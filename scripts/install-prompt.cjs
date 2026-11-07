// Adds the "● Selected / ○ Not selected" line to every shell and to Claude Code:
//   - PowerShell 5.1 and 7 profiles (CurrentUserAllHosts, so VS Code and IDE terminals too)
//     dot-source shell/prompt.ps1
//   - ~/.bashrc (Git Bash) sources shell/prompt.bash
//   - ~/.claude/settings.json gets a "statusLine" running src/statusline.cjs
// Every added line carries MARKER, so --uninstall removes exactly what was added.
// cmd has no programmable prompt, so it isn't covered.
//
//   npm run install-prompt            install (safe to run again)
//   npm run install-prompt -- --uninstall
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const MARKER = "# terminal-claude-helper";
const root = path.resolve(__dirname, "..");
const fwd = (p) => p.replace(/\\/g, "/");
const uninstall = process.argv.includes("--uninstall");

function profilePath(exe) {
  try {
    return execFileSync(exe, ["-NoProfile", "-Command", "$PROFILE.CurrentUserAllHosts"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null; // that PowerShell isn't installed
  }
}

// Appends `line` (tagged with MARKER) to a profile-like file, or removes tagged lines.
function editLines(file, line) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const kept = old.split(/\r?\n/).filter((l) => !l.includes(MARKER));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  if (!uninstall) kept.push(`${line} ${MARKER}`);
  const eol = old.includes("\r\n") ? "\r\n" : "\n";
  const next = kept.length ? kept.join(eol) + eol : "";
  if (next === old) return console.log(`unchanged  ${file}`);
  if (!old && uninstall) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  console.log(`${uninstall ? "cleaned   " : "updated   "} ${file}`);
}

function editClaudeSettings() {
  const file = path.join(os.homedir(), ".claude", "settings.json");
  const command = `node "${fwd(path.join(root, "src", "statusline.cjs"))}"`;
  let settings = {};
  if (fs.existsSync(file)) {
    try {
      settings = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      return console.log(`skipped    ${file}: not valid JSON (${err.message})`);
    }
  }
  const ours = settings.statusLine?.command?.includes("statusline.cjs");
  if (uninstall) {
    if (!ours) return;
    delete settings.statusLine;
  } else {
    if (settings.statusLine && !ours) {
      return console.log(`skipped    ${file}: it already has a different statusLine:\n           ${JSON.stringify(settings.statusLine)}`);
    }
    // Claude Code re-runs the status line only on session events (a new message, a mode change),
    // so without a timer a selection made from the tray would show up only after the next
    // message. refreshInterval (seconds) re-runs it periodically as well.
    const wanted = { type: "command", command, padding: 0, refreshInterval: 2 };
    if (ours && JSON.stringify(settings.statusLine) === JSON.stringify(wanted)) return console.log(`unchanged  ${file}`);
    settings.statusLine = wanted;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  console.log(`${uninstall ? "cleaned   " : "updated   "} ${file}${fs.existsSync(`${file}.bak`) ? " (backup: settings.json.bak)" : ""}`);
}

const ps1 = path.join(root, "shell", "prompt.ps1");
for (const exe of ["powershell", "pwsh"]) {
  const file = profilePath(exe);
  if (file) editLines(file, `. "${ps1}"`);
}
editLines(path.join(os.homedir(), ".bashrc"), `source "${fwd(path.join(root, "shell", "prompt.bash"))}"`);
editClaudeSettings();
console.log(uninstall ? "Removed. Open new terminals to see the change." : "Done. Open new terminals (and restart Claude Code) to see the line.");
