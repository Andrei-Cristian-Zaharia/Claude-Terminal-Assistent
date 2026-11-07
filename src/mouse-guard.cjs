// Mouse guard: keeps the Back/Forward presses the app uses away from other apps (see
// button-guard.cjs for which ones), so a screenshot drag while recording doesn't also send the
// browser a page back. uiohook only listens; dropping an event takes a WH_MOUSE_LL hook that
// returns 1 instead of calling the next hook.
//
// It runs as its own process (Electron's binary with ELECTRON_RUN_AS_NODE, like console-helper):
// a low-level hook delays every mouse event on the desktop until its thread answers, so it must
// not live in the app's main thread, where a busy moment (PNG encoding, a sync file read) would
// make the whole system's mouse stutter. Its thread only waits for hook calls and messages.
//
// Hook order matters. Windows calls the newest low-level hook first, and a hook that swallows an
// event hides it from the hooks after it. The guard is therefore installed *before* uiohook starts:
// uiohook, being newer, sees every event first and passes it on; the guard then drops it.
// Replayed clicks (a press the app didn't use, sent again on release) reach uiohook too; they
// carry MARK in dwExtraInfo so the guard itself lets them through.
//
// Control: main posts WM_APP to the guard's thread (PostThreadMessageW), wParam 1 = recording,
// 0 = not. The guard exits when the app process ends (it waits on the parent's handle).
const { spawn } = require("node:child_process");

const WM_APP = 0x8000;

// ---------- child process ----------
function runGuard(parentPid, config) {
  const koffi = require("koffi");
  const { createButtonGuard } = require("./button-guard.cjs");
  const k32 = koffi.load("kernel32.dll");
  const u32 = koffi.load("user32.dll");

  const MSLLHOOKSTRUCT = koffi.struct("MSLLHOOKSTRUCT", {
    x: "int32_t", y: "int32_t", mouseData: "uint32_t", flags: "uint32_t", time: "uint32_t", extra: "uintptr_t",
  });
  const MSG = koffi.struct("MSG", {
    hwnd: "void*", message: "uint32_t", wParam: "uintptr_t", lParam: "intptr_t", time: "uint32_t", x: "int32_t", y: "int32_t", priv: "uint32_t",
  });
  const HookProc = koffi.proto("intptr_t __stdcall HookProc(int code, uintptr_t wParam, void* lParam)");
  const SetWindowsHookExW = u32.func("void* __stdcall SetWindowsHookExW(int id, HookProc* fn, void* mod, uint32_t thread)");
  const CallNextHookEx = u32.func("intptr_t __stdcall CallNextHookEx(void* hhk, int code, uintptr_t wParam, void* lParam)");
  const PeekMessageW = u32.func("bool __stdcall PeekMessageW(_Out_ MSG* msg, void* hwnd, uint32_t min, uint32_t max, uint32_t remove)");
  const MsgWaitForMultipleObjects = u32.func("uint32_t __stdcall MsgWaitForMultipleObjects(uint32_t n, void** handles, bool all, uint32_t ms, uint32_t mask)");
  const GetModuleHandleW = k32.func("void* __stdcall GetModuleHandleW(const char16_t* name)");
  const GetCurrentThreadId = k32.func("uint32_t __stdcall GetCurrentThreadId()");
  const OpenProcess = k32.func("void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)");
  const GetLastError = k32.func("uint32_t __stdcall GetLastError()");

  const WH_MOUSE_LL = 14;
  const SYNCHRONIZE = 0x00100000;
  const INFINITE = 0xffffffff;
  const QS_ALLINPUT = 0x04ff;
  const PM_REMOVE = 1;
  const WM_QUIT = 0x0012;
  // Low-level mouse messages -> [uiohook button, down?]. Back/Forward are WM_XBUTTON* with
  // XBUTTON1/2 in the high word of mouseData.
  const BUTTON_MSG = { 0x0201: [1, true], 0x0202: [1, false], 0x0207: [3, true], 0x0208: [3, false] };
  const WM_XBUTTONDOWN = 0x020b;
  const WM_XBUTTONUP = 0x020c;

  const PostThreadMessageW = u32.func("bool __stdcall PostThreadMessageW(uint32_t thread, uint32_t msg, uintptr_t wParam, intptr_t lParam)");
  const SendInput = u32.func("uint32_t __stdcall SendInput(uint32_t n, void* inputs, int size)");
  const WM_REPLAY = WM_APP + 1; // wParam: uiohook button to send again as a whole click
  const MARK = 0x54434741; // dwExtraInfo of the clicks the guard replays, so it lets them through
  // uiohook button -> [MOUSEEVENTF down, up, mouseData]
  const SEND = { 3: [0x0020, 0x0040, 0], 4: [0x0080, 0x0100, 1], 5: [0x0080, 0x0100, 2] };
  const replay = (button) => {
    const [downFlag, upFlag, data] = SEND[button] ?? [];
    if (!downFlag) return;
    const inputs = Buffer.alloc(80); // two INPUTs (x64: 40 bytes each), type 0 = mouse
    for (const [i, flag] of [[0, downFlag], [1, upFlag]]) {
      inputs.writeUInt32LE(data, i * 40 + 16);
      inputs.writeUInt32LE(flag, i * 40 + 20);
      inputs.writeBigUInt64LE(BigInt(MARK), i * 40 + 32);
    }
    SendInput(2, inputs, 40);
  };

  const guard = createButtonGuard(config);
  let thread = 0;
  const proc = koffi.register((code, wParam, lParam) => {
    try {
      const msg = Number(wParam);
      const xbutton = msg === WM_XBUTTONDOWN || msg === WM_XBUTTONUP;
      if (code === 0 && (BUTTON_MSG[msg] || xbutton)) {
        const info = koffi.decode(lParam, MSLLHOOKSTRUCT);
        if (Number(info.extra) !== MARK) {
          const x = info.mouseData >>> 16;
          const [button, isDown] = xbutton ? [x === 1 ? 4 : x === 2 ? 5 : 0, msg === WM_XBUTTONDOWN] : BUTTON_MSG[msg];
          const action = guard.event(button, isDown);
          // Sent after this hook call returns: injecting from inside a hook call is asking for trouble.
          if (action === "replay") PostThreadMessageW(thread, WM_REPLAY, button, 0);
          if (action !== "pass") return 1;
        }
      }
    } catch {}
    return CallNextHookEx(null, code, wParam, lParam);
  }, koffi.pointer(HookProc));

  const parent = OpenProcess(SYNCHRONIZE, false, parentPid);
  if (!parent) throw new Error(`cannot open the app process (${GetLastError()})`);
  const hook = SetWindowsHookExW(WH_MOUSE_LL, proc, GetModuleHandleW(null), 0);
  if (!hook) throw new Error(`SetWindowsHookExW failed (${GetLastError()})`);
  const msg = {};
  PeekMessageW(msg, null, 0, 0, 0); // creates this thread's message queue before main posts to it
  thread = GetCurrentThreadId();
  process.stdout.write(`${JSON.stringify({ ok: true, thread })}\n`);

  // Hook calls arrive as sent messages; PeekMessage dispatches them.
  for (;;) {
    const r = MsgWaitForMultipleObjects(1, [parent], false, INFINITE, QS_ALLINPUT);
    if (r === 0) return; // the app is gone
    while (PeekMessageW(msg, null, 0, 0, PM_REMOVE)) {
      if (msg.message === WM_QUIT) return;
      if (msg.message === WM_APP) guard.setActive(Number(msg.wParam) !== 0);
      if (msg.message === WM_REPLAY) replay(Number(msg.wParam));
    }
  }
}

if (require.main === module) {
  try {
    runGuard(Number(process.argv[2]), JSON.parse(process.argv[3] || "{}"));
    process.exit(0);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: err.message })}\n`);
    process.exit(1);
  }
}

// ---------- app side ----------
// Starts the guard and resolves once its hook is installed, with { setActive, stop }. onExit runs
// if it ends on its own (the hook is gone then).
function startMouseGuard(config, { onExit } = {}) {
  const koffi = require("koffi");
  const PostThreadMessageW = koffi.load("user32.dll").func("bool __stdcall PostThreadMessageW(uint32_t thread, uint32_t msg, uintptr_t wParam, intptr_t lParam)");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, String(process.pid), JSON.stringify(config)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    let thread = 0;
    let stopping = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error("mouse guard did not start")); }, 10_000);
    child.stdout.on("data", (d) => {
      if (thread) return;
      out += d;
      const nl = out.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(timer);
      let res;
      try { res = JSON.parse(out.slice(0, nl)); } catch { res = { ok: false, error: out.slice(0, nl) }; }
      if (!res.ok) return reject(new Error(res.error));
      thread = res.thread;
      resolve({
        setActive: (on) => { if (!stopping) PostThreadMessageW(thread, WM_APP, on ? 1 : 0, 0); },
        stop: () => { stopping = true; child.kill(); },
      });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!thread) return reject(new Error(`mouse guard exited (${code}): ${out.trim()}`));
      if (!stopping) onExit?.(code);
    });
    child.on("error", reject);
  });
}

module.exports = { startMouseGuard };
