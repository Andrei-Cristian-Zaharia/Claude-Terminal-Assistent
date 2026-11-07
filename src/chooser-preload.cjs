const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chooser", {
  onState: (fn) => ipcRenderer.on("chooser:state", (_e, state) => fn(state)),
  onHover: (fn) => ipcRenderer.on("chooser:hover", (_e, index) => fn(index)),
  layout: (layout) => ipcRenderer.send("chooser:layout", layout),
});
