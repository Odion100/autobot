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

// WHICH REPO HOLDS A LANE'S BRANCH — and the answer is not always the session's own folder.
//
// The work here is full-stack and coupled across repos: a SystemView change routinely needs
// autobot's `electron/`, so the branch for that half is cut in autobot while the session's cwd is
// systemview. The lane guard below used to run `git rev-parse` against `s.cwd` and nothing else,
// which made every such lane UNREGISTERABLE — and the refusal it printed named the branch and the
// fix as though the fix were one command away, when no command could satisfy it. A proactive run
// hit exactly that on 2026-10-13: branch cut in autobot, registration refused from a systemview
// session, so the work could not be handed over at all.
//
// The session's own folder is tried FIRST — that is the common case and it costs one spawn. The
// registry's other roots are only consulted when that misses, and the holder is returned rather
// than a boolean so a caller can say WHERE the branch lives instead of only that it exists.
const { buildUpdate } = require("../apps/documentUpdate.cjs");
const documents = require("../markdown/registry.cjs");
const docFires = require("../markdown/fires.cjs");
const docWrite = require("../markdown/write.cjs");
const PROJECTS_FILE = () => path.join(require("os").homedir(), ".autobot", "projects.json");
function branchIn(dir, branch) {
  if (!dir || !branch) return false;
  try {
    return (
      require("child_process").spawnSync(
        "git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
        { cwd: dir, encoding: "utf8", timeout: 4000 },
      ).status === 0
    );
  } catch {
    return false;
  }
}
function repoHolding(branch, cwd) {
  if (!branch) return null;
  if (branchIn(cwd, branch)) return cwd;
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(PROJECTS_FILE(), "utf8")) || {};
  } catch {
    return null; // no registry readable — the session's own folder was the whole answer
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  for (const dir of Object.values(map)) {
    if (typeof dir !== "string" || !dir || dir === cwd) continue;
    if (branchIn(dir, branch)) return dir;
  }
  return null;
}

const sessions = new Map(); // key -> session record

// THE LAST QUOTA REPORT the API gave anyone — {status, type, resetsAt(sec)} — cached so ambient
// stamping (fireHooks) can say what the account can afford. Absent until a limit event arrives;
// the API only speaks at limit moments, and inventing a number would be worse than saying nothing.
let lastQuota = null;
function noteQuota(m) {
  const q = m && m.quotaLimits;
  if (!q) return;
  lastQuota = { status: q.status || "", type: q.rateLimitType || "", resetsAt: q.resetsAt || 0 };
}

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
const ledger = require("./ledger.cjs");
const worklist = require("./worklist.cjs");
const nudge = require("./nudge.cjs");
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
// A cheap stable number over the composed fields only. Not a crypto hash — it just has to CHANGE
// when one of these does and not when anything else in the file does, which is all `staleParts`
// compares. Unreadable definition returns 0, the same as a missing file did before.
//
// AND IT IS MEMOISED ON THE FILE'S MTIME, which is not an optimisation — it is the whole reason
// this is allowed to exist. The comment above says a synchronous read-and-hash per call per session
// is "precisely the shape that put the app at 154% CPU and jammed the main process on 2026-09-12",
// and `list()` is polled by the panel while `staleParts(s)` is called TWICE in the same projection.
// The first version of this function did exactly the forbidden thing; the store's own note
// (`the defs dir: sidecars for churn`) warned about it and I did not read it until the maintenance
// pass an hour later.
//
// So the hot path is one stat, as it was before. The read and the hash happen only when the mtime
// has actually moved — which is the only moment the answer could be different. Keyed per agent, and
// a stat failure falls through to a re-read rather than serving a stale number, because being wrong
// about staleness is the one thing this cannot afford.
const COMPOSED_FIELDS = [
  "prompt", "skills", "tools", "disallowedTools",
  "mcpServers", "model", "effort", "thinking", "maxTurns", "background", "memory",
];
const STAMP_CACHE = new Map(); // agentId -> { mtime, stamp }
function composedStamp(agentId) {
  try {
    const file = path.join(definitions.DIR, `${agentId}.json`);
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { return 0; } // no file is no composition
    const hit = STAMP_CACHE.get(agentId);
    if (hit && hit.mtime === mtime) return hit.stamp;
    const rec = definitions.get(agentId);
    const def = (rec && rec.def) || {};
    const shape = COMPOSED_FIELDS.map((k) => `${k}=${JSON.stringify(def[k] === undefined ? null : def[k])}`).join("|");
    let h = 0;
    for (let i = 0; i < shape.length; i += 1) h = (h * 31 + shape.charCodeAt(i)) | 0;
    STAMP_CACHE.set(agentId, { mtime, stamp: h });
    return h;
  } catch {
    return 0;
  }
}

// WHEN THIS SHELL BOOTED — a composition part like any file's mtime, because the shell's own code
// IS part of what a session runs on: its watcher, its doors, its delivery wiring all live in this
// process. A session that outlived the process it opened under is wired to a dead one — measured
// 2026-10-25: a session from before a shell restart wrote a registration leaf with Bash and no row
// landed, because its watcher belonged to the old shell; nothing offered a refresh because nothing
// counted the shell as a thing that changes. His: "I can refresh your session on the agent page
// only when it pops up" — this is what makes it pop up.
const SHELL_BOOT = Date.now();

function compositionOf(agentId, cwd) {
  const t = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  // KEYED BY THE NAME A HUMAN READS, not an anonymous list. "presence, the system context or this
  // doc changed" is three guesses in a trench coat; naming the file that actually moved is the
  // difference between a notice and information, and the data was already here to say it.
  const parts = {
    Presence: t(PRESENCE_FILE),
    "System context": t(SYSTEM_CONTEXT_FILE),
    "The shell": SHELL_BOOT,
  };
  // THE AGENT DOC, FINGERPRINTED BY WHAT IS ACTUALLY COMPOSED — not by the file's mtime.
  //
  // His objection, 2026-10-12: *"we know that this shit is requiring a re-init. It doesn't require
  // a re-init… not everything in there is immediate context and you don't have to aim at the
  // entire document."* Correct. This used to be `t(<id>.json)`, so ANY write to the definition
  // moved the stamp and every live session reported stale — saving a chore line asked him to
  // re-initialize a session for a field that never enters a system prompt.
  //
  // THE DEFINITION IS A MIX, and the split is what reaches the SDK at open:
  //   COMPOSED  prompt (the doc), skills (their descriptions are injected), tools /
  //             disallowedTools, mcpServers, model, effort, maxTurns, background, memory
  //   NOT       chores   — read on demand, only when the `chores` verb is called
  //             hooks    — fire at runtime, and the carry list is read per fire (see carriesOf)
  //             subscriptions — delivered at their moment, and they live in a sidecar anyway
  //             name / description — surfaces, never the prompt
  //
  // So the whitelist below IS the claim "this is what a re-init would change", and a field added
  // to the definition is NOT stale-making until somebody puts it here on purpose. That is the
  // right default: a false "up to date" is one bad paragraph, while crying stale at every write
  // teaches him to ignore the notice, which costs the real ones too.
  if (agentId) parts["Agent doc"] = composedStamp(agentId);
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
  `- \`${worklist.TOOL_BOARD_NAME}\` — the whiteboard beside that list: freeform markdown for the ` +
  "conversation's working state, rendered live for the user. Whole board each call; empty wipes.\n" +
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
// RFC-013 test seams — the identity mapping and wrapping for the two prompt-side moments,
// extracted so the boundaries are provable without a live model.
function startInjection(def = {}) {
  try {
    const t = context.injectedFor({ projectCode: def.projectCode, slot: def.id }, "session-start");
    return t ? t + "\n\n" : "";
  } catch { return ""; }
}
function postCompactionInjection(identity = {}) {
  try {
    const t = context.injectedFor(identity, "post-compaction");
    if (!t) return null;
    return { type: "user", message: { role: "user", content: [{ type: "text", text: t }] }, parent_tool_use_id: null, session_id: "" };
  } catch { return null; }
}

function sdkOptionsOf(def = {}) {
  const o = {};
  // A CUSTOM systemPrompt REPLACES the preset — and per the SDK, `append` has no
  // effect once systemPrompt is a string. So the stamp is composed differently in
  // each case rather than set once: appended to the agent's own assignment when it
  // has one, appended to the claude_code preset when it does not. Either way it is
  // present, and neither way costs a turn.
  // RFC-013 — the session-start shelf rides the same composition as presence: not part of the
  // conversation, costs no turn, and survives compaction by construction. Read at open — a fresh
  // mark reaches the NEXT session, which is what "session-start" means.
  const stamped = presence() + systemContext() + startInjection(def) + STAMP;
  o.systemPrompt = def.prompt
    ? `${def.prompt}\n\n${stamped}`
    : { type: "preset", preset: "claude_code", append: stamped };
  // A definition that PINS `tools` would otherwise drop the worklist without
  // saying so — the agent keeps working and quietly stops being able to plan.
  // The worklist is harness state, so it is always appended, never negotiable.
  if (def.tools?.length)
    o.allowedTools = [...def.tools, ...worklist.TOOL_NAMES, discovery.TOOL_NAME, ...services.TOOL_NAMES, ...context.TOOL_NAMES];
  if (def.disallowedTools?.length) o.disallowedTools = def.disallowedTools;
  // The thinking BUDGET is a start option; the DISPLAY is not (the SDK only has a live setter for
  // it), so the display is applied right after `system/init` — see the init handler.
  if (def.thinking && def.thinking.budget != null) o.thinking = { type: "enabled", budgetTokens: Number(def.thinking.budget) };
  // PER-AGENT SKILL CARRY (his design — the profile's toggle writes def.skills). The SDK's own
  // context filter: a listed set enables exactly those; absent/empty forwards nothing, which is
  // the SDK's "no override" = all discovered — the same back-compat the UI promises. This line
  // was MISSING while the comment above claimed skills were forwarded — the toggle would have
  // been a control writing a field nothing read.
  if (Array.isArray(def.skills) && def.skills.length) o.skills = def.skills;
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
    // `tag` and `meta` are optional and only membership delivery uses them today — see
    // `mergePending`. Every other caller pushes a bare message and is unaffected.
    push(msg, tag = null, meta = null) { buffered.push({ msg, tag, meta }); if (wake) { wake(); wake = null; } },
    // MERGE RATHER THAN INTERRUPT AGAIN. A message still sitting in `buffered` has NOT been
    // yielded, so the session was never going to read it as its own turn — it would only have
    // arrived as N copies of being interrupted. Rewriting it in place therefore loses nothing.
    //
    // Safe by construction, not by luck: this is synchronous and `buffered.shift()` is the only
    // way out, so if the entry is still in the array it cannot be mid-consumption. That is why
    // the merge lives HERE, inside the closure that owns the array, instead of in the caller —
    // from outside, `s.input` exposes no way to see what is pending, and anything that tried
    // would be guessing at a race.
    mergePending(tag, rewrite) {
      if (!tag) return false;
      const entry = buffered.find((b) => b.tag === tag);
      if (!entry) return false;
      const next = rewrite(entry.meta);
      if (typeof next === "string" && entry.msg?.message?.content?.[0]) {
        entry.msg.message.content[0].text = next;
      }
      return true;
    },
    end() { done = true; if (wake) { wake(); wake = null; } },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (buffered.length) yield buffered.shift().msg;
        if (done) return;
        await new Promise((r) => { wake = r; });
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// THE TURN BOUNDARY — RFC-012.
//
// The SDK announces the real yield: `m.type === "result"` is the agent handing the turn back, not
// an inference from activity going quiet. So the boundary is OBSERVED, and the debounce below is a
// safety net on a signal we actually have rather than the mechanism itself.
//
// What it nets: `result` lands, and a turn the human had already queued has not been announced yet
// — flushing into that gap would put the pointer back beside his message, which is the exact
// failure this RFC exists to end. Any in-turn activity cancels the flush, so the timer only has to
// cover the race between the yield and the next turn being seen. 1.5s covers it with room, and the
// seam stays under what reads as a pause in the UI.
//
// AND IT IS CHEAP TO BE WRONG. A persisting hook (`until:`) comes back next turn, so a missed
// boundary costs one turn instead of the procedure — which is what lets the value be conservative
// at all. Without persistence the timing would have to be exact, because a miss would be permanent.
const TURN_SETTLE_MS = 1500;

// A turn is in flight while any of these are arriving. `usage` is not here on purpose: the
// mid-turn snapshot and the end-of-turn receipt share the kind, so treating it as activity would
// make the session's own ruler tick cancel the flush it just armed.
const TURN_ACTIVITY = new Set([
  "user.prompt",
  "assistant.text",
  "assistant.thinking",
  "tool.call",
  "tool.result",
  "permission.request",
]);

// Hand the pointer over. THE WRAPPER IS THE POINT: it rides the same path a cross-session message
// does — the pump recognises it and the feed draws a row instead of pretending the human typed it.
function deliverHook(s, h, event) {
  // THE POINTER IS BUILT ONCE AND KEPT, because the receipt needs the same words the agent got.
  // It used to be built inline here and discarded: the feed could say a hook fired and never what
  // it said, and `HOOKWRAP` strips the text out of the transcript on purpose (so the mechanism
  // cannot draw as the human typing) — which left the pointer visible to nobody at all. Hidden
  // from the transcript and available on the row is the behaviour; this is the half that was
  // missing.
  const pointer = hooks.pointerText(h, event);
  try {
    s.input.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: pointer }] },
      parent_tool_use_id: null,
      session_id: "",
    });
  } catch {}
  // NOBODY SENT THIS ONE. The pointer now on the queue will start a turn, and the harness knows —
  // without asking the agent — that a hook and not the human started it. Marked here, at the only
  // place a hook enters the conversation, and committed when that turn actually begins.
  s.nextTurnFromHook = true;
  // THE RECEIPT, AND IT IS WRITTEN AT DELIVERY, NOT AT MATCH. A pointer held for the turn boundary
  // has not reached anyone yet; a receipt at match time would put a row in the feed for something
  // that had not happened, and for a hook whose session ends first, never would.
  // AND A JOB'S VERDICT RIDES WITH IT. Without this a job that fired and was REFUSED for a missing
  // input drew the identical row to one that ran — the row reporting the pointer rather than what
  // happened, which is a surface testifying instead of reading state. `given` is the fact; `missing`
  // is why not; `with` is what it was handed; `runId` is the record it opened.
  emit(s, {
    kind: "hook.fired",
    name: h.name,
    on: event.kind,
    to: h.do,
    hookKind: h.kind,
    note: h.note || "",
    text: pointer,
    when: h.when && Object.keys(h.when).length ? h.when : null,
    rate: h.rate || h.guard || "",
    ...(h.job
      ? {
          job: h.job,
          given: h.given === true,
          inputs: h.with && Object.keys(h.with).length ? h.with : null,
          missing: Array.isArray(h.missing) && h.missing.length ? h.missing : null,
          runId: h.runId || "",
        }
      : {}),
  });
  logLife(s, `hook fired: ${h.name} on ${event.kind} -> ${h.do || "(no target)"}`);
  // THE RATE'S CLOCK STARTS AT DELIVERY, not at match — same reason the receipt is written here.
  // A pointer that matched, was held for the turn boundary and then dropped has not spent the
  // agent's once-a-day; recording at match time would silently eat cadences nobody received.
  try { hooks.recordFired(h, { agentId: s.agentId, projectCode: s.projectCode }); } catch {}
}

function flushTurnEndHooks(s) {
  s.turnEndTimer = null;
  if (s.turnActive) return;        // something started again — a pause is not an ending
  if (s.toolsInFlight > 0) return; // work is still outstanding, whatever the message stream said
  // HELD DELIVERIES GO FIRST — ambient document updates that arrived while a turn was running
  // (the wake fix: a push mid-turn lands in the CLI's queue, which is HIS). The CLI is idle at
  // this boundary, so each push starts its own turn, which is the whole point of holding them.
  const dels = s.pendingDeliveries;
  if (dels && dels.size) {
    const heldDels = [...dels.entries()];
    dels.clear();
    for (const [tag, m] of heldDels) { try { pushDelivery(s, tag, m); } catch {} }
  }
  const pend = s.pendingHooks;
  if (!pend || !pend.size) return;
  const held = [...pend.values()];
  pend.clear();
  for (const { hook, event } of held) deliverHook(s, hook, event);
}

function armFlush(s) {
  if (s.turnEndTimer) clearTimeout(s.turnEndTimer);
  s.turnEndTimer = setTimeout(() => flushTurnEndHooks(s), TURN_SETTLE_MS);
  if (s.turnEndTimer.unref) s.turnEndTimer.unref();
}

// IDLE — THE TURN ENDED AND NOBODY CAME BACK (his ask). End-of-turn and idle are different
// moments and the difference is the human: a turn ending means he has just been answered and may
// be typing, while idle means he left. Work that should never compete with him — doc maintenance,
// an audit, anything long — belongs here and nowhere else.
//
// It reuses the boundary RFC-012 already observes rather than inventing a second detector, and it
// is cancelled by the same TURN_ACTIVITY set, so a session that is doing anything at all is not
// idle. Emitted ONCE per quiet stretch: a hook's own guard decides the cadence, and an event that
// repeated every N minutes would make `cooldown:` meaningless by drowning it.
// THE HARNESS REPORTS; THE HOOK JUDGES (his call, and it deleted a design). The first version of
// this picked five minutes and emitted once — a threshold of mine, in code, which is a setting
// competing with configuration that already exists. A hook carries `when` and `guard`: ask for
// `{quietMin: {gte: 15}}` and you have named your own duration; add `cooldown:` and you have named
// how often it may repeat. So there is nothing here to configure, and no rungs file, no setting —
// quiet simply TICKS and reports its total, and every question about "how long" and "how often" is
// answered where it was always answerable.
//
// The one number left is RESOLUTION, not policy: a minute is the granularity `quietMin` is
// measured in, the same way ctxPct is a whole percent.
//
// AND IT NEVER REACHES THE FEED. This goes through fireHooks, not emit — a session that sits quiet
// for a week must not write ten thousand rows about its own silence into anyone's log. Hooks are
// the only consumer of a tick, so hooks are the only thing it is handed to.
// THE INTERVAL IS HIS HOOKS', TOO (his last cut). A minute was still a number I picked: if the
// only idle hook in play asks for `{quietMin: {gte: 15}}`, waking fourteen times to learn it is
// not fifteen yet is work nobody ordered. So the wake comes from the THRESHOLDS THEMSELVES —
// the smallest one any carried idle hook declared — and a wake does not count or accumulate
// anything, it asks one question: has the last activity passed that threshold. Nothing is
// tracked between wakes, because the clock already knows.
let IDLE_TICK_OVERRIDE = 0;
function __setIdleTick(ms) { IDLE_TICK_OVERRIDE = Number(ms) || 0; } // tests only

// WHICH HOOKS THIS SESSION CARRIES, READ NOW RATHER THAN AT BIRTH.
//
// His objection, 2026-10-12, and it is about the design and not a bug hunt: *"sometimes it's like
// if I enable this hook, you tell me I got to refresh the context. That makes no sense because
// hooks aren't a part of your context. They just jump into your chat out of nowhere. What the fuck
// does that have to do with you resetting your session to enable the hook?"*
//
// Nothing, is the answer. The carry list was COPIED onto the session record when the session was
// built and every fire read that copy, so ticking a hook on the profile wrote to disk and a
// running session never looked again. Restarting "worked" only because it rebuilt the snapshot —
// a session reset to pick up a list that was never part of the session's context in the first
// place. tests/hooks.js already describes this shape from the other side: the switches moved, the
// agent behaved enabled, and the truth on disk was empty.
//
// So it is read per call. The cost is one small JSON read of one definition file, on an event that
// already walks the hook index; the definition store is a handful of files and `list()` next door
// deliberately does not cache for the same reason. THE SNAPSHOT REMAINS THE FALLBACK: if the
// definition cannot be read at this instant, a session must keep firing the hooks it had rather
// than silently carrying none — losing a pointer is the failure this whole file is written against.
function carriesOf(s) {
  if (!s) return [];
  try {
    const defs = require("./definitions.cjs");
    const id = s.agentId || null;
    if (!id) return s.carriesHooks || [];
    const rec = defs.get(id) || defs.resolve(id);
    const live = rec && rec.def && Array.isArray(rec.def.hooks) ? rec.def.hooks.map(String) : null;
    return live || s.carriesHooks || [];
  } catch {
    return s.carriesHooks || [];
  }
}

function idleWakeMs(s) {
  const mins = [];
  // THE NUDGE IS A LISTENER IN ITS OWN RIGHT, so it sets a floor even when the session carries no
  // idle hook at all. Without this, `idleWakeMs` returns 0 for an agent with nothing armed, no
  // timer runs, and a nudge delivered "on idle" is dead code that tests green — the exact failure
  // shape of a verb with no door.
  try {
    const cfg = nudge.readSettings();
    if (cfg.on && cfg.giveUpAfter) mins.push(Math.max(1, cfg.idleMin));
  } catch {}
  const carries = carriesOf(s);
  if (!carries.length) return mins.length ? Math.min(...mins) * 60000 : 0;
  try {
    for (const h of hooks.list()) {
      if (h.on !== "idle" || h.enabled === false) continue;
      if (!carries.includes(h.name)) continue;
      const q = (h.when || {}).quietMin || {};
      const n = Number(q.gte != null ? q.gte : q.gt);
      // a hook that names no duration wants any quiet at all, so it sets the floor
      mins.push(n > 0 ? n : 1);
    }
  } catch { return 0; }
  return mins.length ? Math.min(...mins) * 60000 : 0; // 0 = nobody listens, so no clock runs
}

// DERIVED, NOT COUNTED (his catch). The first version did `idleMin += 1` per tick, which trusts
// every tick to have fired on time — and background timers are throttled in Electron while a
// sleeping laptop stops them dead, so a three-hour nap would have reported two minutes. The tick's
// only job is to give hooks a chance to be ASKED; the answer comes from the clock.
//
// AND IT IS NOT ARMED AT ALL unless something is listening — an agent carrying no idle hook pays
// nothing, no timer and no wakeups, which is the honest answer to "isn't this inefficient": the
// cost exists only where somebody asked for the signal, at the rate they asked for it.
function armIdle(s) {
  if (s.idleTimer) clearInterval(s.idleTimer);
  s.idleTimer = null;
  s.quietSince = Date.now();
  const every = IDLE_TICK_OVERRIDE || idleWakeMs(s);
  if (!every) return; // nobody listens — no clock runs
  s.idleTimer = setInterval(() => {
    if (s.turnActive || s.toolsInFlight > 0) return; // busy after all — not quiet
    // ONE QUESTION, ASKED OF THE CLOCK: how long since he last did anything. No accumulator, so a
    // throttled or slept timer cannot make this lie.
    const quietMin = Math.floor((Date.now() - (s.quietSince || Date.now())) / 60000);
    if (quietMin < 1) return;
    try { fireHooks(s, { kind: "idle", quietMin }); } catch {}
    try { maybeNudge(s, quietMin); } catch {}
  }, every);
  if (s.idleTimer.unref) s.idleTimer.unref();
}

// Called from the pump the moment the SDK yields. The counter is what makes "at most once per
// turn" meanable for a persisting hook — hooks.guardAllows compares it, and without it the phrase
// would quietly mean "no limit at all".
function armTurnEnd(s) {
  s.turnActive = false;
  s.turnSeq = (s.turnSeq || 0) + 1;
  armFlush(s);
  armIdle(s);
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
  // THE TURN IS ALIVE AGAIN. Anything a working session emits cancels a flush that was armed on a
  // boundary that turned out not to be one — including the pointer's own turn, so a delivered hook
  // can never be flushed on top of itself.
  if (TURN_ACTIVITY.has(event.kind)) {
    // A TURN IS STARTING — the one moment `turnActive` goes false -> true. Whatever the queue was
    // holding is now the turn in flight, and the holder is reset so a pointer that is never
    // followed by a turn cannot colour the next one the human starts.
    if (!s.turnActive) {
      s.turnFromHook = s.nextTurnFromHook === true;
      s.nextTurnFromHook = false;
    }
    s.turnActive = true;
    if (s.turnEndTimer) { clearTimeout(s.turnEndTimer); s.turnEndTimer = null; }
    // and the quiet stretch is over — the next yield starts a fresh one from now
    if (s.idleTimer) { clearInterval(s.idleTimer); s.idleTimer = null; }
    s.quietSince = 0;
  }
  // CLEARING IS READ FROM THE RUN RECORD, NOT FROM THE AGENT. `run.finished` is emitted by the
  // harness when a write leaves every item done (worklist.allDone on the persisted list) — there is
  // no flag an agent can set, and an agent that wipes its worklist has not cleared anything.
  if (event.kind === "run.finished" && event.source) s.runsDone.set(String(event.source), Date.now());
  // AMBIENT FIELDS (his design, hooks.AMBIENT is the declaration): every event carries what the
  // world can afford alongside what happened, so a `when` can say {"ctxPct":{"lte":40}} on any
  // kind. Stamped on a copy — the emitted event that feeds/history see stays exactly what
  // happened. Absent means unknown: the quota trio exists only after the API reported a limit.
  const win = contextWindowOf(s.model);
  const ev = {
    ...event,
    ...(win && s.lastCtxSnapshot ? { ctxPct: Math.round((s.lastCtxSnapshot / win) * 100) } : {}),
    ...(lastQuota
      ? {
          quotaStatus: lastQuota.status,
          quotaType: lastQuota.type,
          ...(lastQuota.resetsAt ? { quotaResetsInMin: Math.max(0, Math.round((lastQuota.resetsAt * 1000 - Date.now()) / 60000)) } : {}),
        }
      : {}),
  };
  let hits = [];
  try {
    hits = hooks.fire(ev, {
      agentId: s.agentId,
      projectCode: s.projectCode,
      // THE SESSION, so a `job:` hook can open its run at match time instead of asking the agent to
      // open it. A run is joined to its continuation by (source, session) — without the key, fire()
      // would either mint a run against nobody or leave the job to the agent's first worklist write.
      // The lane that built the fire path refused to guess this rather than risk an orphan record.
      session: s.worklistOwner,
      // `every-agent` is conservative by default (see hooks.inScope): an agent carries a shared
      // hook the way it carries a skill, so nothing acquires one it never opted into.
      carries: carriesOf(s),
      fired: s.hooksFired,
      // what a persisting hook is measured against, and which turn this is
      cleared: s.runsDone,
      turn: s.turnSeq || 0,
    });
  } catch {}
  for (const h of hits) {
    // WHERE THE POINTER GOES DEPENDS ON WHAT KIND OF MOMENT THIS IS (hooks.deliverAt). An in-turn
    // hook — one watching a tool call — is handed over now, because its whole value is proximity
    // to the action. A session-level pointer is HELD for the yield: pushing it now would put it on
    // the input queue beside the request the human just made, where it competes with the thing he
    // asked for and loses.
    if (hooks.deliverAt(h) === "turn-end") {
      // Keyed by name, so a hook that matched three events inside one turn is ONE pointer. The
      // newest match wins the payload — for a threshold hook that is the freshest reading, which
      // is the whole second half of the argument: a `pct` measured at the start of a heavy turn is
      // stale by 15–20 points before anyone acts on it.
      s.pendingHooks.set(h.name, { hook: h, event });
      // A MOMENT THAT ARRIVES AT AN IDLE SESSION HAS NO TURN TO WAIT FOR. `session.started`, a
      // cross-session message, a page event fanned out by emitAmbient — none of them are inside a
      // turn, and without this the pointer would sit in the queue until the human happened to say
      // something, which for an unattended agent is never. The same timer, so a turn that starts
      // inside the window still wins and the pointer waits for its ending instead.
      if (!s.turnActive && !s.turnEndTimer) armFlush(s);
      continue;
    }
    deliverHook(s, h, event);
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
  // RFC-057 — THE SAME SEAM, A THIRD TIME. emit() is where the feed draws, where hooks fire, and now
  // where the ledger is written: observability, hookability and accountability are one surface, so
  // anything a future event adds is measurable for free. record() swallows its own errors — a
  // ledger that can break a session is worse than no ledger.
  ledger.record(s, event);
  fireHooks(s, event);
}

// ---------------------------------------------------------------------------------------------
// AMBIENT EVENTS — RFC-005 §7.1. Something happened that belongs to NO session: a value changed on
// a page, a schedule came due, something arrived from outside. `emit()` above cannot carry these,
// because every line of it is about one session's feed, one session's ledger, one session's
// history — and an ambient event has no session to be about.
//
// IT FANS OUT TO HOOKS AND NOT TO FEEDS, and that asymmetry is the whole design. Pushing a page
// event into every live session's event list would put a stranger's click in your chat: N copies
// of one fact, in N places none of them belong. But every session must still get the chance to
// MATCH it, because carrying a hook is how an agent opts in — so `fire()` runs per session, with
// that session's own `carries` list and its own guard state, and only the ones that opted in see
// anything at all. A session that carries nothing pays one Map lookup that misses.
//
// The receipt still lands in the right place: fireHooks emits `hook.fired` into the session that
// actually received the pointer, so an unattended trigger is never silent, and it is never noisy
// for anyone it did not reach.
const AMBIENT_LIMIT = 500;
const ambient = [];
const ambientSubs = new Set();

// RFC-071 — MEMBERSHIP IS THE SUBSCRIPTION, AND IT DELIVERS ITSELF. His correction, 2026-10-19:
// *"How could no agent have the hook? It shouldn't be up to the agent. If the UI says the agent
// has the hook, then they have the hook. If you're in the members, then you get the messages."*
//
// He is right, and the first build had it wrong. Delivery rode on hooks alone, which meant the
// document's chip said buAPI was a member while buAPI heard nothing — because somebody had to arm
// a hook on buAPI first. A surface that claims a subscription nobody is honouring is the exact
// failure this system refuses everywhere else.
//
// So a `document.updated` is delivered to the sessions of the projects named in its `members`,
// directly, by the harness. Hooks still fire for whoever carries one — they are the general
// mechanism and this is not replacing them — but membership no longer DEPENDS on one existing.
// It RETURNS the project codes it actually reached — RFC-073 c30: `told=` is stamped only on a
// successful hand-off, and only this function knows which sessions took the push.
// THE DELIVERY'S WORDS, COMPOSED FROM ITS META — module-level because a HELD delivery (below)
// composes at FLUSH time, after every merge has landed, not at arrival. The meta carries the
// document's own address so composition needs nothing from the event that started it.
const DELIVERY_TAIL =
  `\n\nRead the file rather than trusting this line — it is current and this is a ` +
  `summary. You are on it because the document says so (\`::members\`), which is also how ` +
  `you stop being on it.`;
const deliveryHeadline = (m) =>
  m.threads.length > 1
    ? `${m.threads.length} threads you are in moved — ${m.project}:${m.path}: ${m.threads.join(", ")}.`
    : m.threads.length === 1
      ? `A thread you are in moved — ${m.project}:${m.path}, thread ${m.threads[0]}.`
      : `A document you are a member of was updated — ${m.project}:${m.path}.`;
const composeDelivery = (m) => {
  const notes = m.summaries.filter(Boolean);
  return `${deliveryHeadline(m)}${notes.length ? ` ${notes.join(" ")}` : ""}${DELIVERY_TAIL}`;
};
// One push, one wake. `nextTurnFromHook` rides along so the turn this starts is labelled as the
// mechanism's, never as the human typing (RFC-066 §3).
function pushDelivery(s, tag, m) {
  s.input.push({
    type: "user",
    message: { role: "user", content: [{ type: "text", text: composeDelivery(m) }] },
    parent_tool_use_id: null,
    session_id: "",
  }, tag, m);
  s.nextTurnFromHook = true;
}

function deliverToMembers(e) {
  const reached = [];
  if (e.kind !== "document.updated") return reached;
  const named = String(e.members || "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!named.length) return reached;
  for (const s of sessions.values()) {
    if (!named.includes(s.projectCode)) continue;
    // Never to the WRITER: an agent whose own tool call put the answer in the file is the one
    // session that cannot be news to (RFC-073 §3 — the watcher fires per-session, so `by` names it).
    // HIS press is NOT the writer's session: the old "never to the room it came from" rule skipped
    // the project's own agent whenever HE pressed send on that project's document — he is not the
    // agent, and the agent is exactly who should hear him. Measured 2026-10-26: *"I clicked the
    // send update button and you didn't get no message."* `by="you"` skips nobody now.
    if (e.by && e.by !== "you" && s.projectCode === e.by) continue;
    const meta = {
      project: e.project || "",
      path: e.path || "",
      threads: e.thread ? [e.thread] : [],
      summaries: [e.summary || ""],
    };
    const tag = `doc:${e.project || ""}:${e.path || ""}`;
    try {
      // ONE DOCUMENT, ONE WAKE — his instruction: "make sure the way you guys receive messages
      // doesn't overwhelm." A delivery already HELD for this document grows in place; one still
      // sitting unconsumed in the input queue is rewritten there. Either way: no second wake.
      const mergeInto = (m) => {
        if (e.thread && !m.threads.includes(e.thread)) m.threads.push(e.thread);
        if (e.summary) m.summaries.push(e.summary);
        return composeDelivery(m);
      };
      const held = s.pendingDeliveries ? s.pendingDeliveries.get(tag) : null;
      const merged = held ? (mergeInto(held), true) : s.input.mergePending(tag, mergeInto);
      if (merged) {
        // The RECEIPT is SystemView's window to draw, not ours — so this reports the fact
        // (`merged`: an update to a delivery already announced, not a new one) and lets that
        // surface decide between collapsing the row and adding one. A receipt that cannot say
        // which of the two it is would make the log claim N interruptions that never happened.
        emit(s, {
          kind: "message.landed",
          from: e.by || "you",
          merged: true,
          preview: `${e.project}:${e.path} — also ${e.thread || "document"}`,
          doc: { project: e.project || "", path: e.path || "", thread: e.thread || "", summary: e.summary || "", merged: true },
        });
        reached.push(s.projectCode);
        continue;
      }
      // THE WAKE FIX (his order: "the queue is mine… why is events coming from outside being
      // queued? you fucked up"). A user message handed to the CLI mid-turn lands in the CLI's OWN
      // queue — his queue — and rides his next message instead of starting a turn. So a BUSY
      // session never gets the push: the delivery is held here, beside the hooks RFC-012 already
      // holds, and flushed at the settled boundary — where a push lands on an idle CLI and
      // provably starts its own turn (the nudge is the proof; it fires only on idle and wakes).
      if (s.turnActive || s.toolsInFlight > 0) {
        s.pendingDeliveries.set(tag, meta);
        emit(s, {
          kind: "message.landed",
          from: e.by || "you",
          held: true,
          preview: deliveryHeadline(meta).slice(0, 140),
          doc: {
            project: meta.project,
            path: meta.path,
            thread: e.thread || "",
            summary: e.summary || "",
            text: composeDelivery(meta),
            held: true,
          },
        });
        reached.push(s.projectCode);
        continue;
      }
      pushDelivery(s, tag, meta);
      // THE RECEIPT CARRIES THE FACTS, not just a sentence. His: *"why isn't that thread log
      // expandable like most logs so you can see details?"* — a one-line note with a 140-character
      // preview is a row that can only ever be read, so the window gets the document, the thread
      // and the whole delivered text and can open all three.
      emit(s, {
        kind: "message.landed",
        from: e.by || "you",
        preview: deliveryHeadline(meta).slice(0, 140),
        doc: {
          project: meta.project,
          path: meta.path,
          thread: e.thread || "",
          summary: e.summary || "",
          text: composeDelivery(meta),
        },
      });
      reached.push(s.projectCode);
    } catch {}
  }
  return reached;
}

// AN UNFINISHED RUN NUDGES ITS AGENT — the delivery half. `pickNudge` decides (purely, in
// nudge.cjs); this pushes the turn, records that it happened, and leaves a receipt.
//
// IT PUSHES A TURN RATHER THAN FIRING A HOOK for the same reason document delivery does: a hook
// only fires for an agent that carries it, so a nudge routed through one reaches whoever the human
// remembered to tick. This is the floor every agent gets.
//
// THE RECEIPT IS NOT DECORATION. A nudge that only exists as an injected turn is invisible the
// moment the transcript scrolls, and "nothing runs invisibly" is the rule this harness lives by —
// so the window gets an event, and the COUNT is stamped on the run itself where a row can read it.
function maybeNudge(s, quietMin) {
  const cfg = nudge.readSettings();
  if (!cfg.on) return null;
  // THE SAME DERIVATION the ambient `ctxPct` uses, from the same two fields — a second formula
  // here is how the nudge's ceiling and a hook's `{ctxPct: {lte: N}}` would start disagreeing.
  const win = contextWindowOf(s.model);
  const ctxPct = win && s.lastCtxSnapshot ? Math.round((s.lastCtxSnapshot / win) * 100) : null;
  const picked = nudge.pickNudge({
    runs: worklist.all(),
    // THE RUN'S OWN SPELLING OF WHERE IT RAN — `session:<projectCode>:<sessionId>`, the exact
    // string the worklist stamps (s.worklistOwner). The first wiring passed `s.id`, a property no
    // session ever had: undefined matched nothing, the selector returned null for every agent, and
    // the 15-claim suite stayed green because it feeds pickNudge its session directly. The nudge
    // that "worked" had never once fired — found live, 2026-10-26, by him waiting for one.
    session: s.worklistOwner,
    quietMin,
    ctxPct,
    settings: cfg,
  });
  if (!picked) return null;
  const { run, text, finalNotice } = picked;
  try {
    s.input.push({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
      session_id: "",
    });
    s.nextTurnFromHook = true;
    const counted = worklist.markNudged(run.owner) || {};
    emit(s, {
      kind: "run.nudged",
      source: run.source || "",
      run: run.owner || "",
      active: run.active || "",
      done: Number(run.done) || 0,
      total: Number(run.total) || 0,
      count: Number(counted.count) || 1,
      // THE ROW SHOWS WHAT WAS SAID (his: "the log is about to show me what kind of message you
      // get from the nudge") — a receipt that hides the message is half a receipt.
      text,
      // THE CYCLE'S LAST WORD, SAID AS SUCH. Nudging no longer stops on a count (his rule) — the
      // final notice names the only exits (done, or abandoned + the account) and the cycle resets.
      finalNotice: finalNotice === true,
      quietMin,
    });
  } catch {
    return null;
  }
  return run;
}

// THE NUDGE'S CLOCK, READABLE (his: "see the countdown… watch it and boom"). The countdown row
// needs the one number only this file knows: when each session went quiet. Project code → ms,
// 0 while a turn is running — so a visible countdown always means "the clock is actually ticking".
function quietOf() {
  const out = {};
  for (const s of sessions.values()) {
    if (s && s.projectCode) out[s.projectCode] = Number(s.quietSince) || 0;
  }
  return out;
}

// THE COUNTDOWN IS THE SELECTOR'S ANSWER, NOT THE ROW'S OPINION (his, 2026-10-26: "I saw two
// things counting down at the same time… but you only got one nudge"). Every list row deriving its
// own eligibility drew N countdowns for ONE nudge — a surface promising wakes the selector never
// makes. So the shell answers WHICH run would be picked when each session's quiet clock matures,
// with the SAME pickNudge that will fire — evaluated at the due moment, so the cooldown and
// give-up rules the row cannot know are already in the answer. Project code → { owner, source,
// dueAt }; absent means nothing would be nudged, and no row should count down.
function nudgePicks() {
  const out = {};
  let cfg;
  try { cfg = nudge.readSettings(); } catch { return out; }
  if (!cfg.on || !cfg.giveUpAfter) return out;
  let runs;
  try { runs = worklist.all(); } catch { return out; }
  for (const s of sessions.values()) {
    try {
      if (!s || !s.projectCode || s.turnActive || s.toolsInFlight > 0 || !s.quietSince) continue;
      const dueAt = Number(s.quietSince) + cfg.idleMin * 60000;
      const win = contextWindowOf(s.model);
      const ctxPct = win && s.lastCtxSnapshot ? Math.round((s.lastCtxSnapshot / win) * 100) : null;
      const picked = nudge.pickNudge({
        runs,
        session: s.worklistOwner,
        now: Math.max(dueAt, Date.now()),
        quietMin: cfg.idleMin, // "when the clock matures" — the pick, not the maturity, is the question
        ctxPct,
        settings: cfg,
      });
      if (picked) out[s.projectCode] = { owner: picked.run.owner || "", source: picked.run.source || "", dueAt };
    } catch {}
  }
  return out;
}

function emitAmbient(event = {}) {
  const e = { ...event, ts: Date.now(), ambient: true };
  ambient.push(e);
  if (ambient.length > AMBIENT_LIMIT) ambient.splice(0, ambient.length - AMBIENT_LIMIT);
  for (const sub of ambientSubs) { try { sub(e); } catch {} }
  try { e.delivered = deliverToMembers(e) || []; } catch { e.delivered = []; }
  // A COPY PER SESSION. fireHooks hands the event to hooks.fire, which reads it and does not write
  // — but emit() downstream stamps fields onto whatever it is given, and one shared object stamped
  // by several sessions is the bug that would be invisible until two agents disagreed about which
  // session an event came from.
  for (const s of sessions.values()) { try { fireHooks(s, { ...e }); } catch {} }
  return e;
}

const ambientHistory = (limit = 100) => ambient.slice(-Math.max(1, Math.min(limit, AMBIENT_LIMIT)));
function subscribeAmbient(fn) {
  ambientSubs.add(fn);
  return () => ambientSubs.delete(fn);
}

// RFC-073 §3 — THE ANNOUNCE DOOR. A markdown file changed (the watcher, a tool's schema, his press
// through files:write) and this is everything that follows: ONE parse answers registration and
// fires; the registry is upserted; each fire is routed through the member router exactly as a
// document send is; and `told=` is stamped for precisely who was reached — plus the writer, who
// cannot be news to. A failed hand-off stamps nothing, so the fire stays visible to the next parse,
// which is the sweep's whole input (c30). Fire-and-forget at every call site: announcing is derived
// behaviour and must never make a write or an emit fail.
async function announceDocument(absPath, opts = {}) {
  const abs = String(absPath || "");
  if (!/\.(md|markdown)$/i.test(abs)) return { ok: true, skipped: true };
  // THE REGISTRY IS THE FILTER (c33): a file we do not know costs a LOOKUP — and, for markdown, one
  // bounded head-read to see whether it is INTRODUCING itself (a registration leaf near the top).
  // No leaf, not ours → no parse. A registered document, or one carrying a leaf, pays the parse.
  if (!documents.byPath(abs) && opts.source == null) {
    let head = "";
    try {
      const fd = require("fs").openSync(abs, "r");
      const buf = Buffer.alloc(4096);
      head = buf.toString("utf8", 0, require("fs").readSync(fd, buf, 0, 4096, 0));
      require("fs").closeSync(fd);
    } catch {
      return { ok: false, error: `cannot read ${abs}` };
    }
    if (!/^::(arc|rfc|report|gap)\{/m.test(head)) return { ok: true, registered: false, parsed: false };
  }
  const res = await docFires.scan(abs, opts.source);
  if (!res.ok) return res;
  if (res.registration) documents.registerParsed(abs, res.registration, res.blocks, res.text);
  // THE REGISTRY IS THE FILTER (§3): only a registered document fires. Everything else cost one
  // lookup and one parse that also answered "should I care".
  const row = documents.byPath(abs);
  if (!row) return { ok: true, registered: false, fired: 0 };
  const { project, rel } = documents.locate(abs);
  let fired = 0;
  // TWO PASSES, AND THE SPLIT IS THE POINT. One parse can find several newly-marked blocks in one
  // document — 41 marks in a night, 13 rows re-derived by one sweep — and each used to arrive as
  // its own wake. The merge in `deliverToMembers` already collapses sends that are still unread,
  // but it could never see these: `await buildUpdate` sat INSIDE the delivery loop, so the session
  // drained the pending message between fires and the merge correctly refused a consumed item.
  //
  // So the awaits are hoisted and delivery is left SYNCHRONOUS. Nothing new is invented — the
  // existing merge now sees consecutive fires for one document with nothing yielding between, and
  // folds them into a single wake naming all of them.
  //
  // Safe because `buildUpdate` reads the file only for `members` and `arc`: `members` is always
  // supplied here (`f.pending`), and the `told=` stamps below touch claim lines, never the arc —
  // so no build depends on a write from an earlier iteration.
  const builts = [];
  for (const f of res.fires) {
    builts.push({
      f,
      built: await buildUpdate(
        {
          path: rel,
          project,
          members: f.pending,
          by: opts.by || "",
          summary: f.summary,
          ...(f.thread ? { thread: f.thread } : {}),
          docKind: row.kind,
          docId: row.id,
          block: f.name,
          line: f.line,
        },
        abs,
      ),
    });
  }
  for (const { f, built } of builts) {
    if (!built.ok) continue;
    const e = emitAmbient(built.event);
    const delivered = Array.isArray(e.delivered) ? e.delivered : [];
    // The writer already knows — its own tool call put the answer there (c31's "exactly one
    // delivery ever happened" depends on the writer never being owed one).
    const knows = opts.by && f.pending.includes(opts.by) ? [opts.by] : [];
    const newly = [...new Set([...delivered, ...knows])];
    if (!newly.length) continue; // nobody reached — stamp nothing, the sweep delivers it later
    fired += 1;
    const union = [...new Set([...f.told, ...newly])];
    docWrite.writeAttr(abs, f.line, { told: union.join("|") });
  }
  return { ok: true, registered: true, fired };
}

// RFC-073 §3.1 — THE AGENT'S DOOR. An agent marks a claim or moves an objective through THIS, not
// by hand-editing the line: one writer (write.cjs), so a mark written by an agent is the same write
// a press makes — and the rules the block cannot police live here. A claim's mark carries the
// caller's own name and the moment; `by=` cannot be spoofed through this door. A claim marked
// without a note is REFUSED: the word is only as good as what it rests on — `met` says what was
// done and seen, `unmet` what happens instead (c35). The write is followed by the same announce
// every other write gets, so the mark fires to the document's audience by itself.
async function markBlock(absPath, line, { state, note } = {}, by = "") {
  const abs = String(absPath || "");
  const n = Number(line) || 0;
  let row = "";
  try {
    row = fs.readFileSync(abs, "utf8").split("\n")[n - 1] || "";
  } catch {
    return { ok: false, error: `cannot read ${abs}` };
  }
  const isClaim = /^\s*::claim\b/.test(row);
  const isObjective = /^\s*:{3,}\s*objective\b/.test(row);
  if (!isClaim && !isObjective)
    return { ok: false, error: `line ${n} holds no ::claim and no :::objective — nothing to mark` };
  const value = String(state || "").trim();
  if (isClaim) {
    if (!["met", "unmet", "not-met"].includes(value))
      return { ok: false, error: 'a claim is marked state=met or state=unmet' };
    if (!String(note || "").trim())
      return {
        ok: false,
        error:
          "refused: a claim marked without note= is no mark — say what was done and seen (met) or what happens instead (unmet)",
      };
    const w = docWrite.writeAttr(abs, n, {
      state: value === "not-met" ? "unmet" : value,
      by: by || "agent",
      at: Date.now(),
      note: String(note).trim(),
    });
    if (!w.ok) return w;
  } else {
    if (!["open", "doing", "done", "blocked"].includes(value))
      return { ok: false, error: "an objective moves to open, doing, done or blocked" };
    const pairs = { state: value };
    if (String(note || "").trim()) pairs.note = String(note).trim();
    const w = docWrite.writeAttr(abs, n, pairs);
    if (!w.ok) return w;
  }
  const announced = await announceDocument(abs, { by });
  return { ok: true, marked: isClaim ? "claim" : "objective", state: value, fired: announced.fired || 0 };
}

// RFC-073 §3 slice 4 — THE SESSION-START SWEEP. A fire that happened while nobody was running is
// delivered when somebody is: a new session asks the registry what exists and re-announces each
// document. `told=` makes it idempotent — a covered block is silence — so the sweep costs one parse
// per registered document and delivers only what is still owed (c32).
async function sweepDocuments() {
  for (const row of documents.read()) {
    const abs = documents.absPathOf(row);
    if (!abs) continue;
    try {
      await announceDocument(abs);
    } catch {}
  }
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
    case worklist.TOOL_BOARD_NAME: return "updating the whiteboard";
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
      // RFC-073: a change is one cause of a parse — register AND fire, writer named so it is
      // stamped as told rather than woken by its own write.
      announceDocument(abs, { by: s.projectCode }).catch(() => {});
    });
  } catch {} // recursive watch unavailable → schema half still covers Edit/Write
}

// Compress a tool result to something a feed can show without drowning in bytes. The harness's
// own MCP tools (context/discovery/systemlynx) get a bigger budget: their outputs are AUTHORED
// for human reading — his rule, "our logs come out human" — and clipping a ranked list of notes
// at 400 chars re-creates the dump problem by amputation. Their sizes are bounded at the source
// (top-k results, 40KB cap on call), so the budget is honest, not unbounded.
// A PICTURE A TOOL FILED IS SHOWN, NOT SPELLED. `brief` flattens a result's blocks to text and
// writes any non-text block as `[image]` — which is how a screenshot tool, whose entire output IS
// the picture, arrived in the feed as the five literal characters "[image]". His ruling,
// 2026-10-19: *"if I expand the log, it's supposed to show me the screenshot."*
//
// The pairing is the signal, and both halves have to be there: the result carries a real image
// block AND its text names an absolute file it filed. The path is what the feed keeps — never the
// bytes, because a session's event log is replayed and stored, and base64 pngs in it would make
// every reload heavier forever for a picture that is already on disk.
function filedImage(content) {
  if (!Array.isArray(content)) return null;
  if (!content.some((b) => b && b.type === "image")) return null;
  const text = content.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/(\/[^\s"']+\.(?:png|jpe?g|gif|webp))/i);
  return m ? m[1] : null;
}

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
// THE HOOKABLE VOCABULARY lives in hooks.cjs — a hook can only attach to a moment the system
// actually announces, so the list and the matcher that reads it belong in one file. Re-exported
// from here because the window's event picker reaches it through sessions.
const EVENTS = hooks.EVENTS;

// `worklist` was missing here, so `get`'s result clipped at 400 chars — the list survived and
// the whiteboard under it was amputated, invisibly. His catch, watching the logs for it.
const HARNESS_MCP = /^mcp__(context|discovery|systemlynx|systemview|worklist)__/;
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
      // quota reports ride message envelopes only at limit moments — cache every sighting
      noteQuota(m);
      if (m.type === "system" && m.subtype === "init") {
        s.sdkSessionId = m.session_id;
        s.model = m.model; // rides usage events so the meter knows its real window
        // The display mode has no start-time option — the SDK's live setter is the only door — so
        // the agent's default is applied the moment the session is up. Fire-and-forget: a refused
        // setter must not take the init down with it.
        if (s.thinking && (s.thinking.display || s.thinking.budget != null)) {
          try { s.query.setMaxThinkingTokens(s.thinking.budget ?? null, s.thinking.display || null).catch(() => {}); } catch {}
        }
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
            // NO `worklist` KEY HERE ANY MORE. It moved to its own owner-keyed file (RFC-005 §3)
            // and this was the only other writer — a second copy of one fact, which nothing read
            // and which would have started disagreeing the first time a job wrote the real one.
            // persisted so the profile can show an agent's REAL lists when it is
            // not running — last session's truth beats the definition's guess
            capabilities: s.capabilities,
            lastActive: Date.now(),
          };
        });
        // SAY WHICH KIND OF OPEN THIS WAS. Cold and re-init both land here as `started`, so a log
        // reading "started … started … started" left us reconstructing what happened from firing
        // patterns and memory — two kinds of guess, no evidence. `origin` is already on the event;
        // it belongs in the line too.
        logLife(s, `started: ${s.origin || "cold"} model ${m.model} sdk ${m.session_id}${s.resumedFrom ? " resumed " + s.resumedFrom : ""}`);
        emit(s, {
          kind: "session.started",
          origin: s.origin || "cold", // "cold" | "reinit" | "resumed" — hookable, so a hook can mean any of them
          model: m.model,
          thinking: s.thinking || null, // what this session shows of its reasoning — the header's knob reads it from here
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
        if (s.worklist.length) emit(s, { kind: "todo.updated", items: s.worklist, replay: true });
        // replay: true — this fires on every query open, and an unmarked replay wears a fresh
        // clock stamp, so the view read it as a live write and opened the board on every send
        if (s.whiteboard) emit(s, { kind: "whiteboard.updated", text: s.whiteboard, replay: true });
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
        // RFC-013 — the post-compaction shelf. This is the moment the agent holds a summary
        // instead of its reasoning — most confident, most wrong — and these are notes an author
        // CHOSE to meet itself with on the far side. Same input-queue ride as a hook pointer:
        // a turn from outside, never words the human typed. Read live; delivery is receipted so
        // it is never silent.
        try {
          const inj = postCompactionInjection({ projectCode: s.projectCode, slot: s.agentId });
          if (inj) {
            s.input.push(inj);
            emit(s, { kind: "context.injected", moment: "post-compaction", chars: inj.message.content[0].text.length, text: inj.message.content[0].text });
          }
        } catch {}
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
        // WHOSE HANDS DID THIS — a subagent's messages carry parent_tool_use_id (the Agent call
        // that spawned it). Stamping it on the emitted events is what lets the feed route a lane's
        // log to its lane instead of interleaving it, unlabeled, with the owner's own work — which
        // is what it did until RFC-059's panel needed the distinction.
        const lane = m.parent_tool_use_id || undefined;
        for (const b of m.message.content || []) {
          if (b.type === "text") emit(s, { kind: "assistant.text", delta: "", done: true, text: b.text, ...(lane ? { parent: lane } : {}) });
          else if (b.type === "thinking") emit(s, { kind: "assistant.thinking", delta: "", done: true, text: b.thinking, ...(lane ? { parent: lane } : {}) });
          else if (b.type === "tool_use") {
            s.toolCalls.set(b.id, { name: b.name, input: b.input });
            s.toolsInFlight++;
            emit(s, { kind: "tool.call", id: b.id, name: b.name, summary: toolSummary(b.name, b.input), input: b.input, ...(lane ? { parent: lane } : {}) });
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
                ...(m.parent_tool_use_id ? { parent: m.parent_tool_use_id } : {}),
                ok,
                summary: `${toolSummary(call.name, call.input)} — ${ok ? "done" : "failed"}`,
                detail: brief(b.content, resultBudget(call.name)),
                ...(filedImage(b.content) ? { image: filedImage(b.content) } : {}),
              });
              const fc = ok && call.name ? fileChangeOf(call.name, call.input) : null;
              if (fc && fc.path) {
                s.recentChanges.set(fc.path, Date.now()); // schema half spoke — watcher stays quiet on this path
                emit(s, { kind: "file.changed", path: fc.path, change: fc.change, source: "schema" });
                announceDocument(fc.path, { by: s.projectCode }).catch(() => {}); // RFC-073 — same door as the watcher half
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
        // THE REAL YIELD, AND IT IS A SIGNAL WE HAVE RATHER THAN ONE WE INFER (RFC-012). `result`
        // is the SDK saying the agent handed the turn back — not activity going quiet, which is
        // what a debounce alone would have had to guess at. Armed AFTER the usage emit on purpose:
        // that emit is what a threshold hook matches, and it must be held before the boundary it
        // will be delivered on is armed.
        armTurnEnd(s);
      }
    }
    logLife(s, "ended: done");
    emit(s, { kind: "session.ended", reason: "done" });
  } catch (err) {
    logLife(s, `ended: error ${String(err?.message || err)}`);
    emit(s, { kind: "session.ended", reason: "error", error: String(err?.message || err) });
  } finally {
    try { s.watcher?.close(); } catch {}
    // A pending flush has nothing to flush into once the pump is done — and a timer holding a dead
    // session is a leak that would deliver a pointer to an input queue nobody is reading.
    if (s.turnEndTimer) { clearTimeout(s.turnEndTimer); s.turnEndTimer = null; }
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

async function open({ projectCode, sessionId = "agent", cwd, model, permissionMode, resume, agentId, reinit = false }) {
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
    // RFC-012 — the turn boundary. `pendingHooks` holds the session-level pointers matched during
    // this turn until the agent yields; `runsDone` is what a persisting hook is cleared by, keyed
    // by run source and seeded from the run files below so a re-init does not forget that a
    // procedure already ran. `turnSeq` counts yields, which is what makes "once per turn" real.
    pendingHooks: new Map(),
    // THE WAKE FIX (his order, 2026-10-26: "the queue is mine… why is events coming from outside
    // being queued?"). An ambient delivery that reaches a BUSY session is held here — keyed by
    // document tag, merged in place — and flushed at the same settled boundary the hooks flush at,
    // where a push lands on an idle CLI and starts its own turn. Handing it to the CLI mid-turn
    // put it in HIS queue, riding his next message.
    pendingDeliveries: new Map(),
    runsDone: new Map(),
    turnSeq: 0,
    turnActive: false,
    // WHO STARTED THE TURN THAT IS RUNNING (RFC-066 §3). `turnFromHook` is the COMMITTED answer for
    // the turn in flight; `nextTurnFromHook` is what the queue is holding for the turn that has not
    // begun. Two fields and not one, because the three writers into `s.input` push at moments that
    // are NOT turn starts: a `deliver: now` hook pointer is pushed mid-turn and begins its own turn
    // after the yield, and `send()` emits `user.prompt` before it pushes. Committing at the one
    // moment a turn is observably starting — turnActive going false -> true in fireHooks — is what
    // keeps a mid-turn pointer from relabelling the turn it interrupted.
    turnFromHook: false,
    nextTurnFromHook: false,
    turnEndTimer: null,
    idleTimer: null,
    quietSince: 0,
    // THE CARRY LIST AT BIRTH — kept as the fallback only. `carriesOf()` below is what the fire
    // path and the idle clock actually ask, because this snapshot going stale is the whole bug.
    carriesHooks: (agent && Array.isArray(agent.def && agent.def.hooks) ? agent.def.hooks : []),
    agentId: agent ? agent.id : null,
    composition: compositionOf(agent ? agent.id : null, cwd),
    // WHAT WAS ASKED FOR, not what came back. `s.model` is overwritten at init with the
    // SDK's RESOLVED id, and re-init has to replay the request — feeding a resolved id
    // back in would quietly pin an agent whose definition says "follow the default".
    requestedModel: model || null,
    startedAt: Date.now(),
    // COLD MEANS COLD, AND THERE ARE THREE WAYS IN, not two. A `session.started` looks identical
    // from the SDK whether this is a first open, a re-init, or the desktop shell being restarted
    // under a conversation that survives it. Two states made the third one lie: he restarted the
    // app, the transcript came back intact on the same session id, and the hook named "cold" fired
    // at an agent that had forgotten nothing — telling it to go look up what it was already
    // holding. `remembered` is the tell, and it is already computed above (no race: `s.reinitFrom`
    // is stamped after open() returns, but this is not).
    //   cold    — nothing behind it; the store is the only memory
    //   reinit  — same process, definition reloaded, conversation intact
    //   resumed — process went away, conversation came back with it
    origin: reinit ? "reinit" : remembered ? "resumed" : "cold",
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
  //
  // RFC-005 §3 — THE LIST HAS AN OWNER NOW, and the owner's own file is the truth. It used to
  // live under this session's key in the session store, which made it unreadable by anything
  // that was not this session: fine for a conversation, wrong for a job, where reading the plan
  // AFTER the run is the entire point. `session:<key>` today, `job:<id>` when a run belongs to
  // one — same structure, longer life, rather than a parallel "job steps" model that would drift
  // from the real one inside a month.
  s.worklistOwner = `session:${key}`;
  s.worklist = worklist.read(s.worklistOwner);
  // WHAT THIS SESSION HAS ALREADY FINISHED (RFC-012). Read ONCE, at open, off the run files —
  // after this it is kept current by the `run.finished` events fireHooks already sees, because
  // re-scanning a directory per emitted event is precisely the read-a-file-per-event shape that
  // cost a day of CPU and a jammed main process. A re-init lands here too, which is the point: a
  // maintenance pass done before the restart must not be re-demanded after it.
  for (const r of worklist.all()) {
    if (!r.owner.startsWith("run:") || r.session !== s.worklistOwner || !r.source) continue;
    if (!worklist.allDone(Array.isArray(r.items) ? r.items : [])) continue;
    const at = r.updatedAt || 0;
    if (!(s.runsDone.get(r.source) >= at)) s.runsDone.set(r.source, at);
  }
  // CARRY-OVER, ONCE. Lists written before worklists were owned are in the session store, and a
  // conversation mid-plan must not open blank on the day this shipped.
  if (!s.worklist.length) {
    const was = loadStore()[key]?.worklist;
    if (Array.isArray(was) && was.length) s.worklist = worklist.write(s.worklistOwner, was);
  }
  s.usedBy = Array.isArray(loadStore()[key]?.usedBy) ? loadStore()[key].usedBy : [];
  // The whiteboard shares the list's file and its lifetimes — read it back the same way, so a
  // resumed session still holds what the conversation was holding.
  s.whiteboard = worklist.readBoard(s.worklistOwner);
  // AN EXECUTION OWNS ITS LIST (runs — his design). `set` WITH a source writes the run for that
  // procedure: same source continues the open run, a new source opens a new one (the old run's
  // file stays exactly where it stopped — where a procedure dies is the record). `set` WITHOUT a
  // source is the session's own plan, untouched by any run. Completion is observed: the write
  // that marks every item done closes the run.
  s.currentRun = null; // { id, source }
  const worklistServer = worklist.serverFor((items, source) => {
    if (source) {
      // ─── A `lane:` SOURCE IS A PROMISE THAT A BRANCH EXISTS, and now it is checked ───────────
      //
      // REGISTRATION IS WHAT MAKES A LANE A LANE (his ruling, 2026-10-08). Cutting a branch is
      // nothing — any agent does it with one git command — so the branch is not the lane; the
      // RECORD is, and writing a run sourced `lane:<branch>` is how one gets registered. Which
      // makes this write the registration door, and an unchecked door registers lanes that do not
      // exist: on 2026-10-04 a skill-writing lane was briefed `lane:lane/job-authoring`, drove a
      // complete 9/9 run, and left a record addressed to a branch nobody ever cut. The row was
      // real; the work was not where the row said it was.
      //
      // AND IT IS WHAT DECOUPLES A LANE FROM DELEGATION. Registering is one call an agent makes
      // about its own work — no subagent, no handing anything over. Doing a job in a lane is now
      // the same two steps for anyone: cut the branch, write the list against it.
      //
      // REFUSED, NOT CORRECTED. Guessing the branch or silently dropping the prefix would both
      // leave the agent believing it had a lane. The refusal names the branch and the fix, because
      // the fix is one command away and the agent is holding it.
      // THE MISSPELLED LANE IS REFUSED BY NAME, same discipline as the unexisting branch below.
      // "lane/<branch>" passed this door silently as a GENERIC run — invisible to the strip, the
      // lanes verb and the janitor, which is how three of them sat unreadable for sixteen days
      // (the 2026-09-28 BUApp records pruneRuns now retires). A door that accepts a near-miss of
      // its own protocol is a door that files work where nothing can find it.
      if (worklist.misspelledLane(source))
        throw new Error(
          `"${source}" is not a lane source — the spelling is \`lane:<branch>\`, so this would be ` +
            `filed as a generic run that no strip, verb or janitor can ever read. If you mean the ` +
            `lane, write \`lane:${source}\`; if you mean an ordinary run, pick a source that does ` +
            `not start with "lane/".`
        );
      if (String(source).startsWith("lane:")) {
        const branch = String(source).slice(5).trim();
        const holder = branch ? repoHolding(branch, s.cwd) : null;
        const known = !!holder;
        // THROWN, NOT RETURNED. `onSet`'s return value is discarded by the tool handler, which
        // builds its own reply — so an early return here would skip the write and still answer
        // "worklist: 0/3 done". A throw is the only thing that reaches the agent.
        if (!known)
          throw new Error(
            `No branch "${branch}" exists in ${s.cwd || "this session's folder"} or in any other ` +
              `project this machine knows, so there is nothing to register as a lane. A \`lane:\` source ` +
              `is a promise that a branch exists — the row it draws points at work, and a row pointing at ` +
              `nothing is worse than no row at all. Cut it first ` +
              `(\`git worktree add -b ${branch} <path>\`) and write the list again, or give this work a ` +
              `source with no branch in it.`
          );
        // THE JOB THIS LANE BELONGS TO, recorded on the JOB's run record at the only moment the
        // relation is a fact: registration, while the job's run is still this session's current
        // one (the switch below replaces it). His design, 2026-10-14: the job record is the
        // surface that points at everything a run produced — the lane is just a branch of work,
        // disposable by construction, so it learns nothing. Same reach-back rule as a report filed
        // after the last item: currentRun if it is a job's, else the job run that just closed.
        const jr =
          s.currentRun && String(s.currentRun.source || "").startsWith("job:")
            ? { job: s.currentRun.source.slice(4), runId: s.currentRun.id }
            : s.lastJobRun || null;
        if (jr) {
          try { require("./jobs.cjs").laneCut(jr.job, jr.runId, { branch, repo: holder }); } catch {}
        }
        // WHICH REPO, held for the lane's own record — the row's answer to "is this repo clean"
        // (his catch: autobot and systemview lanes read identically on the strip). The registry's
        // code when it knows the folder; the folder's own name when it does not.
        s.pendingLaneRepo = (() => {
          try {
            const map = JSON.parse(fs.readFileSync(PROJECTS_FILE(), "utf8")) || {};
            for (const [code, dir] of Object.entries(map)) if (dir === holder) return code;
          } catch {}
          return require("path").basename(String(holder || ""));
        })();
      }
      if (!s.currentRun || s.currentRun.source !== source) {
        // resume the unfinished run this session already started on this source — a harness
        // restart mid-run must not mint a corpse that reads as died-at-step-3
        const back = worklist.openRunFor(s.worklistOwner, source);
        s.currentRun = { id: back || worklist.newRunId(), source };
        if (!back) emit(s, { kind: "run.started", id: s.currentRun.id, source });
        // A JOB NAMED IN THE CONVERSATION LEAVES THE SAME EVIDENCE AS ONE A HOOK FIRED (2026-10-08).
        //
        // `jobs.given()` is the only door that opens a job's RUN RECORD, and it is reached only
        // through a hook. So the other legitimate way a job is handed over — the human saying "do
        // the accounting one", which RFC-067 §3 names explicitly — produced a worklist run with the
        // right source and NO job-side record. Everything that reads the record then failed
        // silently: the report pointer had no file to land on, the status never flipped to
        // finished, and the job's card had nothing to show. The worklist half worked, which is what
        // made it quiet.
        //
        // THE GATE IS NOT CLAIMED TO HAVE RUN, and that is the whole care taken here. `given()`
        // checks the declared inputs against a hook's `with:`; a human supplying them in a sentence
        // cannot be checked that way and must not be recorded as though it had been. So the record
        // is opened with a `why` that says exactly how it arrived, and the refusal machinery is left
        // where it belongs — on the path that can actually be refused.
        if (String(source).startsWith("job:")) {
          try {
            const jobsMod = require("./jobs.cjs");
            const name = source.slice(4);
            if (jobsMod.get(name) && !jobsMod.runsOf(name).some((r) => String(r.id) === String(s.currentRun.id)))
              jobsMod.startRun(name, {
                runId: s.currentRun.id,
                why: "named in the conversation, not fired by a hook — its declared inputs were not machine-checked",
              });
          } catch {}
        }
      }
      // NOBODY SENT ME HERE — AND THE HOST SAYS SO, NOT THE AGENT (RFC-066 §3). Read off the
      // session's current-turn origin, which the harness observed; there is no tool parameter
      // carrying this and there must never be one. writeRun stamps it only at the run's BIRTH, so
      // a lane's later list writes — possibly landing in a turn the human did start — cannot
      // relabel the provenance of the run.
      worklist.writeRun(s.currentRun.id, s.worklistOwner, items, source, { selfDirected: s.turnFromHook === true });
      // the repo resolved at the lane verify lands the moment the record exists — synchronous,
      // because a stamp scheduled for "later" raced the very first read of the row
      if (s.pendingLaneRepo && String(source).startsWith("lane:")) {
        try { worklist.markLaneRepo(s.currentRun.id, s.pendingLaneRepo); } catch {}
        s.pendingLaneRepo = null;
      }
      s.worklistSource = source;
      emit(s, { kind: "todo.updated", items, source, run: s.currentRun.id });
      if (worklist.allDone(items)) {
        emit(s, { kind: "run.finished", id: s.currentRun.id, source });
        // A JOB'S RUN RECORD HAS TO CLOSE TOO (2026-10-08). `jobs.done` observes the close off the
        // worklist and stamps the run record finished — and NOTHING called it, so every job run on
        // disk said "running" forever however finished it was. A surface reading that record could
        // never show finished work waiting, which is the whole of RFC-067 §4. Observed, not
        // claimed: `done` re-reads the list and refuses to close a run that is not all-done, so
        // this is the moment it is true rather than the moment somebody says it is.
        if (String(source || "").startsWith("job:")) {
          try { require("./jobs.cjs").done(source.slice(4), s.currentRun.id); } catch {}
          // AND IT STAYS REACHABLE FOR THE REPORT. An agent usually files its account AFTER it
          // marks the last item done, so a pointer that could only be stamped while the run was
          // open would miss the common order by one call.
          s.lastJobRun = { job: source.slice(4), runId: s.currentRun.id };
        }
        s.currentRun = null;
      }
      return;
    }
    s.worklist = items;
    s.worklistSource = "";
    // persisted on every write, not at init — a plan written mid-session and
    // then interrupted is exactly the one worth keeping
    worklist.write(s.worklistOwner, items);
    emit(s, { kind: "todo.updated", items, source: "" });
  }, () => s.worklist, (text) => {
    s.whiteboard = text;
    worklist.writeBoard(s.worklistOwner, text);
    emit(s, { kind: "whiteboard.updated", text });
  }, () => s.whiteboard, () => {
    if (!s.currentRun) return null;
    return { id: s.currentRun.id, source: s.currentRun.source, items: worklist.read(worklist.runOwner(s.currentRun.id)) };
  }, (src) => {
    // the mild reminder: an unknown skill/job source is EITHER a typo pointing a run record at
    // nothing, or a namespace made up on purpose — only the agent knows which, so say it and move on
    // A LANE SAYS SO POSITIVELY. Registering is the whole act now — cut a branch, write a list
    // against it — so the one call that does it has to confirm it did, or the agent cannot tell a
    // registered lane from a plain sourced run. The branch is already verified above (the write
    // throws otherwise), so this is a statement and not a check.
    if (/^lane:/.test(src))
      return `registered as a lane on ${src.slice(5)} — it has a row in his strip now, and it stands there until he clears it.`;
    const m = /^(skill|job):(.+)$/.exec(src);
    if (!m) return "";
    if (m[1] === "skill") {
      const known = definitions.skills(agent ? agent.id : null).some((sk) => sk.name === m[2]);
      return known ? "" : `note: no skill named "${m[2]}" exists — fine if this is a namespace of your own.`;
    }
    const jobs = require("./jobs.cjs");
    const known = jobs.list().some((j) => j.id === m[2] || j.name === m[2]);
    return known ? "" : `note: no job "${m[2]}" exists — fine if this is a namespace of your own.`;
  }, (id, source, what) => {
    // A STATUS OR ATTACHMENT IS NEWS THE STRIP READS OFF DISK — without an announce his rows wear
    // yesterday's face until some unrelated run event ticks a refresh (his catch, 2026-10-26: the
    // run he watched me declare abandoned "doesn't show any abandoned"). Same seam as
    // whiteboard.updated: write, then say so.
    emit(s, { kind: "run.updated", id, source, what });
  });

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
  const systemviewServer = systemview.serverFor({
    projectCode,
    slot: agent ? agent.id : null,
    // the half the hub cannot do: drop the run record and tell every strip in this project, so a
    // lane cleared by an agent disappears the same way one cleared by his press does
    onLaneRemoved: (branch) => removeLaneByBranch(projectCode, branch),
    onLaneBroughtIn: (branch, opts) => recordLaneBroughtIn(projectCode, branch, opts),
    // A JOB'S RUN POINTS AT THE REPORT IT FILED (RFC-067 §2 part 6). The host is the only place
    // that knows both halves — which document was just filed, and whether this session is working a
    // job — so the stamp happens here and nothing is asked of the agent.
    // WHICH LANES THIS PROJECT HAS REGISTERED — run records, which live on this side. The lanes
    // verb intersects the hub's git answer with this, so a branch nobody registered is reported as
    // a branch rather than listed as a lane.
    // REGISTERED LANES, ASKED OF THE BRANCH rather than of this project — see
    // worklist.registeredLanes for why the two axes are different and what scoping it by project
    // got wrong.
    laneRuns: () => [...worklist.registeredLanes()],
    // AN AGENT CAN SAY "I UPDATED THIS, TELL THE MEMBERS" — with no window open anywhere. Until
    // now the only trigger was the window's press, so an agent that moved an objective in an arc
    // could not announce it and every member stayed behind. Injected rather than imported for the
    // same reason as the three above: this file requires systemview.cjs and cannot be required
    // back. The EMIT stays here, where the session host lives, so the tool builds an event and
    // never announces one itself.
    // RFC-073 §3.1 — the agent's write door, with the caller's own name stamped as `by` so a mark
    // is attributable and cannot speak as anybody else.
    markBlock: (absPath, line, attrs) => markBlock(absPath, line, attrs, projectCode),
    announceUpdate: async (payload = {}) => {
      // Resolving a project code to a folder happens HERE and not in the tool, because seven
      // places in this shell already read projects.json and an eighth copy is worse than a
      // slightly longer injected function.
      let abs = "";
      try {
        const map = JSON.parse(fs.readFileSync(PROJECTS_FILE(), "utf8")) || {};
        const dir = map[String(payload.project || projectCode || "")];
        const rel = String(payload.path || "");
        if (dir) abs = path.isAbsolute(rel) ? rel : path.join(path.resolve(dir), rel);
      } catch {}
      const built = await buildUpdate({ ...payload, by: payload.by || projectCode }, abs);
      if (!built.ok) return built;
      try {
        emitAmbient(built.event);
      } catch (e) {
        return { ok: false, error: (e && e.message) || "could not announce it" };
      }
      return { ok: true, sent: built.members, arc: built.event.arc || "", path: built.event.path };
    },
    onReportFiled: ({ path: at, label }) => {
      const open = s.currentRun && String(s.currentRun.source || "").startsWith("job:")
        ? { job: s.currentRun.source.slice(4), runId: s.currentRun.id }
        : s.lastJobRun || null;
      if (!open) return; // a report filed outside a job is just a report, which is most of them
      try { require("./jobs.cjs").reported(open.job, open.runId, { path: at, label }); } catch {}
    },
  });

  // The agent's default; the header's knob overrides it per session (setThinking). Carried on the
  // session so `session.started` can say it and a window can draw the knob honestly.
  s.thinking = (agent && agent.def && agent.def.thinking) || null;
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
  // RFC-073 slice 4 — a session arriving is one cause of a parse: whatever fired while nobody was
  // running is delivered now, and told= keeps it to exactly what is still owed.
  sweepDocuments().catch(() => {});
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
// RFC-013 — the every-turn shelf: the highest rent in the system (spends attention on every
// single prompt), which is why its cap is the smallest. Read live per send; rides as a leading
// block inside the SAME user message, so the feed (which echoes only the human's text) never
// shows it as words he typed. Extracted so the boundary is testable without a live model —
// delivery verified by a test, not by reading my own code.
function sendContent(identity, text, pics = []) {
  let turnShelf = "";
  try { turnShelf = context.injectedFor(identity, "every-turn"); } catch {}
  return [
    ...pics.map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.mime, data: im.data },
    })),
    ...(turnShelf && String(text || "").trim() ? [{ type: "text", text: turnShelf }] : []),
    // A picture with no caption is a whole message — do not invent words for it, and do not send
    // an empty text block, which the API rejects.
    ...(String(text || "").trim() ? [{ type: "text", text }] : []),
  ];
}

function send(key, text, images = []) {
  const s = get(key);
  // THE HUMAN ASKED. Cleared before the emit below, because emitting `user.prompt` is what trips
  // the turn-start transition that commits the flag — set it after and the commit reads the stale
  // value from whatever queued last.
  s.nextTurnFromHook = false;
  const pics = (Array.isArray(images) ? images : []).filter((im) => im && im.data && im.mime);
  // echoed into the feed so history carries BOTH sides — a late-attaching view
  // (or another window) can replay the whole conversation, not just the answers
  emit(s, {
    kind: "user.prompt",
    text,
    images: pics.map((im) => ({ name: im.name || "image", mime: im.mime, thumb: im.thumb || "" })),
  });
  const content = sendContent({ projectCode: s.projectCode, slot: s.agentId }, text, pics);
  if (!content.length) return;
  const turnInj = content.find((b) => b.text && b.text.startsWith('<injected-context moment="every-turn"'));
  if (turnInj) emit(s, { kind: "context.injected", moment: "every-turn", chars: turnInj.text.length, text: turnInj.text });
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

// THE USER'S WIPE — the whiteboard is a shared surface, so either side may erase it. No
// notification ceremony on the agent side: its next `get` shows the board empty, which is how
// anyone finds out a whiteboard got erased — by looking at it.
function wipeWhiteboard(key) {
  const s = get(key);
  s.whiteboard = "";
  worklist.writeBoard(s.worklistOwner, "");
  emit(s, { kind: "whiteboard.updated", text: "" });
  return true;
}

// STANDING LANES (RFC-059 slice 2) — the rows read run files + git, not session events, so they
// outlive refreshes. Keyed by PROJECT, not by this session: the lanes an earlier life of this
// chat spawned still belong on its strip. Delete is the user's press, after the row's confirm.
function laneRuns(key) {
  return worklist.laneRuns(String(key || "").split(":")[0]);
}

// EVERY ROW THE STRIP DRAWS, not just the lanes. Additive beside `laneRuns` rather than a widening
// of it: that one is also read by `runIdForLane` and the receipt path, where "lane" means lane.
function stripRuns(key) {
  return worklist.stripRuns(String(key || "").split(":")[0]);
}
const deleteLaneRun = (_key, id) => worklist.deleteRun(id);

// A LANE DISAPPEARING IS AN EVENT — and until now it was the only lifecycle moment that wasn't.
//
// The strip's rows come from run FILES, and `refreshLanes()` re-reads only when something ticks:
// `run.started`, `run.finished`, `todo.updated` with a `lane:` source. Nothing ticked when a lane was
// REMOVED. The only reason the user's strip ever dropped a row is that his own press called
// refreshLanes() in the same callback (useAgentSession.js:113) — so the row vanished because he
// clicked, not because the lane was gone. Anyone else clearing a lane left a ghost row sitting on a
// surface whose entire claim is that it reads state instead of being told.
//
// The precedent is eight lines up: wipeWhiteboard emits `whiteboard.updated` so every watcher clears
// together, whoever erased it. Lanes get the same treatment. Keyed by PROJECT because that is how a
// lane row is keyed — the lanes an earlier life of this chat spawned still belong on its strip.
function announceLaneRemoved(projectCode, branch) {
  let told = 0;
  for (const s of sessions.values()) {
    if (s.projectCode !== projectCode) continue;
    emit(s, { kind: "lane.removed", branch: String(branch || "") });
    told++;
  }
  return told;
}

// RECORDING A BRING-IN (RFC-063's door, 2026-10-03). The receipt is stamped by the OWNER at the
// moment it applies a lane's diff, because that is the only moment the fact is known for certain —
// twenty minutes later the owner has edited those files and derivation has gone blind. BUApp proved
// it from the other side: a verified bring-in read "can't tell (0/1 match)" within the hour.
//
// `by` is the session's own slot, which is honest: the agent that applied the diff is the one making
// the claim, and a receipt is a claim. `markBroughtIn` refuses a run that does not exist, so a
// receipt can never mint a lane — and it lives on the run record, so it dies with the lane.
function recordLaneBroughtIn(projectCode, branch, { base = "", repo = "" } = {}) {
  const id = worklist.runIdForLane(projectCode, String(branch || "").trim());
  if (!id) return null;
  const me = [...sessions.values()].find((s) => s.projectCode === projectCode);
  return worklist.markBroughtIn(id, {
    base,
    repo: repo || projectCode,
    by: (me && me.agentId) || `project:${projectCode}`,
  });
}

// BY BRANCH, NOT BY RUN ID. A caller holding a branch name should not have to learn the id scheme to
// clean up after itself, and the branch is the only name a lane has in every other door.
//
// THE RECORD GOING IS NOT CONDITIONAL ON FINDING IT. A lane whose run file was already swept (two
// weeks of retention) still has a worktree and a branch on disk and still has a ROW — so a remove
// that refused because there was no record would leave exactly the lane nobody can clear. It reports
// `record: false` and announces anyway.
function removeLaneByBranch(projectCode, branch) {
  const b = String(branch || "").trim();
  if (!b) return { ok: false, error: "which branch?" };
  const id = worklist.runIdForLane(projectCode, b);
  const record = id ? worklist.deleteRun(id) : false;
  return { ok: true, branch: b, record, told: announceLaneRemoved(projectCode, b) };
}

// Model switching — a real SDK primitive (verified by experiment 2026-08-24), not
// a slash command. supportedModels() is the menu: the SDK owns the list, so no
// panel hardcodes one. setModel is a REQUEST — truth arrives on the next turn's
// re-init (another session.started, same sdk id = update, the compaction
// convention) and on every assistant message's own `model` stamp.
const models = (key) => get(key).query.supportedModels();
const setModel = async (key, model) => { await get(key).query.setModel(model); return true; };
// HOW MUCH OF ITS THINKING THIS SESSION SHOWS — his knob. `display` is the SDK's thinkingDisplay
// ("summarized" | "highlights" | "omitted" | null for the raw stream); `budget` its thinking tokens.
// Unlike setModel this takes effect for the rest of the session without a re-init, so the session
// records it and says so at once — there is no next-turn truth to wait for.
const setThinking = async (key, { display = null, budget = null } = {}) => {
  const s = get(key);
  const d = ["summarized", "highlights", "omitted"].includes(display) ? display : null;
  const b = budget != null && Number.isFinite(Number(budget)) ? Number(budget) : null;
  await s.query.setMaxThinkingTokens(b, d);
  s.thinking = { display: d, budget: b };
  emit(s, { kind: "session.thinking", display: d, budget: b });
  return s.thinking;
};
const thinkingOf = (key) => get(key).thinking || null;

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
    reinit: true,
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
  [...sessions.values()].map((s) => {
    // ONE PASS, READ TWICE. staleParts was called twice per session per poll — memoised, so
    // usually one stat each, but a cache miss (any def edit) paid the full composition hash twice
    // in the same projection. The board card is his; the fix is a local.
    const staleNames = staleParts(s);
    return {
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
    staleParts: staleNames,   // the NAMES that moved — the panel says which, not "something"
    stale: staleNames.length > 0,
    capabilities: s.capabilities || null,   // null = not started yet, NOT "has nothing"
    usedBy: s.usedBy || [],                 // which applications are using this agent
    worklist: s.worklist || [],
    startedAt: s.startedAt,
  };
  });

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
            out.push({
              kind: "tool.result",
              id: b.tool_use_id,
              ok: !b.is_error,
              detail: brief(b.content, resultBudget(callNames.get(b.tool_use_id))),
              // Replay shows the picture too — a log that only shows it live is a log that forgets.
              ...(filedImage(b.content) ? { image: filedImage(b.content) } : {}),
              ts,
            });
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
  sendContent, startInjection, postCompactionInjection, // RFC-013 test seams
  composedStamp, // test seam: proves which fields staleness watches, and that the hot path is cached
  repoHolding, // test seam: a lane's branch may live in a COUPLED repo, not the session's own folder
  purgeAgent, agentRuns,
  setThinking, thinkingOf, // the thinking knob — RFC-073's cousin: how much of the reasoning reaches the window
  open, send, answerPermission, interrupt, wipeWhiteboard, laneRuns, stripRuns, deleteLaneRun, removeLaneByBranch, announceLaneRemoved, recordLaneBroughtIn, models, setModel, subscribe, history, kill, reinit, announceReinit, list, keyOf, noteUsedBy,
  transcriptsFor, transcriptMessages, dismissTranscript, toolSummary,
  // ONE READER FOR THE RUN STORE. host.cjs and files-host.cjs each opened this
  // file by path; with the name changing, a missed caller reads an empty object
  // and silently reports no resumable sessions — the same "both halves moved,
  // nothing left answering" shape that cost the blank-code-panel hour. Anyone
  // who needs the store takes it from here, so the rename is one edit forever.
  EVENTS,
  emitAmbient, ambientHistory, subscribeAmbient,
  announceDocument, sweepDocuments, markBlock,
  weights,
  loadSessionStore: loadStore,
  saveSessionStore: saveStore,
  // RFC-012 — THE TURN BOUNDARY, EXPORTED SO IT CAN BE PROVEN. Holding a pointer until the agent
  // yields is the kind of behaviour that is invisible when it is right and indistinguishable from
  // "the hook never fired" when it is wrong, and the only thing that separates those two readings
  // is a test that can drive the boundary without a live model on the other end.
  TURN_SETTLE_MS, idleWakeMs, __setIdleTick, fireHooks, armTurnEnd, armIdle, flushTurnEndHooks, maybeNudge, quietOf, nudgePicks,
};
