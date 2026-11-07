const test = require("node:test");
const assert = require("node:assert");
const { lastAssistantText, summarize, findTerminal, isShowing, parseMessage } = require("../src/tasks.cjs");

test("lastAssistantText: the last assistant text in a transcript, skipping tools and subagents", () => {
  const lines = [
    '{"type":"user","message":{"role":"user","content":"fix it"}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Earlier answer"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Done: the bug was in parse()."},{"type":"tool_use","name":"Bash"}]}}',
    '{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"subagent talk"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}',
    '{"type":"system","subtype":"stop"}',
  ];
  assert.strictEqual(lastAssistantText(`{"cut line"\n${lines.join("\n")}\n`), "Done: the bug was in parse().");
  assert.strictEqual(lastAssistantText(""), "");
});

test("summarize: paragraphs as sentences, markdown removed, cut at a word", () => {
  assert.strictEqual(summarize("## Gata\n\nAm reparat **bug-ul** din `parse()` și [testele](x.md) trec.\n\n- detaliu"),
    "Gata. Am reparat bug-ul din parse() și testele trec. detaliu.");
  assert.strictEqual(summarize("```js\ncode\n```\n\nAfter the code."), "After the code.");
  assert.strictEqual(summarize("Line one\nline two"), "Line one line two.");
  const long = summarize("word ".repeat(100), 50);
  assert.ok(long.endsWith("…") && long.length <= 51, long);
  assert.strictEqual(summarize(""), "");
});

const TERMS = [
  { pid: 10, owner: 500, hwnd: 600, title: "◐ Session A" },
  { pid: 20, owner: 500, hwnd: 601, title: "Session B" },
  { pid: 30, owner: 700, hwnd: 700, title: "cmd" },
];

test("findTerminal: the listed terminal among the hook's ancestors", () => {
  assert.strictEqual(findTerminal(TERMS, [99, 98, 20, 4]).pid, 20);
  assert.strictEqual(findTerminal(TERMS, [99, 98]), null);
});

test("isShowing: no card for the terminal already in front", () => {
  const fg = (hwnd, title = "", pid = 1) => ({ hwnd, title, pid });
  assert.strictEqual(isShowing({ fg: fg(700), terminal: TERMS[2], terminals: TERMS }), true); // its own window
  assert.strictEqual(isShowing({ fg: fg(800), terminal: TERMS[2], terminals: TERMS }), false); // something else
  // Two tabs in one Windows Terminal window: the window title (the active tab) decides.
  assert.strictEqual(isShowing({ fg: fg(500, "✳ Session A"), terminal: TERMS[0], terminals: TERMS }), true);
  assert.strictEqual(isShowing({ fg: fg(500, "Session B"), terminal: TERMS[0], terminals: TERMS }), false);
  // No listed terminal (Claude in an IDE panel): a window of an ancestor process counts.
  assert.strictEqual(isShowing({ fg: fg(900, "", 42), terminal: null, chain: [7, 42] }), true);
  assert.strictEqual(isShowing({ fg: fg(900, "", 43), terminal: null, chain: [7, 42] }), false);
  assert.strictEqual(isShowing({ fg: null, terminal: TERMS[2], terminals: TERMS }), false);
});

test("parseMessage: keeps what it needs, drops the malformed", () => {
  const m = parseMessage(JSON.stringify({ type: "done", chain: [5, "x", -1, 6], cwd: "C:\p", sessionId: "s", text: "t", extra: 1 }));
  assert.deepStrictEqual(m, { type: "done", kind: "done", chain: [5, 6], cwd: "C:\p", sessionId: "s", text: "t" });
  assert.strictEqual(parseMessage('{"type":"done","kind":"ask","chain":[1]}').kind, "ask");
  assert.strictEqual(parseMessage('{"type":"done","kind":"weird","chain":[1]}').kind, "done");
  assert.strictEqual(parseMessage("not json"), null);
  assert.strictEqual(parseMessage('{"type":"done","chain":[]}'), null);
  assert.strictEqual(parseMessage('{"type":"other","chain":[1]}'), null);
});
