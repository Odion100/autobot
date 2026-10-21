// IPC seam for the voice capability. voice.cjs is pure node so it stays testable without electron;
// this half is the only part that knows what a renderer is. Same split as vectors-host.cjs.
const { ipcMain } = require("electron");
const voice = require("./voice.cjs");

function register() {
  ipcMain.handle("voice:status", () => voice.status());
  ipcMain.handle("voice:voices", () => voice.voices());
  ipcMain.handle("voice:speak", (_e, text, opts) => voice.speak(text, opts));
  ipcMain.handle("voice:stop", () => {
    voice.stop();
    return { ok: true };
  });
}

module.exports = { register };
