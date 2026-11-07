const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("menu", {
  onState: (fn) => ipcRenderer.on("menu:state", (_e, state) => fn(state)),
  act: (action) => ipcRenderer.send("menu:action", action),
  size: (height) => ipcRenderer.send("menu:size", height),
});
