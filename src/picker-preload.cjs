const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("picker", {
  onShow: (fn) => ipcRenderer.on("picker:show", (_e, state) => fn(state)),
  pick: (index) => ipcRenderer.send("picker:pick", index),
  cancel: () => ipcRenderer.send("picker:cancel"),
});
