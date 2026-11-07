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
function terminalTitle(t) {
  const title = (t.title ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (!title || /^[a-z]:\\.*\.exe\s*$/i.test(title)) return shellName(t.shell);
  return title;
}

// What the menu shows for one terminal.
function terminalLabel(t) {
  return {
    pid: t.pid,
    title: terminalTitle(t),
    where: `${shellName(t.shell)} in ${hostName(t.host)}`,
    claude: (t.processes ?? []).some((p) => p.toLowerCase() === "claude.exe"),
  };
}

// "Control+Alt+Space" -> ["Ctrl", "Alt", "Space"], for keycaps.
const KEYCAP = { control: "Ctrl", ctrl: "Ctrl", commandorcontrol: "Ctrl", super: "Win", meta: "Win", cmdorctrl: "Ctrl" };
const keycaps = (accelerator = "") => accelerator.split("+").map((k) => k.trim()).filter(Boolean).map((k) => KEYCAP[k.toLowerCase()] ?? k);

const BUTTONS = { 1: "Left", 2: "Right", 3: "Middle", 4: "Back", 5: "Forward" };
const buttonName = (n) => BUTTONS[n] ?? `Button ${n}`;

module.exports = { shellName, hostName, terminalTitle, terminalLabel, keycaps, buttonName };
