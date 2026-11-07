# AGENTS.md

This file provides guidance to Codex (claude.ai/code) when working with code in this repository.

## Goal

This is a Windows tray app for **voice-controlling one chosen terminal while another app has focus**, for example while a full-screen game is running.

1. The user picks a **target terminal**. There are two ways: from the tray menu, or by holding the select button (default: mouse Back button, `config.json` → `select`) and left-clicking a terminal window. All open terminals are listed (Windows Terminal tabs, VS Code terminals, classic console windows). The target stays selected while other apps are focused.
2. Pressing the **global hotkey** anywhere starts recording from the microphone. Pressing it again stops recording. Recording also stops automatically after `maxRecordSeconds`. The hotkey is set in `config.json` → `hotkey`. A normal accelerator such as `Control+Alt+Space` goes through `globalShortcut`. A modifiers-only hotkey such as `Control+Alt` is watched by uiohook (`setupModifierHotkey`) and fires on a *clean tap*: the modifiers are released with no other key or click in between, so Ctrl+Alt+Del and AltGr letters don't trigger it. Pressing the mouse Back and Forward buttons together also toggles recording (`config.json` → `mouseHotkey`, a list of uiohook button numbers, default `[4, 5]`; `[]` turns it off). It fires once when the last button of the chord goes down (`setupMouseHotkey`).
   While recording, holding the select button and dragging captures that screen area. The screenshot is saved as a PNG under `screenshotsDir`, defaulting to `%APPDATA%	erminal-Codex-helperscreenshots` and pruned after 7 days. Its path is appended to the dictated text, and Codex attaches image files whose path it receives.
3. The audio is transcribed **locally** with whisper.cpp. No cloud STT is used.
4. The text is typed into the target terminal, followed by Enter if that option is on. The text is delivered **without moving focus**.

## Commands

- `npm start`: run the tray app (Electron). Logs go to the launching terminal.
- `npm test`: run the unit tests (`node --test`, files `test/**/*.test.cjs`). Run a single file with `node --test test/whisper.test.cjs`.
- `npm run terminals`: print the terminals the app would offer as targets (JSON). Add `-- --all` to include hidden consoles that the filter removes.
- `node src/console-helper.cjs send <pid> <base64-utf8-text> <1|0>`: type text into a terminal by hand. This is useful for debugging injection.
- `npm run install-prompt` (`-- --uninstall` to undo): adds the "● Selected / ○ Not selected" line to the PowerShell 5.1/7 profiles (`CurrentUserAllHosts`), `~/.bashrc`, and Codex's `statusLine` in `~/.Codex/settings.json`. Lines it adds carry `# terminal-Codex-helper`. cmd isn't covered because it has no programmable prompt.

## Architecture

The whole flow is orchestrated by `src/main.cjs` (Electron main process, CommonJS):

**hotkey** (`globalShortcut`, i.e. `RegisterHotKey`) → **recorder** (hidden `BrowserWindow`) → **Whisper** → **console helper**

- **`src/recorder.html` + `recorder-preload.cjs`**: a hidden window that captures the mic through `getUserMedia` into a 16 kHz `AudioContext`. It returns a 16-bit mono WAV over IPC (`rec:start`, `rec:stop`, `rec:audio`, `rec:error`). It also plays the audio cues (`rec:beep`), because the tray can't be seen during a full-screen game. `backgroundThrottling: false` is required.
- **`src/overlay.html` + `overlay-preload.cjs`**: a transparent, click-through, non-focusable, always-on-top window that follows the cursor (it is repositioned every 16 ms while shown). It shows a REC timer, a transcribing spinner, then the result or error. It can't appear above games in exclusive full-screen; borderless windowed works.
- **Click-to-select** (`setupClickSelect` in `main.cjs`): **uiohook-napi** provides global mouse and key hooks. Button numbers are 1 left, 2 right, 3 middle, 4 Back, 5 Forward. `select` can be `{ "mouseButton": n }` or `{ "key": "F13" }` (any `UiohookKey` name), which is useful when mouse software maps a custom button to a key. A left click while the button is held calls `console-helper at x y`, with physical pixels from the hook.
- **Screenshot drag** (`startDrag`/`updateDrag`/`endDrag` in `main.cjs`): the hook gives physical pixels; `selection.html` is a click-through frame window placed with `screen.screenToDipRect`, drawn just *outside* the area. The cursor pill is hidden during the drag so it can't end up in the shot. `console-helper capture x y w h file` copies the area with GDI `BitBlt` into raw BGRA (alpha forced to 255), and main turns that into a PNG with `nativeImage.createFromBitmap`. Shots are promises gathered in `shots` and awaited before sending.
- **`src/whisper.cjs`**: manages one long-running `whisper-server.exe`. It starts lazily, is pre-warmed when recording begins so the model loads while the user speaks, and is killed after `idleUnloadMinutes` to free VRAM for games. Audio is sent with `POST /inference` (multipart). Silence handling is two-layered because Whisper invents subtitle phrases on silence ("Să vă mulțumim pentru vizionare!", "Thanks for watching"). First, `peakLevel` (the loudest 30 ms RMS) below `silenceLevel` skips transcription entirely. Second, `isHallucination` drops transcripts that are only such a phrase. `cleanTranscript` removes Whisper's `[BLANK_AUDIO]` and `(music)` tags.
- **`src/console-helper.cjs`**: all Win32 calls are made here through **koffi** (FFI, no native build step). It **always runs as a separate process**, started by `src/terminals.cjs` with Electron's binary and `ELECTRON_RUN_AS_NODE=1`. The reason is that `FreeConsole`/`AttachConsole` change process-wide state and must never run inside the app process.
  - `list`: walks processes (Toolhelp snapshot) and runs `AttachConsole` on each shell-like process. It reads the console title (for Codex this is the session name) and `GetConsoleProcessList`, then groups processes that share a console. The target `pid` is the console's **anchor**: the process whose parent is outside the console. Consoles that have no visible conhost window are kept only if their host process is a known ConPTY terminal (`TERMINAL_HOSTS`). This filter hides the invisible consoles of background tools.
  - `at`: `WindowFromPoint` → root window, matched to a console by its visible conhost hwnd, or by the pseudo-console window's **owner**. Windows Terminal owns each tab's `PseudoConsoleWindow` with its top-level window, one per WT window. If several tabs share a window, the WT window title (the active tab's title) decides; otherwise the result is an "ambiguous" error.
  - `send`: runs `AttachConsole(pid)`, opens `CONIN$` and calls `WriteConsoleInputW` with key down/up `INPUT_RECORD`s. Newlines become spaces, and Enter is sent as `VK_RETURN`. This works for conhost and ConPTY (Windows Terminal) alike, because the shell owns the console input buffer whichever app draws the window.
- **"Selected" line** (`src/statusline.cjs`, `shell/prompt.ps1`, `shell/prompt.bash`): reads the target pid from `state.json`. With `--plain` (shell prompts) the terminal counts as selected if that pid is attached to the same console (`consolePids`). Without it (the Codex status line) it counts if that pid is an ancestor. Git Bash's `$(...)` breaks the Windows parent chain, and Codex may run status-line commands in a hidden console of its own, which is why each mode uses a different check. In Codex mode the line also shows session info from the JSON Codex pipes on stdin (`claudeInfo` parses it, `segments` styles it with 24-bit colors): model with a 5-dot effort meter │ a context bar with tokens used/max (green <50%, yellow <80%, red after) │ prompt-cache time left until `prompt_cache.expires_at` out of its TTL (yellow under 25%, red under 10% or 2 min, `cold` once it expires). `refreshInterval: 2` keeps the countdown live. Codex's Bash tool also runs in its own hidden console, so to test prompt mode, attach to the target's console first (`AttachConsole`) and run the shell from there.
- **State**: the target and the `pressEnter` toggle are saved to `%APPDATA%\terminal-Codex-helper\state.json`. At startup a saved target is kept only if that pid is still a listed terminal. If a send fails, the target is cleared.
- **Config**: `config.json` in the repo root holds the hotkey, `pressEnter`, `maxRecordSeconds`, and the whisper `server`, `model`, `language`, `port`, `threads` and `idleUnloadMinutes`. It is read once at startup.

## Environment facts

- The machine runs Windows 11 with an NVIDIA RTX 5070. whisper.cpp uses its CUDA build: `large-v3-turbo` loads in about 2.5 s, and a short command transcribes in about 0.3–0.5 s.
- whisper.cpp binaries and models are **reused from the sibling project**: `C:\Users\Andrei\Desktop\AI Assistent\data\whisper\` (`bin-gpu\Release\whisper-server.exe`, and `models\ggml-large-v3-turbo.bin` and `ggml-medium.bin`). They are referenced through `config.json`. Do not download them again.
- `uiohook-napi` loads its bundled `prebuilds/win32-x64` binary; its install script (a node-gyp compile) is denied on purpose.
- `npm install` blocks install scripts unless they are allowlisted (`allowScripts` in `package.json`). koffi is approved. If `node_modules/electron/dist` is missing after an install, run `node node_modules/electron/install.js`.
- When testing from Codex's shell tools, processes started by one command, such as a test terminal window, are killed when that command ends. Run setup, the action and the check in **one** command. Check `%APPDATA%	erminal-claude-helperstate.json` before simulating the hotkey: if the saved target is the Codex session itself, the test dictation is typed into that session. Windows TTS (`System.Speech`) plus `keybd_event` for the hotkey makes it possible to test the whole pipeline without speaking.

## Known limitations / next steps

- Recording is toggled with the hotkey (press to start, press again to stop) because Electron's `globalShortcut` reports no key-up. True push-to-talk is now possible with the uiohook key-up events that are already loaded.
- Some games, especially ones with anti-cheat or exclusive full-screen, may swallow `RegisterHotKey`. This hasn't been tested with real games yet.
- With `language: "auto"`, short utterances can be detected as the wrong language. Pin `en` or `ro` if this happens.
- Elevated (admin) terminals can't be attached to from a non-elevated app.
