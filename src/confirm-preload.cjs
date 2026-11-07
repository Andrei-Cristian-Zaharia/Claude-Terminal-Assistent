const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toast", { // not "confirm": that is window.confirm
  onShow: (fn) => ipcRenderer.on("confirm:show", (_e, state) => fn(state)),
  onRun: (fn) => ipcRenderer.on("confirm:run", (_e, t) => fn(t)),
  onPause: (fn) => ipcRenderer.on("confirm:pause", (_e, t) => fn(t)),
  onHover: (fn) => ipcRenderer.on("confirm:hover", (_e, which) => fn(which)),
  layout: (layout) => ipcRenderer.send("confirm:layout", layout),
});
