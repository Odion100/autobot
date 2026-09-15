// Preload for local-app tabs (SystemView first): the host side of RFC-001's frozen
// transport contract. A plain browser has no window.systemview.terminal — its absence
// is how the <Terminal> component knows to say "no terminal host here".
const { contextBridge, ipcRenderer } = require("electron");
const { build } = require("./capabilities.cjs");

// The FULL surface — what this preload is capable of offering. What an app actually RECEIVES is
// this filtered by its grants, at the bottom of the file. Nothing below is exposed directly.
const FULL = {
  // The Web Speech API doesn't work in Electron (no Google speech service behind
  // webkitSpeechRecognition) — the host provides dictation instead. Per the dividing
  // rule (RFC-001): CAPABILITIES belong to the browser, SURFACES belong to the app.
  dictation: require("./dictationBridge.cjs")(ipcRenderer),
  // RFC-055 — semantic retrieval belongs to the HARNESS, so every app gets it;
  // SystemView supplies the corpus and the node types, never the runtime.
  vectors: require("./vectorsBridge.cjs")(ipcRenderer),
  // RFC-055 — the context store's management half: list/edit/delete notes. Reading and
  // querying ride on `vectors` above; these are the curate verbs his surface needs.
  context: {
    notes: (scope) => ipcRenderer.invoke("context:notes", scope),
    save: (scope, id, fields) => ipcRenderer.invoke("context:save", scope, id, fields),
    remove: (scope, id) => ipcRenderer.invoke("context:delete", scope, id),
  },
  // The host-served IDE surfaces (/ide fills in from these): projects, the
  // fileProviders-shaped codebase methods, and read-only auth status.
  projects: {
    list: () => ipcRenderer.invoke("files:projects"),
    // name-first flow (his rule: choose the code BEFORE it's in): pickFolder()
    // opens the dialog and writes NOTHING → ask the human, defaultCode prefilled
    // → put(code, dir) commits. rename migrates saved sessions with it.
    pickFolder: () => ipcRenderer.invoke("files:pick-folder"), // -> { dir, defaultCode } | null
    put: (code, dir) => ipcRenderer.invoke("files:add-project", code, dir), // -> { code, dir } | { error }
    rename: (code, next) => ipcRenderer.invoke("files:rename-project", code, next), // -> { code, dir } | { error }
    // opens the native folder picker; code defaults to the folder name
    add: (code) => ipcRenderer.invoke("files:pick-project", code),
    remove: (code) => ipcRenderer.invoke("files:remove-project", code),
  },
  files: {
    readFile: (pc, rel) => ipcRenderer.invoke("files:read", pc, rel),
    writeFile: (pc, rel, content) => ipcRenderer.invoke("files:write", pc, rel, content),
    listFiles: (pc, rel) => ipcRenderer.invoke("files:list", pc, rel),
    search: (pc, pattern, opts) => ipcRenderer.invoke("files:search", pc, pattern, opts),
    // git: read + staging
    gitState: (pc) => ipcRenderer.invoke("files:git-state", pc),
    changedFiles: (pc) => ipcRenderer.invoke("files:changed", pc),
    getDiff: (pc, rel, opts) => ipcRenderer.invoke("files:diff", pc, rel, opts),
    stageFiles: (pc, paths, unstage) => ipcRenderer.invoke("files:stage", pc, paths, unstage),
    stageHunk: (pc, rel, hunk, unstage) => ipcRenderer.invoke("files:stage-hunk", pc, rel, hunk, unstage),
    // git verbs (gitState/getDiff/stageFiles/commit) CUT 2026-08-24 with their
    // handlers — his call: the new plugin doesn't need them; commits stay his press.
  },
  auth: {
    status: () => ipcRenderer.invoke("files:auth-status"),
  },
  // RFC-004 §3.3 — what this surface may mount. A host that renders travelling components asks
  // here; the answer is already filtered to the surface and carries resolved own-origin src URLs,
  // so a host never assembles one from parts.
  components: {
    list: (surface) => ipcRenderer.invoke("apps:components", surface),
  },
  // RFC-005 §10 — JOBS, for the app that is the surface for them without owning them. Every verb
  // here goes through the engine: nothing an app calls writes into a store the app can see, which
  // is what keeps "workers can be deleted without the engine changing" true rather than aspirational.
  jobs: {
    list: () => ipcRenderer.invoke("jobs:list"),
    get: (id) => ipcRenderer.invoke("jobs:get", id),
    runs: (id) => ipcRenderer.invoke("jobs:runs", id),
    // What may be hooked — so a surface OFFERS a trigger instead of asking someone to type one.
    vocabulary: () => ipcRenderer.invoke("jobs:vocabulary"),
    save: (rec) => ipcRenderer.invoke("jobs:save", rec),
    remove: (id) => ipcRenderer.invoke("jobs:remove", id),
    // §5 — capturable where the report is READ. One call, no ceremony.
    rate: (id, runId, body) => ipcRenderer.invoke("jobs:rate", id, runId, body),
    // The ambient stream: things that happened to nobody in particular. `subscribe` returns an
    // unsubscribe, the same shape the agent feed uses, so a surface never has to remember a key.
    events: (limit) => ipcRenderer.invoke("jobs:events", limit),
    subscribe: (cb) => {
      ipcRenderer.invoke("jobs:subscribe");
      const l = (_e, ev) => cb(ev);
      ipcRenderer.on("jobs:event", l);
      return () => ipcRenderer.removeListener("jobs:event", l);
    },
  },
  // RFC-005 §7.1 — what is being watched on which page. A watch created from a right-click is
  // invisible until something draws it, and an invisible watcher is why a human turns a feature off.
  watches: {
    list: () => ipcRenderer.invoke("watches:list"),
    save: (rec) => ipcRenderer.invoke("watches:save", rec),
    remove: (id) => ipcRenderer.invoke("watches:remove", id),
  },
  agent: {
    // Every live agent session in this shell: { key, projectCode, sessionId, cwd,
    // sdkSessionId, startedAt }. Sessions ride the user's Claude Code login.
    sessions: () => ipcRenderer.invoke("agent:list"),
    // Claude conversations already on disk for this project's directory —
    // [{sessionId, lastActive, sizeBytes, about}]; open({resume: sessionId})
    // continues one of them HERE, same data, nothing copied.
    transcripts: (projectCode) => ipcRenderer.invoke("agent:transcripts", projectCode),
    // one conversation's messages, newest last: [{kind, text, ts}]
    transcript: (projectCode, sessionId, opts) => ipcRenderer.invoke("agent:transcript", projectCode, sessionId, opts),
    killSession: (projectCode, sessionId = "agent") =>
      ipcRenderer.invoke("agent:kill", `${projectCode}:${sessionId}`),
    // RE-INIT a running session in place: same conversation (resumed by sdk session id),
    // freshly composed system prompt. This is how an edit to presence / the system context /
    // an agent's own doc reaches an agent that is already running — nothing else does, because
    // the SDK took the prompt at query time and compaction only rewrites the conversation.
    // Returns { key, history }; the caller re-seeds its feed from history.
    refresh: (key) => ipcRenderer.invoke("agent:refresh", key),

    // AGENT DEFINITIONS (RFC-003). An agent is a configured session:
    //   { id, name, def: <SDK AgentDefinition>, projectCode, cwd, permissionMode }
    // `def` holds the SDK's own fields (prompt, tools, disallowedTools, skills,
    // mcpServers, model, …) so nothing needs translating; placement and gating sit
    // beside it because they are session facts, not agent facts.
    // Run one with open({ agentId }) — anything passed explicitly still wins.
    defs: () => ipcRenderer.invoke("agent:defs"),
    def: (id) => ipcRenderer.invoke("agent:def", id),
    saveDef: (rec) => ipcRenderer.invoke("agent:def-save", rec),
    removeDef: (id) => ipcRenderer.invoke("agent:def-remove", id),
    // capture a definition from a run that already works, instead of a blank form
    defFromSession: (key, extra) => ipcRenderer.invoke("agent:def-from-session", key, extra),
    // every doc feeding an agent (def prompt + CLAUDE.md stack), and the write-back
    docs: (id) => ipcRenderer.invoke("agent:docs", id),
    saveDoc: (id, key, text) => ipcRenderer.invoke("agent:doc-save", id, key, text),
    // skills: shared on-demand docs (user + project scan), editable by name
    skills: (id) => ipcRenderer.invoke("agent:skills", id),
    saveSkill: (id, name, where, text) => ipcRenderer.invoke("agent:skill-save", id, name, where, text),
    // page-level HELP — for the humans designing agents, scoped to no agent
    help: () => ipcRenderer.invoke("agent:help"),
    saveHelp: (key, text) => ipcRenderer.invoke("agent:help-save", key, text),
    // CONTEXT HOOKS (files in ~/.autobot/hooks). A hook is `on` (which emitted event) + `when`
    // (a cheap declarative predicate over that event's payload) + `do` (a POINTER to a skill —
    // never the procedure itself). hooks() also returns the event VOCABULARY, which is what the
    // picker is built from: you can only hook a moment the system actually announces.
    hooks: () => ipcRenderer.invoke("agent:hooks"),
    saveHook: (rec) => ipcRenderer.invoke("agent:hook-save", rec),
    removeHook: (name) => ipcRenderer.invoke("agent:hook-remove", name),
    // STATISTICS — { store: { since, notes[], readers, totals }, weight: { rows[], totalTokens } }.
    // `store` is retrieval: what is pulled, how often, by whom. `weight` is the opposite question:
    // what every turn costs before anyone asks for anything.
    contextStats: (agentId) => ipcRenderer.invoke("agent:context-stats", agentId),
    // RFC-057 — what has actually been CALLED: tools, MCP, skills, hooks. {days, agent, project}
    callStats: (opts) => ipcRenderer.invoke("agent:call-stats", opts || {}),
    // RFC-058 §8 — the document corpora: what is embedded, how it was cut, and the buttons that
    // change it. Same functions the agent tools call, so a dry run he reads is the one they get.
    docsList: () => ipcRenderer.invoke("agent:docs-list"),
    docsPlan: (name, opts) => ipcRenderer.invoke("agent:docs-plan", name, opts || {}),
    docsSearch: (opts) => ipcRenderer.invoke("agent:docs-search", opts || {}),
    // a real picker, and a preview of what the pattern matched before anything is saved
    pickPath: (kind) => ipcRenderer.invoke("agent:pick-path", kind || "dir"),
    docsPreview: (spec) => ipcRenderer.invoke("agent:docs-preview", spec || {}),
    docsIndex: (name) => ipcRenderer.invoke("agent:docs-index", name),
    docsDrop: (name) => ipcRenderer.invoke("agent:docs-drop", name),
    saveCorpus: (rec) => ipcRenderer.invoke("agent:docs-save-corpus", rec),
    // an agent proposing its own doc — it never writes def.prompt, the approval does
    proposals: () => ipcRenderer.invoke("agent:proposals"),
    applyProposal: (id, text) => ipcRenderer.invoke("agent:proposal-apply", id, text),
    rejectProposal: (id) => ipcRenderer.invoke("agent:proposal-reject", id),
    // per-agent run history: { [agentId]: { runs, lastActive, capabilities } }
    runs: () => ipcRenderer.invoke("agent:runs"),

    // open({ projectCode, sessionId?, model?, permissionMode? }) -> Promise<AgentTransport>
    // Events speak RFC-048 (the session event vocabulary): session.started /
    // assistant.text / assistant.thinking / tool.call / tool.result / file.changed /
    // permission.request / usage / compaction / status / session.ended — every
    // event enveloped with sessionId, projectCode, cwd, branch, worktree.
    // (compaction = the boundary receipt with pre/postTokens; status = the SDK's
    // own compacting/compact_result narration. Both were shipping unlisted — d2
    // built against the documented nine and missed compaction for a week.)
    async open(opts) {
      const { key, history } = await ipcRenderer.invoke("agent:open", opts);
      return {
        onEvent(cb) {
          const l = (_e, event) => cb(event);
          ipcRenderer.on(`agent:event:${key}`, l);
          return () => ipcRenderer.removeListener(`agent:event:${key}`, l);
        },
        // images: [{ name, mime, data (base64, no prefix), thumb (small data URL) }] — the full
        // bytes go to the model, the thumb is what the feed keeps. See sessions.send.
        send: (text, images) => ipcRenderer.send("agent:send", key, text, images),
        // answer a permission-request event; allow=false may carry a reason
        answerPermission: (id, allow, message) =>
          ipcRenderer.invoke("agent:permission", key, id, allow, message),
        interrupt: () => ipcRenderer.invoke("agent:interrupt", key),
        // model switching — SDK menu + a request whose truth is the next re-init
        models: () => ipcRenderer.invoke("agent:models", key),
        setModel: (model) => ipcRenderer.invoke("agent:setModel", key, model),
        history: () => ipcRenderer.invoke("agent:history", key),
        // detaches this view; the session keeps thinking (kill is separate + deliberate)
        dispose: () => ipcRenderer.send("agent:dispose", key),
        kill: () => ipcRenderer.invoke("agent:kill", key),
        initialEvents: history,
      };
    },
  },
  terminal: {
    // Every live session on the machine — including survivors from previous shell
    // runs, which is the point: nothing runs invisibly. Each entry: { projectCode,
    // sessionId, key, pid }. Kill any of them with killSession, view open or not.
    sessions: () => ipcRenderer.invoke("term:list"),
    killSession: (projectCode, sessionId = "main") =>
      ipcRenderer.invoke("term:kill", `${projectCode}:${sessionId}`),

    // open({ projectCode, sessionId?, cwd, cols?, rows? }) -> Promise<Transport>
    async open(opts) {
      const { key, history } = await ipcRenderer.invoke("term:open", opts);
      return {
        onData(cb) {
          const l = (_e, chunk) => cb(chunk);
          ipcRenderer.on(`term:data:${key}`, l);
          return () => ipcRenderer.removeListener(`term:data:${key}`, l);
        },
        onExit(cb) {
          const l = (_e, info) => cb(info);
          ipcRenderer.on(`term:exit:${key}`, l);
          return () => ipcRenderer.removeListener(`term:exit:${key}`, l);
        },
        write: (data) => ipcRenderer.send("term:write", key, data),
        resize: (cols, rows) => ipcRenderer.send("term:resize", key, cols, rows),
        history: () => ipcRenderer.invoke("term:history", key),
        // ⌘K semantics: truncates the host-side scrollback so a remount stays clear —
        // pair with xterm.clear() in the component
        clear: () => ipcRenderer.send("term:clear", key),
        // detaches this view; the session keeps running (kill is separate + deliberate)
        dispose: () => ipcRenderer.send("term:dispose", key),
        kill: () => ipcRenderer.invoke("term:kill", key),
        initialHistory: history,
      };
    },
  },
};

// ---------------------------------------------------------------------------------------------
// THE GATE — RFC-004 §1. Everything above is the menu; this decides what is on the plate.

// IDENTITY COMES FROM MAIN, SYNCHRONOUSLY. A preload cannot know which app it belongs to on its
// own: main.cjs:addTab hands every kind:"app" view this same file path, with no arguments and no
// per-app copy. So we ask, and main answers from `event.sender` -> tab -> appId (it already
// carries appId on the tab record). sendSync rather than invoke because exposeInMainWorld has to
// run DURING preload execution — an awaited answer arrives after the page has already looked for
// its bridge and found nothing.
//
// This re-runs on EVERY navigation, and that is the property that makes the grant ORIGIN-bound
// instead of view-bound. The preload stays attached to a WebContentsView across navigation, so an
// app that follows a redirect would otherwise carry files:write to wherever it landed. Main
// re-checks the URL it is being asked from each time and answers [] when it is not the registered
// origin. A launch-time additionalArguments would have been resolved once, at first load, and been
// wrong for every navigation after it.
let granted = [];
try {
  const answer = ipcRenderer.sendSync("app:grants");
  if (answer && Array.isArray(answer.capabilities)) granted = answer.capabilities;
} catch {
  // No answer means no grant. Failing closed is the only safe direction here: a preload that
  // exposes the full bag when the handler is missing would make every future refactor of main a
  // silent security regression.
  granted = [];
}

// THEME RIDES OUTSIDE THE GATE, DELIBERATELY. Everything else an app receives is a capability —
// an action it may take — and absent-not-denied applies. Theme is not an action: it is the
// environment the app is being displayed in, and an app that had to ask permission to match its own
// window would look foreign by default, which is the failure the whole component story is trying to
// avoid. So it is always present, even for an app granted nothing at all.
//
// `current()` is synchronous because a page must paint in the right theme on its FIRST frame — an
// awaited answer means a flash of the wrong one on every load.
const theme = {
  current() {
    try { return ipcRenderer.sendSync("app:theme"); } catch { return { dark: true }; }
  },
  onChange(cb) {
    const l = (_e, t) => { try { cb(t); } catch {} };
    ipcRenderer.on("autobot:theme", l);
    return () => ipcRenderer.removeListener("autobot:theme", l);
  },
};

contextBridge.exposeInMainWorld("systemview", { ...build(FULL, granted), theme });
