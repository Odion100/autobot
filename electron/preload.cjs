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
  // Same voice behavior SystemView's chat has — one shared implementation
  dictation: require("./apps/dictationBridge.cjs")(ipcRenderer),
  // RFC-055 — local embeddings + a JSON-file vector store, offline, no key
  vectors: require("./apps/vectorsBridge.cjs")(ipcRenderer),
  // The browser-level agent surface — same session substrate the apps see, same
  // RFC-048 events, rendered by the chrome's own panel.
  agents: {
    list: () => ipcRenderer.invoke("agent:list"),
    resumable: () => ipcRenderer.invoke("agent:resumable"),
    projects: () => ipcRenderer.invoke("agent:projects"),
    // conversations on disk for a project (claude CLI transcripts) — resume any of
    // them here with open({sessionId: t.sessionId, resume: t.sessionId})
    transcripts: (projectCode) => ipcRenderer.invoke("agent:transcripts", projectCode),
    dismiss: (projectCode, sessionId) => ipcRenderer.invoke("agent:dismiss", projectCode, sessionId),
    // one conversation's messages, newest last: [{kind, text, ts}]
    transcript: (projectCode, sessionId, opts) => ipcRenderer.invoke("agent:transcript", projectCode, sessionId, opts),
    kill: (key) => ipcRenderer.invoke("agent:kill", key),
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
    async open(opts) {
      const { key, history } = await ipcRenderer.invoke("agent:open", opts);
      return {
        key,
        onEvent(cb) {
          const l = (_e, event) => cb(event);
          ipcRenderer.on(`agent:event:${key}`, l);
          return () => ipcRenderer.removeListener(`agent:event:${key}`, l);
        },
        send: (text) => ipcRenderer.send("agent:send", key, text),
        answerPermission: (id, allow, message) => ipcRenderer.invoke("agent:permission", key, id, allow, message),
        interrupt: () => ipcRenderer.invoke("agent:interrupt", key),
        models: () => ipcRenderer.invoke("agent:models", key),
        setModel: (model) => ipcRenderer.invoke("agent:setModel", key, model),
        dispose: () => ipcRenderer.send("agent:dispose", key),
        kill: () => ipcRenderer.invoke("agent:kill", key),
        initialEvents: history,
      };
    },
  },
});
