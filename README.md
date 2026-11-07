# Claude Terminal Assistant

**Speak to your terminal while you keep doing something else.**

Playing a game, reading a page, or working in another app? Choose a terminal, press a shortcut, and say what you want to send. Claude Terminal Assistant turns your speech into text and types it into that terminal without switching away from your current window.

For example, leave Claude Code open in a terminal, switch to your browser, and say: *“Explain the error and suggest a fix.”* You can include a screenshot while you speak, too.

The helper lives beside the Windows clock as a small microphone icon. Speech recognition runs on your PC with whisper.cpp; no cloud transcription account or API key is needed. The terminal app you send the text to, such as Claude Code, has its own requirements.

[Install](#install) · [First dictation](#your-first-dictation) · [Settings](#settings) · [Shortcuts](#shortcuts) · [Troubleshooting](#troubleshooting)

## Install

### 1. Get the app

You will need:

- **Windows 10 or 11** and a microphone. The helper uses your Windows default microphone.
- **[Node.js](https://nodejs.org/en/download)** with npm. Choose an LTS release.
- **whisper.cpp and a speech model**, set up in the next step. An NVIDIA GPU can speed up transcription; a CPU build is also available.

On this GitHub page, choose **Code → Download ZIP**, then extract the folder somewhere you want to keep it. Open a terminal in that folder and run:

```powershell
npm install
```

If you use Git, you can get the project this way instead:

```powershell
git clone https://github.com/Andrei-Cristian-Zaharia/ClaudeTerminalAssistent.git
cd ClaudeTerminalAssistent
npm install
```

### 2. Set up speech recognition

Whisper needs two things: a program that processes your audio, and a model file that recognizes speech.

1. Download a **Windows x64 build containing `whisper-server.exe`** from the [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases). Choose a CUDA build for a compatible NVIDIA GPU, or a CPU build otherwise.
2. Extract the **whole archive**. Keep the included DLL files with the executable.
3. Download a model from the [whisper.cpp model files](https://huggingface.co/ggerganov/whisper.cpp/tree/main). This project is configured for `ggml-large-v3-turbo.bin`. Save it somewhere you will keep it, for example `C:\whisper\models`.

Already have whisper.cpp and a model installed? You can reuse them.

### 3. Connect the helper to Whisper

Open [`config.json`](config.json) in a text editor. The paths included in the repository point to the author's computer, so **you must replace them with your own paths**.

Replace the value of the existing `whisper` section with the object below, adjusting `server` and `model` to match your files. Keep the other sections of `config.json`.

```json
{
  "server": "C:\\whisper\\whisper-server.exe",
  "model": "C:\\whisper\\models\\ggml-large-v3-turbo.bin",
  "language": "english",
  "port": 8178,
  "threads": 4,
  "idleUnloadMinutes": 15
}
```

- `server` must point to **`whisper-server.exe`**, including any subfolders created when you extracted it.
- `model` must point to the downloaded **`.bin` file**.
- Use **double backslashes** in Windows paths, as shown above.
- Set `language` to `english`, `romanian`, or `auto` for automatic detection. Choosing a specific language helps with short phrases. The repository's starting configuration uses Romanian.

### 4. Start the helper

From the project folder, run:

```powershell
npm start
```

Look for the microphone icon beside the Windows clock. It may be inside the **hidden icons** menu, opened with the small arrow. Click the microphone to open the app menu.

**Start with Windows is on by default.** After the first launch, the helper is configured to start when you sign in. You can turn this off in **Settings → General**. Keep the project folder in place while you use this option.

## Your first dictation

1. **Open the terminal you want to talk to.** If you want to send prompts to Claude Code, start it there first. The helper types into whatever is currently running in the selected terminal.
2. **Choose that terminal.** Click the microphone in the tray and select it from the list. The icon turns orange when a target is selected.
3. **Switch to another app.** The terminal stays selected in the background.
4. **Tap Ctrl+Alt, release both keys, and speak.** A small indicator beside the cursor shows the recording time. Tap the same shortcut again when you finish. Recording also stops after 60 seconds by default.
5. **Review the text.** A box at the top right shows the transcript and its destination. Click **Accept** to send it or **Reject** to discard it. Hover over the box to pause the countdown.

**With the starting settings, the text is accepted automatically after 3 seconds, then Enter is pressed in the terminal.** To leave the text there for editing, turn off **Settings → Typing → Press Enter after the text**. You can also increase the review countdown.

The first dictation may take longer because Whisper has to load the model. Later dictations reuse it until it unloads after a period of inactivity.

The tray icon shows the current state: **gray** = no terminal selected, **orange** = ready, **red** = recording, **yellow** = transcribing.

## Settings

Click the tray microphone, then **Settings**. Most everyday changes can be made here without editing a file.

| I want to… | Where to change it |
|---|---|
| Speak a different language | **Speech recognition → Language**. Choose the language you normally speak. |
| Change the recording shortcut | **Shortcuts → Start and stop recording**. Click the shortcut field and press your new combination. |
| Keep Ctrl+Tab for my browser or editor | **Shortcuts → Show the terminal list**. Choose another shortcut or click **Turn off**. |
| Use different mouse buttons | **Shortcuts → Mouse buttons**. Choose a combination, or **Off**. |
| Review the text for longer | **Typing → Send on its own after**. Hovering over the review box also pauses its countdown. |
| Send immediately without the review box | Turn off **Typing → Ask before sending**. |
| Type into the terminal without submitting | Turn off **Typing → Press Enter after the text**. This is also available in the tray menu. |
| Record longer than a minute | **Recording → Stop recording after**. |
| Hide the indicator beside the mouse | Turn off **Typing → Show the recording pill next to the cursor**. |
| Stop launching automatically | Turn off **General → Start with Windows**. |
| Release GPU memory sooner | **Speech recognition → Free the graphics memory after**. Starts at 15 minutes; 0 keeps the model loaded. |
| Use another downloaded model | **Speech recognition → Model**. The list shows `.bin` files in the same folder as the configured model. |

Click **Save** when you finish. Changes to shortcuts or speech recognition show **Save and restart** instead; finish any recording before saving those changes.

<details>
<summary>Advanced: editing config.json directly</summary>

Settings are stored in [`config.json`](config.json) in the project folder. After editing it by hand, choose **Restart** from the tray menu.

| Setting | What it controls |
|---|---|
| `whisper.server` / `whisper.model` | Full paths to the Whisper server and model. |
| `whisper.port` / `whisper.threads` | Local server port and CPU thread count; start at `8178` and `4`. |
| `terminalsHotkey` | Shortcut for the terminal list. An empty string disables it. |
| `mouseHotkey` | Mouse button combination: `4` is Back, `5` is Forward, `3` is Middle. `[]` disables it. |
| `mouseHoldMs` | Hold time for the mouse terminal list. The included config uses `1000` milliseconds; `0` disables this gesture. |
| `select` | Button for selecting terminals and capturing the screen. For example, `{ "mouseButton": 4 }` or `{ "key": "F13" }`. |
| `screenshotsDir` | Capture folder. An empty string uses the default. Use a dedicated folder without spaces; files older than 7 days are cleaned up there. |
| `screenRecord` | Screen capture interval, frame limit, and image size. Starts at one check per second, a frame limit of 10, and `maxWidth: 1920`. |
| `silenceLevel` | Minimum audio level to transcribe. Starts at `0.015`; lower it if quiet speech is skipped, or raise it if background noise produces unwanted text. |

</details>

## Shortcuts

These are the shortcuts in the included configuration. **Back** and **Forward** mean the two side buttons on a typical mouse.

### Recording and choosing a terminal

| Action | Shortcut |
|---|---|
| Start or stop voice recording | Tap **Ctrl+Alt**, then release both keys. Alternatively, briefly press **Back + Forward** together. |
| Choose a terminal by clicking it | While not recording, hold **Back** and left-click the terminal window. |
| Open the terminal list with the keyboard | Hold **Ctrl**, press **Tab** to move through the list, and release **Ctrl** to select. **Shift+Tab** moves back; **Esc** cancels. |
| Open the terminal list with the mouse | Hold **Back + Forward** for 1 second, then click a terminal while still holding the buttons. This selects a target and cancels the recording that the initial press started. |
| Reject a transcript during review | Press the recording shortcut again, press **Back + Forward**, or click **Reject**. |

**Ctrl+Tab is a global shortcut while the helper runs.** Browsers and editors will no longer receive it for switching tabs. Change it or turn it off in Settings if you use it elsewhere.

### Include something from your screen

Start a voice recording first, then use either gesture:

| What to capture | Gesture |
|---|---|
| One area of the screen | Hold **Back**, drag across the area, then release. No left-click is needed. |
| A sequence of screen changes | Tap **Back** to begin capturing, then tap it again to stop. Ending voice recording also stops the capture. |

While you are recording, Back and Forward only do these things: the app or web page under the cursor doesn't receive them, so a browser won't go back a page. The same applies to the Back + Forward press that starts or stops a recording, and to Back when you hold it to click a terminal. Outside a recording, a press of Back or Forward on its own works as usual.

For example: say *“This is the error I mean,”* capture the error, then continue explaining.

Screen recording saves a **sequence of still images**, not a video file. It checks the monitor under the cursor and keeps frames when the screen or pointer changes. The capture interval and frame limit are adjustable in **Settings → Screen recording**.

The helper inserts image paths into the dictated text near the corresponding part of your speech. An assistant that can read local images can use them; an ordinary shell receives the paths as text.

### Dictate into another app

1. Press **Back + Forward** together to start recording.
2. While still holding both buttons, left-click the input area in an editor, browser, or chat, before the terminal list opens.
3. Release the buttons, speak, then use the recording shortcut to stop.
4. Review and accept the text as usual.

For this recording, the clicked window becomes the destination. The helper brings that window to the foreground when typing. Your selected terminal stays available for later recordings.

Only text is sent in this mode. **Press Enter when typing into other apps** is a separate setting under **Typing**, and is on in the included configuration. Turn it off if you want to edit the text before submitting a chat message.

## Troubleshooting

| What you see | What to try |
|---|---|
| `npm` is not recognized | Install Node.js, then open a new terminal in the project folder. |
| PowerShell says `npm.ps1` cannot run | Run `npm.cmd install` and `npm.cmd start`, or use Command Prompt. |
| Electron is missing when you start | Run `node node_modules/electron/install.js` in the project folder, then try `npm start` again. |
| “Whisper server not found” or “model not found” | Check the two file paths in `config.json`. They must point to existing files on your PC. Restart after editing. |
| Whisper exits or never becomes ready | Keep the extracted DLLs beside the executable and use a build compatible with your hardware. The launching terminal shows error details. |
| “Heard nothing” or a microphone error | Check the default input device and microphone access for desktop apps in Windows Settings. If quiet speech is skipped, lower **Recording → Treat as silence below** slightly. |
| The transcript is in the wrong language | Choose a specific language under **Speech recognition → Language** instead of automatic detection. |
| The terminal is missing or sending fails | Open the terminal and select it again. A non-administrator helper cannot send to a terminal running as administrator. |
| Several terminal tabs share one window | Select the exact terminal from the tray list. If clicking a window is ambiguous, the helper asks you to choose. |
| The overlay does not appear over a game | Use borderless or windowed mode. Exclusive full screen can hide overlays, and some games may block shortcuts. |
| Starting the app opens its menu | It is already running. The helper keeps one instance. |
| Something else goes wrong | Open **Settings → Open log** to see what happened. To report it, click **Report a problem**: it opens a GitHub issue with your versions filled in. Attach the log, or the lines around the problem, after reading it over, because it also contains the text you dictated. |

## Optional: show which terminal is selected

To add a **● Selected / ○ Not selected** indicator to PowerShell, Git Bash, and Claude Code's status line, run this from the project folder:

```powershell
npm run install-prompt
```

This updates the relevant shell profiles and Claude Code settings. It also lets Claude Code open the screenshots and screen frames you dictate to it, in any project, without asking each time: the screenshots folder is added to Claude Code's allowed folders. Open a new shell session and restart Claude Code to load the changes. Command Prompt (`cmd`) is not covered.

To remove the indicator and the screenshots permission:

```powershell
npm run install-prompt -- --uninstall
```

## Local files and privacy

Audio is transcribed locally by Whisper. The helper sends the resulting text and any image paths to the destination you choose. If that destination is a cloud-connected assistant, it may send that content to its own service.

- **App settings:** `config.json` in the project folder.
- **Saved terminal selection:** `%APPDATA%\claude-terminal-assistant\state.json`.
- **Screenshots and screen frames:** `%APPDATA%\claude-terminal-assistant\screenshots`, unless you set a custom capture folder. Files older than 7 days are pruned when the helper starts.
- **Log:** `%APPDATA%\claude-terminal-assistant\logs\app.log`, with what the helper did, any errors, and the text you dictated. It stays under about 1 MB; the previous one is kept as `app.old.log`. It never leaves your PC unless you attach it to a report.

## Remove the app

1. Turn off **Settings → General → Start with Windows**.
2. If you installed the terminal indicator, run the uninstall command above while the project folder still exists.
3. Choose **Quit** from the tray menu, then delete the project folder.
4. To also remove saved state and captures, delete `%APPDATA%\claude-terminal-assistant` and any custom capture folder you configured.

<details>
<summary>For contributors</summary>

Run commands from the project folder:

| Command | Purpose |
|---|---|
| `npm start` | Run the Electron tray app and view logs in the terminal. The same lines go to the log file. |
| `npm test` | Run the unit tests. |
| `npm run terminals` | List the terminals the helper can offer as targets. |
| `npm run terminals -- --all` | Include hidden consoles for debugging. |

</details>
