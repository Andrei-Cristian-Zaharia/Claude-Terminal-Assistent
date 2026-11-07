const test = require("node:test");
const assert = require("node:assert");
const { claudeInfo, segments, bar, tokens, duration, untilReset, ttlSeconds, priceFor, estimateNext, money } = require("../src/statusline.cjs");

const strip = (s) => s.replace(/\x1b\[[\d;]*m/g, "");

const sample = {
  model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
  effort: { level: "medium" },
  context_window: {
    context_window_size: 1000000,
    current_usage: { input_tokens: 2, output_tokens: 390, cache_creation_input_tokens: 237, cache_read_input_tokens: 50766 },
    used_percentage: 5,
  },
  prompt_cache: { warm: true, ttl: "1h", expires_at: 10000 },
  cost: { total_cost_usd: 1.234 },
};

test("tokens, duration and ttl formatting", () => {
  assert.strictEqual(tokens(950), "950");
  assert.strictEqual(tokens(51005), "51k");
  assert.strictEqual(tokens(1000000), "1M");
  assert.strictEqual(tokens(1500000), "1.5M");
  assert.strictEqual(duration(30), "30s");
  assert.strictEqual(duration(47 * 60 + 5), "47m");
  assert.strictEqual(duration(3900), "1h05m");
  assert.strictEqual(ttlSeconds("5m"), 300);
  assert.strictEqual(ttlSeconds("1h"), 3600);
  assert.strictEqual(ttlSeconds("weird"), null);
});

test("claudeInfo reads model, effort, context and cache", () => {
  const { cost, ...rest } = claudeInfo(sample, 10000 - 47 * 60);
  assert.deepStrictEqual(rest, {
    model: "Opus 5.5", effort: "medium", used: 51005, size: 1000000, pct: 5, output: 390, ttl: "1h", cold: false, left: 47 * 60,
    total: 1.234,
  });
  // Warm 1h cache on Opus 5.5: 51005 x $0.20/M read + 390 x $20/M output.
  assert.ok(Math.abs(cost.next - 0.018001) < 1e-9);
  // Cold: 51005 x $8/M (1-hour write, 2x input) + the same output.
  assert.ok(Math.abs(cost.cold - 0.41584) < 1e-9);
});

test("expired or cold cache is cold", () => {
  assert.strictEqual(claudeInfo(sample, 10001).cold, true);
  assert.strictEqual(claudeInfo({ prompt_cache: { warm: false, ttl: "5m" } }).cold, true);
});

test("segments render readable text", () => {
  assert.deepStrictEqual(segments(claudeInfo(sample, 10000 - 47 * 60)).map(strip), [
    "◆ Opus 5.5 ●●○○○ medium",
    "▰▱▱▱▱▱▱▱▱▱ 51k/1M 5%",
    "cache ● 47m / 1h",
    "next ~$0.02 cold $0.42 Σ $1.23",
  ]);
  assert.deepStrictEqual(segments(claudeInfo(sample, 10001)).map(strip).slice(-2), ["cache ○ cold 1h", "next ~$0.42 Σ $1.23"]);
});

test("showNext: false keeps only the session total", () => {
  const info = claudeInfo(sample, 10000 - 47 * 60);
  assert.deepStrictEqual(segments(info, { showNext: false }).map(strip).at(-1), "Σ $1.23");
  // No total either (API-key login without cost): the segment disappears instead of being empty.
  const { total, ...noTotal } = info;
  assert.deepStrictEqual(segments(noTotal, { showNext: false }).map(strip).at(-1), "cache ● 47m / 1h");
});

test("bar fills by percent", () => {
  assert.strictEqual(strip(bar(0)), "▱".repeat(10));
  assert.strictEqual(strip(bar(55)), "▰".repeat(6) + "▱".repeat(4));
  assert.strictEqual(strip(bar(100)), "▰".repeat(10));
});

test("prices match by model-id prefix", () => {
  assert.deepStrictEqual(priceFor("claude-opus-5-5[1m]"), { input: 4, output: 20, read: 0.2 });
  assert.strictEqual(priceFor("claude-opus-5").input, 5);
  assert.strictEqual(priceFor("claude-sonnet-4-6").output, 15);
  assert.strictEqual(priceFor("claude-haiku-5-5", 50_000).input, 0.1);
  assert.strictEqual(priceFor("claude-haiku-5-5", 200_000).input, 0.5); // tier above 100K prompt
  assert.strictEqual(priceFor("gpt-5"), null);
});

test("next-request estimate: cache read when warm, cache write when cold", () => {
  // 100k context on Sonnet 5.5, 5-minute cache, no output yet.
  const e = estimateNext({ modelId: "claude-sonnet-5-5", used: 100_000, ttl: "5m", cold: false });
  assert.ok(Math.abs(e.warm - 0.01) < 1e-9); // 100k x $0.10/M (0.05x input on Sonnet 5.5)
  assert.ok(Math.abs(e.cold - 0.25) < 1e-9); // 100k x $2.50/M (5-minute write, 1.25x input)
  assert.strictEqual(e.next, e.warm);
  assert.strictEqual(estimateNext({ modelId: "claude-sonnet-5-5", used: 100_000, ttl: "5m", cold: true }).next, e.cold);
  assert.strictEqual(estimateNext({ modelId: "unknown", used: 1 }), null);
  assert.strictEqual(money(0.0042), "$0.004");
  assert.strictEqual(money(12.3), "$12.30");
});

test("usage limits: share left and time to reset", () => {
  const now = 1_000_000;
  const info = claudeInfo({
    rate_limits: {
      five_hour: { used_percentage: 21, resets_at: now + 77 * 60 },
      seven_day: { used_percentage: 85, resets_at: now + 5 * 86400 + 14 * 3600 + 5 },
    },
  }, now);
  assert.deepStrictEqual(info.limits, [
    { label: "5h", used: 21, left: 79, resetIn: 77 * 60 },
    { label: "7d", used: 85, left: 15, resetIn: 5 * 86400 + 14 * 3600 + 5 },
  ]);
  assert.deepStrictEqual(segments(info).map(strip), ["5h ▰▱▱▱▱ 79% left ↻ 1h17m · 7d ▰▰▰▰▱ 15% left ↻ 5d14h"]);
  assert.strictEqual(untilReset(-5), "0s"); // reset time already passed
});

test("missing fields are skipped", () => {
  assert.deepStrictEqual(segments(claudeInfo(null)), []);
  assert.deepStrictEqual(segments(claudeInfo({ model: { id: "x" } })).map(strip), ["◆ x"]);
});
