const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig, withDefaults } = require("../src/config-store.cjs");
const { updateClaudeSettings, launcherText, claudeConnected } = require("../src/claude-setup.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cta-test-"));

test("withDefaults: new settings and new keys in a section take the default", () => {
  const out = withDefaults({ hotkey: "F13", whisper: { model: "m.bin" }, mouseHotkey: [] },
    { hotkey: "Control+Alt", notify: { enabled: true }, whisper: { model: "", port: 8178 }, mouseHotkey: [4, 5] });
  assert.deepStrictEqual(out, { hotkey: "F13", notify: { enabled: true }, whisper: { model: "m.bin", port: 8178 }, mouseHotkey: [] });
});

test("loadConfig: the data folder's file wins; an old checkout config.json is copied over once", () => {
  const app = tmp(), data = tmp();
  fs.writeFileSync(path.join(app, "config.default.json"), JSON.stringify({ hotkey: "Control+Alt", pressEnter: true }));
  assert.deepStrictEqual(loadConfig(data, app), { hotkey: "Control+Alt", pressEnter: true }); // defaults only
  fs.writeFileSync(path.join(app, "config.json"), JSON.stringify({ hotkey: "F13" })); // from before the move
  assert.deepStrictEqual(loadConfig(data, app), { hotkey: "F13", pressEnter: true });
  assert.ok(fs.existsSync(path.join(data, "config.json"))); // copied
  fs.writeFileSync(path.join(data, "config.json"), JSON.stringify({ hotkey: "F14" }));
  assert.strictEqual(loadConfig(data, app).hotkey, "F14"); // the data folder's file wins from now on
});

test("launchers: run the script with the app's exe in Node mode", () => {
  const text = launcherText("C:\\Apps\\CTA\\Claude Terminal Assistant.exe", "C:\\Apps\\CTA\\resources\\app\\src\\task-done.cjs");
  assert.match(text, /set ELECTRON_RUN_AS_NODE=1/);
  assert.match(text, /"C:\\Apps\\CTA\\Claude Terminal Assistant\.exe" "C:\\Apps\\CTA\\resources\\app\\src\\task-done\.cjs" %\*/);
});

test("Claude settings: the launchers replace the node commands from before", () => {
  const before = updateClaudeSettings({}, { command: 'node "C:/x/src/statusline.cjs"', hookCommand: 'node "C:/x/src/task-done.cjs"', shotsDir: "C:\\s" }).settings;
  const opts = { command: "C:/d/bin/statusline.cmd", hookCommand: "C:/d/bin/task-done.cmd", shotsDir: "C:\\s" };
  const after = updateClaudeSettings(before, opts).settings;
  assert.strictEqual(after.statusLine.command, "C:/d/bin/statusline.cmd");
  assert.deepStrictEqual(after.hooks.Stop, [{ hooks: [{ type: "command", command: "C:/d/bin/task-done.cmd", timeout: 10 }] }]);
  assert.strictEqual(after.hooks.Notification.length, 1);
  assert.deepStrictEqual(updateClaudeSettings(after, { ...opts, uninstall: true }).settings, {});
});

test("claudeConnected: reads our hook from Claude Code's settings", () => {
  const home = tmp();
  assert.strictEqual(claudeConnected(home), false);
  fs.mkdirSync(path.join(home, ".claude"));
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "C:/d/bin/task-done.cmd" }] }] } }));
  assert.strictEqual(claudeConnected(home), true);
});
