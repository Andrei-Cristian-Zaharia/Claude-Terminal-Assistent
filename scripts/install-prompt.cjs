// Adds the "● Selected / ○ Not selected" line to every shell and to Claude Code:
//   - PowerShell 5.1 and 7 profiles (CurrentUserAllHosts, so VS Code and IDE terminals too)
//     dot-source shell/prompt.ps1
//   - ~/.bashrc (Git Bash) sources shell/prompt.bash
//   - ~/.claude/settings.json gets a "statusLine" running src/statusline.cjs, and the screenshots
//     folder in permissions.additionalDirectories, so Claude Code can open the screenshots and
//     screen-recording frames whose paths are dictated to it, in any project, without asking
// Every added line carries MARKER, so --uninstall removes exactly what was added.
// cmd has no programmable prompt, so it isn't covered.
//
//   npm run install-prompt            install (safe to run again)
//   npm run install-prompt -- --uninstall
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const MARKER = "# claude-terminal-assistant";
const OLD_MARKER = "# terminal-claude-helper"; // lines added before the rename are replaced or removed too
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
  const kept = old.split(/\r?\n/).filter((l) => !l.includes(MARKER) && !l.includes(OLD_MARKER));
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

// The screenshots folder the app uses: config.json "screenshotsDir", or its default.
function screenshotsDir() {
  let dir = "";
  try { dir = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")).screenshotsDir || ""; } catch {}
  return dir || path.join(process.env.APPDATA ?? "", "claude-terminal-assistant", "screenshots");
}
// Where screenshots were before the app was renamed; removed from the list (the app moved them).
const OLD_SHOTS_DIR = path.join(process.env.APPDATA ?? "", "terminal-claude-helper", "screenshots");

// Claude Code settings object -> { settings, notes }. Pure, so it can be tested.
//   statusLine: ours is added or updated; someone else's is left alone (and noted).
//   permissions.additionalDirectories: the screenshots folder is added; the pre-rename folder is
//   dropped. --uninstall removes both entries and our statusLine.
function updateClaudeSettings(input, { command, shotsDir, oldDirs = [], uninstall = false }) {
  const settings = structuredClone(input ?? {});
  const notes = [];
  const ours = settings.statusLine?.command?.includes("statusline.cjs");
  if (uninstall) {
    if (ours) delete settings.statusLine;
  } else if (settings.statusLine && !ours) {
    notes.push(`kept its own statusLine: ${JSON.stringify(settings.statusLine)}`);
  } else {
    // Claude Code re-runs the status line only on session events (a new message, a mode change),
    // so without a timer a selection made from the tray would show up only after the next
    // message. refreshInterval (seconds) re-runs it periodically as well.
    settings.statusLine = { type: "command", command, padding: 0, refreshInterval: 2 };
  }

  const key = (p) => path.resolve(p).toLowerCase();
  const drop = new Set([...oldDirs, ...(uninstall ? [shotsDir] : [])].map(key));
  const dirs = (settings.permissions?.additionalDirectories ?? []).filter((d) => !drop.has(key(d)));
  if (!uninstall && !dirs.some((d) => key(d) === key(shotsDir))) dirs.push(shotsDir);
  if (dirs.length || settings.permissions?.additionalDirectories) {
    settings.permissions = { ...settings.permissions, additionalDirectories: dirs };
    if (!dirs.length) delete settings.permissions.additionalDirectories;
    if (!Object.keys(settings.permissions).length) delete settings.permissions;
  }
  return { settings, notes };
}

function editClaudeSettings() {
  const file = path.join(os.homedir(), ".claude", "settings.json");
  let current = {};
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      return console.log(`skipped    ${file}: not valid JSON (${err.message})`);
    }
  }
  const shotsDir = screenshotsDir();
  if (!uninstall) fs.mkdirSync(shotsDir, { recursive: true }); // Claude Code expects the folder to exist
  const { settings, notes } = updateClaudeSettings(current, {
    command: `node "${fwd(path.join(root, "src", "statusline.cjs"))}"`,
    shotsDir, oldDirs: [OLD_SHOTS_DIR], uninstall,
  });
  for (const n of notes) console.log(`note       ${file}: ${n}`);
  if (JSON.stringify(settings) === JSON.stringify(current)) return console.log(`unchanged  ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`${uninstall ? "cleaned   " : "updated   "} ${file}${fs.existsSync(`${file}.bak`) ? " (backup: settings.json.bak)" : ""}`);
  if (!uninstall) console.log(`           Claude Code may open screenshots in ${shotsDir}`);
}

if (require.main === module) {
  const ps1 = path.join(root, "shell", "prompt.ps1");
  for (const exe of ["powershell", "pwsh"]) {
    const file = profilePath(exe);
    if (file) editLines(file, `. "${ps1}"`);
  }
  editLines(path.join(os.homedir(), ".bashrc"), `source "${fwd(path.join(root, "shell", "prompt.bash"))}"`);
  editClaudeSettings();
  console.log(uninstall ? "Removed. Open new terminals to see the change." : "Done. Open new terminals and restart Claude Code to see the changes.");
}

module.exports = { updateClaudeSettings };
