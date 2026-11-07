const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settings", {
  load: () => ipcRenderer.invoke("settings:load"),
  save: (config) => ipcRenderer.invoke("settings:save", config),
  // While a shortcut is being recorded, the app's own hotkeys are paused so they don't fire.
  capturing: (on) => ipcRenderer.send("settings:capturing", on),
  close: () => ipcRenderer.send("settings:close"),
  openLog: () => ipcRenderer.send("settings:openLog"),
  report: () => ipcRenderer.send("settings:report"),
  // Connect Claude Code: the cards' hooks, the status line, the screenshots permission, the prompts.
  claudeStatus: () => ipcRenderer.invoke("settings:claudeStatus"),
  claudeConnect: (on) => ipcRenderer.invoke("settings:claudeConnect", on),
  checkUpdates: () => ipcRenderer.invoke("settings:checkUpdates"),
  openSetup: () => ipcRenderer.send("settings:openSetup"),
  installUpdate: () => ipcRenderer.send("settings:installUpdate"),
});
