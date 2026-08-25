// The setup page's few verbs — auth status, the API-key fallback, and the
// add-a-project-by-folder flow. All state lands in visible files under ~/.autobot
// (and Claude login state is only READ — the claude CLI owns it).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("autobotSetup", {
  authStatus: () => ipcRenderer.invoke("setup:auth-status"),
  saveKey: (key) => ipcRenderer.invoke("setup:save-key", key),
  clearKey: () => ipcRenderer.invoke("setup:save-key", null),
  projects: () => ipcRenderer.invoke("setup:projects"),
  pickFolder: () => ipcRenderer.invoke("setup:pick-folder"),
  addProject: (code, dir) => ipcRenderer.invoke("setup:add-project", code, dir),
  removeProject: (code) => ipcRenderer.invoke("setup:remove-project", code),
});
