// The settings window edits config.json. This file holds the parts that are plain data: checking
// a new config, telling whether it needs a restart, and writing it back in the file's own style.

// Read once at startup (hooks, hotkey registration, the Whisper server's arguments): changing them
// restarts the app. Everything else is read when used and applies at once.
const RESTART_KEYS = ["hotkey", "terminalsHotkey", "mouseHotkey", "mouseHoldMs", "select", "whisper", "screenshotsDir"];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const needsRestart = (before, after) => RESTART_KEYS.some((k) => !same(before[k], after[k]));

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNum = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

// -> [{ field, message }]; empty when the config can be saved. `keyNames`: uiohook key names.
function validate(c, keyNames = []) {
  const errors = [];
  const bad = (field, message) => errors.push({ field, message });
  if (c.startAtLogin !== undefined && typeof c.startAtLogin !== "boolean") bad("startAtLogin", "Turn starting with Windows on or off.");
  if (typeof c.hotkey !== "string" || !c.hotkey.trim()) bad("hotkey", "Set a recording shortcut.");
  const th = c.terminalsHotkey ?? "";
  const MODS = ["control", "ctrl", "alt", "shift", "super", "meta", "commandorcontrol", "cmdorctrl"];
  if (typeof th !== "string" || (th && th.split("+").every((p) => MODS.includes(p.trim().toLowerCase())))) {
    bad("terminalsHotkey", "The terminal list needs a key with its modifiers, such as Ctrl+Tab.");
  } else if (th && th.toLowerCase() === String(c.hotkey).toLowerCase()) {
    bad("terminalsHotkey", "Use a different shortcut from the one that records.");
  }
  if (!Array.isArray(c.mouseHotkey) || !(c.mouseHotkey.length === 0 || (c.mouseHotkey.length >= 2 && c.mouseHotkey.every((b) => isInt(b, 3, 5))))) {
    bad("mouseHotkey", "A mouse chord needs two or more of the Middle, Back and Forward buttons.");
  }
  if (!isInt(c.mouseHoldMs ?? 1500, 0, 10000)) bad("mouseHoldMs", "Hold time must be 0 to 10 seconds.");
  const sel = c.select ?? {};
  if (!(isInt(sel.mouseButton, 3, 5) || (typeof sel.key === "string" && keyNames.includes(sel.key)))) {
    bad("select", "Choose a mouse button or a key for picking terminals.");
  }
  const cf = c.confirm ?? {};
  if (cf.enabled !== undefined && typeof cf.enabled !== "boolean") bad("confirm.enabled", "Turn asking before sending on or off.");
  if (!isInt(cf.seconds ?? 3, 1, 30)) bad("confirm.seconds", "The countdown must be 1 to 30 seconds.");
  if (!isInt(c.maxRecordSeconds, 5, 600)) bad("maxRecordSeconds", "Recording length must be 5 to 600 seconds.");
  if (!isNum(c.silenceLevel, 0.001, 0.2)) bad("silenceLevel", "The silence threshold must be between 0.001 and 0.2.");
  const sr = c.screenRecord ?? {};
  if (!isInt(sr.intervalMs, 250, 10000)) bad("screenRecord.intervalMs", "Frame interval must be 0.25 to 10 seconds.");
  if (!isInt(sr.maxFrames, 1, 30)) bad("screenRecord.maxFrames", "Keep 1 to 30 frames.");
  const w = c.whisper ?? {};
  if (typeof w.model !== "string" || !w.model) bad("whisper.model", "Choose a Whisper model.");
  if (typeof w.language !== "string" || !w.language) bad("whisper.language", "Choose a language.");
  if (!isInt(w.idleUnloadMinutes, 0, 240)) bad("whisper.idleUnloadMinutes", "Unload time must be 0 to 240 minutes.");
  if (!isInt(w.threads, 1, 32)) bad("whisper.threads", "Threads must be 1 to 32.");
  return errors;
}

// JSON like the hand-written config.json: two-space indent, short arrays and flat objects on one
// line ("mouseHotkey": [4, 5], "select": { "mouseButton": 4 }).
function formatConfig(value, indent = "") {
  const flat = (v) => v === null || typeof v !== "object" || !Object.keys(v).length; // empty [] and {} too
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((v) => [null, v]) : Object.entries(value);
  if (!entries.length) return isArray ? "[]" : "{}";
  const item = ([k, v], inner) => `${k === null ? "" : `${JSON.stringify(k)}: `}${formatConfig(v, inner)}`;
  if (entries.every(([, v]) => flat(v))) {
    const line = entries.map((e) => item(e, "")).join(", ");
    const one = isArray ? `[${line}]` : `{ ${line} }`;
    if (indent.length + one.length <= 80) return one;
  }
  const inner = `${indent}  `;
  const body = entries.map((e) => `${inner}${item(e, inner)}`).join(",\n");
  return isArray ? `[\n${body}\n${indent}]` : `{\n${body}\n${indent}}`;
}

module.exports = { RESTART_KEYS, needsRestart, validate, formatConfig };
