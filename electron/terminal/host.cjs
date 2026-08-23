// IPC face of the pty substrate — what the preload's window.systemview.terminal
// talks to. Sessions belong to the substrate and OUTLIVE any view; this layer only
// routes data channels per (webContents, session) and cleans up when a view lets go.
const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const sessions = require("./sessions.cjs");

// The browser side never knows a project's absolute root (systemview-test's contract
// note: they pass cwd null) — resolving projectCode → cwd is the host's job.
// ~/.autobot/projects.json holds the map; a hub-side root registry can replace it later.
const PROJECTS = path.join(os.homedir(), ".autobot", "projects.json");
function resolveCwd(projectCode, cwd) {
  if (cwd) return cwd;
  try {
    const map = JSON.parse(fs.readFileSync(PROJECTS, "utf8"));
    if (map[projectCode] && fs.existsSync(map[projectCode])) return map[projectCode];
  } catch {}
  return os.homedir();
}

// key -> Map<webContents, unsubscribe>
const wired = new Map();

function wire(key, wc) {
  let byWc = wired.get(key);
  if (!byWc) wired.set(key, (byWc = new Map()));
  if (byWc.has(wc)) return;
  const off = sessions.subscribe(key, {
    onData: (chunk) => { if (!wc.isDestroyed()) wc.send(`term:data:${key}`, chunk); },
    onExit: (info) => { if (!wc.isDestroyed()) wc.send(`term:exit:${key}`, info); },
  });
  byWc.set(wc, off);
  wc.once("destroyed", () => unwire(key, wc));
}

function unwire(key, wc) {
  const byWc = wired.get(key);
  const off = byWc?.get(wc);
  if (off) { off(); byWc.delete(wc); }
}

function register() {
  ipcMain.handle("term:open", async (e, opts = {}) => {
    const s = await sessions.open({ ...opts, cwd: resolveCwd(opts.projectCode, opts.cwd) });
    wire(s.key, e.sender);
    return { key: s.key, history: await sessions.history(s.key) };
  });
  ipcMain.on("term:write", (_e, key, data) => { sessions.write(key, data).catch(() => {}); });
  ipcMain.on("term:resize", (_e, key, cols, rows) => { sessions.resize(key, cols, rows); });
  ipcMain.handle("term:history", (_e, key) => sessions.history(key));
  // dispose detaches THIS view — the session keeps running (contract rule 3)
  ipcMain.on("term:dispose", (e, key) => unwire(key, e.sender));
  // ⌘K: truncate the scrollback file; session untouched
  ipcMain.on("term:clear", (_e, key) => { try { sessions.clear(key); } catch {} });
  ipcMain.handle("term:kill", (_e, key) => sessions.kill(key));
  // every live session on the machine, survivors from previous runs included
  ipcMain.handle("term:list", () => sessions.list());
}

module.exports = { register };
