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
const definitions = require("./definitions.cjs");
const ledger = require("./ledger.cjs");
const hooks = require("./hooks.cjs");
const contextStore = require("./context.cjs");

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

function register(surfaceOf) {
  ipcMain.handle("agent:open", async (e, opts = {}) => {
    const s = await sessions.open({ ...opts, cwd: resolveCwd(opts.projectCode, opts.cwd) });
    wire(s.key, e.sender);
    // an agent can be used by more than one surface over its life, so this is a
    // SET that grows, not a field that gets overwritten by whoever asked last
    try { sessions.noteUsedBy(s.key, surfaceOf?.(e.sender)); } catch {}
    return { key: s.key, history: sessions.history(s.key) };
  });
  ipcMain.on("agent:send", (_e, key, text, images) => { try { sessions.send(key, text, images); } catch {} });
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
  // RE-INIT — the only way a running agent picks up an edited presence / system context /
  // agent doc, because the system prompt was taken by the SDK at query time (see
  // sessions.reinit). The substrate replaces the session object, so every view that was
  // wired to the old one has to be re-pointed at the new one or the window goes deaf while
  // the agent carries on talking — the panel would look dead and be fine.
  ipcMain.handle("agent:refresh", async (e, key) => {
    const viewers = [...(wired.get(key)?.keys() || [])];
    for (const wc of viewers) unwire(key, wc);
    const s = await sessions.reinit(key);
    for (const wc of viewers) if (!wc.isDestroyed()) wire(s.key, wc);
    wire(s.key, e.sender);
    // ONLY NOW. The receipt is emitted after the views are back on the new session — emitting it
    // inside reinit() put it in history while the subscriber set was empty on purpose, so the one
    // panel that needed to show it was the one panel that could not hear it.
    sessions.announceReinit(s.key);
    return { key: s.key, history: sessions.history(s.key) };
  });
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
      // through the substrate, never by path — the run store's name changed in
      // RFC-003 and a second reader is a second place to forget
      const store = sessions.loadSessionStore();
      const liveKeys = new Set(sessions.list().map((s) => s.key));
      return Object.entries(store)
        .filter(([key]) => !liveKeys.has(key))
        .map(([key, v]) => ({ key, ...v }));
    } catch { return []; }
  });
  // AGENT DEFINITIONS (RFC-003) — the shell owns them, so every app and page sees
  // the same agents. Deliberately separate verbs from the session ones: defining
  // an agent and running one are different acts, and collapsing them is how you
  // end up unable to edit a definition without disturbing a conversation.
  ipcMain.handle("agent:defs", () => definitions.list());
  ipcMain.handle("agent:def", (_e, id) => definitions.get(id));
  ipcMain.handle("agent:def-save", (_e, rec) => definitions.save(rec));
  ipcMain.handle("agent:def-remove", (_e, id) => {
    // DELETE MEANS GONE — def + its context (in definitions.remove) + its sessions (here, where
    // both modules are in scope without a circular require).
    const ok = definitions.remove(id);
    try { sessions.purgeAgent(id); } catch {}
    return ok;
  });
  // THE DOCS FEEDING AN AGENT (RFC-055 "one window"): def prompt + the CLAUDE.md
  // stack at its cwd, listed with content, written back by key (never by path).
  ipcMain.handle("agent:docs", (_e, id) => definitions.docs(id));
  ipcMain.handle("agent:doc-save", (_e, id, key, text) => definitions.saveDoc(id, key, text));
  // skills are docs that load ON DEMAND — shared files (user / project), editable like the rest
  ipcMain.handle("agent:skills", (_e, id) => definitions.skills(id));
  ipcMain.handle("agent:skill-save", (_e, id, name, where, text) => definitions.saveSkill(id, name, where, text));
  // PAGE-LEVEL HELP — for the humans designing agents, scoped to no agent (so NOT agent:docs).
  // Lives by the agent list; the defining-agents template/walkthrough is the first one.
  ipcMain.handle("agent:help", () => definitions.help());
  ipcMain.handle("agent:help-save", (_e, key, text) => definitions.saveHelp(key, text));
  // per-agent run summary from the store — runs, last activity, last-known real
  // capabilities — so the profile can tell a dead test agent from a working one.
  // CONTEXT HOOKS — files in ~/.autobot/hooks, listed and edited from the window like docs and
  // skills. `events` is the PICKER's source: the vocabulary the sessions substrate actually emits,
  // so a hook can only ever be attached to a moment that really happens.
  ipcMain.handle("agent:hooks", () => ({ hooks: hooks.list(), events: sessions.EVENTS }));
  ipcMain.handle("agent:hook-save", (_e, rec) => {
    try { return { hook: hooks.save(rec) }; } catch (err) { return { error: String(err?.message || err) }; }
  });
  ipcMain.handle("agent:hook-remove", (_e, name) => hooks.remove(name));

  // STATISTICS — the half of the context system that says what gets USED, not just what exists.
  // Two measurements that must not share a table: RETRIEVAL (notes — is this earning its place?)
  // and WEIGHT (the always-loaded layers — never retrieved, so size is the whole story).
  ipcMain.handle("agent:context-stats", (_e, agentId) => {
    const rec = agentId ? definitions.resolve(agentId) : null;
    const scopes = ["system"];
    if (rec && rec.projectCode) scopes.push(`project:${rec.projectCode}`);
    if (rec) scopes.push(`agent:${rec.id}`);
    return {
      store: contextStore.stats(scopes),
      weight: sessions.weights(rec ? rec.id : null, rec ? rec.cwd : null),
    };
  });

  // RFC-057 — the call ledger, global by default with an agent/project filter. Deliberately NOT
  // folded into agent:context-stats: one answers "is this note earning its place", the other "is
  // this tool being used, and properly" — same dialect, different ledgers, and merging them would
  // make a surface that can only ever be read one way.
  ipcMain.handle("agent:call-stats", (_e, opts) => ledger.stats(opts || {}));

  // A proposed agent doc, waiting on him. Read, approve (which is the write), or reject.
  ipcMain.handle("agent:proposals", () => definitions.proposals());
  ipcMain.handle("agent:proposal-apply", (_e, id, text) => {
    try { return { ok: true, def: definitions.applyProposal(id, text) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle("agent:proposal-reject", (_e, id) => ({ ok: definitions.rejectProposal(id) }));

  ipcMain.handle("agent:runs", () => sessions.agentRuns());
  // save-as-agent: capture a definition from a run that already works, rather
  // than asking him to fill a blank form (RFC-003 §4)
  ipcMain.handle("agent:def-from-session", (_e, key, extra) => {
    const s = sessions.list().find((x) => x.key === key);
    if (!s) return { error: `no live session: ${key}` };
    return definitions.fromSession(s, extra || {});
  });

  // the projects the shell can host an agent for (same map that resolves cwd)
  ipcMain.handle("agent:projects", () => {
    try { return Object.keys(JSON.parse(fs.readFileSync(PROJECTS, "utf8"))); } catch { return []; }
  });
}

module.exports = { register };
