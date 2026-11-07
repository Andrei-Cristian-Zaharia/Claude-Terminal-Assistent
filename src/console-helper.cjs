// Out-of-process helper that talks to Windows consoles. It runs in its own process because
// AttachConsole/FreeConsole change process-wide state, which must not happen inside the app.
//
//   list                      -> prints JSON: the terminal consoles currently open
//   at <x> <y>                -> prints JSON: the terminal whose window is at that screen point
//   capture <x> <y> <w> <h> <file> -> raw BGRA screenshot of that screen area into <file>
//   send <pid> <b64> <enter>  -> types base64(utf8) text into the console that <pid> belongs to,
//                                then presses Enter if <enter> is "1"
//   window <x> <y>            -> prints JSON: the top-level window at that screen point (any app)
//   type <hwnd> <b64> <enter> -> brings that window to the front and types the text with SendInput
//                                (free dictation into any app: Notepad, a browser, a chat)
//   foreground                -> prints JSON: the window in front ({ hwnd, pid, title })
//   list                         also gives renamed Windows Terminal tabs their name (tabName)
//   focus <pid> <chain> [b64 tab] -> brings the terminal of console <pid> to the front, and in Windows
//                                Terminal its tab (by its renamed name, else its title); <chain>
//                                (comma-separated pids) is the fallback when no console window
//                                is found: the nearest one with a window
//
// Works for classic conhost windows and for ConPTY hosts (Windows Terminal, VS Code), because
// each shell still owns a console input buffer. Focus never moves.
const koffi = require("koffi");

const k32 = koffi.load("kernel32.dll");
const u32 = koffi.load("user32.dll");

const PROCESSENTRY32W = koffi.struct("PROCESSENTRY32W", {
  dwSize: "uint32_t",
  cntUsage: "uint32_t",
  th32ProcessID: "uint32_t",
  th32DefaultHeapID: "uintptr_t",
  th32ModuleID: "uint32_t",
  cntThreads: "uint32_t",
  th32ParentProcessID: "uint32_t",
  pcPriClassBase: "int32_t",
  dwFlags: "uint32_t",
  szExeFile: koffi.array("char16_t", 260),
});

const CreateToolhelp32Snapshot = k32.func("void* __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)");
const Process32FirstW = k32.func("bool __stdcall Process32FirstW(void* snap, _Inout_ PROCESSENTRY32W* pe)");
const Process32NextW = k32.func("bool __stdcall Process32NextW(void* snap, _Inout_ PROCESSENTRY32W* pe)");
const CloseHandle = k32.func("bool __stdcall CloseHandle(void* h)");
const FreeConsole = k32.func("bool __stdcall FreeConsole()");
const AttachConsole = k32.func("bool __stdcall AttachConsole(uint32_t pid)");
const GetConsoleTitleW = k32.func("uint32_t __stdcall GetConsoleTitleW(_Out_ void* buf, uint32_t size)");
const GetConsoleProcessList = k32.func("uint32_t __stdcall GetConsoleProcessList(_Out_ uint32_t* list, uint32_t count)");
const CreateFileW = k32.func("void* __stdcall CreateFileW(const char16_t* name, uint32_t access, uint32_t share, void* sa, uint32_t disp, uint32_t flags, void* tmpl)");
const WriteConsoleInputW = k32.func("bool __stdcall WriteConsoleInputW(void* h, void* records, uint32_t n, _Out_ uint32_t* written)");
const GetLastError = k32.func("uint32_t __stdcall GetLastError()");
const GetConsoleWindow = k32.func("void* __stdcall GetConsoleWindow()");
const IsWindowVisible = u32.func("bool __stdcall IsWindowVisible(void* hwnd)");
const POINT = koffi.struct("POINT", { x: "int32_t", y: "int32_t" });
const WindowFromPoint = u32.func("void* __stdcall WindowFromPoint(POINT pt)");
const GetAncestor = u32.func("void* __stdcall GetAncestor(void* hwnd, uint32_t flags)");
const GetWindowThreadProcessId = u32.func("uint32_t __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32_t* pid)");
const GetWindowTextW = u32.func("int __stdcall GetWindowTextW(void* hwnd, _Out_ void* buf, int max)");
const SetProcessDpiAwarenessContext = u32.func("bool __stdcall SetProcessDpiAwarenessContext(intptr_t ctx)");
const gdi = koffi.load("gdi32.dll");
const GetDC = u32.func("void* __stdcall GetDC(void* hwnd)");
const ReleaseDC = u32.func("int __stdcall ReleaseDC(void* hwnd, void* dc)");
const CreateCompatibleDC = gdi.func("void* __stdcall CreateCompatibleDC(void* dc)");
const CreateCompatibleBitmap = gdi.func("void* __stdcall CreateCompatibleBitmap(void* dc, int w, int h)");
const SelectObject = gdi.func("void* __stdcall SelectObject(void* dc, void* obj)");
const BitBlt = gdi.func("bool __stdcall BitBlt(void* dst, int x, int y, int w, int h, void* src, int sx, int sy, uint32_t rop)");
const GetDIBits = gdi.func("int __stdcall GetDIBits(void* dc, void* bmp, uint32_t start, uint32_t lines, _Out_ void* bits, void* info, uint32_t usage)");
const DeleteObject = gdi.func("bool __stdcall DeleteObject(void* obj)");
const DeleteDC = gdi.func("bool __stdcall DeleteDC(void* dc)");
const GA_ROOT = 2;
const GA_ROOTOWNER = 3;
const hwndNum = (h) => (isInvalid(h) ? 0 : Number(koffi.address(h)));
const VkKeyScanW = u32.func("int16_t __stdcall VkKeyScanW(char16_t ch)");
const MapVirtualKeyW = u32.func("uint32_t __stdcall MapVirtualKeyW(uint32_t code, uint32_t type)");
const GetForegroundWindow = u32.func("void* __stdcall GetForegroundWindow()");
const SetForegroundWindow = u32.func("bool __stdcall SetForegroundWindow(void* hwnd)");
const IsIconic = u32.func("bool __stdcall IsIconic(void* hwnd)");
const IsWindow = u32.func("bool __stdcall IsWindow(void* hwnd)");
const ShowWindow = u32.func("bool __stdcall ShowWindow(void* hwnd, int cmd)");
const SendInput = u32.func("uint32_t __stdcall SendInput(uint32_t n, void* inputs, int size)");
const QueryFullProcessImageNameW = k32.func("bool __stdcall QueryFullProcessImageNameW(void* h, uint32_t flags, _Out_ void* buf, _Inout_ uint32_t* size)");
const OpenProcess = k32.func("void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)");
const FindWindowExW = u32.func("void* __stdcall FindWindowExW(void* parent, void* after, const char16_t* cls, const char16_t* title)");
const GetWindow = u32.func("void* __stdcall GetWindow(void* hwnd, uint32_t cmd)");
const GetWindowTextLengthW = u32.func("int __stdcall GetWindowTextLengthW(void* hwnd)");
const GetClassNameW = u32.func("int __stdcall GetClassNameW(void* hwnd, _Out_ void* buf, int max)");

const INVALID_HANDLE = -1n;
const isInvalid = (h) => !h || koffi.address(h) === 0n || koffi.address(h) === 0xffffffffffffffffn || koffi.address(h) === BigInt.asUintN(64, INVALID_HANDLE);

// Processes that can own an interactive terminal session.
const SHELLS = new Set([
  "cmd.exe", "powershell.exe", "pwsh.exe", "bash.exe", "wsl.exe", "nu.exe", "zsh.exe", "fish.exe",
  "node.exe", "claude.exe", "python.exe", "py.exe", "ssh.exe",
]);

// Apps that host terminals through ConPTY. Their consoles have no visible console window of their
// own, so they are recognised by the host process instead. Everything else must have a visible
// conhost window; this hides the invisible consoles of background tools.
const TERMINAL_HOSTS = new Set([
  "windowsterminal.exe", "code.exe", "cursor.exe", "windsurf.exe", "wezterm-gui.exe", "alacritty.exe",
  "tabby.exe", "hyper.exe", "idea64.exe", "pycharm64.exe", "rider64.exe", "webstorm64.exe", "conemu64.exe",
]);

function processes() {
  const snap = CreateToolhelp32Snapshot(0x2 /* TH32CS_SNAPPROCESS */, 0);
  if (isInvalid(snap)) throw new Error(`CreateToolhelp32Snapshot failed (${GetLastError()})`);
  const out = new Map();
  try {
    const pe = { dwSize: koffi.sizeof(PROCESSENTRY32W) };
    let ok = Process32FirstW(snap, pe);
    while (ok) {
      const raw = pe.szExeFile;
      const name = typeof raw === "string" ? raw : String.fromCharCode(...raw.slice(0, raw.indexOf(0) < 0 ? raw.length : raw.indexOf(0)));
      out.set(pe.th32ProcessID, { pid: pe.th32ProcessID, ppid: pe.th32ParentProcessID, name });
      pe.dwSize = koffi.sizeof(PROCESSENTRY32W);
      ok = Process32NextW(snap, pe);
    }
  } finally {
    CloseHandle(snap);
  }
  return out;
}

function consoleTitle() {
  const buf = Buffer.alloc(2048 * 2);
  const n = GetConsoleTitleW(buf, 2048);
  return buf.toString("utf16le", 0, n * 2);
}

function consolePids() {
  const list = new Uint32Array(256);
  const n = GetConsoleProcessList(list, list.length);
  return [...list.slice(0, Math.min(n, list.length))].filter((p) => p !== process.pid);
}

function list({ all = false } = {}) {
  const procs = processes();
  const seen = new Set(); // pids already covered by a console we looked at
  const consoles = [];
  for (const p of procs.values()) {
    if (p.pid === process.pid || seen.has(p.pid) || !SHELLS.has(p.name.toLowerCase())) continue;
    FreeConsole();
    if (!AttachConsole(p.pid)) continue; // other session, elevated, or no console
    const title = consoleTitle();
    const members = consolePids();
    const hwnd = GetConsoleWindow();
    const visible = !isInvalid(hwnd) && IsWindowVisible(hwnd);
    // ConPTY hosts (Windows Terminal) make the hidden pseudo-console window owned by their own
    // window; that owner is how a click on the terminal window is matched to this console.
    const owner = isInvalid(hwnd) ? 0 : hwndNum(GetAncestor(hwnd, GA_ROOTOWNER));
    FreeConsole();
    members.forEach((m) => seen.add(m));
    if (!members.length) continue;
    // The anchor is the process whose parent is outside this console: the shell the terminal started.
    const memberSet = new Set(members);
    const anchor = members.map((m) => procs.get(m)).filter(Boolean).find((m) => !memberSet.has(m.ppid)) ?? procs.get(members[0]) ?? p;
    const host = procs.get(anchor.ppid);
    // A console with no window at all (not even a hidden pseudo-console one) belongs to a background
    // tool the IDE started itself, e.g. IntelliJ's "npm install types-registry"; never a terminal tab.
    if (!all && (isInvalid(hwnd) || (!visible && !TERMINAL_HOSTS.has((host?.name ?? "").toLowerCase())))) continue;
    consoles.push({
      pid: anchor.pid,
      shell: anchor.name,
      host: host?.name ?? "",
      hostPid: host?.pid ?? 0,
      hwnd: visible ? hwndNum(hwnd) : 0,
      owner,
      title,
      processes: members.map((m) => procs.get(m)?.name).filter(Boolean),
    });
  }
  return consoles;
}

// The terminal whose window is at screen point (x, y), in physical pixels.
function at(x, y) {
  SetProcessDpiAwarenessContext(-4); // PER_MONITOR_AWARE_V2: take physical pixels as they are
  const root = GetAncestor(WindowFromPoint({ x, y }), GA_ROOT);
  if (isInvalid(root)) throw new Error("No window under the cursor.");
  const rootHwnd = hwndNum(root);
  const pidOut = [0];
  GetWindowThreadProcessId(root, pidOut);
  const buf = Buffer.alloc(1024 * 2);
  const n = GetWindowTextW(root, buf, 1024);
  const windowTitle = buf.toString("utf16le", 0, n * 2).trim();

  const consoles = list({ all: true });
  let matches = consoles.filter((c) => c.hwnd === rootHwnd || c.owner === rootHwnd);
  // Some hosts (IntelliJ) leave their pseudo-console windows unowned: match by host process, but
  // skip consoles without any window, which are background tools rather than terminal tabs.
  if (!matches.length) matches = consoles.filter((c) => c.hostPid && c.hostPid === pidOut[0] && (c.hwnd || c.owner));
  // One Windows Terminal window holds several tabs; its title is the active tab's title.
  if (matches.length > 1) {
    const win = normTitle(windowTitle);
    const byTitle = matches.filter((c) => { const t = normTitle(c.title); return t && (win === t || win.includes(t)); });
    if (byTitle.length) matches = byTitle;
  }
  if (!matches.length) throw new Error(`"${windowTitle || "This window"}" is not a terminal.`);
  // Still several (e.g. IntelliJ tabs, whose window title is the project): let the user pick one.
  if (matches.length > 1) return { ambiguous: true, windowTitle, candidates: matches };
  return matches[0];
}

// Titles without the status glyphs some apps animate in front (Claude Code: ✳ ◐ ⠋ …), so a title
// read a few milliseconds apart from the window title still compares equal.
const normTitle = (t) => (t ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();

// Copies the screen rectangle (physical pixels, virtual-desktop coordinates) into `outFile` as raw
// top-down BGRA with alpha forced to 255. The app turns it into a PNG.
function capture(x, y, w, h, outFile) {
  SetProcessDpiAwarenessContext(-4);
  if (!(w > 0 && h > 0)) throw new Error("Empty screenshot area.");
  const screenDc = GetDC(null);
  const memDc = CreateCompatibleDC(screenDc);
  const bmp = CreateCompatibleBitmap(screenDc, w, h);
  const old = SelectObject(memDc, bmp);
  try {
    if (!BitBlt(memDc, 0, 0, w, h, screenDc, x, y, 0x00cc0020 | 0x40000000 /* SRCCOPY|CAPTUREBLT */)) {
      throw new Error(`BitBlt failed (error ${GetLastError()})`);
    }
    const info = Buffer.alloc(40); // BITMAPINFOHEADER, 32 bpp, negative height = top-down rows
    info.writeUInt32LE(40, 0);
    info.writeInt32LE(w, 4);
    info.writeInt32LE(-h, 8);
    info.writeUInt16LE(1, 12);
    info.writeUInt16LE(32, 14);
    const bits = Buffer.alloc(w * h * 4);
    SelectObject(memDc, old);
    if (GetDIBits(memDc, bmp, 0, h, bits, info, 0) !== h) throw new Error(`GetDIBits failed (error ${GetLastError()})`);
    for (let i = 3; i < bits.length; i += 4) bits[i] = 255;
    require("node:fs").writeFileSync(outFile, bits);
    return { width: w, height: h };
  } finally {
    DeleteObject(bmp);
    DeleteDC(memDc);
    ReleaseDC(null, screenDc);
  }
}

const VK_RETURN = 0x0d;
const VK_PACKET = 0xe7;

function keyRecords(text, enter) {
  const events = [];
  for (const ch of text.replace(/\r?\n/g, " ")) {
    for (let i = 0; i < ch.length; i++) {
      const code = ch.charCodeAt(i);
      const scan = VkKeyScanW(code);
      const vk = scan === -1 ? VK_PACKET : scan & 0xff;
      const shift = scan !== -1 && (scan & 0x100) ? 0x10 /* SHIFT_PRESSED */ : 0;
      events.push({ vk, code, ctrl: shift });
    }
  }
  if (enter) events.push({ vk: VK_RETURN, code: 13, ctrl: 0 });

  const buf = Buffer.alloc(events.length * 2 * 20); // INPUT_RECORD (KEY_EVENT) is 20 bytes
  let off = 0;
  for (const e of events) {
    const scan = e.vk === VK_PACKET ? 0 : MapVirtualKeyW(e.vk, 0 /* MAPVK_VK_TO_VSC */);
    for (const down of [1, 0]) {
      buf.writeUInt16LE(0x1, off); // KEY_EVENT
      buf.writeInt32LE(down, off + 4);
      buf.writeUInt16LE(1, off + 8); // repeat count
      buf.writeUInt16LE(e.vk, off + 10);
      buf.writeUInt16LE(scan, off + 12);
      buf.writeUInt16LE(e.code, off + 14);
      buf.writeUInt32LE(e.ctrl, off + 16);
      off += 20;
    }
  }
  return { buf, count: events.length * 2 };
}

function send(pid, text, enter) {
  FreeConsole();
  if (!AttachConsole(pid)) throw new Error(`Cannot attach to the console of process ${pid} (error ${GetLastError()}). Is the terminal still open?`);
  try {
    const h = CreateFileW("CONIN$", 0xc0000000 /* GENERIC_READ|WRITE */, 0x3 /* SHARE_READ|WRITE */, null, 3 /* OPEN_EXISTING */, 0, null);
    if (isInvalid(h)) throw new Error(`Cannot open the console input (error ${GetLastError()})`);
    try {
      const { buf, count } = keyRecords(text, enter);
      const written = [0];
      if (count && !WriteConsoleInputW(h, buf, count, written)) throw new Error(`WriteConsoleInput failed (error ${GetLastError()})`);
      return { written: written[0] };
    } finally {
      CloseHandle(h);
    }
  } finally {
    FreeConsole();
  }
}

// ---------- free dictation into any window ----------

function exeName(pid) {
  const h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
  if (isInvalid(h)) return "";
  try {
    const buf = Buffer.alloc(1024 * 2);
    const size = [1024];
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return "";
    const full = buf.toString("utf16le", 0, size[0] * 2);
    return full.slice(full.lastIndexOf("\\") + 1);
  } finally {
    CloseHandle(h);
  }
}

// The top-level window at screen point (x, y), physical pixels: where free dictation will type.
function windowAt(x, y) {
  SetProcessDpiAwarenessContext(-4);
  const root = GetAncestor(WindowFromPoint({ x, y }), GA_ROOT);
  if (isInvalid(root)) throw new Error("No window under the cursor.");
  const pidOut = [0];
  GetWindowThreadProcessId(root, pidOut);
  const buf = Buffer.alloc(1024 * 2);
  const n = GetWindowTextW(root, buf, 1024);
  return { hwnd: hwndNum(root), pid: pidOut[0], exe: exeName(pidOut[0]), title: buf.toString("utf16le", 0, n * 2).trim() };
}

// One INPUT record (x64 layout: 4-byte type, 4 bytes padding, then the 32-byte union).
const INPUT_SIZE = 40;
function keyInput(buf, off, { vk = 0, scan = 0, flags = 0 }) {
  buf.writeUInt32LE(1 /* INPUT_KEYBOARD */, off);
  buf.writeUInt16LE(vk, off + 8);
  buf.writeUInt16LE(scan, off + 10);
  buf.writeUInt32LE(flags, off + 12);
}

function sendKeys(events) {
  const buf = Buffer.alloc(events.length * INPUT_SIZE);
  events.forEach((e, i) => keyInput(buf, i * INPUT_SIZE, e));
  const sent = SendInput(events.length, buf, INPUT_SIZE);
  if (sent !== events.length) throw new Error(`SendInput sent ${sent} of ${events.length} events (error ${GetLastError()})`);
}

const KEYEVENTF_KEYUP = 0x2;
const KEYEVENTF_UNICODE = 0x4;
const VK_MENU = 0x12;

// Brings window `hwnd` (a number) to the front. -> true when it is in front.
function bringToFront(hwnd) {
  const h = koffi.as(hwnd, "void*");
  if (!IsWindow(h)) throw new Error("That window is gone.");
  if (IsIconic(h)) ShowWindow(h, 9 /* SW_RESTORE */);
  if (hwndNum(GetForegroundWindow()) === hwnd) return true;
  // Windows only lets the process that received the last input change the foreground window;
  // a tapped Alt key makes this process that one (the classic SetForegroundWindow workaround).
  sendKeys([{ vk: VK_MENU }, { vk: VK_MENU, flags: KEYEVENTF_KEYUP }]);
  SetForegroundWindow(h);
  const t0 = Date.now();
  while (hwndNum(GetForegroundWindow()) !== hwnd && Date.now() - t0 < 500) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  return hwndNum(GetForegroundWindow()) === hwnd;
}

// Types `text` into window `hwnd` as Unicode key events, after bringing it to the front. The text
// is never typed into a window other than the one asked for: if the window cannot be brought
// forward, that is an error.
function typeInto(hwnd, text, enter) {
  if (!bringToFront(hwnd)) throw new Error("Could not bring that window to the front.");
  const events = [];
  for (const ch of text.replace(/\r\n/g, "\n")) {
    if (ch === "\n") {
      events.push({ vk: VK_RETURN }, { vk: VK_RETURN, flags: KEYEVENTF_KEYUP });
      continue;
    }
    for (let i = 0; i < ch.length; i++) { // surrogate pairs go as two UTF-16 units
      const scan = ch.charCodeAt(i);
      events.push({ scan, flags: KEYEVENTF_UNICODE }, { scan, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP });
    }
  }
  if (enter) events.push({ vk: VK_RETURN }, { vk: VK_RETURN, flags: KEYEVENTF_KEYUP });
  // In chunks: SendInput takes the whole batch atomically, and very long batches are refused.
  for (let i = 0; i < events.length; i += 200) sendKeys(events.slice(i, i + 200));
  return { typed: events.length / 2 };
}

// ---------- bringing a terminal forward (the "Claude finished" card) ----------

function windowTitle(h) {
  const buf = Buffer.alloc(1024 * 2);
  const n = GetWindowTextW(h, buf, 1024);
  return buf.toString("utf16le", 0, n * 2).trim();
}

function className(h) {
  const buf = Buffer.alloc(256 * 2);
  const n = GetClassNameW(h, buf, 256);
  return buf.toString("utf16le", 0, n * 2);
}

// The window in front: root window, its process and title.
function foreground() {
  const root = GetAncestor(GetForegroundWindow(), GA_ROOT);
  if (isInvalid(root)) return { hwnd: 0, pid: 0, title: "" };
  const pidOut = [0];
  GetWindowThreadProcessId(root, pidOut);
  return { hwnd: hwndNum(root), pid: pidOut[0], title: windowTitle(root) };
}

// The main window of process `pid`: the topmost visible, unowned, titled top-level window.
function topWindowOf(pid) {
  let h = FindWindowExW(null, null, null, null);
  for (let i = 0; !isInvalid(h) && i < 5000; i++, h = FindWindowExW(null, h, null, null)) {
    const pidOut = [0];
    GetWindowThreadProcessId(h, pidOut);
    if (pidOut[0] !== pid || !IsWindowVisible(h) || !isInvalid(GetWindow(h, 4 /* GW_OWNER */)) || !GetWindowTextLengthW(h)) continue;
    return hwndNum(h);
  }
  return 0;
}

// Processes in the chain whose windows are never "the terminal".
const NOT_HOSTS = new Set(["explorer.exe", "svchost.exe", "services.exe", "wininit.exe", "sihost.exe", "userinit.exe"]);

// Where the console of `pid` is shown: { hwnd, title (the console's), host (exe name) }.
//   classic conhost: the console window itself (it is its own root owner);
//   ConPTY (Windows Terminal, VS Code): the window that owns the hidden pseudo-console window;
//   unowned pseudo-console (IntelliJ): the host process's main window.
// Without a console (Claude in an IDE panel rather than a terminal), the nearest process of
// `chain` that has a window.
function locate(pid, chain = []) {
  const procs = processes();
  let hwnd = 0, title = "", host = "";
  if (pid && procs.has(pid)) {
    FreeConsole();
    if (AttachConsole(pid)) {
      title = consoleTitle();
      const con = GetConsoleWindow();
      if (!isInvalid(con)) {
        const owner = GetAncestor(con, GA_ROOTOWNER);
        if (!isInvalid(owner) && IsWindowVisible(owner) && className(owner) !== "PseudoConsoleWindow") hwnd = hwndNum(owner);
      }
      FreeConsole();
    }
    const hostProc = procs.get(procs.get(pid).ppid);
    host = hostProc?.name ?? "";
    if (!hwnd && hostProc && !NOT_HOSTS.has(host.toLowerCase())) hwnd = topWindowOf(hostProc.pid);
  }
  for (const p of chain) {
    if (hwnd) break;
    const name = procs.get(p)?.name ?? "";
    if (!name || NOT_HOSTS.has(name.toLowerCase())) continue;
    hwnd = topWindowOf(p);
    if (hwnd) host = name;
  }
  return { hwnd, title, host };
}

// Selects the Windows Terminal tab named `tabName` (a renamed tab, see tabnames.cjs) or showing
// `title`, through UI Automation (from PowerShell: the COM interfaces are far simpler from .NET
// than through FFI; about 0.4 s). A window with one tab, or no such tab, is left as it is.
// -> "selected" | "single" | "notfound" | "" (failed)
const SELECT_TAB_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
function norm($s) { return ($s -replace '^[^\\p{L}\\p{N}]+', '').Trim() }
$want = norm $env:CTA_TITLE
$tabName = norm $env:CTA_TAB
$A = [System.Windows.Automation.AutomationElement]
$win = $A::FromHandle([IntPtr][long]$env:CTA_HWND)
$cond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
$tabs = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($tabs.Count -lt 2) { 'single'; exit }
foreach ($t in $tabs) {
  if ($tabName -and (norm $t.Current.Name) -eq $tabName) {
    $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    'selected'; exit
  }
}
foreach ($t in $tabs) {
  $n = norm $t.Current.Name
  if ($want -and $n -and ($n -eq $want -or $n.Contains($want))) {
    $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    'selected'; exit
  }
}
'notfound'`;

function selectTab(hwnd, title, tabName = "") {
  const r = require("node:child_process").spawnSync("powershell.exe",
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(SELECT_TAB_PS, "utf16le").toString("base64")],
    { env: { ...process.env, CTA_HWND: String(hwnd), CTA_TITLE: title, CTA_TAB: tabName }, encoding: "utf8", timeout: 8000, windowsHide: true });
  return (r.stdout ?? "").trim();
}

// Brings the terminal of console `pid` to the front (see locate), and its tab in Windows Terminal.
function focusTerminal(pid, chain = [], tabName = "") {
  SetProcessDpiAwarenessContext(-4);
  const where = locate(pid, chain);
  if (!where.hwnd) throw new Error("That terminal has no window any more.");
  if (!bringToFront(where.hwnd)) throw new Error("Could not bring the terminal to the front.");
  const tab = where.host.toLowerCase() === "windowsterminal.exe" && (where.title || tabName) ? selectTab(where.hwnd, where.title, tabName) : "";
  return { ...where, tab };
}

// `list` plus the names of renamed Windows Terminal tabs (tabnames.cjs): the windows that own
// Windows Terminal consoles are asked for their tabs (about 0.4 s more).
async function listWithTabNames(opts) {
  const { readTabNames, assignTabNames } = require("./tabnames.cjs");
  const consoles = list(opts);
  const wt = [...new Set(consoles.filter((c) => c.owner && c.host.toLowerCase() === "windowsterminal.exe").map((c) => c.owner))];
  return assignTabNames(consoles, await readTabNames(wt));
}

// `at`, and when the clicked window holds several tabs whose titles don't decide (the active tab
// was renamed: the window title is its name), the tab names do.
async function atWithTabNames(x, y) {
  const r = at(x, y);
  if (!r.ambiguous) return r;
  const { readTabNames, assignTabNames } = require("./tabnames.cjs");
  const owners = [...new Set(r.candidates.map((c) => c.owner).filter(Boolean))];
  const named = assignTabNames(r.candidates, await readTabNames(owners));
  const win = normTitle(r.windowTitle).toLowerCase();
  const hit = named.filter((c) => c.tabName && normTitle(c.tabName).toLowerCase() === win);
  return hit.length === 1 ? hit[0] : { ...r, candidates: named };
}

if (require.main === module) (async () => {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    let result;
    if (cmd === "list") result = await listWithTabNames({ all: args.includes("--all") });
    else if (cmd === "at") result = await atWithTabNames(Number(args[0]), Number(args[1]));
    else if (cmd === "capture") result = capture(...args.slice(0, 4).map(Number), args[4]);
    else if (cmd === "send") result = send(Number(args[0]), Buffer.from(args[1] ?? "", "base64").toString("utf8"), args[2] === "1");
    else if (cmd === "window") result = windowAt(Number(args[0]), Number(args[1]));
    else if (cmd === "foreground") result = foreground();
    else if (cmd === "focus") result = focusTerminal(Number(args[0]) || 0, String(args[1] ?? "").split(",").map(Number).filter((p) => p > 0), Buffer.from(args[2] ?? "", "base64").toString("utf8"));
    else if (cmd === "type") result = typeInto(Number(args[0]), Buffer.from(args[1] ?? "", "base64").toString("utf8"), args[2] === "1");
    else throw new Error(`Unknown command: ${cmd}`);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    process.exitCode = 1;
  }
})();

module.exports = { list, at, capture, send, windowAt, typeInto, processes, consolePids, foreground, locate, focusTerminal };
