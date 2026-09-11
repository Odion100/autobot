// Preload for local-app tabs (SystemView first): the host side of RFC-001's frozen
// transport contract. A plain browser has no window.systemview.terminal — its absence
// is how the <Terminal> component knows to say "no terminal host here".
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("systemview", {
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
        send: (text) => ipcRenderer.send("agent:send", key, text),
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
});
