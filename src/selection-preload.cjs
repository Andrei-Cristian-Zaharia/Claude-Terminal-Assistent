const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("selection", {
  onRect: (fn) => ipcRenderer.on("sel:rect", (_e, data) => fn(data)),
});
