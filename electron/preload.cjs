// Bridge between the React chrome and the main process — the chrome never touches
// Electron APIs directly, it just asks for tab operations and listens to state.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("autobot", {
  tabs: (action, payload) => ipcRenderer.invoke("tabs", action, payload),
  onState: (cb) => {
    const listener = (_e, s) => cb(s);
    ipcRenderer.on("autobot:state", listener);
    return () => ipcRenderer.removeListener("autobot:state", listener);
  },
});
