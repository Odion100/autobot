// The agent session substrate — RFC-002 step 2. Claude sessions live in the browser's
// main process via the Agent SDK (which spawns its bundled native claude binary and
// rides the user's existing Claude Code login — no API key involved). Sessions are
// keyed (projectCode, sessionId) like terminals, outlive any view, and emit the
// RFC-048 event vocabulary (systemview repo, RFCs/RFC-048-the-session-event-vocabulary.md):
//   session.started | assistant.text | assistant.thinking | tool.call | tool.result
//   | file.changed | permission.request | usage | compaction | status | session.ended
// Every event carries the envelope: sessionId, projectCode, cwd, worktree — a
// straight echo of what open() was given. Branch and arrangement are IDE state
// (Odion's line, 2026-08-23): the IDE chose the directory, the IDE labels the feed. Whatever emits activity — this SDK stream today, hooks or
// an agentci adapter tomorrow — speaks these events; the renderer never knows the lane.
const fs = require("fs");
const path = require("path");

const HISTORY_LIMIT = 2000;

const sessions = new Map(); // key -> session record

// Sticky across shell restarts: the SDK's session id is enough to resume a
// conversation, so it lives in ~/.autobot/sessions.json (the visible shell-state
// home). open() auto-resumes from here; kill() is the deliberate forget.
const os = require("os");
// RFC-003 §3 — THIS FILE HOLDS RUNS, NOT AGENTS. It was named agents.json before
// an agent was a thing you could define; now that definitions exist (agents/
// definitions.cjs) the old name would have two meanings a week apart. Renamed to
// sessions.json, READ-BOTH / WRITE-NEW for one release so a shell that comes up
// on the old file loses nothing — same migration shape as the project rename.
const STORE = path.join(os.homedir(), ".autobot", "sessions.json");
const STORE_LEGACY = path.join(os.homedir(), ".autobot", "agents.json");
function loadStore() {
  // READ-BOTH means MERGE, not "new else old". Returning the new file the moment
  // it parses orphans every legacy-only key — invisible, not an error, and only
  // survivable by luck (right now both files happen to hold the same 6 runs).
  // New wins per key; legacy fills the gaps until it is empty of anything unique.
  let legacy = {}, current = {};
  try { legacy = JSON.parse(fs.readFileSync(STORE_LEGACY, "utf8")); } catch {}
  try { current = JSON.parse(fs.readFileSync(STORE, "utf8")); } catch {}
  return { ...legacy, ...current };
}
function saveStore(mutate) {
  const store = loadStore();
  mutate(store);
  try { fs.writeFileSync(STORE, JSON.stringify(store, null, 2)); } catch {}
}

const keyOf = (projectCode, sessionId = "agent") => `${projectCode}:${sessionId}`;

// DELETE MEANS GONE — purge every run that belonged to a deleted agent (his rule: a confirmed
// delete leaves nothing behind). Keyed off the run's agentId, which open() stamps on it.
function purgeAgent(id) {
  let n = 0;
  saveStore((store) => {
    for (const key of Object.keys(store)) {
      if (store[key] && store[key].agentId === id) { delete store[key]; n++; }
    }
  });
  return n;
}

// WHAT THE STORE KNOWS PER AGENT — for the profile's delete decision: how many runs a
// definition has, when it last did anything, and the real capability lists its last
// session reported. Live sessions are a separate question (list() answers it).
function agentRuns() {
  const store = loadStore();
  const out = {};
  for (const key of Object.keys(store)) {
    const r = store[key];
    if (!r || !r.agentId) continue;
    const a = out[r.agentId] || (out[r.agentId] = { runs: 0, lastActive: 0, capabilities: null });
    a.runs++;
    if ((r.lastActive || 0) >= a.lastActive) {
      a.lastActive = r.lastActive || 0;
      if (r.capabilities) a.capabilities = r.capabilities;
    }
  }
  return out;
}

const definitions = require("./definitions.cjs");
const worklist = require("./worklist.cjs");
const context = require("./context.cjs");
const discovery = require("./discovery.cjs");
const services = require("./services.cjs");

// THE LEVEL-0 STAMP (RFC-055, my half of the context MCP).
//
// The premise it exists for: an agent does not reach for tools it was never told
// exist. Discovery, worklist and context are all merged into every session, but a
// merged tool the model never considers is a tool that is not there.
//
// IT RIDES THE SYSTEM PROMPT, NOT A USER TURN. The obvious implementation — push a
// message into the input queue at open — is wrong twice: it would spend a model
// turn the human did not ask for on EVERY session open, and it would show up in
// his feed as words he did not type. The system prompt costs no turn and is not
// part of the conversation at all.
//
// WHICH ALSO ANSWERS THE RE-STAMP. Compaction rewrites the CONVERSATION; the system
// prompt is not in it, so a stamp placed here survives a boundary by construction
// and there is nothing to re-fire. A re-stamp would have been a user turn arriving
// out of nowhere immediately after a compaction — the worst moment for one.
// PRESENCE RIDES WITH THE STAMP — his call, 2026-09-09: the stamp named the tools but
// nothing said WHERE THE AGENT IS. An agent outside systemview's repo knew nothing of the
// browser, the chat, or that its reply renders as interactive markdown — the original
// Part-A failure, rebuilt. The text is a FILE he edits (~/.autobot/presence.md), read at
// open, so fixing "we forgot to tell them X" is one edit, no rebuild, no code. Known
// imperfection, his words: harness-level for now — an app should eventually inject its own
// presence through its handle, because "in the browser" does not necessarily mean "in
// SystemView". Structure upgrades later; context gets solved now.
const PRESENCE_FILE = path.join(os.homedir(), ".autobot", "presence.md");
function presence() {
  try {
    const t = fs.readFileSync(PRESENCE_FILE, "utf8").trim();
    return t ? t + "\n\n" : "";
  } catch {
    return "";
  }
}

const STAMP =
  "SHARED MEMORY. This harness carries context across sessions and agents:\n" +
  `- \`${context.TOOL_NAMES[1]}\` — search what has already been learned (conventions, corrections, ` +
  "project facts, prior lessons) BEFORE deriving or guessing. An empty answer means nothing matches; proceed.\n" +
  `- \`${context.TOOL_NAMES[0]}\` — write one small note the moment you learn something a future ` +
  "session would otherwise rediscover: a correction from the user, a convention, a gotcha, what a command really does.\n" +
  `- \`${worklist.TOOL_NAME}\` — your plan for multi-step work; send the whole list every time.\n` +
  `- \`${discovery.TOOL_NAME}\` — find a tool by describing what you need, instead of assuming none exists.`;

// The definition's SDK half → query options. Only tool access, skills and MCP are
// forwarded as-is; `prompt` becomes systemPrompt (the assignment IS the system
// prompt), and undefined fields are omitted entirely rather than sent as
// undefined, which the SDK would treat as "set to nothing" for some of them.
function sdkOptionsOf(def = {}) {
  const o = {};
  // A CUSTOM systemPrompt REPLACES the preset — and per the SDK, `append` has no
  // effect once systemPrompt is a string. So the stamp is composed differently in
  // each case rather than set once: appended to the agent's own assignment when it
  // has one, appended to the claude_code preset when it does not. Either way it is
  // present, and neither way costs a turn.
  const stamped = presence() + STAMP;
  o.systemPrompt = def.prompt
    ? `${def.prompt}\n\n${stamped}`
    : { type: "preset", preset: "claude_code", append: stamped };
  // A definition that PINS `tools` would otherwise drop the worklist without
  // saying so — the agent keeps working and quietly stops being able to plan.
  // The worklist is harness state, so it is always appended, never negotiable.
  if (def.tools?.length)
    o.allowedTools = [...def.tools, worklist.TOOL_NAME, discovery.TOOL_NAME, ...services.TOOL_NAMES, ...context.TOOL_NAMES];
  if (def.disallowedTools?.length) o.disallowedTools = def.disallowedTools;
  // FORWARDED NOW — the "real server to wire" arrived (SystemLynx's MCP workbench,
  // the first SystemLynx service exposing tools over MCP). The shape mismatch this
  // comment warned about is the whole job: a definition stores an ARRAY of specs
  // because that is a list a human edits and orders; query options want a RECORD
  // keyed by name. Mapping here keeps the definition human-shaped and the SDK call
  // correct, instead of making one of them wear the other's shape.
  //
  // A spec is { name, ...connection } — whatever the SDK's own server config takes
  // (type/url for http, command/args for stdio). We do not interpret the connection
  // half: unknown transports are the SDK's business, and inventing validation here
  // would mean a new transport needs a change in this file to be usable.
  if (Array.isArray(def.mcpServers) && def.mcpServers.length) {
    const record = {};
    def.mcpServers.forEach((spec, i) => {
      if (!spec || typeof spec !== "object") return;
      const { name, ...connection } = spec;
      // A nameless spec is still a spec — key it positionally rather than dropping
      // it silently, which is the failure this comment existed to prevent.
      const key = String(name || `mcp-${i}`);
      if (Object.keys(connection).length) record[key] = connection;
    });
    if (Object.keys(record).length) o.mcpServers = record;
  }
  if (def.maxTurns) o.maxTurns = def.maxTurns;
  return o;
}

// The model's REAL context window — the rule App.jsx learned the hard way (the
// 200k-era guess pegged red at 457k of real context on a 1M-window model).
// Shipped on session.started AND usage so consumers never mirror this regex:
// d2 already reads contextWindow, and App.jsx now prefers the shipped number.
const contextWindowOf = (model) =>
  model ? (/haiku|-3-|sonnet-4-5|opus-4-5/.test(model) ? 200000 : 1000000) : undefined;

// Streaming input for the SDK: an async iterable we can push user turns into forever.
function inputQueue() {
  const buffered = [];
  let wake = null;
  let done = false;
  return {
    push(msg) { buffered.push(msg); if (wake) { wake(); wake = null; } },
    end() { done = true; if (wake) { wake(); wake = null; } },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (buffered.length) yield buffered.shift();
        if (done) return;
        await new Promise((r) => { wake = r; });
      }
    },
  };
}

function emit(s, event) {
  event.ts = Date.now();
  // the rule-3 envelope, stamped once here so no emitter can forget it
  event.sessionId = s.sessionId;
  event.projectCode = s.projectCode;
  event.cwd = s.cwd;
  event.worktree = s.cwd;
  s.events.push(event);
  if (s.events.length > HISTORY_LIMIT) s.events.splice(0, s.events.length - HISTORY_LIMIT);
  for (const sub of s.subs) { try { sub(event); } catch {} }
}

// Rule 2: the summary is produced ONCE, here, from the tool schemas the host holds.
// The label half of the label/record split, bounded once at the exit so every
// branch — including ones added later — inherits the bound. path.basename()
// clamps nothing, so per-branch clamping leaked.
function toolSummary(name, input = {}) {
  return String(toolLabel(name, input) ?? name ?? "").replace(/\s+/g, " ").slice(0, 70);
}

function toolLabel(name, input = {}) {
  const p = (f) => (f ? path.basename(String(f)) : "");
  switch (name) {
    // every branch here clamps — this summary feeds the STATUS line (one line),
    // not the record (the ToolCard shows the full command, clamped by its own
    // show-more). description is agent-written and unbounded: a long one used to
    // be the one path that could flood the cooking line. Same class as
    // systemview-test's `said → room` fix: one field, two surfaces, and the
    // status always wants a NAME while the record wants everything.
    case "Bash": return String(input.description || `run: ${String(input.command || "").slice(0, 60)}`).slice(0, 70);
    case "Edit": return `editing ${p(input.file_path)}`;
    case "Write": return `writing ${p(input.file_path)}`;
    case "NotebookEdit": return `editing ${p(input.notebook_path)}`;
    case "Read": return `reading ${p(input.file_path)}`;
    case "Grep": return `searching for ${String(input.pattern || "").slice(0, 40)}`;
    case "Glob": return `finding ${String(input.pattern || "").slice(0, 40)}`;
    case "WebFetch": return `fetching ${String(input.url || "").slice(0, 60)}`;
    case "WebSearch": return `searching the web: ${String(input.query || "").slice(0, 40)}`;
    // TodoWrite is NOT in this SDK's tool set (measured 2026-08-25 — the model
    // searched for a todo tool and found none). Kept only for transcripts written
    // by an older harness; the live path is the worklist tool below.
    case "TodoWrite": return "updating the plan";
    case worklist.TOOL_NAME: return "updating the worklist";
    case "Task": case "Agent": return `delegating: ${String(input.description || "").slice(0, 50)}`;
    default: return name;
  }
}

// Rule 4 (schema half): tools whose schema names the path they touch. The watcher
// half — catching a shell sed or git checkout — is the fs-watcher follow-up.
function fileChangeOf(name, input = {}) {
  if (name === "Edit") return { path: input.file_path, change: "edited" };
  if (name === "Write") return { path: input.file_path, change: "edited" }; // created-vs-edited needs an existsSync at call time
  if (name === "NotebookEdit") return { path: input.notebook_path, change: "edited" };
  return null;
}

// Rule 4 (watcher half): an fs.watch on the worktree catches what no schema names —
// a shell sed, a git checkout, an MCP tool writing files. It only SPEAKS while the
// agent has tools in flight: the same directory is also the user's, and a watcher
// can't tell whose hand moved a file — tools-in-flight is the honest gate. Paths the
// schema half just emitted are deduped for a beat so Edit/Write don't double-fire.
const WATCH_IGNORE = /(^|\/)(\.git|node_modules|\.systemview|dist|build)(\/|$)/;
function startWatcher(s) {
  try {
    s.watcher = fs.watch(s.cwd, { recursive: true }, (eventType, rel) => {
      if (!rel) return;
      if (WATCH_IGNORE.test(rel) || s.toolsInFlight === 0) return;
      const abs = path.join(s.cwd, rel);
      const now = Date.now();
      const last = s.recentChanges.get(abs);
      if (last && now - last < 1500) return; // debounce + schema-half dedupe
      s.recentChanges.set(abs, now);
      const change = eventType === "rename" ? (fs.existsSync(abs) ? "created" : "deleted") : "edited";
      emit(s, { kind: "file.changed", path: abs, change, source: "watcher" });
    });
  } catch {} // recursive watch unavailable → schema half still covers Edit/Write
}

// Compress a tool result to something a feed can show without drowning in bytes. The harness's
// own MCP tools (context/discovery/systemlynx) get a bigger budget: their outputs are AUTHORED
// for human reading — his rule, "our logs come out human" — and clipping a ranked list of notes
// at 400 chars re-creates the dump problem by amputation. Their sizes are bounded at the source
// (top-k results, 40KB cap on call), so the budget is honest, not unbounded.
function brief(content, max = 400) {
  if (typeof content === "string") return content.slice(0, max);
  if (Array.isArray(content))
    return content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n").slice(0, max);
  return "";
}
const HARNESS_MCP = /^mcp__(context|discovery|systemlynx)__/;
const resultBudget = (toolName) => (HARNESS_MCP.test(String(toolName || "")) ? 6000 : 400);

// Lifecycle breadcrumbs — when a session dies on its own, this file says why.
function logLife(s, what) {
  try {
    const dir = path.join(os.homedir(), ".autobot", "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "agents.log"), `${new Date().toISOString()} ${s.key} ${what}\n`);
  } catch {}
}

async function pump(s) {
  try {
    for await (const m of s.query) {
      if (m.type === "system" && m.subtype === "init") {
        s.sdkSessionId = m.session_id;
        s.model = m.model; // rides usage events so the meter knows its real window
        // WHAT THIS AGENT ACTUALLY HAS. The init message carries the real lists —
        // tools (including our mcp__worklist__set), skills, subagents, mcp servers
        // with their connection status. The panel was printing "everything the
        // shell allows" while this sat here unread; his catch, and the same class
        // as the UUID labels: a placeholder standing where real data already was.
        s.capabilities = {
          tools: m.tools || [],
          skills: m.skills || [],
          agents: m.agents || [],
          mcpServers: m.mcp_servers || [],
          slashCommands: m.slash_commands || [],
        };
        saveStore((store) => {
          store[s.key] = {
            projectCode: s.projectCode,
            sessionId: s.sessionId,
            cwd: s.cwd,
            sdkSessionId: m.session_id,
            permissionMode: s.permissionMode,
            agentId: s.agentId,       // RFC-003: a run belongs to a definition, or to none
            agentName: s.agentName,
            worklist: s.worklist,
            // persisted so the profile can show an agent's REAL lists when it is
            // not running — last session's truth beats the definition's guess
            capabilities: s.capabilities,
            lastActive: Date.now(),
          };
        });
        logLife(s, `started: model ${m.model} sdk ${m.session_id}${s.resumedFrom ? " resumed " + s.resumedFrom : ""}`);
        emit(s, {
          kind: "session.started",
          model: m.model,
          contextWindow: contextWindowOf(m.model),
          sdkSessionId: m.session_id,
          permissionMode: s.permissionMode, // gated-vs-open is decided at open; the UI needs to know which it got
          capabilities: s.capabilities,     // the real lists, so no consumer has to guess or label
        });
        // REPLAY THE SURVIVING PLAN. A resumed conversation has its worklist back
        // in memory, but a subscriber only ever learns a list from an event — so
        // without this the rail stays empty until the model happens to write
        // again, which may be never. Same full-list shape; nothing distinguishes
        // a replayed list from a fresh one, because nothing should.
        if (s.worklist.length) emit(s, { kind: "todo.updated", items: s.worklist });
      } else if (m.type === "system" && m.subtype === "compact_boundary") {
        // compaction is an EVENT the user watches finish, not a silent gap — the
        // harness reports exactly what it freed (his ask: "see that it's working
        // properly and when it's done")
        const cm = m.compact_metadata || m.compactMetadata || {};
        // the pre-compaction reading measures a conversation that no longer
        // exists; postTokens is the honest new one, null means "no snapshot yet"
        s.lastCtxSnapshot = cm.postTokens ?? cm.post_tokens ?? null;
        emit(s, {
          kind: "compaction",
          trigger: cm.trigger,
          preTokens: cm.preTokens ?? cm.pre_tokens,
          postTokens: cm.postTokens ?? cm.post_tokens,
        });
      } else if (m.type === "system" && m.subtype === "status") {
        // the SDK narrates compaction itself: status:"compacting" while it runs,
        // then compact_result / compact_error on the verdict — exactly what the
        // renderer's status branches consume (cooking line says "compacting" from
        // the SDK's own signal, a failed compact shows WHY and un-sticks "working")
        emit(s, {
          kind: "status",
          status: m.status,
          compactResult: m.compact_result ?? m.compactResult,
          compactError: m.compact_error ?? m.compactError,
        });
      } else if (m.type === "stream_event") {
        const ev = m.event;
        if (ev?.type === "content_block_delta") {
          if (ev.delta?.type === "text_delta")
            emit(s, { kind: "assistant.text", delta: ev.delta.text, done: false });
          else if (ev.delta?.type === "thinking_delta")
            emit(s, { kind: "assistant.thinking", delta: ev.delta.thinking, done: false });
        }
      } else if (m.type === "assistant") {
        // The WINDOW truth lives here: each parent assistant message's usage is a
        // per-call snapshot (input + cache read + cache creation = what actually
        // fills the context). The result record's usage is CUMULATIVE across the
        // run — painting it as a snapshot read "2M / 1M" red at every stop
        // (systemview-60's find). Subagent messages carry parent_tool_use_id and
        // their numbers never rule this session's meter.
        if (!m.parent_tool_use_id && m.message.usage) {
          const u = m.message.usage;
          s.lastCtxSnapshot = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          // snapshot:true = a ruler tick, not a turn closing (no turns/costUsd)
          emit(s, {
            kind: "usage",
            snapshot: true,
            contextTokens: s.lastCtxSnapshot,
            contextWindow: contextWindowOf(s.model || m.message.model),
          });
        }
        for (const b of m.message.content || []) {
          if (b.type === "text") emit(s, { kind: "assistant.text", delta: "", done: true, text: b.text });
          else if (b.type === "thinking") emit(s, { kind: "assistant.thinking", delta: "", done: true, text: b.thinking });
          else if (b.type === "tool_use") {
            s.toolCalls.set(b.id, { name: b.name, input: b.input });
            s.toolsInFlight++;
            emit(s, { kind: "tool.call", id: b.id, name: b.name, summary: toolSummary(b.name, b.input), input: b.input });
          }
        }
      } else if (m.type === "user") {
        const content = m.message?.content;
        if (Array.isArray(content))
          for (const b of content)
            if (b.type === "tool_result") {
              const call = s.toolCalls.get(b.tool_use_id) || {};
              if (s.toolCalls.delete(b.tool_use_id)) s.toolsInFlight = Math.max(0, s.toolsInFlight - 1);
              const ok = !b.is_error;
              emit(s, {
                kind: "tool.result",
                id: b.tool_use_id,
                ok,
                summary: `${toolSummary(call.name, call.input)} — ${ok ? "done" : "failed"}`,
                detail: brief(b.content, resultBudget(call.name)),
              });
              const fc = ok && call.name ? fileChangeOf(call.name, call.input) : null;
              if (fc && fc.path) {
                s.recentChanges.set(fc.path, Date.now()); // schema half spoke — watcher stays quiet on this path
                emit(s, { kind: "file.changed", path: fc.path, change: fc.change, source: "schema" });
              }
            }
      } else if (m.type === "result") {
        emit(s, {
          kind: "usage",
          inputTokens: m.usage?.input_tokens,
          outputTokens: m.usage?.output_tokens,
          // what actually fills the window: the LAST per-message snapshot — NOT
          // this result's own usage, which is cumulative across the run. The
          // result stays the run receipt (cost/turns); the snapshot is the ruler.
          contextTokens: s.lastCtxSnapshot ?? null,
          contextWindow: contextWindowOf(s.model),
          costUsd: m.total_cost_usd,
          turns: m.num_turns,
          durationMs: m.duration_ms,
          ok: m.subtype === "success",
        });
      }
    }
    logLife(s, "ended: done");
    emit(s, { kind: "session.ended", reason: "done" });
  } catch (err) {
    logLife(s, `ended: error ${String(err?.message || err)}`);
    emit(s, { kind: "session.ended", reason: "error", error: String(err?.message || err) });
  } finally {
    try { s.watcher?.close(); } catch {}
    sessions.delete(s.key);
  }
}

async function open({ projectCode, sessionId = "agent", cwd, model, permissionMode, resume, agentId }) {
  // RFC-003: an agent is a configured session. A definition supplies defaults —
  // never an override — so an explicit argument at open always wins. That is q1's
  // lean made concrete: placement is a default you can point somewhere else.
  let agent = agentId ? definitions.resolve(agentId) : null;
  if (agentId && !agent) throw new Error(`unknown agent: ${agentId}`);
  // NO IMPLICIT AGENTS GOING FORWARD (his call). A run opened without a definition
  // gets one written for it now, keyed by placement so a project's many
  // conversations stay ONE agent. The browser's own chats are placed too — they
  // are agents like everything else, per "there are no more conversations".
  if (!agent) {
    try { agent = definitions.adopt({ projectCode, cwd, permissionMode, model }); } catch {}
  }
  if (agent) {
    projectCode = projectCode || agent.projectCode;
    cwd = cwd || agent.cwd;
    model = model || agent.def.model;
    permissionMode = permissionMode || agent.permissionMode;
  }
  const key = keyOf(projectCode, sessionId);
  const existing = sessions.get(key);
  if (existing) return existing;

  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  // sticky: an explicit resume wins; otherwise a previous life of this same key
  // (same project, same session name) picks up where it left off
  const remembered = resume ?? loadStore()[key]?.sdkSessionId;
  const s = {
    key,
    projectCode,
    sessionId,
    cwd,
    events: [],
    subs: new Set(),
    input: inputQueue(),
    toolCalls: new Map(), // tool_use id -> {name, input}, so results can be summarized
    toolsInFlight: 0,
    recentChanges: new Map(), // abs path -> ts, watcher debounce + schema-half dedupe
    watcher: null,
    pendingPermissions: new Map(), // id -> resolve
    permissionSeq: 0,
    sdkSessionId: null,
    agentId: agent ? agent.id : null,   // a run remembers its definition; ad-hoc runs keep null
    agentName: agent ? agent.name : null,
    startedAt: Date.now(),
    // His posture: permissions-off is the personal default. NOTE (SDK fact): in
    // bypassPermissions the canUseTool callback NEVER fires — permission.request
    // events only exist for sessions opened in "default" mode. Gated-vs-open is
    // a choice made here, at open, per session.
    permissionMode: permissionMode || "bypassPermissions",
    resumedFrom: null,
  };

  // Auth: the Claude login owns the session by default; the setup page's saved key
  // is the fallback for a machine with no login (never overrides a real login).
  const env = { ...process.env };
  try {
    const signedIn = !!JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")).oauthAccount;
    if (!signedIn) {
      const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".autobot", "agent-auth.json"), "utf8"));
      if (auth.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = auth.ANTHROPIC_API_KEY;
    }
  } catch {}

  // THE WORKLIST — one per session, harness state. The handler closes over THIS
  // session, so the tool takes no session id and cannot write to another list.
  // emit() pushes into s.events, which history() returns verbatim — so this
  // rides history for free and a panel opened an hour late renders the current
  // list from one event, which was their whole requirement.
  // SEEDED FROM THE STORE, not empty. systemview-test's rendering decision —
  // "the plan outlives the turn that wrote it" — is only true if the plan also
  // outlives a RESTART, and sessions here outlive views and restarts by design.
  // Without this the worklist would be the one piece of session state that
  // silently didn't, and their rail would show nothing for a conversation that
  // still has a plan.
  s.worklist = Array.isArray(loadStore()[key]?.worklist) ? loadStore()[key].worklist : [];
  s.usedBy = Array.isArray(loadStore()[key]?.usedBy) ? loadStore()[key].usedBy : [];
  const worklistServer = worklist.serverFor((items) => {
    s.worklist = items;
    // persisted on every write, not at init — a plan written mid-session and
    // then interrupted is exactly the one worth keeping
    saveStore((store) => { if (store[s.key]) store[s.key].worklist = items; });
    emit(s, { kind: "todo.updated", items });
  });

  // DISCOVERY — one tool that finds the others (RFC-055, his design). Built from the
  // definition's OWN mcpServers record, so it can never describe a server this agent is
  // not actually wired to: the thing doing the connecting is the thing reporting the
  // connection, which is the presence principle applied one layer down.
  const wiredMcp = agent ? sdkOptionsOf(agent.def).mcpServers : null;
  const discoveryServer = discovery.serverFor(wiredMcp);
  // The third tier: SystemLynx services he has whitelisted, attachable mid-session.
  const servicesServer = services.serverFor();

  // CONTEXT — shared memory across sessions and agents (RFC-055). Identity is
  // CLOSED OVER here and never taken from tool arguments: `slot` is the agent
  // DEFINITION id, so a note filed to agent scope follows the slot across
  // re-clones and cannot be misfiled by a model inventing a name. An ad-hoc run
  // with no definition has no slot — it gets system (and project when known) and
  // no agent scope at all, which is the honest degradation: an anonymous session
  // has no slot to inherit from or write to.
  const contextServer = context.serverFor({ projectCode, slot: agent ? agent.id : null });

  s.query = query({
    prompt: s.input,
    options: {
      cwd,
      model,
      env,
      resume: remembered,
      includePartialMessages: true,
      permissionMode: s.permissionMode,
      // THE SDK HALF, SPREAD VERBATIM — no mapping step, because the definition
      // already stores the SDK's own AgentDefinition fields (systemPrompt aside:
      // `prompt` is the assignment, and it is what the SDK reads). Anything the
      // definition doesn't set simply isn't here, so an unconfigured agent opens
      // exactly like today's ad-hoc session.
      ...(agent ? sdkOptionsOf(agent.def) : {}),
      // THE STAMP IS NOT NEGOTIABLE AND NOT CONDITIONAL. sdkOptionsOf only runs
      // when a definition exists, so composing the stamp only in there would have
      // left ad-hoc runs — the ones adoption could not place — as the single
      // session kind that never hears its tools exist. Same rule as the worklist:
      // merged AFTER the definition's options so a definition cannot drop it.
      systemPrompt: agent?.def?.prompt
        ? `${agent.def.prompt}\n\n${STAMP}`
        : { type: "preset", preset: "claude_code", append: STAMP },
      // EVERY session gets the worklist — it is harness state, not a capability
      // that touches the repo, so nothing is gained by withholding it. Merged
      // AFTER the definition's options so a definition cannot drop it by accident.
      // …and the definition's OWN servers ride alongside rather than being
      // overwritten: spreading the mapped record first and the worklist second
      // keeps "never negotiable" true for the worklist without making it the only
      // server an agent may have. A definition naming a server called "worklist"
      // still loses to ours, deliberately.
      mcpServers: {
        ...(agent ? sdkOptionsOf(agent.def).mcpServers : {}),
        [worklist.SERVER]: worklistServer,
        // Same reasoning as the worklist: every agent should be able to ASK what it can
        // do rather than be told. Withholding discovery buys nothing — it exposes no new
        // reach, it only makes the reach an agent already has findable.
        [discovery.SERVER]: discoveryServer,
        [services.SERVER]: servicesServer,
        [context.SERVER]: contextServer,
      },
      canUseTool: (tool, input) =>
        new Promise((resolve) => {
          const id = `perm-${++s.permissionSeq}`;
          s.pendingPermissions.set(id, { resolve, input });
          emit(s, {
            kind: "permission.request",
            id,
            title: toolSummary(tool, input),
            detail: tool,
            input,
            options: ["allow", "deny"],
          });
        }),
    },
  });

  // A resume CONTINUES the transcript but replays nothing — so the substrate seeds
  // the history itself, and every surface opens with the conversation ON SCREEN.
  s.resumedFrom = remembered || null;
  if (remembered) {
    for (const msg of transcriptMessages(cwd, remembered, { limit: 140 })) {
      msg.replay = true;
      msg.sessionId = s.sessionId; msg.projectCode = s.projectCode;
      msg.cwd = s.cwd; msg.worktree = s.cwd;
      if (!msg.ts) msg.ts = 0;
      s.events.push(msg);
    }
  }

  sessions.set(key, s);
  startWatcher(s);
  pump(s);
  return s;
}

function get(key) {
  const s = sessions.get(key);
  if (!s) throw new Error(`no agent session ${key}`);
  return s;
}

function send(key, text) {
  const s = get(key);
  // echoed into the feed so history carries BOTH sides — a late-attaching view
  // (or another window) can replay the whole conversation, not just the answers
  emit(s, { kind: "user.prompt", text });
  s.input.push({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: "",
  });
}

function answerPermission(key, id, allow, message) {
  const s = get(key);
  const pending = s.pendingPermissions.get(id);
  if (!pending) return false;
  s.pendingPermissions.delete(id);
  pending.resolve(
    allow
      ? { behavior: "allow", updatedInput: pending.input }
      : { behavior: "deny", message: message || "denied by user" }
  );
  return true;
}

const interrupt = (key) => get(key).query.interrupt();

// Model switching — a real SDK primitive (verified by experiment 2026-08-24), not
// a slash command. supportedModels() is the menu: the SDK owns the list, so no
// panel hardcodes one. setModel is a REQUEST — truth arrives on the next turn's
// re-init (another session.started, same sdk id = update, the compaction
// convention) and on every assistant message's own `model` stamp.
const models = (key) => get(key).query.supportedModels();
const setModel = async (key, model) => { await get(key).query.setModel(model); return true; };

function subscribe(key, cb) {
  const s = get(key);
  s.subs.add(cb);
  return () => s.subs.delete(cb);
}

const history = (key) => get(key).events.slice();

async function kill(key) {
  const s = sessions.get(key);
  if (!s) {
    // not running — still forget the sticky record so a dead conversation can be dismissed
    saveStore((store) => { delete store[key]; });
    return false;
  }
  try { s.input.end(); await s.query.interrupt(); } catch {}
  try { s.watcher?.close(); } catch {}
  saveStore((store) => { delete store[key]; }); // kill = the deliberate forget
  emit(s, { kind: "session.ended", reason: "interrupted" });
  sessions.delete(key);
  return true;
}

// USED BY — which APPLICATION in this browser is using the agent. Distinct from
// cwd (where it runs) and from projectCode (whose code it works on): an agent can
// run on the autobot repo while being USED by SystemView. His correction, and it
// is the thing the panel most needed to say. A set, because a session can be
// opened by several surfaces over its life and the last one to ask is not the
// only truth.
function noteUsedBy(key, surface) {
  const s = sessions.get(key);
  if (!s || !surface || !surface.id) return;
  s.usedBy = s.usedBy || [];
  if (!s.usedBy.some((u) => u.id === surface.id)) {
    s.usedBy.push({ id: surface.id, title: surface.title, kind: surface.kind });
    saveStore((store) => { if (store[key]) store[key].usedBy = s.usedBy; });
    emit(s, { kind: "status", status: "used-by", usedBy: s.usedBy });
  }
}

const list = () =>
  [...sessions.values()].map((s) => ({
    key: s.key,
    projectCode: s.projectCode,
    sessionId: s.sessionId,
    cwd: s.cwd,
    sdkSessionId: s.sdkSessionId,
    permissionMode: s.permissionMode,
    agentId: s.agentId,
    agentName: s.agentName,
    capabilities: s.capabilities || null,   // null = not started yet, NOT "has nothing"
    usedBy: s.usedBy || [],                 // which applications are using this agent
    worklist: s.worklist || [],
    startedAt: s.startedAt,
  }));

// The conversations that already exist on disk for a directory — the claude CLI
// stores each session at ~/.claude/projects/<cwd with / → -> as <sessionId>.jsonl.
// This is what makes transfer a CLICK: pick one, open({resume: sessionId, cwd}) and
// it is the SAME conversation continuing here. ~/.claude sits outside every project
// root (the files API rightly refuses it), so it gets its own read-only call.
// The conversation itself, read from the transcript file — newest last. Tail-read
// only (these files reach GBs): the last few MB hold far more than any panel shows.
// Returns simplified messages the RFC-048 renderers already know how to draw.
function transcriptMessages(cwd, sessionId, { limit = 50 } = {}) {
  const file = path.join(os.homedir(), ".claude", "projects", cwd.replace(/\//g, "-"), `${sessionId}.jsonl`);
  let fd, size;
  try { fd = fs.openSync(file, "r"); size = fs.fstatSync(fd).size; } catch { return []; }
  const want = Math.min(size, 4 * 1024 * 1024);
  const buf = Buffer.alloc(want);
  fs.readSync(fd, buf, 0, want, size - want);
  fs.closeSync(fd);
  let lines = buf.toString("utf8").split("\n");
  if (want < size) lines = lines.slice(1); // first line is a partial record
  const out = [];
  let lastUsage = null; // declared HERE — an implicit global leaked one session's meter into another

  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    // Subagent (sidechain) records live in the same transcript. Their usage/model
    // must NEVER rule the meter (a haiku subagent's window shrank the ruler 5× and
    // flared the meter to "due" on every attach), and their chatter isn't the
    // conversation — skip the whole record.
    if (rec.isSidechain) continue;
    const ts = Date.parse(rec.timestamp) || undefined;
    if (rec.type === "user") {
      const c = rec.message?.content;
      if (typeof c === "string") {
        if (c && !c.trimStart().startsWith("<")) out.push({ kind: "user.prompt", text: c, ts });
      } else if (Array.isArray(c)) {
        for (const b of c) {
          if (b.type === "text" && b.text && !b.text.trimStart().startsWith("<"))
            out.push({ kind: "user.prompt", text: b.text, ts });
          // the work is part of the conversation — results replay too
          else if (b.type === "tool_result")
            out.push({ kind: "tool.result", id: b.tool_use_id, ok: !b.is_error, detail: brief(b.content), ts });
        }
      }
    } else if (rec.type === "system" && rec.subtype === "compact_boundary") {
      // the receipt: compaction is a real event with the harness's own numbers
      // (his 458k → 9k) — never again a mystery whether it worked
      const cm = rec.compactMetadata || {};
      out.push({ kind: "compaction", trigger: cm.trigger, preTokens: cm.preTokens, postTokens: cm.postTokens, ts });
    } else if (rec.type === "assistant") {
      // the meter reads from here — EVERY conversation's context fill is in its
      // transcript, so every conversation gets the bar, not just live ones.
      // model rides along: it names the real context window (fable = 1M).
      const u = rec.message?.usage;
      if (u) lastUsage = {
        kind: "usage",
        model: rec.message?.model,
        contextTokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        contextWindow: contextWindowOf(rec.message?.model),
        ts,
      };
      for (const b of rec.message?.content || []) {
        if (b.type === "text" && b.text) out.push({ kind: "assistant.text", done: true, delta: "", text: b.text, ts });
        else if (b.type === "thinking" && b.thinking) out.push({ kind: "assistant.thinking", done: true, delta: "", text: b.thinking, ts });
        else if (b.type === "tool_use")
          out.push({ kind: "tool.call", id: b.id, name: b.name, summary: toolSummary(b.name, b.input), input: b.input, ts });
      }
    }
  }
  const tail = out.slice(-limit);
  if (lastUsage) tail.push(lastUsage);
  return tail;
}

// Dismissed conversations: a LIST decision, not a delete — the transcript on disk
// is Claude Code's own history and stays untouched. ~/.autobot/agents-dismissed.json
// is a flat map "projectCode:sessionId" -> dismissedAt (his ask 2026-08-24: "I need
// to be able to delete sessions I'm not using anymore").
const DISMISSED_FILE = path.join(os.homedir(), ".autobot", "agents-dismissed.json");
const readDismissed = () => {
  try { return JSON.parse(fs.readFileSync(DISMISSED_FILE, "utf8")); } catch { return {}; }
};
function dismissTranscript(projectCode, sessionId) {
  const map = readDismissed();
  map[`${projectCode}:${sessionId}`] = Date.now();
  fs.mkdirSync(path.dirname(DISMISSED_FILE), { recursive: true });
  fs.writeFileSync(DISMISSED_FILE, JSON.stringify(map, null, 2));
  return true;
}

function transcriptsFor(cwd, projectCode) {
  const dir = path.join(os.homedir(), ".claude", "projects", cwd.replace(/\//g, "-"));
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const dismissed = readDismissed();
  const out = [];
  for (const name of entries) {
    // top-level sessions only — agent-*.jsonl are subagent transcripts
    if (!/^[0-9a-f-]{36}\.jsonl$/.test(name)) continue;
    if (projectCode && dismissed[`${projectCode}:${name.slice(0, -6)}`]) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    // "what it's about": the summary record if the file starts with one, else the
    // first user message — read only the head, these files can be GBs
    let about = "";
    let fallback = "";
    try {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      let textAbout = "";
      let title = "";
      const scan = (chunk) => {
        for (const line of chunk.split("\n")) {
          try {
            const rec = JSON.parse(line);
            // the newest ai-title IS the tab name he recognizes — titles are
            // rewritten as the conversation goes on, so the last one wins
            // (evidence: 1.5GB transcript, 10 ai-titles, 0 summary records)
            if (rec.type === "ai-title" && rec.aiTitle) title = rec.aiTitle;
            else if (rec.type === "summary" && rec.summary && !title) title = rec.summary;
            else if (rec.type === "user" && !textAbout) {
              const c = rec.message?.content;
              const text = typeof c === "string" ? c : Array.isArray(c) ? c.find((b) => b.type === "text")?.text : "";
              if (text && !text.trimStart().startsWith("<")) textAbout = text;
              else if (text && !fallback) fallback = text.replace(/<[^>]*>/g, " ");
            }
          } catch {} // partial boundary lines — fine
        }
      };
      scan(buf.toString("utf8", 0, n));
      if (st.size > n) {
        // titles live near the END of a long file — scan the tail too, its last wins
        const tail = Buffer.alloc(Math.min(st.size - n, 256 * 1024));
        const fd2 = fs.openSync(file, "r");
        const tn = fs.readSync(fd2, tail, 0, tail.length, st.size - tail.length);
        fs.closeSync(fd2);
        scan(tail.toString("utf8", 0, tn));
      }
      about = title || textAbout;
    } catch {}
    out.push({
      sessionId: name.slice(0, -6),
      lastActive: st.mtimeMs,
      sizeBytes: st.size,
      about: (about || fallback).replace(/\s+/g, " ").trim().slice(0, 140),
    });
  }
  return out.sort((a, b) => b.lastActive - a.lastActive).slice(0, 50);
}

module.exports = {
  purgeAgent, agentRuns,
  open, send, answerPermission, interrupt, models, setModel, subscribe, history, kill, list, keyOf, noteUsedBy,
  transcriptsFor, transcriptMessages, dismissTranscript, toolSummary,
  // ONE READER FOR THE RUN STORE. host.cjs and files-host.cjs each opened this
  // file by path; with the name changing, a missed caller reads an empty object
  // and silently reports no resumable sessions — the same "both halves moved,
  // nothing left answering" shape that cost the blank-code-panel hour. Anyone
  // who needs the store takes it from here, so the rename is one edit forever.
  loadSessionStore: loadStore,
  saveSessionStore: saveStore,
};
