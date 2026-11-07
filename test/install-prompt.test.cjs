const test = require("node:test");
const assert = require("node:assert");
const { updateClaudeSettings } = require("../scripts/install-prompt.cjs");

const SHOTS = "C:\\Users\\A\\AppData\\Roaming\\claude-terminal-assistant\\screenshots";
const OLD = "C:\\Users\\A\\AppData\\Roaming\\terminal-claude-helper\\screenshots";
const opts = (extra = {}) => ({ command: 'node "C:/app/src/statusline.cjs"', shotsDir: SHOTS, oldDirs: [OLD], ...extra });

test("install: adds our status line and the screenshots folder, keeps other settings", () => {
  const { settings, notes } = updateClaudeSettings({ model: "opus", permissions: { allow: ["Bash(git:*)"] } }, opts());
  assert.deepStrictEqual(settings, {
    model: "opus",
    permissions: { allow: ["Bash(git:*)"], additionalDirectories: [SHOTS] },
    statusLine: { type: "command", command: 'node "C:/app/src/statusline.cjs"', padding: 0, refreshInterval: 2 },
  });
  assert.deepStrictEqual(notes, []);
});

test("install again: no duplicate folder (any case), the pre-rename folder is dropped", () => {
  const before = { permissions: { additionalDirectories: [OLD, "D:\\other", SHOTS.toUpperCase()] } };
  const { settings } = updateClaudeSettings(before, opts());
  assert.deepStrictEqual(settings.permissions.additionalDirectories, ["D:\\other", SHOTS.toUpperCase()]);
});

test("someone else's status line is kept, the folder is still added", () => {
  const theirs = { type: "command", command: "my-line" };
  const { settings, notes } = updateClaudeSettings({ statusLine: theirs }, opts());
  assert.deepStrictEqual(settings.statusLine, theirs);
  assert.deepStrictEqual(settings.permissions.additionalDirectories, [SHOTS]);
  assert.strictEqual(notes.length, 1);
});

test("uninstall removes only what was added", () => {
  const { settings: installed } = updateClaudeSettings({ permissions: { additionalDirectories: ["D:\\other"] } }, opts());
  const { settings } = updateClaudeSettings(installed, opts({ uninstall: true }));
  assert.deepStrictEqual(settings, { permissions: { additionalDirectories: ["D:\\other"] } });
  const { settings: empty } = updateClaudeSettings(updateClaudeSettings({}, opts()).settings, opts({ uninstall: true }));
  assert.deepStrictEqual(empty, {});
});

const HOOK = 'node "C:/app/src/task-done.cjs"';

test("Stop hook: added next to other hooks, replaced on reinstall, removed on uninstall", () => {
  const theirs = { matcher: "", hooks: [{ type: "command", command: "say done" }] };
  const before = { hooks: { Stop: [theirs], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x" }] }] } };
  const { settings } = updateClaudeSettings(before, opts({ hookCommand: HOOK }));
  assert.deepStrictEqual(settings.hooks.Stop, [theirs, { hooks: [{ type: "command", command: HOOK, timeout: 10 }] }]);
  assert.deepStrictEqual(settings.hooks.PreToolUse, before.hooks.PreToolUse);
  assert.deepStrictEqual(settings.hooks.Notification, [{ matcher: "permission_prompt", hooks: [{ type: "command", command: HOOK, timeout: 10 }] }]);
  // Reinstalled from a moved project: one hook, with the new path.
  const moved = 'node "D:/new/src/task-done.cjs"';
  const { settings: again } = updateClaudeSettings(settings, opts({ hookCommand: moved }));
  assert.deepStrictEqual(again.hooks.Stop, [theirs, { hooks: [{ type: "command", command: moved, timeout: 10 }] }]);
  const { settings: removed } = updateClaudeSettings(again, opts({ hookCommand: moved, uninstall: true }));
  assert.deepStrictEqual(removed.hooks, { Stop: [theirs], PreToolUse: before.hooks.PreToolUse });
  const { settings: empty } = updateClaudeSettings(updateClaudeSettings({}, opts({ hookCommand: HOOK })).settings, opts({ hookCommand: HOOK, uninstall: true }));
  assert.deepStrictEqual(empty, {});
});
