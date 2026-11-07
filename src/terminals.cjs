// Runs console-helper.cjs in a separate process (see that file for why) using Electron's own
// binary in Node mode, so no separate Node install is needed at runtime.
const path = require("node:path");
const { execFile } = require("node:child_process");

const HELPER = path.join(__dirname, "console-helper.cjs");

function runHelper(args) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [HELPER, ...args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      timeout: 15_000,
    }, (err, stdout) => {
      let out;
      try { out = JSON.parse(stdout); } catch { return reject(err ?? new Error(`console helper gave no answer: ${stdout}`)); }
      if (!out.ok) return reject(new Error(out.error));
      resolve(out.result);
    });
  });
}

const listTerminals = () => runHelper(["list"]);
const terminalAt = (x, y) => runHelper(["at", String(Math.round(x)), String(Math.round(y))]); // physical pixels
// Physical-pixel screen rectangle -> raw BGRA file (see console-helper `capture`).
const captureArea = (x, y, w, h, rawFile) => runHelper(["capture", ...[x, y, w, h].map((n) => String(Math.round(n))), rawFile]);
const sendToTerminal = (pid, text, enter) => runHelper(["send", String(pid), Buffer.from(text, "utf8").toString("base64"), enter ? "1" : "0"]);
// Free dictation into any app: the top-level window at a point, and typing into it by hwnd.
const windowAt = (x, y) => runHelper(["window", String(Math.round(x)), String(Math.round(y))]); // physical pixels
const typeIntoWindow = (hwnd, text, enter) => runHelper(["type", String(hwnd), Buffer.from(text, "utf8").toString("base64"), enter ? "1" : "0"]);

// "Claude finished" cards: the window in front, and bringing a terminal (or, without one, the
// nearest window of the hook's ancestor chain) to the front.
const foregroundWindow = () => runHelper(["foreground"]);
const focusTerminal = (pid, chain = [], tabName = "") => runHelper(["focus", String(pid || 0), chain.join(","), Buffer.from(tabName, "utf8").toString("base64")]);

module.exports = { listTerminals, terminalAt, captureArea, sendToTerminal, windowAt, typeIntoWindow, foregroundWindow, focusTerminal };
