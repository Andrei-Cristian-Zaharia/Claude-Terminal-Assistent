# Claude Terminal Assistant

**Speak to your terminal while you keep doing something else.**

Playing a game, reading a page, or working in another app? Choose a terminal, press a shortcut, and say what you want to send. Claude Terminal Assistant turns your speech into text and types it into that terminal without switching away from your current window.

For example, leave Claude Code open in a terminal, switch to your browser, and say: *“Explain the error and suggest a fix.”* You can include a screenshot while you speak, too. When Claude is done, or needs your permission, a small card in the corner of the screen tells you; click it to jump straight back to that terminal. The terminal list shows which sessions are still working, which wait for you, and which are done.

The helper lives beside the Windows clock as a small microphone icon. Speech recognition runs on your PC with whisper.cpp, which the installer sets up for you; no cloud transcription account or API key is needed. The terminal app you send the text to, such as Claude Code, has its own requirements.

[Install](#install) · [First dictation](#your-first-dictation) · [When Claude finishes](#when-claude-finishes) · [Naming terminals](#naming-your-terminals) · [Settings](#settings) · [Shortcuts](#shortcuts) · [Troubleshooting](#troubleshooting)

## Install

You need **Windows 10 or 11** and a microphone (the helper uses your Windows default microphone). An NVIDIA graphics card makes transcription fast, but any PC works.

1. **Download the installer**, `Claude-Terminal-Assistant-Setup-<version>.exe`, from the [latest release](https://github.com/Andrei-Cristian-Zaharia/claude-terminal-assistant-releases/releases/latest).
2. **Run it.** It installs for your Windows account only, without asking for administrator rights, and adds the app to the Start menu. The installer isn't signed yet, so Windows may show **“Windows protected your PC”**: choose **More info → Run anyway**.
3. **Set up speech recognition.** On first start a window offers to download it: choose **NVIDIA graphics card** or **Processor only** (it tells you if it found an NVIDIA card), pick a model, and click **Download and set up**. The helper downloads whisper.cpp and the model once, about 0.8–2.2 GB with an NVIDIA card or 0.15–1.6 GB without, then checks that it works. Already have whisper.cpp? Click **I already have whisper.cpp…** and choose its files.
4. **Connect Claude Code** (if you use it): click the microphone beside the Windows clock, then **Settings → General → Claude Code → Connect**. This adds the [cards when Claude finishes](#when-claude-finishes) and the status chips, a "● Selected / ○ Not selected" line in Claude Code's status bar and in your PowerShell and Git Bash prompts, and lets Claude Code open the screenshots you dictate without asking. Restart your Claude Code sessions afterwards.

The microphone may be inside the **hidden icons** menu, opened with the small arrow beside the clock. The helper starts with Windows from now on; you can turn that off in **Settings → General**.

### Updates

The helper updates itself. It checks for a new version shortly after it starts and every few hours, downloads it in the background, and shows an **Update ready** card: click it to restart into the new version, or it installs the next time you quit the app. Your settings, terminal choice, Claude Code connection and speech model stay as they are. **Settings → General → Updates** shows your version and has **Check now**.

<details>
<summary>Run from source instead (for development)</summary>

You need [Node.js](https://nodejs.org/en/download) (LTS) with npm, and Git.

```powershell
git clone https://github.com/Andrei-Cristian-Zaharia/Claude-Terminal-Assistent.git
cd Claude-Terminal-Assistent
npm install
npm start
```

The same speech recognition window opens on first start. To connect Claude Code use **Settings → General → Claude Code → Connect**, or `npm run install-prompt` (`-- --uninstall` to undo). A source copy doesn't update itself: use `git pull`, then **Restart** from the tray menu.

If PowerShell says `npm.ps1` cannot run, use `npm.cmd install` and `npm.cmd start`, or Command Prompt. If Electron is missing when you start, run `node node_modules/electron/install.js`.

</details>

## Your first dictation

1. **Open the terminal you want to talk to.** If you want to send prompts to Claude Code, start it there first. The helper types into whatever is currently running in the selected terminal.
2. **Choose that terminal.** Click the microphone in the tray and select it from the list. The icon turns orange when a target is selected.
3. **Switch to another app.** The terminal stays selected in the background.
4. **Tap Ctrl+Alt, release both keys, and speak.** A small indicator beside the cursor shows the recording time. Tap the same shortcut again when you finish. Recording also stops after 60 seconds by default.
5. **Review the text.** A card at the bottom right shows the transcript and its destination. Click **Accept** to send it or **Reject** to discard it. Hover over the card to pause the countdown.

**With the starting settings, the text is accepted automatically after 3 seconds, then Enter is pressed in the terminal.** To leave the text there for editing, turn off **Settings → Typing → Press Enter after the text**. You can also increase the review countdown.

The first dictation may take longer because Whisper has to load the model. Later dictations reuse it until it unloads after a period of inactivity.

The tray icon shows the current state: **gray** = no terminal selected, **orange** = ready, **red** = recording, **yellow** = transcribing.

## When Claude finishes

Leave Claude working in a terminal and go do something else. When it finishes answering, a small card appears at the bottom right of the screen (the same kind of card as the review box), with a short chime. It shows which terminal it was, the project folder, and the start of Claude's answer.

- **Click the card to bring that terminal to the front.** In Windows Terminal the right tab is selected too.
- Click **✕** to dismiss it.
- Cards go away after 15 seconds; hovering keeps them up. Up to three stack, newest on top, one per terminal.

When Claude is **waiting for your permission** (to run a command, edit a file…), a gold **Claude needs you** card appears instead, with a different chime. It stays until you click it, close it, or that terminal's next card replaces it.

No card appears when that terminal is already in front of you. The cards show above borderless games; in exclusive full-screen you still hear the chime. If Claude runs inside an editor rather than a terminal, a click brings that editor's window forward.

The terminal lists (the tray menu, Ctrl+Tab, and holding Back + Forward) show the same at a glance, next to each terminal running Claude:

| Chip | Meaning |
|---|---|
| **◐ Working** | Claude is working on something. |
| **● Needs you** | Claude is waiting for your permission. |
| **✓ Done · 3m** | Claude finished, 3 minutes ago. |
| **Idle** | Claude is waiting for your next message. |

**Working** and **Idle** come from the terminal title that Claude Code sets, so they show even without the hooks; **Needs you** and **Done** need them.

The cards and chips need Claude Code to be connected ([step 4 of the install](#install)). In **Settings → When Claude finishes** you can turn them or their sound off, change how long they stay, and pick the corner of the screen.

## Naming your terminals

With several terminals open, give them names you recognize at a glance. Rename a Windows Terminal tab (right-click the tab → **Rename tab**) and that name is what the tray menu, the terminal list and the Claude cards show, with the original title (for Claude Code, the session name) underneath. In Claude Code, `/rename` changes the session name, which the list shows too.

One limit: if one Windows Terminal window holds several renamed tabs, the helper can't tell which is which, so those keep their original titles rather than risk sending your words to the wrong one. One renamed tab per window, or renamed tabs in separate windows, always work. Terminals inside VS Code and IntelliJ show their own titles.

## Settings

Click the tray microphone, then **Settings**. Most everyday changes can be made here without editing a file.

| I want to… | Where to change it |
|---|---|
| Speak a different language | **Speech recognition → Language**. Choose the language you normally speak. |
| Change the recording shortcut | **Shortcuts → Start and stop recording**. Click the shortcut field and press your new combination. |
| Keep Ctrl+Tab for my browser or editor | **Shortcuts → Show the terminal list**. Choose another shortcut or click **Turn off**. |
| Use different mouse buttons | **Shortcuts → Mouse buttons**. Choose a combination, or **Off**. |
| Move the review box or the Claude cards to another corner | **Typing → Where it appears** and **When Claude finishes → Where it appears**. If both use the same corner, the Claude cards move aside. |
| Review the text for longer | **Typing → Send on its own after**. Hovering over the review box also pauses its countdown. |
| Send immediately without the review box | Turn off **Typing → Ask before sending**. |
| Type into the terminal without submitting | Turn off **Typing → Press Enter after the text**. This is also available in the tray menu. |
| Record longer than a minute | **Recording → Stop recording after**. |
| Hide the indicator beside the mouse | Turn off **Typing → Show the recording pill next to the cursor**. |
| Turn off the Claude cards, their sound, or change how long they stay | **When Claude finishes**. |
| Stop launching automatically | Turn off **General → Start with Windows**. |
| Release GPU memory sooner | **Speech recognition → Free the graphics memory after**. Starts at 15 minutes; 0 keeps the model loaded. |
| Download speech recognition again, switch between graphics card and processor, or get another model | **Speech recognition → Download or change…** |
| Use another downloaded model | **Speech recognition → Model**. The list shows `.bin` files in the same folder as the configured model. |
| Connect or disconnect Claude Code | **General → Claude Code**. |

Click **Save** when you finish. Changes to shortcuts or speech recognition show **Save and restart** instead; finish any recording before saving those changes.

<details>
<summary>Advanced: editing config.json directly</summary>

Settings are stored in `%APPDATA%\claude-terminal-assistant\config.json`; [`config.default.json`](config.default.json) holds the starting values. After editing it by hand, choose **Restart** from the tray menu.

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
| `notify` | The card when Claude finishes: `enabled`, `seconds` it stays up, `sound`, `position` (`bottom-right`, `top-right`, `bottom-left`, `top-left`). |
| `confirm` | The review box: `enabled`, `seconds` before it accepts, `position` (same corners). |
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

While you are recording, Back and Forward only do these things: the app or web page under the cursor doesn't receive them, so a browser won't go back a page. The same applies to the Back + Forward press that starts or stops a recording, and to Back when you hold it to click a terminal. Outside a recording, a press of Back or Forward on its own works as usual, except that it reaches the app when you release the button. Browsers only react on release anyway, but holding the button down in another app does nothing until you let go.

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
| “Windows protected your PC” when installing | The installer isn't signed yet. Choose **More info → Run anyway**. |
| “Set up speech recognition first” | Open **Settings → Speech recognition → Download or change…** and run the setup. |
| The speech setup fails with the NVIDIA build | Run it again and choose **Processor only**; some graphics cards or drivers can't run the downloaded build. **Settings → Open log** shows the details. |
| Whisper exits or never becomes ready | If you chose your own whisper.cpp files, keep the DLLs beside `whisper-server.exe` and use a build that fits your hardware. The log has the details. |
| “Heard nothing” or a microphone error | Check the default input device and microphone access for desktop apps in Windows Settings. If quiet speech is skipped, lower **Recording → Treat as silence below** slightly. |
| The transcript is in the wrong language | Choose a specific language under **Speech recognition → Language** instead of automatic detection. |
| The terminal is missing or sending fails | Open the terminal and select it again. A non-administrator helper cannot send to a terminal running as administrator. |
| Several terminal tabs share one window | Select the exact terminal from the tray list. If clicking a window is ambiguous, the helper asks you to choose. |
| The overlay or the cards don't appear over a game | Use borderless or windowed mode. Exclusive full screen can hide them (you still hear the chimes), and some games may block shortcuts. |
| No card when Claude finishes | Connect Claude Code in **Settings → General** and restart your Claude Code sessions. The helper must be running, and **Settings → When Claude finishes → Show a card** must be on. No card appears for the terminal that is already in front of you. |
| A renamed tab shows its old title | Its window holds other renamed tabs, so the helper can't match names to tabs. Move it to its own window, or keep one renamed tab per window. |
| Starting the app opens its menu | It is already running. The helper keeps one instance. |
| Something else goes wrong | Open **Settings → Open log** to see what happened. To report it, click **Report a problem**: it opens a GitHub issue with your versions filled in. Attach the log, or the lines around the problem, after reading it over, because it also contains the text you dictated. |

## Local files and privacy

Audio is transcribed locally by Whisper. The helper sends the resulting text and any image paths to the destination you choose. If that destination is a cloud-connected assistant, it may send that content to its own service.

For the Claude cards, Claude Code's hook passes the start of Claude's answer (or its permission question) to the helper over a local pipe on your PC; nothing goes over the network.

- **App settings:** `%APPDATA%\claude-terminal-assistant\config.json`.
- **Speech recognition:** whisper.cpp and the model in `%LOCALAPPDATA%\claude-terminal-assistant\whisper`, when the helper downloaded them. Downloads come from whisper.cpp's GitHub releases and its models on Hugging Face.
- **Claude Code connection:** small launchers in `%APPDATA%\claude-terminal-assistant\bin`, which Claude Code's hooks, its status line and your shell prompts run.
- **Saved terminal selection:** `%APPDATA%\claude-terminal-assistant\state.json`.
- **Screenshots and screen frames:** `%APPDATA%\claude-terminal-assistant\screenshots`, unless you set a custom capture folder. Files older than 7 days are pruned when the helper starts.
- **Log:** `%APPDATA%\claude-terminal-assistant\logs\app.log`, with what the helper did, any errors, the text you dictated, and the first words of the answers shown on the Claude cards. It stays under about 1 MB; the previous one is kept as `app.old.log`. It never leaves your PC unless you attach it to a report.

## Remove the app

Uninstall it from **Windows Settings → Apps → Installed apps → Claude Terminal Assistant**. That also disconnects Claude Code and your shell prompts, and removes the Start with Windows entry.

To also remove your settings, captures and the speech model, delete `%APPDATA%\claude-terminal-assistant` and `%LOCALAPPDATA%\claude-terminal-assistant`, and any custom capture folder you configured.

A copy run from source: click **Disconnect** in **Settings → General → Claude Code** (or `npm run install-prompt -- --uninstall`), turn off **Start with Windows**, choose **Quit**, then delete the folder.

<details>
<summary>For contributors</summary>

Run commands from the project folder:

| Command | Purpose |
|---|---|
| `npm start` | Run the Electron tray app and view logs in the terminal. The same lines go to the log file. |
| `npm test` | Run the unit tests. |
| `npm run terminals` | List the terminals the helper can offer as targets. |
| `npm run terminals -- --all` | Include hidden consoles for debugging. |
| `npm run dist` | Build the installer into `dist\`. |
| `npm run icon` | Redraw `assets/icon.png` and `assets/icon.ico`. |

**Publishing a version:** set `version` in `package.json` (for example `1.2.0`), commit, then `git tag v1.2.0 && git push origin v1.2.0`. The [Release workflow](.github/workflows/release.yml) runs the tests, builds the installer and publishes it to [the releases repository](https://github.com/Andrei-Cristian-Zaharia/claude-terminal-assistant-releases), where installed copies find it. It needs the `RELEASES_TOKEN` secret described in the workflow. From your own PC, `npm run release` does the same with a `GH_TOKEN` in the environment.

</details>
