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
const hooks = require("./hooks.cjs");
const worklist = require("./worklist.cjs");
const context = require("./context.cjs");
const discovery = require("./discovery.cjs");
const services = require("./services.cjs");
const systemview = require("./systemview.cjs");

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

// THE SYSTEM CONTEXT — the one definition EVERY agent gets (his design, the defining-agents
// draft): presence says WHERE you are, this says HOW TO BE — context is retrieved not memorized,
// the store is yours to keep clean, the room rules. Same mold as presence deliberately: one file
// he edits, read at open, injected for every agent, so there are no copies and nothing to drift.
// It rides the same composition as presence, so it re-arrives after compaction the same way.
const SYSTEM_CONTEXT_FILE = path.join(os.homedir(), ".autobot", "system-context.md");
function systemContext() {
  try {
    const t = fs.readFileSync(SYSTEM_CONTEXT_FILE, "utf8").trim();
    return t ? t + "\n\n" : "";
  } catch {
    return "";
  }
}

// STALENESS, ASKED CHEAPLY. A session's system prompt is built from exactly three inputs:
// presence, the system context, and the agent's own definition file. Edit any of them and
// every RUNNING session is wearing an old composition — true, invisible, and until now
// undetectable from the outside. This is the fingerprint that makes it visible.
//
// MTIMES, NOT CONTENT. `list()` is polled by the panel, so this sits on a hot path, and a
// synchronous read-and-hash per call per session is precisely the shape that put the app at
// 154% CPU and jammed the main process on 2026-09-12. Three stat calls answer the only
// question being asked — "has anything it was built from been touched since?" — and a
// touched-but-identical file costing one offered re-init is a trade worth making.
function compositionOf(agentId, cwd) {
  const t = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  // KEYED BY THE NAME A HUMAN READS, not an anonymous list. "presence, the system context or this
  // doc changed" is three guesses in a trench coat; naming the file that actually moved is the
  // difference between a notice and information, and the data was already here to say it.
  const parts = {
    Presence: t(PRESENCE_FILE),
    "System context": t(SYSTEM_CONTEXT_FILE),
  };
  if (agentId) parts["Agent doc"] = t(path.join(definitions.DIR, `${agentId}.json`));
  // AND THE CLAUDE.md STACK — his catch. It is composed into a session at open exactly like the
  // rest, by Claude Code rather than by us, which is precisely why it was missed: the fingerprint
  // only knew the files THIS file writes. An edit to CLAUDE.md would have left the page saying
  // "up to date" over an agent still wearing the old one. The stack is asked of definitions, the
  // one place that knows what it is, so adding a file to it never needs a second edit here.
  try {
    for (const d of Object.values(definitions.docPaths({ cwd }))) parts[d.label] = t(d.path);
  } catch {}
  return parts;
}

// WHICH inputs moved since this session opened — [] when nothing did. The comparison is per-key
// so a session that opened before a key existed (an agent adopted mid-life, a CLAUDE.md created
// later) reads as changed for that key alone rather than as wholesale staleness.
function staleParts(s) {
  const now = compositionOf(s.agentId, s.cwd);
  const was = s.composition || {};
  return Object.keys(now).filter((k) => (was[k] || 0) !== now[k]);
}

const STAMP =
  "SHARED MEMORY. This harness carries context across sessions and agents:\n" +
  `- \`${context.TOOL_NAMES[1]}\` — search what has already been learned (conventions, corrections, ` +
  "project facts, prior lessons) BEFORE deriving or guessing. An empty answer means nothing matches; proceed.\n" +
  `- \`${context.TOOL_NAMES[0]}\` — write one small note the moment you learn something a future ` +
  "session would otherwise rediscover: a correction from the user, a convention, a gotcha, what a command really does.\n" +
  `- \`${worklist.TOOL_NAME}\` — your plan for multi-step work; send the whole list every time.\n` +
  `- \`${worklist.TOOL_READ_NAME}\` — read that plan back. It is harness state, so it survives a ` +
  "compaction the conversation does not: after one, this is where you left off.\n" +
  `- \`${discovery.TOOL_NAME}\` — find a tool by describing what you need, instead of assuming none exists.`;

// WHAT AN AGENT PAYS EVERY TURN. The store's numbers answer "is this note earning its place";
// these layers are never retrieved, so frequency means nothing for them and SIZE is the whole
// story. Presence, the system context, the agent's own doc and the CLAUDE.md stack are composed
// into the system prompt at open and charged on every single turn for the life of the session —
// which makes a paragraph nobody needed the most expensive kind of writing in the system.
//
// Tokens are ESTIMATED at ~4 chars each, and reported as an estimate. The exact count is a
// tokenizer call per layer per agent on a surface that gets polled; the decision this informs
// ("is this doc too long?") does not change between 1,180 and 1,240.
function weights(agentId, cwd) {
  const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const layers = [
    { key: "presence", label: "Presence", scope: "every agent", path: PRESENCE_FILE },
    { key: "system-context", label: "System context", scope: "every agent", path: SYSTEM_CONTEXT_FILE },
  ];
  // MEASURE WHAT IS INJECTED, NOT THE FILE THAT HOLDS IT. The definition's json carries tools,
  // mcp servers, placement and gating — none of which reach the model. Only `def.prompt` does.
  // Sizing the file made the agent doc look like the heaviest layer in the system, which is the
  // one number here most likely to make someone delete good writing.
  let docBytes = 0;
  if (agentId) {
    try { docBytes = Buffer.byteLength(String((definitions.resolve(agentId)?.def || {}).prompt || ""), "utf8"); } catch {}
    layers.push({ key: "agent-doc", label: "Agent doc", scope: "this agent", path: null, bytes: docBytes });
  }
  try {
    for (const [key, d] of Object.entries(definitions.docPaths({ cwd })))
      layers.push({ key, label: d.label, scope: "this placement", path: d.path });
  } catch {}
  const rows = layers.map((l) => {
    const bytes = l.bytes != null ? l.bytes : sizeOf(l.path);
    return { ...l, bytes, tokens: Math.round(bytes / 4), missing: !bytes };
  });
  // The stamp is composed in code rather than read from a file, so it has no path — but it is
  // paid exactly like the rest and hiding it would understate the total.
  rows.push({ key: "stamp", label: "Shared-memory stamp", scope: "every agent", path: null, bytes: STAMP.length, tokens: Math.round(STAMP.length / 4), missing: false });
  return { rows, totalTokens: rows.reduce((a, r) => a + r.tokens, 0) };
}

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
  const stamped = presence() + systemContext() + STAMP;
  o.systemPrompt = def.prompt
    ? `${def.prompt}\n\n${stamped}`
    : { type: "preset", preset: "claude_code", append: stamped };
  // A definition that PINS `tools` would otherwise drop the worklist without
  // saying so — the agent keeps working and quietly stops being able to plan.
  // The worklist is harness state, so it is always appended, never negotiable.
  if (def.tools?.length)
    o.allowedTools = [...def.tools, ...worklist.TOOL_NAMES, discovery.TOOL_NAME, ...services.TOOL_NAMES, ...context.TOOL_NAMES];
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

// HOOKS FIRE FROM emit(), AND THAT IS THE WHOLE DESIGN, NOT A SHORTCUT. Hook points are the
// events the system already announces — we do not invent injection sites, because a private
// injection call bolted into a handler buys one hook and no visibility, where an emitted event
// buys a hook AND a row in the feed. Putting the call here means every moment this harness
// announces is hookable the day it is announced, and a future moment (a browser event, a webhook)
// becomes hookable by being emitted, with nothing to wire.
//
// It also puts a predicate on the hottest path in the process, which is the thing that went wrong
// on 2026-09-12 — so the cheap exits are the point: streaming deltas never even reach the index,
// and the index itself is a Map keyed by event name that only rebuilds when the hooks directory's
// mtime moves. With nothing wired this is one lookup on an empty Map.
function fireHooks(s, event) {
  // A token at a time is not a moment. Deltas are the highest-frequency events in the system and
  // nothing meaningful can key off half a sentence — the settled event carries the same text.
  if ((event.kind === "assistant.text" || event.kind === "assistant.thinking") && event.done !== true) return;
  let hits = [];
  try {
    hits = hooks.fire(event, {
      agentId: s.agentId,
      projectCode: s.projectCode,
      // `every-agent` is conservative by default (see hooks.inScope): an agent carries a shared
      // hook the way it carries a skill, so nothing acquires one it never opted into.
      carries: s.carriesHooks || [],
      fired: s.hooksFired,
    });
  } catch {}
  for (const h of hits) {
    // THE POINTER RIDES THE INPUT QUEUE, exactly like a cross-session message: it is a turn that
    // arrived from outside, not words the human typed, and the wrapper is what lets both the pump
    // and the feed tell those apart.
    try {
      s.input.push({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: hooks.pointerText(h, event) }] },
        parent_tool_use_id: null,
        session_id: "",
      });
    } catch {}
    // THE RECEIPT. A hook fires without anyone asking, which makes it the easiest thing in this
    // system to get wrong invisibly — so it is never silent. `fire()` refuses to match on
    // `hook.fired`, so this emit cannot loop back around.
    emit(s, { kind: "hook.fired", name: h.name, on: event.kind, to: h.do, hookKind: h.kind, note: h.note || "" });
    logLife(s, `hook fired: ${h.name} on ${event.kind} -> ${h.do || "(no target)"}`);
  }
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
  fireHooks(s, event);
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
    case worklist.TOOL_READ_NAME: return "reading the worklist";
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
// THE EVENT VOCABULARY, NAMED ONCE — RFC-048's list, as data rather than as a comment.
//
// It exists because of hooks: "adding a hook pops a list of events to attach to, GENERATED from
// the vocabulary, never typed" — you can only hook something the system actually announces. Which
// gives the principle the whole design rests on: OBSERVABILITY AND HOOKABILITY ARE THE SAME
// SURFACE. If a moment is announced well enough to draw a row in the feed, it can be hooked; if it
// is not announced, the fix is to emit the event — which we wanted anyway — never to bolt a
// private injection site into some handler where nobody can see it.
//
// `fields` are the paths a hook's `when` clause can match on, so the editor can offer them instead
// of asking a human to guess the payload shape.
//
// KEEPING IT HONEST: this must stay level with what is actually emitted. The check is one line —
//   grep -o 'kind: "[a-z.]*"' electron/agents/sessions.cjs | sort -u
// — and every name it prints should appear below. A kind that is emitted but missing here is a
// moment you cannot hook; a name here that is never emitted is a hook that can never fire.
const EVENTS = [
  { name: "session.started", what: "a session opened (or re-opened) and the SDK reported in", fields: ["model"] },
  { name: "session.reinit", what: "the session was re-initialized on current docs", fields: ["resumedFrom", "agentId"] },
  { name: "session.ended", what: "the session finished or was interrupted", fields: ["reason"] },
  { name: "user.prompt", what: "a turn arrived from the human (or a visiting agent)", fields: ["text"] },
  { name: "assistant.text", what: "the agent spoke", fields: ["text", "done"] },
  { name: "assistant.thinking", what: "the agent thought out loud", fields: ["text", "done"] },
  { name: "tool.call", what: "the agent called a tool", fields: ["tool", "summary", "input.command", "input.file_path"] },
  { name: "tool.result", what: "a tool answered", fields: ["tool", "ok", "output"] },
  { name: "file.changed", what: "a file under the session's cwd changed", fields: ["path"] },
  { name: "permission.request", what: "the agent asked before acting", fields: ["title", "detail"] },
  { name: "usage", what: "token usage was reported — fires at the END of a turn, a safe place to hook", fields: ["pct", "contextTokens", "contextWindow", "inputTokens", "outputTokens"] },
  { name: "compaction.after", what: "a compaction finished — the summary is in place and the reasoning behind it is gone", fields: ["trigger", "preTokens", "postTokens"] },
  { name: "todo.updated", what: "the worklist changed", fields: [] },
  { name: "message.landed", what: "a cross-session message arrived", fields: ["from", "text"] },
  { name: "status", what: "the session narrated its own state", fields: ["status"] },
  // NOT LISTED: `hook.fired`. It is emitted (the receipt every hook writes to the feed) but it is
  // deliberately not hookable — a hook on it would deliver a pointer, which writes a receipt,
  // which fires the hook, at input-queue speed. hooks.fire() refuses the kind; leaving it out of
  // the picker means nobody is offered the loop in the first place.
];

const HARNESS_MCP = /^mcp__(context|discovery|systemlynx|systemview)__/;
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
        // NAMED `compaction.after` BECAUSE THAT IS WHEN IT IS. `compact_boundary` is a RECEIPT —
        // the SDK sends it once the compaction has already happened — so anything a hook injects
        // here lands in the conversation that exists on the far side, not in the one that was just
        // summarized away. That was already true, and it was true by ACCIDENT of ordering: the
        // event was called `compaction`, which reads like "while it happens", and the next person
        // to move a line would have had nothing telling them the timing mattered. It matters
        // completely: this is the moment an agent holds a summary instead of the reasoning, which
        // is the whole reason to point it at retrieval. (Its twin, `compaction.before`, will be a
        // different event emitted where the harness HOLDS the trigger — not a flag on this one.)
        emit(s, {
          kind: "compaction.after",
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
          {
            // PERCENTAGE IS EMITTED, NOT COMPUTED BY WHOEVER READS IT. A hook's `when` compares one
            // field to a constant, so a threshold on raw tokens silently means something different
            // on a 200k model than on a 1M one — the same hook firing at a quarter of the window in
            // one session and past the point of no return in another. The window is known right
            // here; the ratio belongs here too. Same rule as every other hook point: emit the fact.
            const win = contextWindowOf(s.model || m.message.model);
            emit(s, {
              kind: "usage",
              snapshot: true,
              contextTokens: s.lastCtxSnapshot,
              contextWindow: win,
              pct: win ? Math.round((s.lastCtxSnapshot / win) * 100) : null,
            });
          }
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
        // MESSAGE LANDING IS VISIBLE (RFC-056, his requirement: "I can see when you send, I
        // can't see when it lands"). A cross-session message arrives as an injected user turn
        // wrapped in <cross-session-message from="…">; surfacing it here puts the RECEIPT in the
        // receiving agent's feed — traceability on both ends, not just the sender's tool call.
        {
          const texts = Array.isArray(content)
            ? content.filter((b) => b.type === "text").map((b) => b.text || "")
            : typeof content === "string"
            ? [content]
            : [];
          for (const tx of texts) {
            const cm = /<cross-session-message from="([^"]*)"(?:\s+from-name="([^"]*)")?/.exec(tx);
            if (cm) emit(s, { kind: "message.landed", from: cm[2] || cm[1], preview: tx.replace(/<[^>]*>/g, " ").trim().slice(0, 140) });
          }
        }
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
          // See the snapshot site: the ratio is emitted, never left to the reader. THIS is the
          // one a threshold hook should watch — `result` fires at the END of a turn, a natural
          // boundary, so a hook here can never take a turn away from what was being worked on.
          pct: contextWindowOf(s.model) && s.lastCtxSnapshot
            ? Math.round((s.lastCtxSnapshot / contextWindowOf(s.model)) * 100)
            : null,
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
    // DELETE ONLY IF THIS IS STILL THE SESSION AT THAT KEY. A key names a SLOT; this pump belongs
    // to one particular session OBJECT, and re-init deliberately puts a second one in the same
    // slot. The old pump drains a beat later (its input was ended, the iterator finishes, "ended:
    // done"), and an unguarded delete-by-key then evicted the LIVE session ~200ms after it opened:
    // sends threw into nothing, the panel cooked forever, the typed messages were never in any
    // history. Identity, not name — the same trap as any other "which path resolves this value"
    // question, here with two objects legitimately sharing one address.
    if (sessions.get(s.key) === s) sessions.delete(s.key);
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
    // The composition this session OPENED under — compared against the live one to answer
    // "is this agent still wearing the definition on disk?" without re-reading anything.
    // Hook guards are per SESSION — once-per-session must mean this session, and a cooldown must
    // not leak into the next one. Created here so it can never be shared by accident.
    hooksFired: new Map(),
    carriesHooks: (agent && Array.isArray(agent.def && agent.def.hooks) ? agent.def.hooks : []),
    composition: compositionOf(agent ? agent.id : null, cwd),
    // WHAT WAS ASKED FOR, not what came back. `s.model` is overwritten at init with the
    // SDK's RESOLVED id, and re-init has to replay the request — feeding a resolved id
    // back in would quietly pin an agent whose definition says "follow the default".
    requestedModel: model || null,
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
  }, () => s.worklist);

  // DISCOVERY — one tool that finds the others (RFC-055, his design). Built from the
  // definition's OWN mcpServers record, so it can never describe a server this agent is
  // not actually wired to: the thing doing the connecting is the thing reporting the
  // connection, which is the presence principle applied one layer down.
  const wiredMcp = agent ? sdkOptionsOf(agent.def).mcpServers : null;
  const discoveryServer = discovery.serverFor(wiredMcp);
  // The third tier: SystemLynx services he has whitelisted, attachable mid-session. Identity
  // rides in (RFC-056): per-agent call sessions — each agent's sign-in cookies are its own.
  const servicesServer = services.serverFor({ projectCode, slot: agent ? agent.id : null });

  // CONTEXT — shared memory across sessions and agents (RFC-055). Identity is
  // CLOSED OVER here and never taken from tool arguments: `slot` is the agent
  // DEFINITION id, so a note filed to agent scope follows the slot across
  // re-clones and cannot be misfiled by a model inventing a name. An ad-hoc run
  // with no definition has no slot — it gets system (and project when known) and
  // no agent scope at all, which is the honest degradation: an anonymous session
  // has no slot to inherit from or write to.
  const contextServer = context.serverFor({ projectCode, slot: agent ? agent.id : null });

  // SYSTEMVIEW — the agent face of the hub (RFC-056): tests, probe-grade calls, logs, stats, the
  // TV, the window-driving verbs — as tools with THIS session's identity, replacing the CLI door.
  const systemviewServer = systemview.serverFor({ projectCode, slot: agent ? agent.id : null });

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
      //
      // AND IT RUNS FOR EVERY SESSION, DEFINITION OR NOT. It used to be guarded by
      // `agent ?`, with a second `systemPrompt:` key below it to cover ad-hoc runs —
      // and that key, being LATER in the literal, won. So the composed prompt
      // sdkOptionsOf builds (presence + system context + stamp) was overwritten by a
      // stamp-only copy on every single session, definition or not: the two layers we
      // spent a day writing reached nobody, silently, while the files on disk looked
      // perfect and the code read as if it worked. `sdkOptionsOf({})` already handles
      // the no-definition case — preset plus the same composition — so there is one
      // place that composes a system prompt and no second copy to drift.
      ...sdkOptionsOf(agent ? agent.def : {}),
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
        [systemview.SERVER]: systemviewServer,
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
  // THE PUMP'S PROMISE IS KEPT. Nothing awaits a session's lifetime — but re-init has to know
  // when the OLD one is actually over, because the next one resumes the same sdk session id and
  // two `claude` processes on one transcript is not a race we get to win. Fire-and-forget was
  // fine while the only way a session ended was the user ending it.
  s.pumping = pump(s);
  return s;
}

function get(key) {
  const s = sessions.get(key);
  if (!s) throw new Error(`no agent session ${key}`);
  return s;
}

// IMAGES RIDE THE SAME TURN AS THE WORDS. A message is content BLOCKS, not a string — it always
// was at the API, we were just hard-coding one text block and throwing the rest of the shape away.
// Each picture arrives as { name, mime, data (base64, no data: prefix), thumb (small data URL) }.
//
// THE FULL BYTES GO TO THE MODEL; THE THUMB GOES TO THE RECORD. The event feeds every attached
// view and is kept in history, and a few screenshots at full size would put megabytes of base64 in
// a list bounded by COUNT, not by weight. The renderer downsizes once, on the way in, and the two
// halves part company here: `data` is sent, `thumb` is remembered.
//
// Images come BEFORE the text in the block list — Anthropic's own guidance, and it reads right:
// the picture is what you are pointing at, the sentence is what you are saying about it.
function send(key, text, images = []) {
  const s = get(key);
  const pics = (Array.isArray(images) ? images : []).filter((im) => im && im.data && im.mime);
  // echoed into the feed so history carries BOTH sides — a late-attaching view
  // (or another window) can replay the whole conversation, not just the answers
  emit(s, {
    kind: "user.prompt",
    text,
    images: pics.map((im) => ({ name: im.name || "image", mime: im.mime, thumb: im.thumb || "" })),
  });
  const content = [
    ...pics.map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.mime, data: im.data },
    })),
    // A picture with no caption is a whole message — do not invent words for it, and do not send
    // an empty text block, which the API rejects.
    ...(String(text || "").trim() ? [{ type: "text", text }] : []),
  ];
  if (!content.length) return;
  s.input.push({
    type: "user",
    message: { role: "user", content },
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

// RE-INIT — BECAUSE A SYSTEM PROMPT IS COMPOSED ONCE, AT OPEN, AND THE SDK TOOK IT AT
// QUERY TIME. Editing presence, the system context, or an agent's own doc changes nothing
// for a session already running: it keeps wearing the composition it opened under. And
// compaction is no help — compaction rewrites the CONVERSATION, not the prompt. That is
// exactly the property that makes the prompt survive a boundary, and exactly the property
// that makes it unreachable. The only way a live agent picks up an edited definition is to
// be opened again.
//
// SO: tear the query down and open the SAME key against the SAME sdk session id. `resume`
// continues the transcript; the options are rebuilt from scratch, which is the whole point.
// It is NOT a kill — kill is the deliberate forget and drops the sticky record, which would
// strand the conversation. The record is what we come back as.
//
// NEVER AUTOMATIC. Saving presence.md makes every live session stale at once, and yanking
// a session out from under a turn to fix a paragraph is a worse bug than the stale paragraph.
// Staleness is SHOWN (see compositionOf/list); the re-init is a press, like a commit.
async function reinit(key) {
  const s = sessions.get(key);
  if (!s) throw new Error(`no agent session ${key}`);
  const resume = s.sdkSessionId || loadStore()[key]?.sdkSessionId || undefined;
  const { projectCode, sessionId, cwd, requestedModel, permissionMode, agentId } = s;
  try { s.input.end(); await s.query.interrupt(); } catch {}
  try { s.watcher?.close(); } catch {}
  // WAIT FOR THE OLD ONE TO ACTUALLY BE OVER. Ending the input makes the iterator finish, but not
  // instantly — measured at ~226ms — and the replacement resumes the SAME sdk session id, so an
  // overlap means two processes holding one transcript. The first build did not wait: the new
  // session opened 226ms before the old one exited and then hung for ten minutes, producing no
  // init and no error. Bounded, because a pump that refuses to end must not take the re-init
  // down with it — better a rare overlap than a button that never returns.
  try {
    await Promise.race([s.pumping, new Promise((r) => setTimeout(r, 5000))]);
  } catch {}
  // Identity, not name: the old pump's own cleanup is guarded the same way (see pump's finally),
  // because for a beat two session objects legitimately answer to one key.
  if (sessions.get(key) === s) sessions.delete(key);
  const next = await open({
    projectCode, sessionId, cwd, agentId, permissionMode,
    model: requestedModel || undefined,
    resume,
  });
  logLife(next, `reinit: resumed ${resume || "(none)"}`);
  // The receipt is NOT emitted here — see announceReinit. Nothing is listening yet at this
  // instant, by construction, because the host unwired the views before calling this.
  next.reinitFrom = resume || null;
  return next;
}

// THE RECEIPT IS PART OF THE RECORD, not a toast that disappears. A re-init changes what an agent
// IS mid-conversation; six turns later the only honest way to read the transcript is to see where
// that happened — same reasoning that earned the compaction boundary its own line.
//
// SEPARATE FROM reinit() BECAUSE OF WHO IS LISTENING. The host unwires every view, re-inits, then
// rewires — so an emit inside reinit lands in the new session's stored history with an empty
// subscriber set, and the panel you are actually watching never sees it. True in the record,
// invisible on screen, which is the worst of both. The host calls this once the views are back.
function announceReinit(key) {
  const s = sessions.get(key);
  if (!s) return;
  emit(s, { kind: "session.reinit", resumedFrom: s.reinitFrom || null, agentId: s.agentId || null });
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
    // STALE = running on an older composition than the files now hold. Shown, never acted on:
    // re-init is a press (see reinit), because restarting an agent mid-turn to pick up a
    // paragraph is worse than the paragraph being late.
    staleParts: staleParts(s),   // the NAMES that moved — the panel says which, not "something"
    stale: staleParts(s).length > 0,
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
  const callNames = new Map(); // tool_use id -> name, so a replayed result gets the same budget the live pump gave it

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
            out.push({ kind: "tool.result", id: b.tool_use_id, ok: !b.is_error, detail: brief(b.content, resultBudget(callNames.get(b.tool_use_id))), ts });
        }
      }
    } else if (rec.type === "system" && rec.subtype === "compact_boundary") {
      // the receipt: compaction is a real event with the harness's own numbers
      // (his 458k → 9k) — never again a mystery whether it worked
      const cm = rec.compactMetadata || {};
      out.push({ kind: "compaction.after", trigger: cm.trigger, preTokens: cm.preTokens, postTokens: cm.postTokens, ts });
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
        else if (b.type === "tool_use") {
          callNames.set(b.id, b.name);
          out.push({ kind: "tool.call", id: b.id, name: b.name, summary: toolSummary(b.name, b.input), input: b.input, ts });
        }
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
  open, send, answerPermission, interrupt, models, setModel, subscribe, history, kill, reinit, announceReinit, list, keyOf, noteUsedBy,
  transcriptsFor, transcriptMessages, dismissTranscript, toolSummary,
  // ONE READER FOR THE RUN STORE. host.cjs and files-host.cjs each opened this
  // file by path; with the name changing, a missed caller reads an empty object
  // and silently reports no resumable sessions — the same "both halves moved,
  // nothing left answering" shape that cost the blank-code-panel hour. Anyone
  // who needs the store takes it from here, so the rename is one edit forever.
  EVENTS,
  weights,
  loadSessionStore: loadStore,
  saveSessionStore: saveStore,
};
