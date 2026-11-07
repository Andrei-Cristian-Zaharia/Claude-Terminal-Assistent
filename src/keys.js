// Keyboard capture for the settings window, shared with the tests: turns browser key events into
// an Electron accelerator ("Control+Alt+Space") or a uiohook key name ("F13"). Loaded as a plain
// <script> in settings.html (sets window.Keys) and with require() in Node.
(function (root) {
  const MODIFIER_CODES = {
    ControlLeft: "Control", ControlRight: "Control", AltLeft: "Alt", AltRight: "Alt",
    ShiftLeft: "Shift", ShiftRight: "Shift", MetaLeft: "Super", MetaRight: "Super",
  };
  const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Super"];

  // KeyboardEvent.code -> Electron accelerator key.
  const ACCEL = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Escape: "Escape",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", PrintScreen: "PrintScreen",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
    Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
    NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv", NumpadDecimal: "numdec",
  };

  function acceleratorKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    return ACCEL[code] ?? null;
  }

  // KeyboardEvent.code -> uiohook-napi UiohookKey name (null if uiohook has no such key).
  const UIOHOOK = {
    ControlLeft: "Ctrl", ControlRight: "CtrlRight", AltLeft: "Alt", AltRight: "AltRight",
    ShiftLeft: "Shift", ShiftRight: "ShiftRight", MetaLeft: "Meta", MetaRight: "MetaRight",
  };
  function uiohookKey(code, names) {
    let name = UIOHOOK[code];
    if (!name && /^Key[A-Z]$/.test(code)) name = code.slice(3);
    if (!name && /^Digit[0-9]$/.test(code)) name = code.slice(5);
    if (!name) name = code;
    return names.includes(name) ? name : null;
  }

  // A recorder for one shortcut. Feed it keydown/keyup codes; it reports a result once:
  // a key with any modifiers ("Control+Shift+K", "F13"), or modifiers alone once all are released
  // ("Control+Alt", at least two so a lone Ctrl tap never triggers recording).
  function shortcutRecorder() {
    const held = new Set();
    let mods = new Set();
    return {
      down(code) {
        const m = MODIFIER_CODES[code];
        if (m) { held.add(code); mods.add(m); return null; }
        const key = acceleratorKey(code);
        if (!key) return { error: "That key can't be used in a shortcut." };
        return { accelerator: [...MODIFIER_ORDER.filter((x) => mods.has(x)), key].join("+") };
      },
      up(code) {
        if (!MODIFIER_CODES[code]) return null;
        held.delete(code);
        if (held.size) return null;
        const chosen = MODIFIER_ORDER.filter((x) => mods.has(x));
        mods = new Set();
        if (chosen.length >= 2) return { accelerator: chosen.join("+") };
        return chosen.length ? { error: "Use at least two modifier keys, or add another key." } : null;
      },
    };
  }

  const api = { acceleratorKey, uiohookKey, shortcutRecorder };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Keys = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
