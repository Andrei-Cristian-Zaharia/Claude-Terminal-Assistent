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
