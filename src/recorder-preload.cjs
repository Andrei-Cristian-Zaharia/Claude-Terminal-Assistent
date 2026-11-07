const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorder", {
  onStart: (fn) => ipcRenderer.on("rec:start", () => fn()),
  onStop: (fn) => ipcRenderer.on("rec:stop", () => fn()),
  onBeep: (fn) => ipcRenderer.on("rec:beep", (_e, tones) => fn(tones)),
  started: () => ipcRenderer.send("rec:started"),
  audio: (wav) => ipcRenderer.send("rec:audio", wav),
  error: (message) => ipcRenderer.send("rec:error", message),
});
