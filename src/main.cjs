// Tray app: pick a target terminal, then press the global hotkey anywhere (even in a game) to
// dictate a command. Flow: hotkey -> record (hidden window) -> local Whisper -> typed into target.
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { app, Tray, BrowserWindow, globalShortcut, ipcMain, nativeImage, nativeTheme, Notification, session, screen, shell } = require("electron");
const { uIOhook, UiohookKey } = require("uiohook-napi");
const { Whisper, isHallucination, peakLevel } = require("./whisper.cjs");
const screenrec = require("./screenrec.cjs");
const { grab } = require("./screen-grab.cjs");
const { terminalLabel, statusChip, keycaps, buttonName } = require("./labels.cjs");
const { RESTART_KEYS, needsRestart, validate, formatConfig } = require("./settings-model.cjs");
const { trayIcon } = require("./tray-icon.cjs");
const { createLog, hookConsole } = require("./log.cjs");
const { listTerminals: listConsoles, terminalAt, captureArea, sendToTerminal, windowAt, typeIntoWindow, foregroundWindow, focusTerminal } = require("./terminals.cjs");
const tasks = require("./tasks.cjs");
const corners = require("./corners.cjs");
const { startMouseGuard } = require("./mouse-guard.cjs");

const ROOT = path.join(__dirname, "..");
const CONFIG_FILE = path.join(ROOT, "config.json");
const APP_ICON = path.join(ROOT, "assets", "icon.png"); // npm run icon
const MIN_WAV_BYTES = 44 + 16000 * 2 * 0.3; // ignore taps shorter than 0.3 s

const APP_NAME = "Claude Terminal Assistant";

// Data (state.json, screenshots) lives in %APPDATA%\claude-terminal-assistant: no spaces, because
// screenshot paths are typed into terminals. Before the rename it was terminal-claude-helper; it is
// moved over once, or, if the move fails (files still open), what matters is copied. A
// --user-data-dir switch (test runs) is left alone. Set before the single-instance lock, which
// lives in this folder.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  const dataDir = path.join(app.getPath("appData"), "claude-terminal-assistant");
  const oldDir = path.join(app.getPath("appData"), "terminal-claude-helper");
  if (!fs.existsSync(dataDir) && fs.existsSync(oldDir)) {
    try {
      fs.renameSync(oldDir, dataDir);
    } catch {
      fs.mkdirSync(dataDir, { recursive: true });
      for (const f of ["state.json", "screenshots"]) {
        try { fs.cpSync(path.join(oldDir, f), path.join(dataDir, f), { recursive: true }); } catch {}
      }
    }
  }
  app.setPath("userData", dataDir);
}

if (!app.requestSingleInstanceLock()) app.exit(0);

// ---------- log file ----------
// %APPDATA%\claude-terminal-assistant\logs\app.log: everything printed below, uncaught errors, and
// errors from the app's own windows (a failed preload, a crashed page). When the app starts with
// Windows there is no terminal, so this is where problems show. Settings has Open log and Report
// a problem.
const LOG = createLog(path.join(app.getPath("userData"), "logs"));
hookConsole(LOG);
console.log(`[app] ${APP_NAME} ${app.getVersion()} starting (Electron ${process.versions.electron}, Windows ${os.release()})`);
let crashNotified = false;
function logCrash(kind, err) {
  console.error(`[${kind}]`, err);
  // Tell the person once per run; the details are in the log.
  if (!crashNotified && app.isReady()) {
    crashNotified = true;
    notify(APP_NAME, "Something went wrong. Settings > Open log shows the details.");
  }
}
process.on("uncaughtException", (err) => logCrash("uncaught", err));
process.on("unhandledRejection", (reason) => logCrash("unhandled rejection", reason));
app.on("web-contents-created", (_e, wc) => {
  const page = () => path.basename(wc.getURL() || "page");
  // One parameter: Electron 35+ puts level and message on the event (extra ones log a deprecation).
  wc.on("console-message", (event) => {
    if (event.level === "error") console.error(`[${page()}] ${event.message}`);
  });
  wc.on("preload-error", (_ev, preload, error) => console.error(`[${page()}] preload ${path.basename(preload)} failed:`, error));
  wc.on("render-process-gone", (_ev, details) => console.error(`[${page()}] page process gone: ${details.reason} (exit ${details.exitCode})`));
});
// Started again (e.g. `npm start`) while already running, often from the login item: the new copy
// quits at once, so show this one's menu to make clear it is there.
app.on("second-instance", () => { if (tray && menuWin) showMenu(); });

// Start with Windows (config "startAtLogin", default on): a per-user Run entry that launches this
// Electron with the project folder, straight into the tray. Written at every start so it follows
// the project if it moves; turning the setting off removes it.
const LOGIN_ITEM = { path: process.execPath, args: [app.getAppPath()], name: APP_NAME };
function applyStartAtLogin() {
  try {
    app.setLoginItemSettings({ ...LOGIN_ITEM, name: "Terminal Claude Helper", openAtLogin: false }); // the name before the rename
    app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: cfg.startAtLogin !== false });
  } catch (err) {
    console.error("[login item]", err);
  }
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
const whisper = new Whisper(cfg.whisper);
const stateFile = () => path.join(app.getPath("userData"), "state.json");

let tray, recorderWin, overlayWin, autoStopTimer;
let phase = "idle"; // idle | recording | transcribing | confirming (the accept/reject toast is up)
let target = null; // { pid, title, shell, host }
let terminals = [];
// Free dictation: set when, during a recording started with the mouse chord, the user left-clicks
// a window while still holding the chord. This recording is then typed into that window instead
// of the target terminal. Cleared when the recording ends.
let dictation = null; // { hwnd, pid, exe, title }
let lastText = "";
// When the microphone actually started (rec:started), so screenshots and screen-recording frames
// can be placed against Whisper's word timestamps. Set to the hotkey time first as a fallback.
let audioT0 = 0;
const sinceAudioStart = () => Math.max(0, (Date.now() - audioT0) / 1000);

const BEEPS = {
  start: [[880, 90]],
  stop: [[660, 90]],
  sent: [[660, 70], [990, 110]],
  error: [[300, 180], [220, 260]],
  shot: [[1200, 40], [1200, 40]],
  screenOn: [[700, 60], [1050, 80]],
  confirm: [[880, 50]],
  screenOff: [[1050, 60], [700, 80]],
  done: [[523, 70], [659, 70], [784, 130]], // Claude finished in a terminal
  ask: [[784, 90], [784, 90], [523, 160]], // Claude waits for a permission
};
const beep = (name) => recorderWin?.webContents.send("rec:beep", BEEPS[name]);

function notify(title, body) {
  console.log(`[notify] ${title}: ${body}`);
  if (Notification.isSupported()) new Notification({ title, body, silent: true, icon: APP_ICON }).show();
}

function fail(message) {
  beep("error");
  showOverlay("error", message.split("\n")[0], 3000);
  notify(APP_NAME, message);
}

// ---------- cursor overlay ----------
// A small click-through pill that follows the mouse: REC timer, transcribing spinner, result.
// Not shown above games running in exclusive full-screen; the beeps cover that case.
const OVERLAY_OFFSET = { x: 18, y: 20 };
let followTimer = null;
let hideTimer = null;

function createOverlay() {
  overlayWin = new BrowserWindow({
    width: 320, height: 40, show: false, frame: false, transparent: true, resizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, "overlay-preload.cjs"), backgroundThrottling: false },
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setVisibleOnAllWorkspaces(true);
  return overlayWin.loadFile(path.join(__dirname, "overlay.html"));
}

function followCursor() {
  const p = screen.getCursorScreenPoint();
  overlayWin.setPosition(p.x + OVERLAY_OFFSET.x, p.y + OVERLAY_OFFSET.y);
}

// hideAfterMs: 0 keeps it up until the next showOverlay/hideOverlay.
function showOverlay(kind, text = "", hideAfterMs = 0) {
  if (!overlayWin || overlayWin.isDestroyed() || cfg.cursorIndicator === false) return;
  clearTimeout(hideTimer);
  overlayWin.webContents.send("overlay:show", { kind, text });
  followCursor();
  if (!overlayWin.isVisible()) overlayWin.showInactive();
  overlayWin.moveTop();
  if (!followTimer) followTimer = setInterval(followCursor, 16);
  if (hideAfterMs) hideTimer = setTimeout(hideOverlay, hideAfterMs);
}

function hideOverlay() {
  clearTimeout(hideTimer);
  clearInterval(followTimer);
  followTimer = null;
  overlayWin?.hide();
}

// ---------- click-to-select ----------
// Hold the select button (a mouse button or a key, see config.json "select") and left-click a
// terminal window to make it the target.
// Is the hook event's point (physical pixels) inside this window?
function insideWindow(win, e) {
  const p = screen.screenToDipPoint({ x: e.x, y: e.y });
  const b = win.getBounds();
  return p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
}

function setupClickSelect() {
  const sel = cfg.select ?? { mouseButton: 4 };
  const keycode = sel.key ? UiohookKey[sel.key] : undefined;
  if (sel.key && keycode === undefined) {
    notify(APP_NAME, `Unknown select key "${sel.key}" in config.json.`);
  }
  // While recording, the same button instead drags out a screenshot area: press, move, release.
  let held = false;
  const mouse = { x: 0, y: 0 }; // last known cursor position, physical pixels
  const press = () => {
    if (held) return; // key auto-repeat
    held = true;
    if (phase === "recording") startDrag(mouse.x, mouse.y);
  };
  const release = () => {
    held = false;
    if (drag) endDrag(mouse.x, mouse.y);
  };
  const move = (e) => {
    mouse.x = e.x;
    mouse.y = e.y;
    if (drag) updateDrag(e.x, e.y);
  };
  uIOhook.on("mousemove", move);
  uIOhook.on("mousedrag", move); // uiohook reports moves with a button held as "mousedrag"
  uIOhook.on("mousedown", (e) => {
    move(e);
    if (sel.mouseButton && e.button === sel.mouseButton) press();
    else if ((e.button === 1 || e.button === 2) && menuWin?.isVisible() && !insideWindow(menuWin, e)) setTimeout(hideMenu, 0);
    else if (e.button === 1 && pickerWin?.isVisible()) {
      // A click inside the picker is handled by the picker itself; one anywhere else dismisses it.
      const p = screen.screenToDipPoint({ x: e.x, y: e.y });
      const b = pickerWin.getBounds();
      if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) closePicker();
    } else if (e.button === 1 && held && !drag && phase !== "recording") selectAt(e.x, e.y);
  });
  uIOhook.on("mouseup", (e) => {
    move(e);
    if (sel.mouseButton && e.button === sel.mouseButton) release();
  });
  if (keycode !== undefined) {
    uIOhook.on("keydown", (e) => { if (e.keycode === keycode) press(); });
    uIOhook.on("keyup", (e) => { if (e.keycode === keycode) release(); });
  }
}

// ---------- screenshots during recording ----------
// Screenshots taken while recording are saved as PNGs and their paths are appended to the
// dictated text; Claude Code attaches image files whose path it receives.
let drag = null; // { x0, y0, x1, y1 } physical pixels
let selectionWin = null;
let shots = []; // promises of { file, t } (t: seconds into the audio) for the current recording

// config "screenshotsDir": a path without spaces (paths are typed unquoted). Default: app data.
const shotsDir = () => cfg.screenshotsDir || path.join(app.getPath("userData"), "screenshots");

// The selection window covers the whole monitor the drag starts on and draws the frame inside
// itself. It is placed once per drag and never resized while dragging: moving or resizing a
// window across monitors with different scaling (100% vs 300% here) makes Windows rescale it
// mid-move, which is what misaligned the frame before.
function createSelectionWindow() {
  selectionWin = new BrowserWindow({
    show: false, frame: false, transparent: true, resizable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, "selection-preload.cjs"), backgroundThrottling: false },
  });
  selectionWin.setAlwaysOnTop(true, "screen-saver");
  selectionWin.setIgnoreMouseEvents(true);
  return selectionWin.loadFile(path.join(__dirname, "selection.html"));
}

const dragRect = (d) => {
  // Clamp to the monitor the drag started on: the frame is only drawn there.
  const b = d.phys;
  const cx = (v) => Math.min(Math.max(v, b.x), b.x + b.width);
  const cy = (v) => Math.min(Math.max(v, b.y), b.y + b.height);
  const x0 = cx(d.x0), x1 = cx(d.x1), y0 = cy(d.y0), y1 = cy(d.y1);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
};

function startDrag(x, y) {
  const display = screen.getDisplayNearestPoint(screen.screenToDipPoint({ x, y }));
  drag = { x0: x, y0: y, x1: x, y1: y, display, phys: screen.dipToScreenRect(null, display.bounds) };
  hideOverlay(); // the cursor pill must not end up inside the screenshot
  selectionWin.webContents.send("sel:rect", { rect: null });
  // Twice: the first call can land with the old monitor's scaling, the second fixes the size.
  selectionWin.setBounds(display.bounds);
  selectionWin.setBounds(display.bounds);
  selectionWin.showInactive();
  selectionWin.moveTop();
}

const shotBadge = (n) => (n ? `· 📷 ${n}` : "");

function updateDrag(x, y) {
  drag.x1 = x;
  drag.y1 = y;
  const r = dragRect(drag);
  const s = drag.display.scaleFactor;
  // Physical pixels -> CSS pixels inside the window covering this monitor.
  selectionWin.webContents.send("sel:rect", {
    rect: { x: (r.x - drag.phys.x) / s, y: (r.y - drag.phys.y) / s, width: r.width / s, height: r.height / s },
    px: { w: r.width, h: r.height },
  });
}

function cancelDrag() {
  drag = null;
  selectionWin?.webContents.send("sel:rect", { rect: null });
  selectionWin?.hide();
}

function endDrag(x, y) {
  drag.x1 = x;
  drag.y1 = y;
  const r = dragRect(drag);
  cancelDrag();
  const reshow = () => { if (phase === "recording") showOverlay("recording", recordingLabel()); };
  // A tap (press and release without dragging) turns screen recording on or off instead.
  if (r.width < 8 || r.height < 8) {
    if (phase === "recording") toggleScreenRec();
    return reshow();
  }
  const t = sinceAudioStart();
  const shot = saveScreenshot(r).then(
    (file) => { console.log(`[shot] ${file}`); return { file, t }; },
    (err) => { fail(`Screenshot failed: ${err.message}`); return null; },
  );
  shots.push(shot);
  shot.then(() => { beep("shot"); reshow(); });
}

async function saveScreenshot(r) {
  // Let the frame window disappear before the screen is copied.
  await new Promise((res) => setTimeout(res, 120));
  fs.mkdirSync(shotsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = path.join(shotsDir(), `shot-${stamp}-${Math.random().toString(36).slice(2, 6)}`);
  const raw = `${base}.raw`;
  try {
    const { width, height } = await captureArea(r.x, r.y, r.width, r.height, raw);
    const png = nativeImage.createFromBitmap(fs.readFileSync(raw), { width, height }).toPNG();
    fs.writeFileSync(`${base}.png`, png);
    return `${base}.png`;
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

// ---------- screen recording during a voice recording ----------
// A tap of the select button while recording toggles it. The monitor under the cursor is sampled
// every `intervalMs`; a sample is kept as a JPEG only if the screen changed or the pointer moved
// (see screenrec.cjs), with the pointer marked. When the recording ends, at most `maxFrames` are
// kept and placed into the transcript where they were taken.
let screenRec = null; // { stamp, frames: [{ t, file, score }], last, busy, timer }
let frames = []; // kept frames of this voice recording ({ t, file }), from finished screen recordings
const screenCfg = () => ({ intervalMs: 1000, maxFrames: 10, maxWidth: 1920, ...cfg.screenRecord });
const frameCount = () => frames.length + (screenRec?.frames.length ?? 0);

function toggleScreenRec() {
  if (screenRec) {
    stopScreenRec();
    beep("screenOff");
  } else {
    startScreenRec();
    beep("screenOn");
  }
}

function startScreenRec() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  screenRec = { stamp, frames: [], last: null, busy: false };
  screenRec.timer = setInterval(captureFrame, screenCfg().intervalMs);
  captureFrame();
  console.log("[screen] recording");
}

// Ends the running screen recording, keeps its best frames and deletes the rest.
function stopScreenRec() {
  const rec = screenRec;
  if (!rec) return;
  screenRec = null;
  clearInterval(rec.timer);
  const { keep, drop } = screenrec.pickFrames(rec.frames, Math.max(1, screenCfg().maxFrames - frames.length));
  for (const f of drop) fs.rmSync(f.file, { force: true });
  frames.push(...keep.map(({ t, file }) => ({ t, file })));
  console.log(`[screen] stopped: ${rec.frames.length} changes, kept ${keep.length}`);
}

// Throws the current recording's frames away (the voice recording failed).
function discardScreenRec() {
  stopScreenRec();
  for (const f of frames) fs.rmSync(f.file, { force: true });
  frames = [];
}

// The cursor pill must not end up in the frame, and it must stay on screen. Content protection
// (WDA_EXCLUDEFROMCAPTURE) made the transparent, hidden-and-reshown pill disappear from the monitor
// too, so instead the pill is made fully transparent for just the ~30 ms GDI copy: setOpacity
// reaches a BitBlt at once (measured), and a 30 ms gap once a second is not noticeable.
function captureFrame() {
  const rec = screenRec;
  if (!rec || rec.busy) return;
  rec.busy = true;
  try {
    const t = sinceAudioStart();
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const phys = screen.dipToScreenRect(null, display.bounds);
    const pill = overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible();
    let bgra;
    if (pill) overlayWin.setOpacity(0);
    try {
      bgra = grab(phys.x, phys.y, phys.width, phys.height);
    } finally {
      if (pill) overlayWin.setOpacity(1);
    }
    let img = nativeImage.createFromBitmap(bgra, { width: phys.width, height: phys.height });
    const k = Math.min(1, screenCfg().maxWidth / Math.max(phys.width, phys.height));
    if (k < 1) img = img.resize({ width: Math.round(phys.width * k), quality: "good" });
    const sample = screenrec.sampleOf(img, display, cursor);
    const score = screenrec.changeScore(rec.last, sample);
    if (score < screenrec.CHANGE_THRESHOLD) return;
    const jpg = screenrec.frameJpeg(nativeImage, img, sample);
    fs.mkdirSync(shotsDir(), { recursive: true });
    const file = path.join(shotsDir(), `screen-${rec.stamp}-${String(rec.frames.length + 1).padStart(2, "0")}.jpg`);
    fs.writeFileSync(file, jpg);
    rec.frames.push({ t, file, score });
    rec.last = sample;
    if (phase === "recording") showOverlay("recording", recordingLabel());
  } catch (err) {
    console.error("[screen]", err);
  } finally {
    rec.busy = false;
  }
}

// Screenshots are only needed until Claude has read them; keep a week's worth.
function pruneScreenshots() {
  try {
    const cutoff = Date.now() - 7 * 24 * 3600_000;
    for (const f of fs.readdirSync(shotsDir())) {
      const p = path.join(shotsDir(), f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch {}
}

function selectLabel() {
  const sel = cfg.select ?? { mouseButton: 4 };
  const names = { 3: "the middle mouse button", 4: "the mouse Back button", 5: "the mouse Forward button" };
  return sel.key ? sel.key : names[sel.mouseButton] ?? `mouse button ${sel.mouseButton}`;
}

async function selectAt(x, y) {
  try {
    const t = await terminalAt(x, y);
    if (t.ambiguous) return pickCandidate(t);
    setTarget(t);
  } catch (err) {
    fail(err.message);
  }
}

function setTarget(t) {
  // Only a console record from the helper can be a target; anything else is a programming error.
  if (!t?.pid) return fail(`Could not select that terminal (no pid in ${JSON.stringify(t)?.slice(0, 80)}).`);
  // A click on a window gives no tab names; the last listing may know this one's.
  const known = terminals.find((x) => x.pid === t.pid);
  target = t.tabName || !known?.tabName ? t : { ...t, tabName: known.tabName };
  saveState();
  refreshTray();
  beep("sent");
  showOverlay("ok", `Target: ${terminalLabel(target).title}`, 2000);
  console.log(`[select] ${describe(target)}`);
}

// The clicked window holds several terminals and nothing tells which tab is showing (IntelliJ's
// window title is the project, not the tab): ask with a small list at the cursor. This is our own
// always-on-top window rather than a native popup menu: a menu opened from a global hook, while
// another app is in the foreground, closes again at once (TrackPopupMenu needs the foreground).
let pickerWin, pickerCandidates = [];
function createPicker() {
  pickerWin = new BrowserWindow({
    width: 420, height: 100, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, movable: false,
    webPreferences: { preload: path.join(__dirname, "picker-preload.cjs"), backgroundThrottling: false },
  });
  pickerWin.setAlwaysOnTop(true, "screen-saver");
  pickerWin.setVisibleOnAllWorkspaces(true);
  ipcMain.on("picker:pick", (_e, i) => { const c = pickerCandidates[i]; closePicker(); if (c) setTarget(c); });
  ipcMain.on("picker:cancel", closePicker);
  return pickerWin.loadFile(path.join(__dirname, "picker.html"));
}

function closePicker() {
  pickerCandidates = [];
  if (pickerWin?.isVisible()) pickerWin.hide();
}

function pickCandidate({ windowTitle, candidates }) {
  console.log(`[select] ${candidates.length} terminals in "${windowTitle}", asking`);
  pickerCandidates = candidates;
  const height = 36 + 30 * candidates.length;
  // At the cursor, kept inside the work area of the display it is on.
  const p = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(p).workArea;
  const x = Math.min(Math.max(p.x + 12, wa.x), wa.x + wa.width - 420);
  const y = Math.min(Math.max(p.y + 12, wa.y), wa.y + wa.height - height);
  pickerWin.setBounds({ x, y, width: 420, height });
  pickerWin.webContents.send("picker:show", { windowTitle, candidates });
  pickerWin.show();
  pickerWin.focus();
}

// ---------- target persistence ----------
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    target = s.target ?? null;
    if (typeof s.pressEnter === "boolean") cfg.pressEnter = s.pressEnter;
  } catch {}
}
function saveState() {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify({ target, pressEnter: cfg.pressEnter }, null, 2));
}

// ---------- tray ----------
// The tray icon is a microphone in the state's color. Clicking it opens our own menu window
// (menu.html) rather than a native menu, styled like the cursor pill.
const ICONS = Object.fromEntries(["idle", "notarget", "recording", "transcribing"].map((k) => [k, trayIcon(nativeImage, k)]));
ICONS.confirming = ICONS.transcribing;

// What Claude is doing in each terminal, for the lists: the console title says working or not;
// the hooks' last event per terminal pid ({ kind: "ask" | "done", at }, set in onTaskDone) tells
// "needs you" and "done" from idle (tasks.claudeStatus). Every listing keeps it current.
const claudeEvents = new Map();
async function listTerminals() {
  const list = await listConsoles();
  tasks.updateEvents(claudeEvents, list);
  return list;
}
// One row of the tray menu or the terminal chooser.
const rowLabel = (t) => ({
  ...terminalLabel(t),
  status: statusChip(tasks.claudeStatus(t, claudeEvents.get(t.pid))),
  selected: target?.pid === t.pid,
});

const describe = (t) => `${t.tabName ? `[${t.tabName}] ` : ""}${t.title || t.shell} (${t.shell}${t.host ? ` in ${t.host}` : ""}, pid ${t.pid})`;

function refreshTray() {
  const icon = phase !== "idle" ? ICONS[phase] : target ? ICONS.idle : ICONS.notarget;
  tray.setImage(icon);
  const lines = [
    APP_NAME,
    target ? `Typing into ${terminalLabel(target).title}` : "No terminal picked",
    phase !== "idle" ? phase[0].toUpperCase() + phase.slice(1) : `Shortcut: ${keycaps(cfg.hotkey).join("+")}`,
  ];
  tray.setToolTip(lines.join("\n").slice(0, 127));
  if (menuWin?.isVisible()) sendMenuState();
}

let menuWin = null;
let menuHiddenAt = 0;
let menuPendingShow = false;
const MENU_WIDTH = 372;

function createMenu() {
  menuWin = new BrowserWindow({
    width: MENU_WIDTH, height: 400, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, movable: false, minimizable: false, maximizable: false,
    webPreferences: { preload: path.join(__dirname, "menu-preload.cjs"), backgroundThrottling: false },
  });
  menuWin.setAlwaysOnTop(true, "pop-up-menu");
  menuWin.on("blur", hideMenu);
  return menuWin.loadFile(path.join(__dirname, "menu.html"));
}

function hideMenu() {
  menuPendingShow = false;
  if (!menuWin?.isVisible()) return;
  menuWin.hide();
  menuHiddenAt = Date.now();
}

function selectHint() {
  const sel = cfg.select ?? { mouseButton: 4 };
  const what = sel.key ? sel.key : `the ${buttonName(sel.mouseButton)} button`;
  return `Or hold ${what} and click a terminal.`;
}

function sendMenuState() {
  menuWin.webContents.send("menu:state", {
    phase,
    target: target ? terminalLabel(target) : null,
    terminals: terminals.map(rowLabel),
    hotkey: keycaps(cfg.hotkey),
    selectHint: selectHint(),
    pressEnter: !!cfg.pressEnter,
    lastText,
  });
}

async function showMenu() {
  // A click on the tray icon while the menu is open closes it (blur fires first): don't reopen.
  if (menuWin.isVisible() || Date.now() - menuHiddenAt < 300) return hideMenu();
  // Open at once with the terminals known so far; the fresh list (about a second) updates it.
  menuPendingShow = true;
  sendMenuState(); // the menu answers with its height (menu:size), then it is placed and shown
  try { terminals = await listTerminals(); } catch (err) { console.error(err); }
  // The target pid may have been reused or closed; keep its newest title if it is still listed.
  if (target) {
    const live = terminals.find((t) => t.pid === target.pid);
    if (live) target = live;
  }
  refreshTray(); // re-sends the menu state while it is open
}

// Above the tray icon (below it when the taskbar is at the top), inside the work area.
function placeMenu(height) {
  const icon = tray.getBounds();
  const anchor = { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 };
  const wa = screen.getDisplayNearestPoint(anchor).workArea;
  const x = Math.round(Math.min(Math.max(anchor.x - MENU_WIDTH / 2, wa.x + 4), wa.x + wa.width - MENU_WIDTH - 4));
  const y = anchor.y < wa.y + wa.height / 2 ? wa.y + 4 : wa.y + wa.height - height - 4;
  menuWin.setBounds({ x, y, width: MENU_WIDTH, height });
}

ipcMain.on("menu:size", (_e, height) => {
  const h = Math.max(120, Math.min(Math.round(height), 720));
  if (menuPendingShow) {
    menuPendingShow = false;
    placeMenu(h);
    menuWin.show();
    menuWin.focus();
  } else if (menuWin.isVisible() && menuWin.getBounds().height !== h) {
    placeMenu(h);
  }
});

ipcMain.on("menu:action", (_e, a) => {
  switch (a.type) {
    case "select": {
      const t = terminals.find((x) => x.pid === a.pid);
      if (t) { target = t; saveState(); refreshTray(); }
      break;
    }
    case "pressEnter": cfg.pressEnter = !!a.value; saveState(); break;
    case "record": hideMenu(); toggleRecording(); break;
    case "settings": hideMenu(); openSettings(); break;
    case "restart": app.relaunch(); app.quit(); break;
    case "quit": app.quit(); break;
    case "close": hideMenu(); break;
  }
});

// ---------- settings window ----------
// Edits config.json. Settings read only at startup (RESTART_KEYS) restart the helper on save;
// the rest apply at once.
let settingsWin = null;

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 620, height: 760, minWidth: 520, minHeight: 480, show: false, title: `${APP_NAME} settings`,
    backgroundColor: "#1f2023", autoHideMenuBar: true, icon: APP_ICON,
    webPreferences: { preload: path.join(__dirname, "settings-preload.cjs") },
  });
  settingsWin.setMenu(null);
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => { settingsWin = null; pauseHotkeys(false); });
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
}

function whisperModels() {
  try {
    const dir = path.dirname(cfg.whisper.model);
    return fs.readdirSync(dir).filter((f) => f.endsWith(".bin")).sort().map((f) => ({
      file: path.join(dir, f),
      name: f.replace(/^ggml-/, "").replace(/\.bin$/, ""),
    }));
  } catch {
    return [];
  }
}

ipcMain.handle("settings:load", () => ({
  config: structuredClone(cfg),
  models: whisperModels(),
  keyNames: Object.keys(UiohookKey),
  restartKeys: RESTART_KEYS,
}));

ipcMain.handle("settings:save", (_e, next) => {
  const errors = validate(next, Object.keys(UiohookKey));
  if (errors.length) return { ok: false, errors };
  const restart = needsRestart(cfg, next);
  if (restart && phase !== "idle") return { ok: false, message: "Finish the recording first: saving restarts the helper." };
  fs.writeFileSync(CONFIG_FILE, `${formatConfig(next)}\n`);
  for (const k of Object.keys(cfg)) delete cfg[k];
  Object.assign(cfg, structuredClone(next));
  saveState(); // pressEnter also lives in state.json
  if (cfg.cursorIndicator === false) hideOverlay();
  applyStartAtLogin();
  refreshTray();
  console.log(`[settings] saved${restart ? ", restarting" : ""}`);
  if (restart) { app.relaunch(); app.quit(); } else settingsWin?.close();
  return { ok: true, restart };
});

ipcMain.on("settings:capturing", (_e, on) => pauseHotkeys(!!on));
ipcMain.on("settings:openLog", () => {
  if (!fs.existsSync(LOG.file)) LOG.write("INFO", ["(log opened from Settings)"]);
  shell.openPath(LOG.file);
});
// A new GitHub issue with the versions filled in. The log isn't attached: it holds dictated text,
// so the person looks it over and attaches it.
ipcMain.on("settings:report", () => {
  const bugs = require(path.join(ROOT, "package.json")).bugs?.url;
  if (!bugs) return shell.openPath(path.dirname(LOG.file));
  const body = [
    "**What happened**", "", "", "**What you expected**", "", "", "**Steps to reproduce**", "", "",
    "---",
    `${APP_NAME} ${app.getVersion()}, Electron ${process.versions.electron}, Windows ${os.release()}`,
    "Log: Settings > Open log. Please attach it, or the lines around the problem. It contains the text you dictated, so look it over first.",
  ].join("\n");
  shell.openExternal(`${bugs}/new?title=${encodeURIComponent("Problem: ")}&body=${encodeURIComponent(body)}`);
});
ipcMain.on("settings:close", () => settingsWin?.close());

// ---------- recording pipeline ----------
// The text after the REC timer: the dictation window if one was clicked, then the screenshot count.
function recordingLabel() {
  return [
    dictation ? `→ ${dictation.title || dictation.exe}` : "",
    shots.length ? shotBadge(shots.length) : "",
    screenRec || frames.length ? `· 🎥 ${frameCount()}${screenRec ? "" : " ⏸"}` : "",
  ].filter(Boolean).join(" ");
}

// allowNoTarget: the mouse chord may be followed by a click on a window (free dictation), so it
// starts recording even without a target terminal; the keyboard hotkey still needs one.
function toggleRecording({ allowNoTarget = false } = {}) {
  if (phase === "confirming") return resolveConfirm(false, "shortcut");
  if (phase === "recording") return stopRecording();
  if (phase !== "idle") return beep("error");
  if (!target && !allowNoTarget) return fail("Pick a target terminal first (right-click the tray icon).");
  phase = "recording";
  mouseGuard?.setActive(true);
  shots = [];
  frames = [];
  dictation = null;
  audioT0 = Date.now(); // refined by rec:started once the microphone is open
  refreshTray();
  beep("start");
  showOverlay("recording", target ? "" : "click a window");
  whisper.start().catch((err) => console.error(err)); // load the model while the user speaks
  recorderWin.webContents.send("rec:start");
  autoStopTimer = setTimeout(stopRecording, (cfg.maxRecordSeconds ?? 60) * 1000);
}

function stopRecording() {
  clearTimeout(autoStopTimer);
  if (phase !== "recording") return;
  cancelDrag(); // a drag still in progress when recording stops is dropped
  stopScreenRec(); // its frames stay in `frames` for rec:audio
  phase = "transcribing";
  mouseGuard?.setActive(false);
  refreshTray();
  beep("stop");
  showOverlay("transcribing", "Transcribing…");
  recorderWin.webContents.send("rec:stop");
}

function backToIdle() {
  phase = "idle";
  mouseGuard?.setActive(false);
  dictation = null;
  refreshTray();
}

// Left click on a window while the mouse chord is still held during a recording: this recording
// goes into that window (free dictation), not into the target terminal.
async function dictateAt(x, y) {
  try {
    const w = await windowAt(x, y);
    if (phase !== "recording") return;
    dictation = w;
    console.log(`[dictate] -> ${w.exe} "${w.title}" (hwnd ${w.hwnd})`);
    showOverlay("recording", recordingLabel());
  } catch (err) {
    fail(err.message);
  }
}

ipcMain.on("rec:started", () => {
  if (phase === "recording") audioT0 = Date.now();
});

ipcMain.on("rec:error", (_e, message) => {
  clearTimeout(autoStopTimer);
  discardScreenRec();
  backToIdle();
  fail(message);
});

// A recording that was cancelled (see cancelRecording) still hands back its audio; drop it.
let discardAudio = 0;

// Stops the current recording without transcribing it: the hold-to-pick gesture started it.
function cancelRecording() {
  if (phase !== "recording") return;
  clearTimeout(autoStopTimer);
  cancelDrag();
  discardScreenRec();
  shots = [];
  dictation = null;
  discardAudio++;
  phase = "idle";
  mouseGuard?.setActive(false);
  refreshTray();
  recorderWin.webContents.send("rec:stop");
  hideOverlay();
  console.log("[rec] cancelled");
}

ipcMain.on("rec:audio", async (_e, arrayBuffer) => {
  if (discardAudio > 0) { discardAudio--; return; }
  const wav = Buffer.from(arrayBuffer);
  const pendingShots = shots;
  const pendingFrames = frames;
  shots = [];
  frames = [];
  try {
    let text = "";
    let words = [];
    const level = wav.length >= MIN_WAV_BYTES ? peakLevel(wav) : 0;
    if (level >= (cfg.silenceLevel ?? 0.015)) {
      const t0 = Date.now();
      ({ text, words } = await whisper.transcribe(wav));
      console.log(`[whisper] ${Date.now() - t0} ms, level ${level.toFixed(3)}: ${JSON.stringify(text)}`);
      if (isHallucination(text)) { console.log("[whisper] dropped as a silence hallucination"); text = ""; words = []; }
    } else {
      console.log(`[whisper] skipped: silence (level ${level.toFixed(3)})`);
    }
    const shotItems = (await Promise.all(pendingShots)).filter(Boolean);
    const images = shotItems.length + pendingFrames.length;
    if (!text && !images) return fail(wav.length < MIN_WAV_BYTES ? "Recording too short." : "Heard nothing. Try again.");
    // Screenshots and screen-recording frames go where they were taken in the speech.
    const message = screenrec.composeMessage({ text, words, shots: shotItems, frames: pendingFrames });
    lastText = text || `${images} image(s)`;
    if (dictation) {
      // Free dictation: words only (screenshot paths mean nothing to a document), Enter only if
      // config "dictationEnter" asks for it (in a chat app Enter would send the message).
      if (!text) return fail("Heard nothing. Try again.");
      const into = dictation;
      if (!(await confirmSend({ verb: "Type into", title: into.title || into.exe, text }))) return notSent();
      try {
        await typeIntoWindow(into.hwnd, text, false);
        if (cfg.dictationEnter === true) { await pause(ENTER_DELAY_MS); await typeIntoWindow(into.hwnd, "", true); }
      } catch (err) {
        return fail(`${err.message}\nHeard: ${text}`);
      }
      beep("sent");
      showOverlay("ok", text, 2500);
      return;
    }
    if (!target) return fail(`No target terminal. Heard: ${text}`);
    const to = target; // the terminal the toast names, even if the target changes meanwhile
    const label = terminalLabel(to);
    if (!(await confirmSend({ verb: "Send to", title: label.title, where: label.where, text, images }))) return notSent();
    try {
      await sendToTerminal(to.pid, message, false);
      if (cfg.pressEnter) { await pause(ENTER_DELAY_MS); await sendToTerminal(to.pid, "", true); }
    } catch (err) {
      target = null;
      saveState();
      return fail(`${err.message}\nPick the terminal again. Heard: ${text}`);
    }
    beep("sent");
    const badges = [shotItems.length ? shotBadge(shotItems.length) : "", pendingFrames.length ? `· 🎥 ${pendingFrames.length}` : ""];
    showOverlay("ok", [text, ...badges].filter(Boolean).join(" "), 2500);
  } catch (err) {
    fail(err.message);
  } finally {
    backToIdle();
  }
});

// Enter goes on its own, a moment after the text. Text and Enter in one burst read as a paste to
// Claude Code (and other TUIs), and a pasted Enter becomes a new line instead of submitting.
const ENTER_DELAY_MS = 500;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- accept / reject before sending ----------
// After transcription a toast in a corner of the screen (config "confirm.position", default bottom
// right; see corners.cjs) shows the text with Reject and Accept, on the same card as the "Claude
// finished" notifications. Accept counts down (config "confirm.seconds", default 3) and fires on its own. The
// toast never takes the focus; clicks and hover come from the global hook. Hovering it pauses
// the countdown so a long text can be read; the recording shortcut or the mouse chord rejects.
// config "confirm.enabled": false sends straight away, as before.
let confirmWin = null;
let pendingConfirm = null; // { resolve, remaining, startedAt, timer, paused, shown, rects }
let confirmPlace = null; // { area, height } while the toast is up
const CONFIRM_WIDTH = 380; // as wide as the "Claude finished" cards, so they line up when stacked

// Places the toast and the "Claude finished" cards in their corners; when they share one, the
// cards stack beyond the toast. Called whenever either appears, changes height or goes away.
function placeToasts() {
  const c = pendingConfirm?.shown && confirmPlace
    ? { corner: corners.cornerOf(cfg.confirm?.position), area: confirmPlace.area, width: CONFIRM_WIDTH, height: confirmPlace.height } : null;
  const d = doneCards.length && donePlace
    ? { corner: corners.cornerOf(cfg.notify?.position), area: donePlace.area, width: DONE_WIDTH, height: donePlace.height } : null;
  const b = corners.placeToasts({ confirm: c, done: d });
  if (b.confirm) confirmWin.setBounds(b.confirm);
  if (b.done) doneWin.setBounds(b.done);
}

function createConfirm() {
  confirmWin = new BrowserWindow({
    width: CONFIRM_WIDTH, height: 200, show: false, frame: false, transparent: true, resizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, movable: false,
    webPreferences: { preload: path.join(__dirname, "confirm-preload.cjs"), backgroundThrottling: false },
  });
  confirmWin.setAlwaysOnTop(true, "screen-saver");
  confirmWin.setVisibleOnAllWorkspaces(true);
  return confirmWin.loadFile(path.join(__dirname, "confirm.html"));
}

// -> Promise<boolean>: true when accepted (by click or by the countdown).
function confirmSend({ verb, title, where = "", text, images = 0 }) {
  const c = cfg.confirm ?? {};
  if (c.enabled === false) return Promise.resolve(true);
  const seconds = c.seconds ?? 3;
  return new Promise((resolve) => {
    pendingConfirm = { resolve, remaining: seconds * 1000, startedAt: 0, timer: null, paused: false, shown: false, rects: null };
    phase = "confirming";
    refreshTray();
    hideOverlay();
    beep("confirm");
    confirmWin.webContents.send("confirm:show", { verb, title, where, text, images, seconds, rejectKeys: keycaps(cfg.hotkey) });
  });
}

ipcMain.on("confirm:layout", (_e, { height, accept, reject }) => {
  const c = pendingConfirm;
  if (!c || c.shown) return;
  c.shown = true;
  c.rects = { accept, reject };
  // On the monitor the cursor is on, where a game or editor is being used.
  confirmPlace = { area: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, height };
  placeToasts();
  confirmWin.showInactive();
  confirmWin.moveTop();
  runConfirm();
});

function runConfirm() {
  const c = pendingConfirm;
  c.paused = false;
  c.startedAt = Date.now();
  c.timer = setTimeout(() => resolveConfirm(true, "countdown"), c.remaining);
  confirmWin.webContents.send("confirm:run", { remaining: c.remaining });
}

function pauseConfirm(on) {
  const c = pendingConfirm;
  if (!c?.shown || c.paused === on) return;
  if (!on) return runConfirm();
  clearTimeout(c.timer);
  c.remaining = Math.max(0, c.remaining - (Date.now() - c.startedAt));
  c.paused = true;
  confirmWin.webContents.send("confirm:pause", { remaining: c.remaining });
}

function resolveConfirm(ok, how) {
  const c = pendingConfirm;
  if (!c) return;
  pendingConfirm = null;
  clearTimeout(c.timer);
  confirmWin.hide();
  confirmPlace = null;
  placeToasts(); // cards that stacked beyond it move back into the corner
  console.log(`[confirm] ${ok ? "accepted" : "rejected"} (${how})`);
  c.resolve(ok);
}

function notSent() {
  beep("stop");
  showOverlay("error", "Not sent", 1500);
}

// Which toast button is under the hook event's point: "accept", "reject", "panel" or null.
function confirmHit(e) {
  if (!pendingConfirm?.shown || !insideWindow(confirmWin, e)) return null;
  const p = screen.screenToDipPoint({ x: e.x, y: e.y });
  const b = confirmWin.getBounds();
  const x = p.x - b.x, y = p.y - b.y;
  for (const [name, r] of Object.entries(pendingConfirm.rects ?? {})) {
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return name;
  }
  return "panel";
}

function setupConfirmHook() {
  let hovered = null;
  const move = (e) => {
    if (!pendingConfirm?.shown) return;
    const hit = confirmHit(e);
    pauseConfirm(!!hit);
    const button = hit === "accept" || hit === "reject" ? hit : null;
    if (button !== hovered) { hovered = button; confirmWin.webContents.send("confirm:hover", button); }
  };
  uIOhook.on("mousemove", move);
  uIOhook.on("mousedrag", move);
  uIOhook.on("mousedown", (e) => {
    if (e.button !== 1) return;
    const hit = confirmHit(e);
    if (hit === "accept") resolveConfirm(true, "click");
    else if (hit === "reject") resolveConfirm(false, "click");
  });
}

// ---------- "Claude finished" cards ----------
// Claude Code runs src/task-done.cjs as a Stop hook (npm run install-prompt) when it finishes
// answering, and as a Notification hook when it waits for a permission (kind "ask"); the hook sends
// its ancestor pids, folder and Claude's last message (or the question) over a named pipe.
// A card in a corner of the screen (config notify.position, default bottom right) says which
// terminal finished and how; a click on it
// brings that terminal forward (in Windows Terminal, its tab too). No card when that terminal is
// already in front. Our own window rather than a Windows notification: those are held back
// while a full-screen game runs, and this one shows above borderless games. Like the
// accept/reject toast it never takes the focus; hover and clicks come from the global hook.
// config "notify": enabled, seconds (until the cards go away; hovering pauses), sound, position.
let doneWin = null;
let doneCards = []; // newest first: { id, kind, sessionId, title, where, project, text, time, pid, tabName, chain }
let doneRects = []; // from done:layout: [{ id, rect, close }], CSS px inside the window
let donePlace = null; // { area, height }: the display the cards are on (kept while they are up) and their height
let doneCountdown = null; // { remaining, startedAt, timer, paused }
let doneSeq = 0;
const DONE_WIDTH = 380;
const MAX_CARDS = 3;
const notifyCfg = () => ({ enabled: true, seconds: 15, sound: true, ...cfg.notify });

function createDone() {
  doneWin = new BrowserWindow({
    width: DONE_WIDTH, height: 160, show: false, frame: false, transparent: true, resizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, movable: false,
    webPreferences: { preload: path.join(__dirname, "done-preload.cjs"), backgroundThrottling: false },
  });
  doneWin.setAlwaysOnTop(true, "screen-saver");
  doneWin.setVisibleOnAllWorkspaces(true);
  return doneWin.loadFile(path.join(__dirname, "done.html"));
}

function startTaskPipe() {
  const server = net.createServer((sock) => {
    let data = "";
    sock.setEncoding("utf8");
    sock.setTimeout(5000, () => sock.destroy());
    sock.on("data", (d) => { data += d; if (data.length > 64 * 1024) sock.destroy(); });
    sock.on("end", () => {
      const m = tasks.parseMessage(data);
      if (m) onTaskDone(m).catch((err) => console.error("[done]", err));
    });
    sock.on("error", () => {});
  });
  // Another copy (a test run with --user-data-dir) may already hold the pipe.
  server.on("error", (err) => console.warn(`[done] no "Claude finished" cards: ${err.message}`));
  server.listen(tasks.PIPE_NAME);
}

async function onTaskDone(m) {
  const n = notifyCfg();
  let list = terminals;
  try { list = await listTerminals(); terminals = list; } catch (err) { console.error(err); }
  const t = tasks.findTerminal(list, m.chain);
  if (t) {
    claudeEvents.set(t.pid, { kind: m.kind, at: Date.now() });
    // An open list shows the new state at once.
    if (menuWin?.isVisible()) sendMenuState();
    if (chooserWin?.isVisible()) setChooserList(chooserTerminals, chooserHover);
  }
  if (n.enabled === false) return; // no cards, but the lists still show the state
  try {
    if (tasks.isShowing({ fg: await foregroundWindow(), terminal: t, terminals: list, chain: m.chain })) {
      return console.log(`[done] ${t ? describe(t) : "Claude"} ${m.kind === "ask" ? "asks" : "finished"}, already in front: no card`);
    }
  } catch (err) {
    console.error(err);
  }
  const label = t ? terminalLabel(t) : null;
  const card = {
    id: ++doneSeq,
    kind: m.kind,
    sessionId: m.sessionId,
    title: label?.title || "Claude Code",
    where: label?.where ?? "",
    project: m.cwd ? path.basename(m.cwd) : "",
    text: tasks.summarize(m.text, m.kind === "ask" ? 300 : 220),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    pid: t?.pid ?? 0,
    tabName: t?.tabName ?? "",
    chain: m.chain,
  };
  // One card per terminal (or session): a newer answer replaces the older card.
  const same = (c) => (card.pid && c.pid === card.pid) || (card.sessionId && c.sessionId === card.sessionId);
  doneCards = [card, ...doneCards.filter((c) => !same(c))].slice(0, MAX_CARDS);
  console.log(`[done] ${t ? describe(t) : "Claude (no terminal found)"} ${m.kind === "ask" ? "asks" : "finished"}: ${JSON.stringify(card.text.slice(0, 80))}`);
  if (n.sound !== false) beep(m.kind === "ask" ? "ask" : "done");
  renderDone();
  restartDoneCountdown();
}

// Sends the cards to the page, which answers with done:layout; with none left, hides the window.
function renderDone() {
  if (!doneCards.length) {
    clearTimeout(doneCountdown?.timer);
    doneCountdown = null;
    doneRects = [];
    donePlace = null;
    doneWin.hide();
    return;
  }
  doneWin.webContents.send("done:state", {
    seconds: notifyCfg().seconds,
    cards: doneCards.map(({ id, kind, title, where, project, text, time }) => ({ id, kind, title, where, project, text, time })),
  });
}

ipcMain.on("done:layout", (_e, { height, cards }) => {
  doneRects = cards;
  if (!doneCards.length) return;
  // In its corner (config notify.position) of the monitor the cursor is on, where a game or editor
  // is being used; it stays on that monitor while cards are up.
  donePlace = { area: donePlace?.area ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, height };
  placeToasts();
  if (!doneWin.isVisible()) doneWin.showInactive();
  doneWin.moveTop();
});

// The countdown ran out: "finished" cards go; a card asking for a permission stays until it is
// clicked, closed, or replaced by that terminal's next card.
function clearDone() {
  doneCards = doneCards.filter((c) => c.kind === "ask");
  if (doneCards.length) doneCountdown = null;
  renderDone();
}

function restartDoneCountdown() {
  clearTimeout(doneCountdown?.timer);
  doneCountdown = { remaining: notifyCfg().seconds * 1000, startedAt: 0, timer: null, paused: false };
  runDoneCountdown();
}

function runDoneCountdown() {
  const c = doneCountdown;
  c.paused = false;
  c.startedAt = Date.now();
  clearTimeout(c.timer);
  c.timer = setTimeout(clearDone, c.remaining);
  doneWin.webContents.send("done:run", { remaining: c.remaining });
}

function pauseDoneCountdown(on) {
  const c = doneCountdown;
  if (!c || c.paused === on) return;
  if (!on) return runDoneCountdown();
  clearTimeout(c.timer);
  c.remaining = Math.max(0, c.remaining - (Date.now() - c.startedAt));
  c.paused = true;
  doneWin.webContents.send("done:pause", { remaining: c.remaining });
}

// What is under the hook event's point: { id, part: "card" | "close" }, "panel" (the window, between
// cards) or null (outside).
function doneHit(e) {
  if (!doneCards.length || !doneWin?.isVisible() || !insideWindow(doneWin, e)) return null;
  const p = screen.screenToDipPoint({ x: e.x, y: e.y });
  const b = doneWin.getBounds();
  const x = p.x - b.x, y = p.y - b.y;
  const inside = (r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  const card = doneRects.find((c) => inside(c.rect));
  if (!card) return "panel";
  return { id: card.id, part: inside(card.close) ? "close" : "card" };
}

async function openDoneCard(id) {
  const card = doneCards.find((c) => c.id === id);
  if (!card) return;
  doneCards = doneCards.filter((c) => c.id !== id);
  renderDone();
  try {
    const r = await focusTerminal(card.pid, card.chain, card.tabName);
    console.log(`[done] opened ${card.title}${r.tab ? ` (tab: ${r.tab})` : ""}`);
  } catch (err) {
    fail(err.message);
  }
}

function setupDoneHook() {
  let hovered = null;
  const key = (h) => (h && typeof h === "object" ? `${h.id}:${h.part}` : null);
  const move = (e) => {
    if (!doneCards.length) return;
    const hit = doneHit(e);
    pauseDoneCountdown(!!hit);
    const card = hit && typeof hit === "object" ? hit : null;
    if (key(card) !== key(hovered)) { hovered = card; doneWin.webContents.send("done:hover", card); }
  };
  uIOhook.on("mousemove", move);
  uIOhook.on("mousedrag", move);
  uIOhook.on("mousedown", (e) => {
    if (e.button !== 1) return;
    const hit = doneHit(e);
    if (!hit || hit === "panel") return;
    hovered = null;
    if (hit.part === "close") {
      doneCards = doneCards.filter((c) => c.id !== hit.id);
      renderDone();
    } else {
      openDoneCard(hit.id);
    }
  });
}

// ---------- startup ----------
app.whenReady().then(async () => {
  app.setAppUserModelId(APP_NAME);
  nativeTheme.themeSource = "dark"; // dark title bar on the settings window
  loadState();

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");

  recorderWin = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, "recorder-preload.cjs"), backgroundThrottling: false },
  });
  await recorderWin.loadFile(path.join(__dirname, "recorder.html"));
  await createOverlay();
  await createSelectionWindow();
  await createPicker();
  await createMenu();
  await createChooser();
  await createConfirm();
  await createDone();
  startTaskPipe();
  pruneScreenshots();
  applyStartAtLogin();

  tray = new Tray(ICONS.notarget);
  tray.on("click", showMenu);
  tray.on("right-click", showMenu);

  // A saved target only survives a restart if that process is still running.
  try { terminals = await listTerminals(); } catch (err) { console.error(err); }
  if (target) target = terminals.find((t) => t.pid === target.pid) ?? null;
  refreshTray();

  setupClickSelect();
  setupHotkey();
  setupMouseHotkey();
  setupConfirmHook();
  setupDoneHook();
  setupChooserHook();
  registerTerminalsShortcut();
  await setupMouseGuard(); // before uiohook: see mouse-guard.cjs on hook order
  try { uIOhook.start(); } catch (err) { notify(APP_NAME, `Global mouse/key hook failed: ${err.message}`); }
  console.log(`[app] ready. Hotkey ${cfg.hotkey}. Target: ${target ? describe(target) : "none"}`);
});

// ---------- mouse guard ----------
// While recording, Back/Forward (the chord and the select button) only do the app's things: the
// guard process drops them before the window under the cursor sees them, so a screenshot drag in
// a browser doesn't also go back a page (rules in button-guard.cjs). It has to be installed before
// uiohook; if it ever exits, it is started again and uiohook is restarted after it, to keep that order.
let mouseGuard = null;
let guardRestarts = 0;
async function setupMouseGuard() {
  const chord = Array.isArray(cfg.mouseHotkey ?? [4, 5]) ? (cfg.mouseHotkey ?? [4, 5]) : [];
  const select = cfg.select ?? { mouseButton: 4 };
  const config = { chord, buttons: select.mouseButton ? [select.mouseButton] : [] };
  try {
    mouseGuard = await startMouseGuard(config, {
      onExit: (code) => {
        console.warn(`[guard] exited (${code})`);
        mouseGuard = null;
        if (++guardRestarts > 3) return;
        setupMouseGuard().then(() => {
          if (!mouseGuard) return;
          try { uIOhook.stop(); uIOhook.start(); } catch (err) { console.error(err); }
          mouseGuard.setActive(phase === "recording");
        });
      },
    });
    console.log(`[guard] on for buttons ${[...new Set([...config.chord, ...config.buttons])].join(", ")}`);
  } catch (err) {
    console.error(`[guard] not started: ${err.message}`); // the buttons then also reach other apps
  }
}

// ---------- recording hotkey ----------
// A normal accelerator ("Control+Alt+Space") goes through globalShortcut (RegisterHotKey).
// A modifiers-only hotkey ("Control+Alt") can't be registered that way, so it is watched with
// uiohook and fires on a clean tap: all its modifiers go down together and come back up with no
// other key or click in between. That keeps Ctrl+Alt+Del, AltGr+ș and other shortcuts from
// toggling recording.
const MODIFIER_KEYS = {
  control: ["Ctrl", "CtrlRight"], ctrl: ["Ctrl", "CtrlRight"], commandorcontrol: ["Ctrl", "CtrlRight"],
  alt: ["Alt", "AltRight"], shift: ["Shift", "ShiftRight"], super: ["Meta", "MetaRight"], meta: ["Meta", "MetaRight"],
};

// While the settings window records a new shortcut, the current ones must not fire, and a
// registered accelerator must be released, or Windows swallows it before the window sees it.
let hotkeysPaused = false;
let usesGlobalShortcut = false;
function pauseHotkeys(on) {
  if (hotkeysPaused === on) return;
  hotkeysPaused = on;
  if (on) return globalShortcut.unregisterAll();
  if (usesGlobalShortcut) registerAccelerator();
  registerTerminalsShortcut();
}
const hotkeyToggle = (opts) => { if (!hotkeysPaused) toggleRecording(opts); };

function registerAccelerator() {
  let ok = false;
  try { ok = globalShortcut.register(cfg.hotkey, () => hotkeyToggle()); } catch {}
  if (!ok) notify(APP_NAME, `Could not register the shortcut "${cfg.hotkey}" (invalid, or another app uses it). Change it in Settings.`);
}

function setupHotkey() {
  const parts = cfg.hotkey.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length && parts.every((p) => MODIFIER_KEYS[p])) return setupModifierHotkey(parts);
  usesGlobalShortcut = true;
  registerAccelerator();
}

function setupModifierHotkey(parts) {
  const groups = parts.map((p) => new Set(MODIFIER_KEYS[p].map((name) => UiohookKey[name])));
  const allModifiers = new Set(Object.values(MODIFIER_KEYS).flat().map((name) => UiohookKey[name]));
  const down = new Set();
  let armed = false; // every group was held at once
  let spoiled = false; // another key or a click happened during this chord

  uIOhook.on("keydown", (e) => {
    if (!allModifiers.has(e.keycode)) { if (down.size) spoiled = true; return; }
    if (!down.size) { armed = false; spoiled = false; }
    down.add(e.keycode);
    const held = [...down];
    // Exactly the configured modifiers: an extra one (Ctrl+Alt+Shift) spoils it too.
    const groupsHeld = groups.every((g) => held.some((k) => g.has(k)));
    const extra = held.some((k) => !groups.some((g) => g.has(k)));
    if (extra) spoiled = true;
    if (groupsHeld) armed = true;
  });
  uIOhook.on("keyup", (e) => {
    if (!allModifiers.has(e.keycode)) return;
    down.delete(e.keycode);
    if (!down.size && armed && !spoiled) hotkeyToggle();
    if (!down.size) armed = false;
  });
  uIOhook.on("mousedown", () => { if (down.size) spoiled = true; });
}

// A mouse chord (config "mouseHotkey", default Back+Forward) also toggles recording. It fires
// once, when the last button of the chord goes down while the others are held, and re-arms only
// after every chord button is released. Back is also the select button, so pressing Back first
// while recording starts a screenshot drag; stopping the recording cancels that drag.
//
// Holding the chord for `mouseHoldMs` (no click yet) turns it into "pick a terminal": a list of
// every open terminal appears at the cursor. A left click on a row, chord still held, makes that
// terminal the target; the recording the press started is cancelled, not transcribed. A click
// outside the list is free dictation as before. Letting go with the list open cancels both.
function setupMouseHotkey() {
  const buttons = cfg.mouseHotkey ?? [4, 5];
  if (!Array.isArray(buttons) || buttons.length < 2) return;
  const holdMs = cfg.mouseHoldMs ?? 1500;
  const down = new Set();
  let fired = false;
  let holdTimer = null;
  const chordHeld = () => buttons.every((b) => down.has(b));

  uIOhook.on("mousedown", (e) => {
    if (e.button === 1) {
      if (!chordHeld()) return;
      clearTimeout(holdTimer);
      if (chooserMode === "mouse" && chooserShowing()) {
        const i = chooserIndexAt(e);
        if (i >= 0) return pickFromChooser(i);
        if (i === -1) return; // inside the list, between rows
        hideChooser(); // outside the list: free dictation, as without it
      }
      // Chord still held + left click while recording: dictate into the clicked window instead.
      if (phase === "recording") dictateAt(e.x, e.y);
      return;
    }
    if (!buttons.includes(e.button)) return;
    down.add(e.button);
    if (!fired && chordHeld()) {
      fired = true;
      const starting = phase === "idle";
      hotkeyToggle({ allowNoTarget: true });
      if (starting && phase === "recording" && holdMs > 0) {
        const list = listTerminals().catch(() => terminals); // ready by the time the list shows
        holdTimer = setTimeout(() => { if (chordHeld() && phase === "recording" && !dictation) showChooser(list); }, holdMs);
      }
    }
  });
  uIOhook.on("mouseup", (e) => {
    if (!buttons.includes(e.button)) return;
    down.delete(e.button);
    clearTimeout(holdTimer);
    if (down.size) return;
    fired = false;
    if (chooserMode === "mouse" && chooserShowing()) { hideChooser(); cancelRecording(); beep("stop"); }
  });
}

// ---------- terminal chooser ----------
// Every open terminal in a list at the cursor, opened two ways:
//  - "mouse": hold the mouse chord (setupMouseHotkey). A click on a row, chord still held, picks it
//    and cancels the recording the press started; letting go cancels both.
//  - "keys": the terminals shortcut (config "terminalsHotkey", default Control+Tab), like Alt+Tab.
//    Each press moves the highlight down, with Shift up; letting go of the shortcut's modifiers
//    picks the highlighted terminal; Enter or a click on a row picks too; Escape cancels. A
//    recording in progress keeps going and is sent to the newly picked terminal.
// The window never takes the focus (a game may be in front): main drives the highlight and the
// pick from the global hook, using the row rectangles the page reports.
let chooserWin = null;
let chooserMode = null; // "mouse" | "keys" while open
let chooserTerminals = [];
let chooserRows = []; // row rectangles, CSS px inside the window, from chooser:layout
let chooserHover = -1; // highlighted row
let chooserPending = false; // laid out, waiting to be placed and shown
const CHOOSER_WIDTH = 360;

function createChooser() {
  chooserWin = new BrowserWindow({
    width: CHOOSER_WIDTH, height: 300, show: false, frame: false, transparent: true, resizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, movable: false,
    webPreferences: { preload: path.join(__dirname, "chooser-preload.cjs"), backgroundThrottling: false },
  });
  chooserWin.setAlwaysOnTop(true, "screen-saver");
  chooserWin.setVisibleOnAllWorkspaces(true);
  return chooserWin.loadFile(path.join(__dirname, "chooser.html"));
}

const chooserShowing = () => chooserPending || !!chooserWin?.isVisible();

function chooserHint() {
  if (chooserMode === "mouse") return "Click one while you hold the buttons. Let go to cancel.";
  const caps = keycaps(cfg.terminalsHotkey ?? "Control+Tab");
  const key = caps.at(-1);
  const mods = caps.slice(0, -1);
  return mods.length
    ? `${key} moves, let go of ${mods.join("+")} to pick. Esc cancels.`
    : `${key} moves, Enter or a click picks. Esc cancels.`;
}

function setChooserList(list, highlight) {
  chooserTerminals = list;
  terminals = list;
  chooserHover = highlight;
  hideOverlay(); // the pill would sit on top of the list
  chooserWin.webContents.send("chooser:state", {
    terminals: list.map(rowLabel),
    hint: chooserHint(),
    highlight,
  });
}

// Mouse mode: shown once the terminal list (started when the chord went down) is in.
async function showChooser(listPromise) {
  chooserMode = "mouse";
  chooserPending = true;
  const list = await listPromise;
  if (!chooserPending) return; // let go while the list was loading
  setChooserList(Array.isArray(list) ? list : terminals, -1);
}

// Keys mode: one press of the terminals shortcut. step 1 = down (Tab), -1 = up (Shift+Tab).
function chooserKey(step) {
  if (hotkeysPaused) return;
  const move = (from, n) => (n ? ((from < 0 ? (step > 0 ? -1 : 0) : from) + step + n) % n : -1);
  if (chooserMode === "keys" && chooserShowing()) return setChooserHover(move(chooserHover, chooserTerminals.length));
  if (chooserShowing()) hideChooser(); // the mouse list was open
  chooserMode = "keys";
  chooserPending = true;
  // Opens at once with the terminals known so far, highlighting the one after the current target
  // (as Alt+Tab does); the fresh list replaces it, keeping the highlighted terminal.
  const list = terminals;
  setChooserList(list, move(list.findIndex((t) => t.pid === target?.pid), list.length));
  listTerminals().then((fresh) => {
    if (chooserMode !== "keys" || !chooserShowing()) return;
    const keep = chooserTerminals[chooserHover]?.pid;
    const i = fresh.findIndex((t) => t.pid === keep);
    setChooserList(fresh, i >= 0 ? i : fresh.length ? 0 : -1);
  }).catch(() => {});
}

ipcMain.on("chooser:layout", (_e, { height, rows }) => {
  chooserRows = rows;
  const p = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(p).workArea;
  const h = Math.min(Math.round(height), wa.height - 8);
  if (chooserPending) {
    chooserPending = false;
    // Next to the cursor, kept inside the work area of its monitor.
    const x = Math.min(Math.max(p.x + 14, wa.x + 4), wa.x + wa.width - CHOOSER_WIDTH - 4);
    const y = Math.min(Math.max(p.y + 14, wa.y + 4), wa.y + wa.height - h - 4);
    chooserWin.setBounds({ x, y, width: CHOOSER_WIDTH, height: h });
    chooserWin.showInactive();
    chooserWin.moveTop();
    console.log(`[chooser] ${chooserMode}: ${chooserTerminals.length} terminals`);
  } else if (chooserWin.isVisible()) {
    // The list changed while open: same spot, new height, still on screen.
    const b = chooserWin.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    chooserWin.setBounds({ x: b.x, y: Math.min(b.y, area.y + area.height - h - 4), width: CHOOSER_WIDTH, height: h });
  }
});

// -> row index under the hook event's point, -1 inside the list but on no row, -2 outside.
function chooserIndexAt(e) {
  if (!chooserWin?.isVisible() || !insideWindow(chooserWin, e)) return -2;
  const p = screen.screenToDipPoint({ x: e.x, y: e.y });
  const b = chooserWin.getBounds();
  const x = p.x - b.x, y = p.y - b.y;
  return chooserRows.findIndex((r) => y >= r.top && y < r.bottom && x >= r.left && x < r.right);
}

function setChooserHover(i) {
  const index = i >= 0 ? i : -1;
  if (index === chooserHover) return;
  chooserHover = index;
  chooserWin.webContents.send("chooser:hover", index);
}

function hideChooser() {
  chooserPending = false;
  chooserMode = null;
  chooserHover = -1;
  if (chooserWin?.isVisible()) chooserWin.hide();
}

function pickFromChooser(i) {
  const t = chooserTerminals[i];
  const mode = chooserMode;
  hideChooser();
  if (mode === "mouse") cancelRecording(); // that press only started a recording to open the list
  if (t) setTarget(t);
}

const pickHighlighted = () => (chooserHover >= 0 ? pickFromChooser(chooserHover) : hideChooser());

// Hover follows the mouse in both modes. In keys mode the mouse leaving the rows keeps the
// keyboard's highlight.
function setupChooserHook() {
  const hover = (e) => {
    if (!chooserWin?.isVisible()) return;
    const i = chooserIndexAt(e);
    if (chooserMode === "keys" && i < 0) return;
    setChooserHover(i);
  };
  uIOhook.on("mousemove", hover);
  uIOhook.on("mousedrag", hover); // moves with buttons held arrive as drags

  // Keys mode: letting go of the shortcut's modifiers picks; Enter picks; Escape cancels; a click
  // on a row picks at once, one outside the list closes it.
  const parts = (cfg.terminalsHotkey ?? "Control+Tab").split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const modCodes = new Set(parts.filter((p) => MODIFIER_KEYS[p]).flatMap((p) => MODIFIER_KEYS[p].map((n) => UiohookKey[n])));
  const held = new Set();
  const keysOpen = () => chooserMode === "keys" && chooserShowing();
  uIOhook.on("keydown", (e) => {
    if (modCodes.has(e.keycode)) held.add(e.keycode);
    if (!keysOpen()) return;
    if (e.keycode === UiohookKey.Escape) hideChooser();
    else if (e.keycode === UiohookKey.Enter) pickHighlighted();
  });
  uIOhook.on("keyup", (e) => {
    if (!modCodes.has(e.keycode)) return;
    held.delete(e.keycode);
    if (!held.size && keysOpen()) pickHighlighted();
  });
  uIOhook.on("mousedown", (e) => {
    if (e.button !== 1 || chooserMode !== "keys" || !chooserWin?.isVisible()) return;
    const i = chooserIndexAt(e);
    if (i >= 0) pickFromChooser(i);
    else if (i === -2) hideChooser();
  });
}

// Registered with RegisterHotKey, so the app in front doesn't also get it (a browser or an IDE
// would switch its own tabs). The same shortcut with Shift moves the highlight up.
function registerTerminalsShortcut() {
  const accel = cfg.terminalsHotkey ?? "Control+Tab";
  if (!accel) return;
  let ok = false;
  try { ok = globalShortcut.register(accel, () => chooserKey(1)); } catch {}
  if (!ok) return notify(APP_NAME, `Could not register the terminals shortcut "${accel}" (invalid, or another app uses it). Change it in Settings.`);
  if (!/(^|\+)shift(\+|$)/i.test(accel)) {
    try { globalShortcut.register(`Shift+${accel}`, () => chooserKey(-1)); } catch {}
  }
}

app.on("window-all-closed", () => {}); // tray app: keep running
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  try { uIOhook.stop(); } catch {}
  mouseGuard?.stop();
  whisper.stop();
});
