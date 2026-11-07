// Human names for what the console helper reports: "powershell.exe" in "WindowsTerminal.exe"
// becomes "PowerShell in Windows Terminal". Used by the tray menu.

const SHELLS = {
  "powershell.exe": "PowerShell", "pwsh.exe": "PowerShell 7", "cmd.exe": "Command Prompt", "bash.exe": "Bash",
  "wsl.exe": "WSL", "zsh.exe": "Zsh", "fish.exe": "Fish", "nu.exe": "Nushell", "node.exe": "Node",
  "claude.exe": "Claude Code", "python.exe": "Python", "py.exe": "Python", "ssh.exe": "SSH",
};
const HOSTS = {
  "windowsterminal.exe": "Windows Terminal", "code.exe": "VS Code", "cursor.exe": "Cursor", "windsurf.exe": "Windsurf",
  "idea64.exe": "IntelliJ IDEA", "pycharm64.exe": "PyCharm", "rider64.exe": "Rider", "webstorm64.exe": "WebStorm",
  "wezterm-gui.exe": "WezTerm", "alacritty.exe": "Alacritty", "tabby.exe": "Tabby", "hyper.exe": "Hyper",
  "conemu64.exe": "ConEmu", "explorer.exe": "a console window", "conhost.exe": "a console window",
};

const exeTitle = (name) => name.replace(/\.exe$/i, "");
const shellName = (exe = "") => SHELLS[exe.toLowerCase()] ?? exeTitle(exe);
const hostName = (exe = "") => HOSTS[exe.toLowerCase()] ?? (exe ? exeTitle(exe) : "a console window");

// The console title without the status glyphs Claude Code animates in front (✳ ◐ ⠋ …). A title
// that is only the shell's own path ("C:\WINDOWS\system32\cmd.exe") says nothing: use the shell name.
function consoleTitle(t) {
  const title = (t.title ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!title || /^[a-z]:\\.*\.exe\s*$/i.test(title)) return "";
  return title;
}

// The name the person gave the tab (tabnames.cjs) comes first, then the console title.
function terminalTitle(t) {
  return t.tabName?.trim() || consoleTitle(t) || shellName(t.shell);
}

// What the menu shows for one terminal. A renamed tab keeps its console title (for Claude Code,
// the session name) next to where it runs.
function terminalLabel(t) {
  const inner = t.tabName?.trim() ? consoleTitle(t) : "";
  return {
    pid: t.pid,
    title: terminalTitle(t),
    where: `${shellName(t.shell)} in ${hostName(t.host)}${inner && inner !== t.tabName.trim() ? ` · ${inner}` : ""}`,
    claude: (t.processes ?? []).some((p) => p.toLowerCase() === "claude.exe"),
  };
}

// The chip next to a Claude terminal in the lists (status from tasks.claudeStatus).
// -> { state, text } or null
function statusChip(status, now = Date.now()) {
  if (!status) return null;
  if (status.state === "working") return { state: "working", text: "Working" };
  if (status.state === "ask") return { state: "ask", text: "Needs you" };
  if (status.state === "done") return { state: "done", text: status.at ? `Done · ${ago(now - status.at)}` : "Done" };
  return { state: "idle", text: "Idle" };
}

// 40 s -> "now", 3 min -> "3m", 2 h -> "2h", 3 days -> "3d".
function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

// "Control+Alt+Space" -> ["Ctrl", "Alt", "Space"], for keycaps.
const KEYCAP = { control: "Ctrl", ctrl: "Ctrl", commandorcontrol: "Ctrl", super: "Win", meta: "Win", cmdorctrl: "Ctrl" };
const keycaps = (accelerator = "") => accelerator.split("+").map((k) => k.trim()).filter(Boolean).map((k) => KEYCAP[k.toLowerCase()] ?? k);

const BUTTONS = { 1: "Left", 2: "Right", 3: "Middle", 4: "Back", 5: "Forward" };
const buttonName = (n) => BUTTONS[n] ?? `Button ${n}`;

module.exports = { shellName, hostName, terminalTitle, terminalLabel, statusChip, keycaps, buttonName };
