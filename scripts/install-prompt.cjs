// Connects Claude Code and the shells to the app from a source checkout (the installed app does
// the same from Settings → Connect Claude Code). See src/claude-setup.cjs for what it changes.
//
//   npm run install-prompt            install (safe to run again)
//   npm run install-prompt -- --uninstall
const fs = require("fs");
const path = require("path");
const { connect, updateClaudeSettings } = require("../src/claude-setup.cjs");
const { DATA_DIR, loadConfig } = require("../src/config-store.cjs");

const root = path.resolve(__dirname, "..");
const uninstall = process.argv.includes("--uninstall");

if (require.main === module) {
  const cfg = loadConfig(DATA_DIR, root);
  const shotsDir = cfg.screenshotsDir || path.join(DATA_DIR, "screenshots");
  const exe = require("electron"); // from Node, the electron package gives its binary's path
  if (!fs.existsSync(exe)) throw new Error(`Electron is missing (${exe}). Run: node node_modules/electron/install.js`);
  const lines = connect({
    dataDir: DATA_DIR, appDir: root, exe, shotsDir, uninstall,
    oldDirs: [path.join(process.env.APPDATA ?? "", "terminal-claude-helper", "screenshots")],
  });
  for (const l of lines) console.log(l);
  console.log(uninstall ? "Removed. Open new terminals to see the change." : "Done. Open new terminals and restart Claude Code to see the changes.");
}

module.exports = { updateClaudeSettings }; // tested in test/install-prompt.test.cjs
