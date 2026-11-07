# Terminal Claude Helper

Talk to your terminal from anywhere. Pick a terminal once (for example the one running Claude Code), then press a shortcut while you're in a game, a browser or an editor, and say what you want. Your words are transcribed on your own PC and typed into that terminal. The app you're using keeps the focus.

It lives in the Windows tray as a small microphone. Speech recognition runs locally with [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Nothing is sent to the cloud.

## How it works

1. **Pick a terminal.** Click the tray icon and choose one from the list. Windows Terminal tabs, VS Code and IntelliJ terminals, and classic console windows all show up. Terminals running Claude Code are marked.
2. **Press the shortcut and speak.** A small pill next to the mouse shows that you're recording.
3. **Press the shortcut again.** The recording stops and is transcribed.
4. **Accept or reject.** A box at the top right of the screen shows the text. If you do nothing for 3 seconds, it's sent. The text is typed into the terminal and Enter is pressed, so Claude Code gets your prompt right away.

You can also show your screen. While recording, drag with the Back mouse button to attach a screenshot, or tap it to record the screen. Claude gets the images right where you were talking about them.

## Shortcuts

All of these can be changed in **Settings** (click the tray icon, then Settings).

| Shortcut | What it does |
|---|---|
| Tap **Ctrl+Alt** | Start or stop recording. Press both, then let go. |
| **Back + Forward** mouse buttons | Start or stop recording. |
| Hold **Back + Forward**, then click a window | Type this recording into that window instead, for example an editor or a chat. |
| Keep holding **Back + Forward** (1.5 seconds by default) | Show the list of terminals at the mouse. Click one while still holding the buttons to pick it. |
| **Ctrl+Tab** | Show the list of terminals, like Alt+Tab. Keep Ctrl down, press Tab to move down or Ctrl+Shift+Tab to move up, and let go of Ctrl to pick. Esc cancels. |
| Hold **Back** and click a terminal window | Pick that terminal. |

While recording:

| Shortcut | What it does |
|---|---|
| Hold **Back** and drag | Take a screenshot of that area. |
| Tap **Back** | Start or stop recording the screen. |

While the accept/reject box is showing:

| Shortcut | What it does |
|---|---|
| Click **Accept** or **Reject** | Send the text now, or throw it away. |
| Move the mouse over the box | Pause the countdown so you can read. |
| **Ctrl+Alt** or **Back + Forward** | Reject. |

> While the helper runs, **Ctrl+Tab belongs to it alone**: browsers and editors stop getting it, so they won't switch tabs with it. Change it or turn it off in Settings if you need it there.

## Install

You need Windows 10 or 11 and [Node.js](https://nodejs.org) 20 or newer. An NVIDIA graphics card makes transcription much faster, but it isn't required.

1. **Get the code and its packages.**

   ```
   git clone <this repository>
   cd "Terminal Claude Helper"
   npm install
   ```

   If `npm start` later says Electron is missing, run `node node_modules/electron/install.js` once.

2. **Get whisper.cpp.** Download a Windows build of `whisper-server.exe` from the [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases). Take the CUDA (cuBLAS) build if you have an NVIDIA card. Then download a model from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp/tree/main). `ggml-large-v3-turbo.bin` is fast and accurate.

3. **Tell the helper where they are.** Open `config.json` and set the two paths, plus the language you speak:

   ```json
   "whisper": {
     "server": "C:\\whisper\\whisper-server.exe",
     "model": "C:\\whisper\\models\\ggml-large-v3-turbo.bin",
     "language": "english",
     ...
   }
   ```

   Use double backslashes in the paths. Other models in the same folder can be chosen later in Settings.

4. **Start it.**

   ```
   npm start
   ```

   A microphone appears in the tray. Gray means no terminal is picked yet. Orange means ready, red means recording, and yellow means transcribing.

5. **Optional: a "Selected" line in your terminals.** This shows "● Selected" above the prompt of the terminal you're talking to, and in Claude Code's status line:

   ```
   npm run install-prompt
   ```

   `npm run install-prompt -- --uninstall` removes it again.

## Good to know

- **Games:** the pill and the boxes show up over games in borderless or windowed mode, but not in exclusive full screen. Some games with anti-cheat may block the keyboard shortcut. The mouse buttons are a good fallback.
- **Wrong language:** short commands are sometimes heard as another language. Set your language in Settings instead of "Detect automatically".
- **Terminals run as administrator** can't be typed into, because the helper isn't running as administrator.
- **Graphics memory:** the speech model unloads after 15 minutes without dictation, so games get the GPU back. You can change this in Settings.
- **Restart:** after changing code or `config.json` by hand, click the tray icon, then Restart.
