const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { needsRestart, validate, formatConfig } = require("../src/settings-model.cjs");
const { acceleratorKey, uiohookKey, shortcutRecorder } = require("../src/keys.js");
const { terminalLabel, keycaps, buttonName } = require("../src/labels.cjs");
const { micBitmap, micDistance, appIconBitmap } = require("../src/tray-icon.cjs");

const CONFIG_FILE = path.join(__dirname, "..", "config.json");
const KEY_NAMES = ["A", "F13", "Ctrl", "CtrlRight", "Space", "1"];

test("formatConfig writes config.json back exactly as it is", () => {
  const text = fs.readFileSync(CONFIG_FILE, "utf8");
  assert.strictEqual(`${formatConfig(JSON.parse(text))}\n`, text.replace(/\r\n/g, "\n"));
  assert.strictEqual(formatConfig({ a: [], b: {} }), '{ "a": [], "b": {} }');
  assert.strictEqual(formatConfig({ a: [], c: [1, 2] }), '{\n  "a": [],\n  "c": [1, 2]\n}');
});

test("validate accepts the current config and names each bad field", () => {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  assert.deepStrictEqual(validate(cfg, KEY_NAMES), []);
  const bad = { ...cfg, hotkey: " ", mouseHotkey: [4], select: { key: "Nope" }, maxRecordSeconds: 2, screenRecord: { intervalMs: 50, maxFrames: 0 } };
  assert.deepStrictEqual(validate(bad, KEY_NAMES).map((e) => e.field),
    ["hotkey", "mouseHotkey", "select", "maxRecordSeconds", "screenRecord.intervalMs", "screenRecord.maxFrames"]);
  assert.deepStrictEqual(validate({ ...cfg, mouseHotkey: [], select: { key: "F13" } }, KEY_NAMES), []);
});

test("needsRestart only for settings read at startup", () => {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  assert.strictEqual(needsRestart(cfg, { ...cfg, pressEnter: !cfg.pressEnter, maxRecordSeconds: 30 }), false);
  assert.strictEqual(needsRestart(cfg, { ...cfg, hotkey: "F13" }), true);
  assert.strictEqual(needsRestart(cfg, { ...cfg, whisper: { ...cfg.whisper, language: "en" } }), true);
});

test("shortcut recorder: key with modifiers, modifiers alone, errors", () => {
  let r = shortcutRecorder();
  assert.strictEqual(r.down("AltLeft"), null);
  assert.strictEqual(r.down("ControlLeft"), null);
  assert.deepStrictEqual(r.down("Space"), { accelerator: "Control+Alt+Space" });
  r = shortcutRecorder();
  r.down("ControlLeft"); r.down("AltRight");
  assert.strictEqual(r.up("ControlLeft"), null); // one still held
  assert.deepStrictEqual(r.up("AltRight"), { accelerator: "Control+Alt" });
  r = shortcutRecorder();
  r.down("ShiftLeft");
  assert.ok(r.up("ShiftLeft").error); // a lone modifier is not a shortcut
  assert.deepStrictEqual(shortcutRecorder().down("F13"), { accelerator: "F13" });
  assert.ok(shortcutRecorder().down("ContextMenu").error);
  assert.strictEqual(acceleratorKey("KeyK"), "K");
  assert.strictEqual(acceleratorKey("ArrowUp"), "Up");
  assert.strictEqual(acceleratorKey("Numpad7"), "num7");
});

test("uiohookKey maps browser codes to uiohook names", () => {
  assert.strictEqual(uiohookKey("F13", KEY_NAMES), "F13");
  assert.strictEqual(uiohookKey("KeyA", KEY_NAMES), "A");
  assert.strictEqual(uiohookKey("ControlRight", KEY_NAMES), "CtrlRight");
  assert.strictEqual(uiohookKey("Digit1", KEY_NAMES), "1");
  assert.strictEqual(uiohookKey("Pause", KEY_NAMES), null);
});

test("terminal labels read like a person would say them", () => {
  assert.deepStrictEqual(
    terminalLabel({ pid: 1, title: "✳ Afișaj ECG Romas", shell: "powershell.exe", host: "WindowsTerminal.exe", processes: ["claude.exe", "powershell.exe"] }),
    { pid: 1, title: "Afișaj ECG Romas", where: "PowerShell in Windows Terminal", claude: true });
  assert.deepStrictEqual(
    terminalLabel({ pid: 2, title: "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", shell: "powershell.exe", host: "idea64.exe", processes: ["powershell.exe"] }),
    { pid: 2, title: "PowerShell", where: "PowerShell in IntelliJ IDEA", claude: false });
  assert.strictEqual(terminalLabel({ pid: 3, title: "", shell: "cmd.exe", host: "" }).where, "Command Prompt in a console window");
  assert.deepStrictEqual(keycaps("Control+Alt"), ["Ctrl", "Alt"]);
  assert.deepStrictEqual(keycaps("Super+Shift+K"), ["Win", "Shift", "K"]);
  assert.strictEqual(buttonName(4), "Back");
});

test("tray microphone: solid body, empty background, scales", () => {
  assert.ok(micDistance(8, 6) < 0); // inside the capsule
  assert.ok(micDistance(1, 1) > 0);
  const b16 = micBitmap(16, [52, 199, 89]);
  const alpha = (buf, size, x, y) => buf[(y * size + x) * 4 + 3];
  assert.strictEqual(alpha(b16, 16, 8, 6), 255);
  assert.strictEqual(alpha(b16, 16, 0, 0), 0);
  assert.strictEqual(alpha(micBitmap(32, [0, 0, 0]), 32, 16, 12), 255);
});

test("app icon: rounded tile, light microphone, ember lamp", () => {
  const size = 64, b = appIconBitmap(size);
  const px = (x, y) => [...b.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)]; // BGRA
  assert.strictEqual(px(0, 0)[3], 0); // rounded corner is transparent
  const orange = (p) => p[2] > 230 && p[1] > 90 && p[1] < 160 && p[0] < 60; // BGRA: R high, G mid, B low
  assert.ok(orange(px(22, 32))); // the prompt chevron, near its tip
  assert.ok(px(39, 32).slice(0, 3).every((c) => c > 220)); // the tallest wave bar in light ink
  assert.ok(px(6, 40).slice(0, 3).every((c) => c < 70)); // graphite tile
  // 16 px: three 1 px bars on whole pixels with a clear gap between them, not one white block.
  const small = appIconBitmap(16);
  const at = (x, y) => [...small.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 3)];
  assert.ok(at(10, 8).every((c) => c > 200)); // middle bar
  assert.ok(at(9, 8).every((c) => c < 90) && at(11, 8).every((c) => c < 90)); // the gaps beside it

});

test("terminals shortcut: a key with modifiers, off, or an error", () => {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  const fields = (c) => validate(c, KEY_NAMES).map((e) => e.field);
  assert.deepStrictEqual(fields({ ...cfg, terminalsHotkey: "Control+Tab" }), []);
  assert.deepStrictEqual(fields({ ...cfg, terminalsHotkey: "" }), []);
  assert.deepStrictEqual(fields({ ...cfg, terminalsHotkey: "Control+Alt" }), ["terminalsHotkey"]);
  assert.deepStrictEqual(fields({ ...cfg, hotkey: "F13", terminalsHotkey: "F13" }), ["terminalsHotkey"]);
  assert.strictEqual(needsRestart(cfg, { ...cfg, terminalsHotkey: "Control+Q" }), true);
});
