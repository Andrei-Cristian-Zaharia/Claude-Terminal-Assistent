const test = require("node:test");
const assert = require("node:assert");
const { claudeStatus, updateEvents } = require("../src/tasks.cjs");
const { statusChip } = require("../src/labels.cjs");

const claude = (pid, title) => ({ pid, title, processes: ["claude.exe", "powershell.exe"] });

test("claudeStatus: the title glyph says working; the hooks' last event tells waiting and done from idle", () => {
  assert.deepStrictEqual(claudeStatus(claude(1, "◐ Fix the bug")), { state: "working" });
  assert.deepStrictEqual(claudeStatus(claude(1, "⠋ Fix the bug")), { state: "working" }); // older spinner
  // Working wins over an older event: the question was answered, or a new prompt started.
  assert.deepStrictEqual(claudeStatus(claude(1, "◑ Fix"), { kind: "ask", at: 5 }), { state: "working" });
  assert.deepStrictEqual(claudeStatus(claude(1, "✳ Fix"), { kind: "ask", at: 5 }), { state: "ask", at: 5 });
  assert.deepStrictEqual(claudeStatus(claude(1, "✳ Fix"), { kind: "done", at: 7 }), { state: "done", at: 7 });
  assert.deepStrictEqual(claudeStatus(claude(1, "✳ Fix")), { state: "idle" });
  assert.strictEqual(claudeStatus({ pid: 2, title: "npm run dev", processes: ["cmd.exe", "node.exe"] }), null);
});

test("updateEvents: an answered question and closed terminals are dropped", () => {
  const events = new Map([[1, { kind: "ask", at: 1 }], [2, { kind: "ask", at: 1 }], [3, { kind: "done", at: 1 }], [4, { kind: "done", at: 1 }]]);
  updateEvents(events, [claude(1, "◐ working again"), claude(2, "✳ still asking"), claude(3, "◐ next prompt")]);
  assert.deepStrictEqual([...events.keys()], [2, 3]); // 1 answered, 4 closed; done stays until replaced
});

test("statusChip: text for each state", () => {
  const now = 10 * 3600_000;
  assert.deepStrictEqual(statusChip({ state: "working" }, now), { state: "working", text: "Working" });
  assert.deepStrictEqual(statusChip({ state: "ask", at: now }, now), { state: "ask", text: "Needs you" });
  assert.strictEqual(statusChip({ state: "done", at: now - 20_000 }, now).text, "Done · now");
  assert.strictEqual(statusChip({ state: "done", at: now - 3 * 60_000 }, now).text, "Done · 3m");
  assert.strictEqual(statusChip({ state: "done", at: now - 5 * 3600_000 }, now).text, "Done · 5h");
  assert.deepStrictEqual(statusChip({ state: "idle" }, now), { state: "idle", text: "Idle" });
  assert.strictEqual(statusChip(null), null);
});
