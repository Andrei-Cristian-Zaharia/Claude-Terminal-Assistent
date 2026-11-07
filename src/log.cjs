// The app's log file: everything the main process prints, with a time and a level, so problems can
// be looked at (and reported) when the app runs from the login item without a terminal. Kept to
// about 1 MB: at startup a bigger file becomes app.old.log and a new one starts.
const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const MAX_BYTES = 1_000_000;

// -> { file, write(level, args) }. Never throws: a log that can't be written must not stop the app.
function createLog(dir, { maxBytes = MAX_BYTES } = {}) {
  const file = path.join(dir, "app.log");
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
      const old = path.join(dir, "app.old.log");
      fs.rmSync(old, { force: true });
      fs.renameSync(file, old);
    }
  } catch {}
  const write = (level, args) => {
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${util.format(...args)}\n`;
    try { fs.appendFileSync(file, line); } catch {}
  };
  return { file, write };
}

// console.log / warn / error keep printing to the terminal and also go to the log.
function hookConsole(log) {
  for (const [name, level] of [["log", "INFO"], ["info", "INFO"], ["warn", "WARN"], ["error", "ERROR"]]) {
    const original = console[name].bind(console);
    console[name] = (...args) => {
      original(...args);
      log.write(level, args);
    };
  }
}

module.exports = { createLog, hookConsole, MAX_BYTES };
