const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settings", {
  load: () => ipcRenderer.invoke("settings:load"),
  save: (config) => ipcRenderer.invoke("settings:save", config),
  // While a shortcut is being recorded, the app's own hotkeys are paused so they don't fire.
  capturing: (on) => ipcRenderer.send("settings:capturing", on),
  close: () => ipcRenderer.send("settings:close"),
});
