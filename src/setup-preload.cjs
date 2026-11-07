const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  info: () => ipcRenderer.invoke("setup:info"),
  start: (choice) => ipcRenderer.invoke("setup:start", choice),
  cancel: () => ipcRenderer.send("setup:cancel"),
  useExisting: (language) => ipcRenderer.invoke("setup:useExisting", language),
  close: () => ipcRenderer.send("setup:close"),
  onProgress: (fn) => ipcRenderer.on("setup:progress", (_e, p) => fn(p)),
});
