// Tells whether the current terminal is the tray app's voice target.
//
//   node src/statusline.cjs           Claude Code status line ("statusLine" in settings.json):
//                                     a colored "● Selected" / "○ Not selected", followed by
//                                     session info from the JSON Claude pipes on stdin:
//                                     model + effort meter │ context bar used/max │ cache TTL countdown
//                                     │ estimated cost of the next request + session total
//                                     │ subscription usage left per limit + time to reset
//   node src/statusline.cjs --plain   for shell prompts (shell/prompt.*): "selected" or
//                                     "not-selected", plain ASCII so any console codepage works
//
// The saved target pid is the console's anchor (the topmost process in that terminal). Each
// mode uses the check that holds for it:
//   --plain (shell prompts): the target pid is attached to this process's console. The prompt
//     runs inside the terminal's own console. The parent chain would be wrong here: Git Bash's
//     $(...) goes through an msys process that has already exited, which breaks the chain, and a
//     new window opened from the target terminal still descends from it.
//   default (Claude Code): the target pid is an ancestor. Claude may start status-line commands
//     in a separate hidden console, but its own parent chain leads back to the terminal.
// The status line's refreshInterval re-runs this every few seconds, so the cache countdown stays live.
const fs = require("fs");
const path = require("path");

// 24-bit colors: Windows Terminal, VS Code and conhost on Windows 10+ all render them.
const rgb = (hex) => (s) => `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m${s}\x1b[39m`;
const bold = (s) => `\x1b[1m${s}\x1b[22m`;
const C = {
  green: rgb("#4ADE80"),
  yellow: rgb("#FACC15"),
  orange: rgb("#FB923C"),
  red: rgb("#F87171"),
  claude: rgb("#D97757"), // Claude's terracotta
  ember: rgb("#FF7A1A"), // the app's orange accent (src/theme.css)
  text: rgb("#E5E7EB"),
  dim: rgb("#6B7280"),
  faint: rgb("#3F4652"),
};

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_COLOR = { low: C.dim, medium: C.yellow, high: C.orange, xhigh: C.red, max: C.red };

function targetPid() {
  // The app's data folder, or the one it had before the rename (until the app has moved it).
  for (const dir of ["claude-terminal-assistant", "terminal-claude-helper"]) {
    const file = path.join(process.env.APPDATA ?? "", dir, "state.json");
    try { return JSON.parse(fs.readFileSync(file, "utf8")).target?.pid ?? null; } catch {}
  }
  return null;
}

function isAncestor(pid, processes) {
  const procs = processes();
  const seen = new Set();
  for (let p = procs.get(process.pid)?.ppid; p && !seen.has(p); p = procs.get(p)?.ppid) {
    if (p === pid) return true;
    seen.add(p);
  }
  return false;
}

// 51005 -> "51k", 1000000 -> "1M", 1500000 -> "1.5M".
function tokens(n) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

// Seconds -> "1h05m", "47m", "30s".
function duration(sec) {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m`;
  return `${sec}s`;
}

// Seconds -> "5d14h", "1h05m", "47m": days only matter for the weekly limit.
function untilReset(sec) {
  if (sec >= 86400) return `${Math.floor(sec / 86400)}d${Math.floor((sec % 86400) / 3600)}h`;
  return duration(Math.max(0, sec));
}

// "5m" / "1h" -> seconds.
function ttlSeconds(ttl) {
  const m = /^(\d+)([smh])$/.exec(ttl ?? "");
  return m ? Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]] : null;
}

// Anthropic API list prices, $ per million tokens (first-party, standard speed, checked 2026-11-06
// against https://platform.claude.com/docs/en/about-claude/pricing).
// Cache writes cost 1.25x input for the 5-minute TTL and 2x for the 1-hour TTL on every model;
// cache reads are listed per model because the newest models discount them more than 0.1x.
// Matched by model-id prefix, longest first ("claude-opus-5-5[1m]" -> "claude-opus-5-5").
const PRICES = {
  "claude-fable-5-1": { input: 10, output: 50, read: 0.25 },
  "claude-mythos-5-1": { input: 10, output: 50, read: 0.25 },
  "claude-fable-5": { input: 10, output: 50, read: 1 },
  "claude-mythos-5": { input: 10, output: 50, read: 1 },
  "claude-opus-5-5": { input: 4, output: 20, read: 0.2 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10, read: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4": { input: 3, output: 15 },
  // Haiku 5.5 is tiered: prompts above 100K tokens cost $0.50 / $2.50.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, above100k: { input: 0.5, output: 2.5 } },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
const PRICE_KEYS = Object.keys(PRICES).sort((a, b) => b.length - a.length);

function priceFor(modelId, promptTokens = 0) {
  const key = PRICE_KEYS.find((k) => (modelId ?? "").startsWith(k));
  if (!key) return null;
  let p = PRICES[key];
  if (p.above100k && promptTokens > 100_000) p = { ...p, ...p.above100k };
  return { input: p.input, output: p.output, read: p.read ?? p.input * 0.1 };
}

// What the next request is likely to cost, in dollars. The whole current context is sent again:
// billed as a cache read while the cache is warm, or written to the cache again once it has gone
// cold. The reply is assumed to be about as long as the last one.
function estimateNext({ modelId, used, output = 0, ttl, cold }) {
  const p = priceFor(modelId, used);
  if (!p || !used) return null;
  const write = p.input * (ttl === "1h" ? 2 : 1.25);
  const out = (output * p.output) / 1e6;
  return {
    warm: (used * p.read) / 1e6 + out,
    cold: (used * write) / 1e6 + out,
    next: ((used * (cold ? write : p.read)) / 1e6) + out,
  };
}

// 0.004 -> "$0.004", 0.123 -> "$0.12", 12.3 -> "$12.30".
function money(usd) {
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

// Session info from Claude Code's status-line JSON. Missing fields stay undefined, so older
// Claude Code versions still show what they provide.
function claudeInfo(data, nowSec = Math.floor(Date.now() / 1000)) {
  const info = {};
  info.model = data?.model?.display_name ?? data?.model?.id;
  info.effort = data?.effort?.level;

  const cw = data?.context_window;
  if (cw?.context_window_size) {
    // What the next request sends = the current context size.
    const u = cw.current_usage ?? {};
    info.used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    info.size = cw.context_window_size;
    info.pct = cw.used_percentage ?? Math.round((info.used / info.size) * 100);
    info.output = u.output_tokens ?? 0;
  }

  const pc = data?.prompt_cache;
  if (pc?.ttl) {
    info.ttl = pc.ttl;
    const left = pc.expires_at ? pc.expires_at - nowSec : null;
    info.cold = pc.warm === false || (left !== null && left <= 0);
    if (!info.cold && left !== null) info.left = left;
  }

  const est = estimateNext({ modelId: data?.model?.id, used: info.used, output: info.output, ttl: info.ttl, cold: info.cold });
  if (est) info.cost = est;
  const total = data?.cost?.total_cost_usd;
  if (typeof total === "number") info.total = total;

  // Subscription usage limits (Pro/Max): share used and when each window resets. Only sent for
  // subscription logins, so API-key sessions simply show no usage segment.
  const limits = [];
  for (const [key, l] of Object.entries(data?.rate_limits ?? {})) {
    if (typeof l?.used_percentage !== "number") continue;
    limits.push({
      label: LIMIT_LABELS[key] ?? key.replace(/_/g, " "),
      used: l.used_percentage,
      left: Math.max(0, 100 - l.used_percentage),
      ...(l.resets_at ? { resetIn: Math.max(0, l.resets_at - nowSec) } : {}),
    });
  }
  if (limits.length) info.limits = limits;
  return info;
}

const LIMIT_LABELS = { five_hour: "5h", seven_day: "7d", seven_day_opus: "7d Opus", seven_day_sonnet: "7d Sonnet" };

// "▰▰▱▱▱▱▱▱▱▱": filled share of `width` cells, colored by how full it is.
function bar(pct, width = 10) {
  const filled = Math.min(width, Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * width)));
  const color = pct >= 80 ? C.red : pct >= 50 ? C.yellow : C.green;
  return color("▰".repeat(filled)) + C.faint("▱".repeat(width - filled));
}

// Colored segments for the status line. `opts` comes from the settings' "statusLine":
//   showNext (default true): the "next ~$X" / "cold $Y" estimate before the session total.
function segments(info, { showNext = true } = {}) {
  const out = [];
  if (info.model) {
    let s = C.claude(bold(`◆ ${info.model}`));
    const lvl = EFFORTS.indexOf(info.effort);
    if (lvl >= 0) {
      const color = EFFORT_COLOR[info.effort];
      s += ` ${color("●".repeat(lvl + 1))}${C.faint("○".repeat(EFFORTS.length - lvl - 1))} ${color(info.effort)}`;
    } else if (info.effort) {
      s += ` ${C.dim(info.effort)}`;
    }
    out.push(s);
  }
  if (info.size) {
    out.push(`${bar(info.pct)} ${C.text(tokens(info.used))}${C.dim(`/${tokens(info.size)}`)} ${C.dim(`${info.pct}%`)}`);
  }
  if (info.ttl) {
    if (info.cold) {
      out.push(`${C.dim("cache")} ${C.dim(`○ cold`)} ${C.faint(info.ttl)}`);
    } else if (info.left !== undefined) {
      const share = info.left / (ttlSeconds(info.ttl) ?? info.left);
      const color = info.left < 120 || share < 0.1 ? C.red : share < 0.25 ? C.yellow : C.green;
      out.push(`${C.dim("cache")} ${color(`● ${duration(info.left)}`)} ${C.faint(`/ ${info.ttl}`)}`);
    } else {
      out.push(`${C.dim("cache")} ${C.green("●")} ${C.faint(info.ttl)}`);
    }
  }
  if (info.cost || info.total !== undefined) {
    const parts = [];
    if (info.cost && showNext) {
      const n = info.cost.next;
      const color = n >= 0.5 ? C.red : n >= 0.1 ? C.yellow : C.green;
      parts.push(`${C.dim("next")} ${color(`~${money(n)}`)}`);
      // While warm, what letting the cache expire would cost: the reason to keep it warm.
      if (!info.cold && info.cost.cold - info.cost.warm >= 0.01) parts.push(C.faint(`cold ${money(info.cost.cold)}`));
    }
    if (info.total !== undefined) parts.push(C.dim(`Σ ${money(info.total)}`));
    if (parts.length) out.push(parts.join(" "));
  }
  if (info.limits) {
    // "5h ▰▰▱▱▱ 79% left ↻ 1h17m": the bar fills with what is used, the number says what is left,
    // ↻ the time until the window resets (with a space after it, so the glyph doesn't crowd the digits).
    out.push(info.limits.map((l) => {
      const color = l.used >= 80 ? C.red : l.used >= 50 ? C.yellow : C.green;
      const reset = l.resetIn !== undefined ? ` ${C.faint(`↻ ${untilReset(l.resetIn)}`)}` : "";
      return `${C.dim(l.label)} ${bar(l.used, 5)} ${color(`${l.left}% left`)}${reset}`;
    }).join(C.faint(" · ")));
  }
  return out;
}

function readStdinJson() {
  if (process.stdin.isTTY) return null; // run by hand with nothing piped: don't block
  try { return JSON.parse(fs.readFileSync(0, "utf8")); } catch { return null; }
}

// The "statusLine" section of the settings (config-store.cjs); missing means defaults.
function statusLineConfig() {
  try {
    const { DATA_DIR, loadConfig } = require("./config-store.cjs");
    return loadConfig(DATA_DIR, path.join(__dirname, "..")).statusLine ?? {};
  } catch {
    return {};
  }
}

function main() {
  const { processes, consolePids } = require("./console-helper.cjs");
  const plain = process.argv.includes("--plain");
  let selected = false;
  try {
    const pid = targetPid();
    selected = Boolean(pid && (plain ? consolePids().includes(pid) : isAncestor(pid, processes)));
  } catch {
    // A prompt or status line must never fail loudly; report "not selected".
  }

  if (plain) return process.stdout.write(selected ? "selected" : "not-selected");

  const parts = [selected ? C.ember(bold("● Selected")) : C.dim("○ Not selected")];
  try {
    parts.push(...segments(claudeInfo(readStdinJson()), statusLineConfig()));
  } catch {
    // Keep at least the selected marker.
  }
  process.stdout.write(parts.join(C.faint("  │  ")) + "\x1b[0m");
}

if (require.main === module) main();
module.exports = { claudeInfo, segments, bar, tokens, duration, untilReset, ttlSeconds, priceFor, estimateNext, money };
