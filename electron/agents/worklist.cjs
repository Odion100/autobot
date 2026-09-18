// THE AGENT WORKLIST — harness state, not project content (Odion's framing, via
// systemview-test, 2026-08-25). Every session gets one, in any repo, in any room.
//
// WHY A TOOL AND NOT A CONVENTION: without a tool call a plan is prose the model
// writes and forgets. With one it is state that outlives the turn and anything
// watching the event stream can render it.
//
// MEASURED FIRST (2026-08-25): this SDK ships NO todo tool. Asked to plan with
// one, the model called ToolSearch("todo task list checklist") and got back
// cron/task/worktree/messaging — nothing. So `case "TodoWrite"` in sessions.cjs's
// toolSummary is dead code from an older tool set, and systemview-test's premise
// was right: the harness has to provide this. We provide it as an in-process SDK
// MCP tool, which means no subprocess, no port, and the handler runs right here
// where the session state lives.
//
// THE WHOLE LIST, EVERY CALL — never deltas. That rule is enforced at the TOOL,
// not just in the event: if the only way to write is to send the entire list,
// a delta cannot be expressed, so a subscriber arriving mid-session can always
// render from one event. Their argument, and it belongs one layer lower than
// they proposed it.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const SERVER = "worklist";
const TOOL = "set";
const TOOL_READ = "get";
// SDK MCP tools are addressed as mcp__<server>__<tool>; a definition that pins
// `tools` must include this name or the agent silently loses its worklist.
const TOOL_NAME = `mcp__${SERVER}__${TOOL}`;
const TOOL_READ_NAME = `mcp__${SERVER}__${TOOL_READ}`;
// THE WHITEBOARD — the worklist's sibling, same store, same lifetimes (his design, 2026-09-16).
// The list is the state of the WORK; the board is the state of the CONVERSATION — drafts under
// discussion, values being worked out, the things that otherwise float up the chat and have to be
// re-said. One tool is the whole API: markdown in replaces the board, nothing in wipes it.
const TOOL_BOARD = "whiteboard";
const TOOL_BOARD_NAME = `mcp__${SERVER}__${TOOL_BOARD}`;
// All names, for the allow-list: pinning `tools` without the reader leaves an
// agent able to write a plan it can never read back.
const TOOL_NAMES = [TOOL_NAME, TOOL_READ_NAME, TOOL_BOARD_NAME];

// ONE ACTIVE ITEM, enforced rather than requested (their §3 left it to me).
// "What is it doing right now" has to be unambiguous or the rendering is a guess;
// a rule the tool applies can't drift, a convention the model remembers will.
// Extra actives are demoted to pending in order, so the FIRST one wins — the
// model's own ordering is the intent, and we don't reorder its plan.
// WHERE THE STEPS CAME FROM. A skill is a procedure — an ordered list of steps someone follows —
// so when one fires, its steps ARE a worklist. Recording which skill they came from is what turns
// "the skill fired" into "the skill was executed, and it got to step 3."
//
// That gap is real and it is the one thing we could never measure about a skill: the Skill tool
// tells us it was CHOSEN, and nothing at all tells us it was FOLLOWED. An agent can read seven
// steps, do two, and the system sees a success.
//
// `source` is provenance, `owner` is ownership, and they are orthogonal on purpose: a job's list is
// owned by `job:<id>` and may carry steps sourced from several skills. One structure, two questions
// — whose plan is this, and where did these steps come from.
const sourceOf = (v) => String(v || "").trim().slice(0, 60);

function normalize(items = []) {
  let seenActive = false;
  return items.slice(0, 50).map((it, i) => {
    let state = it.state === "active" || it.state === "done" ? it.state : "pending";
    if (state === "active") {
      if (seenActive) state = "pending";
      else seenActive = true;
    }
    return {
      id: String(it.id ?? i + 1),
      text: String(it.text ?? "").slice(0, 300),
      state,
    };
  }).filter((it) => it.text);
}


// ---------------------------------------------------------------------------------------------
// DURABLE WORKLISTS — RFC-005 §3. One concept, two lifetimes.
//
// The worklist was session state: it lived in the session store under the session's own key, and
// nothing outside that session could read it. That is right for a conversation and wrong for a
// JOB, where reading the plan after the run is the entire point — a job that ran at 3am is a job
// nobody watched, so the list it left behind is the only account of what it did.
//
// So the worklist gains an OWNER instead of gaining a parallel structure. `session:<key>` today,
// `job:<id>` when jobs land, `<cwd-key>` for the terminal door that already wrote here. The RFC is
// explicit about why it must not be a second "job steps" model: two structures describing the same
// progress drift within a month, and then the surface showing one is lying about the other.
//
// ONE FILE PER OWNER, and the file is the truth. Not a cache beside the session store — a copy
// that can disagree is worse than no copy, and the session store already proved it by holding a
// `worklist` key nobody could read from outside.
// Overridable for TESTS ONLY. The retention test calls pruneRuns(now + 15 days) — run against
// the real store, that swept every closed run on the machine, including the user's live lane
// records (2026-09-17, his rows vanished). A test that exercises a janitor gets a scratch house.
const DIR = process.env.AUTOBOT_WORKLISTS_DIR || path.join(os.homedir(), ".autobot", "worklists");

// An owner is a free-form string; it becomes a filename, so it is sanitised rather than trusted.
// `job:abc` and `session:abc` must not collide, which is why the separator survives as a dash
// instead of being stripped.
const fileFor = (owner) =>
  path.join(DIR, `${String(owner || "unowned").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-90)}.json`);

function readFile(owner) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(owner), "utf8")) || {};
  } catch {
    return {};
  }
}

function read(owner) {
  const r = readFile(owner);
  return Array.isArray(r.items) ? r.items : [];
}

const readBoard = (owner) => String(readFile(owner).whiteboard || "");

function save(owner, patch) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const cur = readFile(owner);
    // `updatedAt` is not decoration: for a list nobody watched, "when did this last move" is the
    // difference between a job that finished and a job that stopped.
    const next = { owner, items: cur.items || [], source: cur.source, whiteboard: cur.whiteboard, session: cur.session, ...patch, updatedAt: Date.now() };
    if (!next.source) delete next.source;
    if (!next.whiteboard) delete next.whiteboard;
    if (!next.session) delete next.session;
    fs.writeFileSync(fileFor(owner), JSON.stringify(next, null, 2));
  } catch {}
}

// The list and the board share one file, so each write patches its own half and PRESERVES the
// other — a set() that clobbered the whiteboard would make the two features enemies.
function write(owner, items, source = "") {
  save(owner, { items, source: source || undefined });
  return items;
}

function writeBoard(owner, text) {
  const t = String(text || "").slice(0, 20000);
  save(owner, { whiteboard: t || undefined });
  return t;
}

// ---------------------------------------------------------------------------------------------
// RUNS — an EXECUTION owns its list (his design, 2026-09-17). One flat list per session broke the
// moment skills chain: "a skill replaces what's on the list" meant replace = destroyed evidence,
// and the half-done list of the outer skill was exactly the artifact worth keeping. So a skill
// firing is a RUN, the run owns its list under `run:<id>`, and the session's own plan stays its
// own file. Completion is OBSERVED, not declared: a run with every item done is finished; one
// left mid-flight is the record of where it died. No state flag to lie with.
// ---------------------------------------------------------------------------------------------
// RETENTION — his rule: no stale logs piling up. A CLOSED run (every item done) older than two
// weeks is a record nobody will read again; the sweep runs once per process start, quietly. A run
// that DIED mid-list is never swept — where a procedure died is the record, and it stays until
// someone acts on it.
const RUN_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
function pruneRuns(now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return 0; }
  let swept = 0;
  for (const n of names) {
    if (!n.startsWith("run-") || !n.endsWith(".json")) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8"));
      const items = Array.isArray(r.items) ? r.items : [];
      if (items.length && items.every((i) => i.state === "done") && now - (r.updatedAt || 0) > RUN_KEEP_MS) {
        fs.unlinkSync(path.join(DIR, n));
        swept++;
      }
    } catch {}
  }
  return swept;
}
try { pruneRuns(); } catch {}

let runSeq = 0;
const newRunId = () => `r${Date.now().toString(36)}${(runSeq++ % 1296).toString(36).padStart(2, "0")}`;
const runOwner = (id) => `run:${id}`;
const allDone = (items) => items.length > 0 && items.every((i) => i.state === "done");

// The comeback: a harness restart mid-run must not orphan the run. The newest unfinished run
// with this source, started by this session, is still THE run — resume it instead of minting a
// second id and leaving a corpse that reads as died-at-step-3.
function openRunFor(session, source) {
  const hit = all().find(
    (r) => r.owner.startsWith("run:") && r.source === source && r.session === session && !allDone(r.items)
  );
  return hit ? hit.owner.slice(4) : null;
}

function writeRun(id, session, items, source) {
  save(runOwner(id), { items, source: source || undefined, session });
  return items;
}

// STANDING LANES (RFC-059 slice 2, his design) — a lane row is born from a spawn and dies at
// cleanup; nothing in between kills it. The rows read THIS, not session events, so a refresh
// cannot eat a row whose debris is still on disk. Project-scoped: a run's session field is
// `session:<project>:<id>`, and the lane rows belong to the project's chat, whichever session
// of it is open now.
function laneRuns(projectCode) {
  const pre = `session:${projectCode}:`;
  return all().filter(
    (r) => r.owner.startsWith("run:") && r.source.startsWith("lane:") && r.session.startsWith(pre)
  );
}

// The delete is the USER'S, pressed on the row after a confirm — never an agent tidying quietly.
// Scoped to run files by construction: the owner is minted from the id, so no path escapes DIR.
function deleteRun(id) {
  try {
    fs.unlinkSync(fileFor(runOwner(String(id || ""))));
    return true;
  } catch {
    return false;
  }
}

// Every worklist on this machine, newest first — what makes one readable AFTER the fact, by
// something that is not the session that wrote it.
function all() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  for (const n of names.filter((f) => f.endsWith(".json"))) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8"));
      const items = normalize(r.items || []);
      out.push({
        owner: r.owner || n.replace(/\.json$/, ""),
        // WHAT THIS LIST IS THE EXECUTION OF, when it is not somebody's own plan. This is the only
        // record that a procedure was actually followed rather than merely chosen.
        source: r.source || "",
        session: r.session || "",
        file: path.join(DIR, n),
        updatedAt: r.updatedAt || 0,
        items,
        whiteboard: String(r.whiteboard || ""),
        done: items.filter((i) => i.state === "done").length,
        total: items.length,
        active: (items.find((i) => i.state === "active") || {}).text || "",
      });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// One server per session: the handler closes over that session's update callback,
// so the tool needs no session id in its arguments and cannot write to the wrong
// list even if the model invents one.
// WRITE-ONLY WAS THE BUG (his catch, 2026-09-13): there was a `set` and nothing else, and
// the list is never fed back into a session — it went to the UI and stopped. So the plan
// survived a compaction in the harness while the agent on the other side went blind to it,
// and "update your worklist before compaction" was advice that could not pay off. `get`
// closes it: system context survives the boundary and tells the agent to read; the worklist
// holds the state. Two harness layers covering each other.
// AN UNKNOWN SOURCE GETS A REMINDER, NEVER AN ERROR (his design). `skill:x` / `job:y` may
// reference a real registry entry — or be a namespace the agent made up on purpose, which is
// legitimate. So the check appends one ignorable line: the agent that typo'd a real job reacts;
// the agent that named its own lane reads past it. `checkSource` is injected by sessions.cjs so
// this module stays free of the registries.
function serverFor(onSet, getList = () => [], onBoard = null, getBoard = () => "", getRun = null, checkSource = null) {
  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
      tool(
        TOOL,
        "Record your worklist for this session: the plan you are working through. " +
          "Send the COMPLETE list every time — items you omit are dropped. Mark exactly " +
          "one item active (the one you are doing right now), the finished ones done, " +
          "and the rest pending. Call this when you start a multi-step task, and again " +
          "each time a step finishes or the plan changes.",
        {
          items: z
            .array(
              z.object({
                id: z.string().optional().describe("stable id; keep it the same across calls"),
                text: z.string().describe("what the step is, in a few words"),
                state: z.enum(["pending", "active", "done"]),
              })
            )
            .describe("the whole list, in order — not a delta"),
          source: z
            .string()
            .optional()
            .describe(
              'where these steps came from, when they are not your own plan: "skill:<name>" when ' +
                'you are following a skill\'s procedure, "job:<id>" when running a job — or any ' +
                "name you choose, when you just want a separate list for a lane of work. A source " +
                "opens a RUN — a separate list owned by that execution; your session plan is " +
                "untouched, and marking every item done is what completes the run. It is how the " +
                "system knows a procedure was FOLLOWED and not just chosen — leave it off for " +
                "your own working plan"
            ),
        },
        async ({ items, source }) => {
          const list = normalize(items);
          const src = sourceOf(source);
          onSet(list, src);
          const done = list.filter((i) => i.state === "done").length;
          const active = list.find((i) => i.state === "active");
          let note = "";
          if (src && checkSource) {
            try { note = checkSource(src) || ""; } catch {}
          }
          return {
            content: [{
              type: "text",
              text: `worklist: ${done}/${list.length} done${active ? ` · now: ${active.text}` : ""}${note ? `\n${note}` : ""}`,
            }],
          };
        },
        // alwaysLoad: without it the tool sits behind ToolSearch and the model has
        // to go looking for it — which is exactly the search that came back empty
        // when we measured. A worklist nobody finds is not a worklist.
        { alwaysLoad: true }
      ),
      tool(
        TOOL_READ,
        "Read your worklist — the plan you recorded for this session, plus the open run's list " +
          "if a procedure is in flight, and the whiteboard. It is harness state, so it survives a " +
          "compaction that summarized the conversation away. One call restores all of it — call " +
          "it after a compaction, and any time you need to know where you left off.",
        {},
        async () => {
          const mark = (st) => (st === "done" ? "\u2713" : st === "active" ? "\u25b8" : "\u00b7");
          const render = (items) => items.map((i) => `${mark(i.state)} ${i.text}`).join("\n");
          const list = normalize(getList() || []);
          // ONE CALL, THE WHOLE SESSION STATE: the session plan, the open run's list when a
          // procedure is in flight, and the whiteboard. Anything `get` leaves out is the one
          // piece of held state a compaction still eats.
          const run = getRun ? getRun() : null;
          const runTail = run && run.items && run.items.length
            ? `\n\nrun ${run.id} (${run.source}): ${run.items.filter((i) => i.state === "done").length}/${run.items.length} done\n${render(normalize(run.items))}`
            : "";
          const board = String(getBoard() || "");
          const boardTail = board ? `\n\nwhiteboard:\n${board}` : "";
          if (!list.length) {
            return { content: [{ type: "text", text: `worklist: empty — nothing recorded for this session.${runTail}${boardTail}` }] };
          }
          const done = list.filter((i) => i.state === "done").length;
          return {
            content: [{ type: "text", text: `worklist: ${done}/${list.length} done\n${render(list)}${runTail}${boardTail}` }],
          };
        },
        // same reasoning as set: a reader the model has to hunt for is a reader it
        // will not reach for in the one moment it matters — straight after a compaction.
        { alwaysLoad: true }
      ),
      tool(
        TOOL_BOARD,
        "Your whiteboard — the freeform markdown surface beside the worklist, for the CONVERSATION'S " +
          "working state: drafts being refined, values under discussion, open threads — the things " +
          "that otherwise float up the chat and have to be re-said. Send the WHOLE board each time; " +
          "it replaces what was there. Send nothing to wipe it. It renders live for the user (who " +
          "can also wipe it at any time), and it survives compaction — `get` returns it with the " +
          "list. Worklist items are tasks; this is prose. Long artifacts belong in files, not here.",
        {
          markdown: z
            .string()
            .optional()
            .describe("the whole board, as markdown — replaces what was there; omit (or empty) to wipe"),
        },
        async ({ markdown }) => {
          const text = String(markdown || "");
          if (onBoard) onBoard(text);
          return {
            content: [{
              type: "text",
              text: text ? `whiteboard: ${text.length} chars held` : "whiteboard: wiped",
            }],
          };
        },
        { alwaysLoad: true }
      ),
    ],
  });
}

module.exports = { serverFor, normalize, DIR, read, write, readBoard, writeBoard, all, newRunId, runOwner, openRunFor, writeRun, allDone, pruneRuns, laneRuns, deleteRun, SERVER, TOOL, TOOL_READ, TOOL_BOARD, TOOL_NAME, TOOL_READ_NAME, TOOL_BOARD_NAME, TOOL_NAMES };
