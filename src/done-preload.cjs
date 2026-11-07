const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("done", {
  onState: (fn) => ipcRenderer.on("done:state", (_e, state) => fn(state)),
  onRun: (fn) => ipcRenderer.on("done:run", (_e, t) => fn(t)),
  onPause: (fn) => ipcRenderer.on("done:pause", (_e, t) => fn(t)),
  onHover: (fn) => ipcRenderer.on("done:hover", (_e, hit) => fn(hit)),
  layout: (layout) => ipcRenderer.send("done:layout", layout),
});
