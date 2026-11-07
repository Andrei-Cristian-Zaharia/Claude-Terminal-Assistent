// Connects Claude Code and the shells to the app, from Settings ("Connect Claude Code") or from
// `npm run install-prompt`. Everything it adds runs through small launchers in <data>\bin that
// start the app's own exe in Node mode (ELECTRON_RUN_AS_NODE), so no Node.js install is needed
// and an installed app keeps working after updates: only the launchers point into the app folder,
// and they are rewritten at every start (`writeLaunchers`).
//   - ~/.claude/settings.json: the status line, the Stop and Notification hooks (the "Claude
//     finished" cards), and the screenshots folder in permissions.additionalDirectories
//   - PowerShell 5.1/7 profiles and ~/.bashrc: the "● Selected" line above the prompt
// Lines added to shell profiles carry MARKER, so disconnecting removes exactly what was added.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const MARKER = "# claude-terminal-assistant";
const OLD_MARKER = "# terminal-claude-helper"; // lines added before the rename are replaced or removed too
const fwd = (p) => p.replace(/\\/g, "/");

// Ours, whichever way they were written: the launchers, or `node ".../src/x.cjs"` from before.
const OUR_STATUS = /statusline\.(cjs|cmd)/;
const OUR_HOOK = /task-done\.(cjs|cmd)/;

// <data>\bin\<name>.cmd -> runs <appDir>\src\<name>.cjs with `exe` in Node mode.
function launcherText(exe, script) {
  return `@echo off\r\nrem Written by Claude Terminal Assistant at every start; runs one of its scripts with its own exe.\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${script}" %*\r\n`;
}

// -> { statusline, taskDone }: the launcher paths (forward slashes, as Claude Code's shell likes).
function writeLaunchers({ dataDir, appDir, exe }) {
  const bin = path.join(dataDir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const out = {};
  for (const [key, name] of [["statusline", "statusline"], ["taskDone", "task-done"]]) {
    const file = path.join(bin, `${name}.cmd`);
    const text = launcherText(exe, path.join(appDir, "src", `${name}.cjs`));
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) fs.writeFileSync(file, text);
    out[key] = fwd(file);
  }
  return out;
}

// Claude Code settings object -> { settings, notes }. Pure, so it can be tested.
//   statusLine: ours is added or updated; someone else's is left alone (and noted).
//   permissions.additionalDirectories: the screenshots folder is added; `oldDirs` are dropped.
//   hooks.Stop and hooks.Notification (permission_prompt): `hookCommand`; other hooks are kept.
//   Left alone without hookCommand.
// uninstall removes all of ours.
function updateClaudeSettings(input, { command, hookCommand, shotsDir, oldDirs = [], uninstall = false }) {
  const settings = structuredClone(input ?? {});
  const notes = [];
  const ours = OUR_STATUS.test(settings.statusLine?.command ?? "");
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
  if (hookCommand) {
    setHook(settings, "Stop", undefined, uninstall ? null : hookCommand);
    setHook(settings, "Notification", "permission_prompt", uninstall ? null : hookCommand);
  }
  return { settings, notes };
}

// Our hook for `event` is the one whose command runs task-done: it is replaced (the app may have
// moved) or removed; groups left empty, and an empty hooks object, are dropped.
function setHook(settings, event, matcher, hookCommand) {
  const ours = (h) => typeof h?.command === "string" && OUR_HOOK.test(h.command);
  const groups = (settings.hooks?.[event] ?? [])
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ours(h)) }))
    .filter((g) => g.hooks.length);
  if (hookCommand) groups.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCommand, timeout: 10 }] });
  if (groups.length) {
    settings.hooks = { ...settings.hooks, [event]: groups };
  } else if (settings.hooks) {
    delete settings.hooks[event];
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
  }
}

// Is Claude Code connected (our hook in its settings)?
function claudeConnected(home = os.homedir()) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
    return Object.values(s.hooks ?? {}).flat().some((g) => (g.hooks ?? []).some((h) => OUR_HOOK.test(h.command ?? "")));
  } catch {
    return false;
  }
}

function profilePath(exe) {
  try {
    return execFileSync(exe, ["-NoProfile", "-Command", "$PROFILE.CurrentUserAllHosts"], { encoding: "utf8", windowsHide: true }).trim() || null;
  } catch {
    return null; // that PowerShell isn't installed
  }
}

// Adds `line` (tagged with MARKER) to a profile-like file, or removes tagged lines.
function editLines(file, line, uninstall, log) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const kept = old.split(/\r?\n/).filter((l) => !l.includes(MARKER) && !l.includes(OLD_MARKER));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  if (!uninstall) kept.push(`${line} ${MARKER}`);
  const eol = old.includes("\r\n") ? "\r\n" : "\n";
  const next = kept.length ? kept.join(eol) + eol : "";
  if (next === old || (!old && uninstall)) return log(`unchanged  ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  log(`${uninstall ? "cleaned   " : "updated   "} ${file}`);
}

function editClaudeSettings({ launchers, shotsDir, oldDirs, uninstall, home, log }) {
  const file = path.join(home, ".claude", "settings.json");
  let current = {};
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      throw new Error(`${file} is not valid JSON (${err.message}); fix it and try again.`);
    }
  }
  if (!uninstall) fs.mkdirSync(shotsDir, { recursive: true }); // Claude Code expects the folder to exist
  const { settings, notes } = updateClaudeSettings(current, {
    command: launchers.statusline, hookCommand: launchers.taskDone, shotsDir, oldDirs, uninstall,
  });
  for (const n of notes) log(`note       ${file}: ${n}`);
  if (JSON.stringify(settings) === JSON.stringify(current)) return log(`unchanged  ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  log(`${uninstall ? "cleaned   " : "updated   "} ${file} (backup: settings.json.bak)`);
}

// Connects (or with uninstall, disconnects) Claude Code and the shells. -> the log lines.
//   dataDir: %APPDATA%\claude-terminal-assistant; appDir: the folder holding src\ and shell\;
//   exe: the Electron executable (the installed app's exe, or node_modules' electron.exe).
function connect({ dataDir, appDir, exe, shotsDir, oldDirs = [], uninstall = false, home = os.homedir() }) {
  const lines = [];
  const log = (l) => lines.push(l);
  const launchers = writeLaunchers({ dataDir, appDir, exe });
  for (const ps of ["powershell", "pwsh"]) {
    const file = profilePath(ps);
    if (file) editLines(file, `. "${path.join(appDir, "shell", "prompt.ps1")}"`, uninstall, log);
  }
  editLines(path.join(home, ".bashrc"), `source "${fwd(path.join(appDir, "shell", "prompt.bash"))}"`, uninstall, log);
  editClaudeSettings({ launchers, shotsDir, oldDirs, uninstall, home, log });
  return lines;
}

module.exports = { connect, writeLaunchers, updateClaudeSettings, claudeConnected, launcherText, MARKER };
