const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlay", {
  onShow: (fn) => ipcRenderer.on("overlay:show", (_e, state) => fn(state)),
});
