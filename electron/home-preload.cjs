// Preload for the shell's own landing page — the few verbs home needs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("autobotHome", {
  apps: async () => (await ipcRenderer.invoke("tabs", "state")).apps,
  openApp: (appId) => ipcRenderer.invoke("tabs", "openApp", { appId }),
  go: (input) => {
    let url = input;
    if (!/^[a-z]+:\/\//i.test(url))
      url = url.includes(" ") || !url.includes(".")
        ? `https://www.google.com/search?q=${encodeURIComponent(url)}`
        : `https://${url}`;
    return ipcRenderer.invoke("tabs", "navigate", { url });
  },
});
