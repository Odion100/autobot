// IPC face of the agent session substrate — what the preload's window.systemview.agent
// talks to. Same division as the terminal host: sessions belong to the substrate and
// outlive any view; this layer routes event channels per (webContents, session) and
// cleans up when a view lets go. cwd resolution is the host's job — the browser side
// never learns a project's absolute root.
const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const sessions = require("./sessions.cjs");

const PROJECTS = path.join(os.homedir(), ".autobot", "projects.json");
function resolveCwd(projectCode, cwd) {
  if (cwd) return cwd;
  // "browser" = conversations for the browser as a USER, not tied to any codebase
  // (Odion's distinction) — they live in the browser's own home directory.
  if (projectCode === "browser") {
    const home = path.join(os.homedir(), ".autobot", "home");
    fs.mkdirSync(home, { recursive: true });
    return home;
  }
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
  const off = sessions.subscribe(key, (event) => {
    if (!wc.isDestroyed()) wc.send(`agent:event:${key}`, event);
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
  ipcMain.handle("agent:open", async (e, opts = {}) => {
    const s = await sessions.open({ ...opts, cwd: resolveCwd(opts.projectCode, opts.cwd) });
    wire(s.key, e.sender);
    return { key: s.key, history: sessions.history(s.key) };
  });
  ipcMain.on("agent:send", (_e, key, text) => { try { sessions.send(key, text); } catch {} });
  ipcMain.handle("agent:permission", (_e, key, id, allow, message) =>
    sessions.answerPermission(key, id, allow, message));
  ipcMain.handle("agent:interrupt", (_e, key) => sessions.interrupt(key));
  // model switching — setModel is a request; truth arrives on the next re-init
  ipcMain.handle("agent:models", (_e, key) => sessions.models(key));
  ipcMain.handle("agent:setModel", (_e, key, model) => sessions.setModel(key, model));
  ipcMain.handle("agent:history", (_e, key) => sessions.history(key));
  // dispose detaches THIS view — the session keeps thinking (same contract as terminals)
  ipcMain.on("agent:dispose", (e, key) => unwire(key, e.sender));
  ipcMain.handle("agent:kill", (_e, key) => sessions.kill(key));
  ipcMain.handle("agent:list", () => sessions.list());
  // conversations already on disk for a project's directory (claude CLI transcripts) —
  // pick one and open({resume: sessionId}) continues it here; the transfer click
  ipcMain.handle("agent:transcripts", (_e, projectCode) =>
    sessions.transcriptsFor(resolveCwd(projectCode, null), projectCode));
  // dismissal is a LIST decision — the transcript on disk stays untouched
  ipcMain.handle("agent:dismiss", (_e, projectCode, sessionId) =>
    sessions.dismissTranscript(projectCode, sessionId));
  // one conversation's own messages, newest last — so a resumed panel opens with
  // the conversation on screen (the substrate also seeds these into initialEvents)
  ipcMain.handle("agent:transcript", (_e, projectCode, sessionId, opts) =>
    sessions.transcriptMessages(resolveCwd(projectCode, null), sessionId, opts));
  // sticky sessions from previous shell runs, resumable by open()ing the same key
  ipcMain.handle("agent:resumable", () => {
    try {
      const store = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".autobot", "agents.json"), "utf8"));
      const liveKeys = new Set(sessions.list().map((s) => s.key));
      return Object.entries(store)
        .filter(([key]) => !liveKeys.has(key))
        .map(([key, v]) => ({ key, ...v }));
    } catch { return []; }
  });
  // the projects the shell can host an agent for (same map that resolves cwd)
  ipcMain.handle("agent:projects", () => {
    try { return Object.keys(JSON.parse(fs.readFileSync(PROJECTS, "utf8"))); } catch { return []; }
  });
}

module.exports = { register };
