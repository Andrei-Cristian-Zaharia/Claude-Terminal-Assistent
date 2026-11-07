const test = require("node:test");
const assert = require("node:assert");
const { assignTabNames, sameTitle } = require("../src/tabnames.cjs");
const { terminalLabel } = require("../src/labels.cjs");
const { isShowing } = require("../src/tasks.cjs");

const con = (pid, owner, title) => ({ pid, owner, title, shell: "powershell.exe", host: "WindowsTerminal.exe" });
const names = (list) => Object.fromEntries(list.map((c) => [c.pid, c.tabName ?? null]));

test("sameTitle: glyphs, case and prefixes don't make a rename", () => {
  assert.ok(sameTitle("✳ Organizarea listei", "◐ Organizarea listei"));
  assert.ok(sameTitle("Administrator: Windows PowerShell", "Windows PowerShell"));
  assert.ok(!sameTitle("Pokemon", "Organizarea listei"));
  assert.ok(!sameTitle("", "x"));
});

test("a window with one renamed tab: its console gets the name", () => {
  const out = assignTabNames([con(1, 100, "✳ Organizarea listei"), con(2, 200, "cmd")],
    [{ hwnd: 100, tabs: [{ name: "Pokemon" }] }, { hwnd: 200, tabs: [{ name: "cmd" }] }]);
  assert.deepStrictEqual(names(out), { 1: "Pokemon", 2: null });
});

test("several tabs: the one renamed tab goes to the one console no tab shows", () => {
  const consoles = [con(1, 100, "Session A"), con(2, 100, "Session B"), con(3, 100, "Session C")];
  const out = assignTabNames(consoles, [{ hwnd: 100, tabs: [{ name: "Session A" }, { name: "Server" }, { name: "✳ Session C" }] }]);
  assert.deepStrictEqual(names(out), { 1: null, 2: "Server", 3: null });
  assert.strictEqual(consoles[1].tabName, undefined); // the input is not changed
});

test("two renamed tabs in one window can't be told apart: no names", () => {
  const out = assignTabNames([con(1, 100, "A"), con(2, 100, "B")], [{ hwnd: 100, tabs: [{ name: "Front" }, { name: "Back" }] }]);
  assert.deepStrictEqual(names(out), { 1: null, 2: null });
});

test("one renamed tab split into panes: every pane gets the tab's name", () => {
  const out = assignTabNames([con(1, 100, "A"), con(2, 100, "B")], [{ hwnd: 100, tabs: [{ name: "Work" }] }]);
  assert.deepStrictEqual(names(out), { 1: "Work", 2: "Work" });
});

test("labels: the tab name is the title, the console title moves next to where it runs", () => {
  const label = terminalLabel({ ...con(1, 100, "✳ Organizarea listei"), tabName: "Pokemon", processes: ["claude.exe"] });
  assert.strictEqual(label.title, "Pokemon");
  assert.strictEqual(label.where, "PowerShell in Windows Terminal · Organizarea listei");
  // A renamed cmd tab: the path title says nothing, so it isn't repeated.
  assert.strictEqual(terminalLabel({ ...con(2, 0, "C:\\WINDOWS\\system32\\cmd.exe"), shell: "cmd.exe", tabName: "Build" }).where, "Command Prompt in Windows Terminal");
});

test("isShowing: a renamed active tab is recognised by its name", () => {
  const terminals = [{ pid: 1, owner: 500, title: "Session A", tabName: "Pokemon" }, { pid: 2, owner: 500, title: "Session B" }];
  assert.strictEqual(isShowing({ fg: { hwnd: 500, title: "Pokemon" }, terminal: terminals[0], terminals }), true);
  assert.strictEqual(isShowing({ fg: { hwnd: 500, title: "Pokemon" }, terminal: terminals[1], terminals }), false);
});
