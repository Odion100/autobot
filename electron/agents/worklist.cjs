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
// THE SDK IS LOADED WHERE IT IS USED, NOT AT MODULE SCOPE — because this module has two readers
// and only one of them wants an MCP server. `@anthropic-ai/claude-agent-sdk` is ESM-only
// (`type: module`, no `require` export), so a top-level require makes the WHOLE module unloadable
// to any CommonJS caller on a node older than 22.12 — and the hub runs v20.11.1 while the shell and
// the terminal run 22+. Measured 2026-10-27: a saved spec in the hub tried to read a run record and
// got `ERR_REQUIRE_ESM` for the SDK, a dependency it never wanted; the run-record half of the
// nudge's law could not be defended from the one process that hosts the specs. Requiring inside
// `toolsFor`/`serverFor` keeps the data functions reachable from anywhere.
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
const TOOL_ATTACH = "attach";
const TOOL_BOARD = "whiteboard";
const TOOL_STATUS = "status";
const TOOL_ATTACH_NAME = `mcp__${SERVER}__${TOOL_ATTACH}`;
const TOOL_BOARD_NAME = `mcp__${SERVER}__${TOOL_BOARD}`;
const TOOL_STATUS_NAME = `mcp__${SERVER}__${TOOL_STATUS}`;
// All names, for the allow-list: pinning `tools` without the reader leaves an
// agent able to write a plan it can never read back.
const TOOL_NAMES = [TOOL_NAME, TOOL_READ_NAME, TOOL_ATTACH_NAME, TOOL_BOARD_NAME, TOOL_STATUS_NAME];

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

// SIDECARS ARE DOTFILES, and the rule is enforced in one place so it cannot rot: `all()` reads
// every .json in this directory as a worklist, so anything else living here has to be excluded by
// SHAPE rather than by name. A leading dot is a shape fileFor() cannot produce — it strips every
// character outside [a-zA-Z0-9] to a dash and then strips leading dashes — so no owner, however
// it is spelled, can ever collide with a sidecar or be hidden by this filter.
const isSidecar = (name) => name.startsWith(".");

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
    // EVERY KEY A WRITER DOES NOT OWN IS CARRIED FORWARD BY HAND, and one that is forgotten here
    // is silently destroyed by the next unrelated write — the lesson the whiteboard already taught
    // (a set() that clobbered the board made the two features enemies). `broughtIn` was the first
    // passenger; `selfDirected` (RFC-066) is the newest, and it rides for the same reason: it is
    // stamped once at a run's birth, so every later list write is a write that does not know it.
    const next = { owner, items: cur.items || [], source: cur.source, whiteboard: cur.whiteboard, session: cur.session, broughtIn: cur.broughtIn, status: cur.status, repo: cur.repo, selfDirected: cur.selfDirected, attachments: cur.attachments, nudges: cur.nudges, ...patch, updatedAt: Date.now() };
    if (!next.source) delete next.source;
    if (!next.whiteboard) delete next.whiteboard;
    if (!next.session) delete next.session;
    if (!next.broughtIn) delete next.broughtIn;
    if (!next.status) delete next.status;
    if (!next.repo) delete next.repo;
    // FALSE IS ABSENT, ON PURPOSE. Every run record already on disk is commissioned work, so
    // "no key" and "false" must be the same answer — which is what makes this need no migration.
    if (!next.selfDirected) delete next.selfDirected;
    // AN EMPTY LIST IS NO LIST. A run with nothing attached must read exactly like every run
    // already on disk — which is what makes this need no migration (RFC-072 §11.2).
    if (!Array.isArray(next.attachments) || !next.attachments.length) delete next.attachments;
    // ABSENT IS "NEVER NUDGED", so an explicit null from an items write clears it rather than
    // writing a zero nobody can distinguish from a count.
    if (!next.nudges) delete next.nudges;
    fs.writeFileSync(fileFor(owner), JSON.stringify(next, null, 2));
  } catch {}
}

// The list and the board share one file, so each write patches its own half and PRESERVES the
// other — a set() that clobbered the whiteboard would make the two features enemies.
// MOVING THE LIST RESETS THE NUDGE COUNT, and that is what makes "nudged 3 times, no movement"
// literally true rather than a figure of speech: the count can only accumulate across a stretch
// where nobody touched the list. An agent that comes back, does a step and stalls again earns a
// fresh set of nudges, which is right — it is a different stall.
function write(owner, items, source = "") {
  save(owner, { items, source: source || undefined, nudges: null });
  return items;
}

function writeBoard(owner, text) {
  const t = String(text || "").slice(0, 20000);
  save(owner, { whiteboard: t || undefined });
  return t;
}

// WHICH REPO HOLDS THE LANE'S BRANCH — stamped once at registration, where repoHolding just
// answered it (his catch: autobot lanes and systemview lanes read identically on the strip, so
// the row could not answer "is this repo clean"). A project CODE when the registry knows the
// folder, the folder's basename when it does not. On the record, so the row survives restarts
// like everything else the strip draws.
function markLaneRepo(id, repo) {
  const owner = runOwner(String(id || ""));
  const name = String(repo || "").trim().slice(0, 80);
  if (!name) return null;
  try { if (!fs.existsSync(fileFor(owner))) return null; } catch { return null; }
  save(owner, { repo: name });
  return name;
}

// ---------------------------------------------------------------------------------------------
// RUNS — an EXECUTION owns its list (his design, 2026-09-17). One flat list per session broke the
// moment skills chain: "a skill replaces what's on the list" meant replace = destroyed evidence,
// and the half-done list of the outer skill was exactly the artifact worth keeping. So a skill
// firing is a RUN, the run owns its list under `run:<id>`, and the session's own plan stays its
// own file. Completion is OBSERVED, not declared: a run with every item done is finished; one
// left mid-flight is the record of where it died. No state flag to lie with.
// ---------------------------------------------------------------------------------------------
// RETENTION — his rule: no stale logs piling up. A CLOSED run (every item done) is a record
// nobody will read again; the sweep runs once per process start, quietly. A run that DIED
// mid-list is never swept — where a procedure died is the record, and it stays until someone acts
// on it.
//
// THE WINDOW IS A SETTING, NOT A CONSTANT — his ask by name: "how quickly the worklist gets
// deleted should be added to the worklist settings." It lives in the same store the cog panel
// already reads and writes (`nudge.json`, `keepHours`), because a number only an agent can change
// is a number he has to ask for every time.
//
// READ PER SWEEP, and lazily: the janitor runs at module load, so a top-level require would make
// every consumer of the worklist pull in the settings module to delete nothing. A store that cannot
// be read falls back to the default rather than refusing to prune — a janitor that stops working
// because a settings file is malformed is a worse failure than one that uses twelve hours.
const KEEP_FALLBACK_H = 12;
function keepMs() {
  try {
    return require("./nudge.cjs").readSettings().keepHours * 60 * 60 * 1000;
  } catch {
    return KEEP_FALLBACK_H * 60 * 60 * 1000;
  }
}
// A SOURCE THAT STARTS "lane/" IS A MISSPELLED LANE, not a kind of run. Every reader keys on
// "lane:", so this spelling files a record nothing can ever show — the write door refuses it by
// name (sessions.cjs), and pruneRuns retires the ones already on disk. One predicate, so the
// refusal and the janitor can never drift apart about what the dead convention looks like.
const misspelledLane = (source) => /^lane\//.test(String(source || ""));

function pruneRuns(now = Date.now(), keep = keepMs()) {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return 0; }
  let swept = 0;
  for (const n of names) {
    if (!n.startsWith("run-") || !n.endsWith(".json")) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8"));
      // THE PRE-`lane:` CONVENTION IS RETIRED (2026-10-14). Three records from 2026-09-28 carried
      // source "lane/<branch>" — written before registration settled the spelling as
      // "lane:<branch>" — and they were invisible AND immortal: unreadable by every door BY
      // DESIGN (laneRuns, stripRuns and registeredLanes all key on "lane:"), and never all-done,
      // so the age rule below never aged them out. Their branches are long deleted, so
      // normalising them into visibility would draw rows pointing at nothing, in rooms that never
      // asked — retirement is the honest end, and the proactive report of 2026-10-14 preserves
      // what each one said.
      if (misspelledLane(r.source)) {
        fs.unlinkSync(path.join(DIR, n));
        swept++;
        continue;
      }
      const items = Array.isArray(r.items) ? r.items : [];
      if (items.length && items.every((i) => i.state === "done") && now - (r.updatedAt || 0) > keep) {
        fs.unlinkSync(path.join(DIR, n));
        swept++;
      }
    } catch {}
  }
  return swept;
}
try { pruneRuns(); } catch {}

// ---------------------------------------------------------------------------------------------
// LAST DONE — the residue a swept run leaves behind (RFC-067 §4, the one build chores needed).
//
// THE PROBLEM: the board asks "did a run with this line's source close inside the current period",
// and pruneRuns deletes closed runs after fourteen days. A MONTHLY line therefore has no run left
// to find and reads "never" when the truth is "42 days ago" — wrong in exactly the case the board
// exists for.
//
// WHY NOT AN EXCEPTION IN THE JANITOR, which was the other candidate:
//   1. A run only exists BECAUSE a source was given — writeRun is the sole writer of run files and
//      is never called without one. So "sourced runs" is every run there is, and an exception for
//      them is pruneRuns repealed.
//   2. Narrowing it to "sources that are on somebody's board" makes the janitor read the agent
//      registry. This module is deliberately registry-free (see `checkSource`, injected by
//      sessions.cjs for precisely that reason).
//   3. Even narrowed it keeps WHOLE records — items, whiteboard, receipt — one per execution,
//      forever, for the sources that fire most often. A daily line is 365 files a year nobody will
//      ever read, which is the pile the janitor exists to prevent.
//
// SO: ONE INTEGER PER (PROCEDURE, PLACE), written at the moment a run closes. It cannot grow with
// time, only with the number of distinct procedures — and pruneRuns is not reopened, which matters
// for the one function here that has already destroyed the user's live records once.
//
// IT IS NOT A SECOND TRUTH, it is the same truth at lower resolution: the run record is PROOF and
// outranks the stamp wherever it still exists (see lastClosedBySource — both are read and the
// NEWEST wins, so they can only ever agree or the record can only ever be fresher). The stamp
// answers alone only for a period the janitor has already cleared.
//
// THE ONE PLACE THEY CAN DIFFER, stated rather than hidden: the user's 🗑 unlinks a run file and
// does not touch the stamp, so a deleted lane record leaves its "last done" standing. That is
// correct — deleting a record is not undoing the work — but it is the seam.
const STAMPS = path.join(DIR, ".chore-stamps.json");

function readStamps() {
  try {
    const r = JSON.parse(fs.readFileSync(STAMPS, "utf8"));
    return r && typeof r === "object" ? r : {};
  } catch {
    return {};
  }
}

// WHERE a run ran. A run's session owner is `session:<projectCode>:<sessionId>` (the same scheme
// laneRuns reads), and the project is the only handle a run record carries on whose work it was —
// nothing on it names an agent. "-" for an owner with no project in it, which is a real case
// (`session:<key>` from the terminal door) and not an error.
const placeOf = (session) => {
  const m = /^session:([^:]+):/.exec(String(session || ""));
  return m ? m[1] : "-";
};

// Called at a close and nowhere else. Monotone: a stamp never moves backwards, so an out-of-order
// write cannot age a line that was done more recently.
function stampClosed(source, session, ts = Date.now()) {
  const src = sourceOf(source);
  const when = Number(ts) || 0;
  if (!src || when <= 0) return null;
  const place = placeOf(session);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const all = readStamps();
    const byPlace = all[src] && typeof all[src] === "object" ? all[src] : {};
    if ((Number(byPlace[place]) || 0) >= when) return Number(byPlace[place]);
    byPlace[place] = when;
    all[src] = byPlace;
    fs.writeFileSync(STAMPS, JSON.stringify(all, null, 2));
    return when;
  } catch {
    return null;
  }
}

// WHEN EACH PROCEDURE LAST CLOSED, as one map from one pass — because the board asks this per line
// and a per-line scan of the whole store would read every file three times over.
//
// READS NOTHING INTO EXISTENCE. This is the query half of the board and it writes nothing at all,
// which is the property that makes the board unable to disagree with what happened.
//
// `place` scopes it to one project; "" counts every place, which is the honest answer for a caller
// that has no placement to scope by.
function lastClosedBySource(place = "") {
  const out = {};
  const bump = (src, ts) => {
    if (src && ts > (out[src] || 0)) out[src] = ts;
  };
  for (const r of all()) {
    if (!r.owner.startsWith("run:") || !r.source) continue;
    if (place && placeOf(r.session) !== place) continue;
    // A CLOSE, NOT A VISIT: a run that died mid-list is the record of where it died, and it must
    // never check a line off. RFC-067: "a line checks off a CLOSED run, so a procedure abandoned
    // halfway leaves it unchecked — which is correct."
    if (!allDone(r.items)) continue;
    bump(r.source, r.updatedAt || 0);
  }
  const stamps = readStamps();
  for (const [src, byPlace] of Object.entries(stamps)) {
    if (!byPlace || typeof byPlace !== "object") continue;
    for (const [p, ts] of Object.entries(byPlace)) {
      if (place && p !== place) continue;
      bump(src, Number(ts) || 0);
    }
  }
  return out;
}

// One line's answer. 0 means never — an absence, never a guess at one.
const lastClosed = (source, place = "") => lastClosedBySource(place)[sourceOf(source)] || 0;

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

// WHO COMMISSIONED THIS RUN (RFC-066 §3) — stamped AT BIRTH and never re-asked, because
// `selfDirected` is a fact about the moment the run STARTED, not about the moment of any later
// write. A backgrounded lane whose fifth list write lands in a turn the user did start must not be
// quietly relabelled as commissioned work, and a run resumed after a harness restart must not be
// relabelled either. So the flag is written only when the file does not exist yet; after that
// save() carries it forward like every other key its writer does not own.
//
// THE CALLER IS THE HOST, NEVER THE AGENT. sessions.cjs reads it off the session's current-turn
// origin; there is no tool parameter that reaches this, by construction — surfaces read state,
// they never testify, and a field an agent sets about its own provenance is testimony.
function writeRun(id, session, items, source, { selfDirected } = {}) {
  const owner = runOwner(id);
  let born = true;
  let hadAbandoned = false;
  try { born = !fs.existsSync(fileFor(owner)); } catch {}
  // MOVEMENT SPENDS THE EXCUSE (his design, 2026-10-26). An "abandoned" declaration is what stops
  // the nudging — so a run that moves again is no longer abandoned, and keeping the word would let
  // one old declaration excuse every future stall. Cleared alongside the nudge count, same reason.
  try { hadAbandoned = !born && /abandon/i.test(String(((readFile(owner) || {}).status || {}).text || "")); } catch {}
  save(owner, {
    items,
    source: source || undefined,
    session,
    nudges: null, // movement resets it — see write()
    ...(hadAbandoned ? { status: null } : {}),
    ...(born ? { selfDirected: selfDirected === true } : {}),
  });
  // THE CLOSE IS THE ONLY MOMENT THIS IS KNOWN (RFC-067 §4). Nothing new observes anything: the
  // stamp rides the same `allDone` the board's checked/unchecked already depends on, written in
  // the one place run files are written, so a run cannot close without leaving its residue.
  if (allDone(items)) stampClosed(source, session);
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

// THE STRIP'S ROWS, ALL OF THEM — lanes, jobs and skills, read off the same run files and for the
// same reason `laneRuns` exists: a row whose debris is still on disk must survive a refresh.
//
// His report, 2026-10-14: *"the job rows disappeared, I didn't delete them."* They had. A job or
// skill row came only from the session's in-memory events, so a SHELL restart erased every one of
// them while lane rows stood — and the run records were on disk the whole time, which made the
// strip say a job never ran while the disk said it did. Worst for an unattended job: it fires at
// 3am, files its account, closes, and the only trace is a card that disappears on the next restart.
//
// A ROW LEAVES WHEN HE CLEARS IT, AND FOR NO OTHER REASON. There was a second rule here — a
// closed non-lane run drew its row only if it had closed inside the last 24 hours — and it was
// mine, not his. It was answering "a project accumulates every job and skill run it ever had, and
// forty rows of history is not a strip, it is a log", which is a real worry that had ALREADY BEEN
// ANSWERED ONE LEVEL UP: the strip is height-bounded and scrolls, and both kinds of card collapse
// to a single header line when closed. His ruling the day that landed, 2026-10-13: *"NOT by
// dropping closed runs out, which was the other half of the ask: a row that vanishes because its
// run finished is a row he cannot find again, and watching them is what the strip is FOR."* The
// window made this file override that decision by clock, invisibly — and against a clock he is
// racing without knowing: a job that closed at 3am is gone by the time he looks on day two.
// Measured before removing it: systemview-test drew 10 rows with the window and 25 without, so it
// was hiding fifteen closed runs, twelve days of context-maintenance, chore-round and path checks.
//
// WHAT BOUNDS IT NOW, since the row count still has to end somewhere: `pruneRuns` deletes a closed
// run after fourteen days, so the history this can draw is bounded by the store rather than by a
// second rule living here — and the dismissal he presses is recorded in the window's localStorage,
// so a row he has cleared stays cleared across restarts. An OPEN run is unbounded in both
// directions: a procedure that died three days ago is exactly the thing worth seeing.
function stripRuns(projectCode) {
  const pre = `session:${projectCode}:`;
  return all().filter((r) => {
    if (!r.owner.startsWith("run:") || !r.session.startsWith(pre)) return false;
    const src = String(r.source || "");
    return src.startsWith("lane:") || src.startsWith("job:") || src.startsWith("skill:");
  });
}

// IS THIS BRANCH REGISTERED AS A LANE — asked of the BRANCH, across every run on disk, and
// deliberately not project-scoped (2026-10-08).
//
// `laneRuns` above is scoped to a project because the STRIP is: a lane row belongs to the
// conversation that owns it. Registration is a different question on a different axis. The run that
// registers a lane is written by whichever session did the work, and the branch lives in whichever
// repo the work was IN — and those are routinely not the same project. Every lane branch in the
// autobot repo today was registered by a systemview-test session, because that is the conversation
// that delegated them. Scoping this read by project answered "none registered" for all five.
//
// THE COLLISION IS ACCEPTED AND IT IS THE SMALL SIDE. Two repos both holding a branch called
// `lane/x` would cross-register, so a row could appear in the second. The repo half of the answer
// comes from git in that repo, which is what keeps that merely untidy — and the alternative, hiding
// five real lanes holding real work, is the failure this whole surface exists to prevent.
function registeredLanes() {
  const out = new Set();
  for (const r of all()) {
    if (!r.owner.startsWith("run:")) continue;
    const src = String(r.source || "");
    if (src.startsWith("lane:")) out.add(src.slice(5));
  }
  return out;
}

// FINDING A LANE'S RUN BY ITS BRANCH. The worklist indexes its own files, because the alternative is
// every caller learning that a lane's run is the one whose `source` is `lane:` + the branch — which
// is a scheme, and a scheme copied into three callers is a scheme that drifts in two of them.
//
// Answers null for a lane with no run file, and that is a REAL case rather than an error: closed runs
// are swept after two weeks, so a lane can outlive its record while its worktree and branch — and its
// ROW — are still there. A caller that treated null as failure would refuse to clear exactly the
// lane nobody else can.
function runIdForLane(projectCode, branch) {
  const b = String(branch || "").trim();
  if (!b) return null;
  const row = laneRuns(projectCode).find((r) => String(r.source || "") === `lane:${b}`);
  return row ? String(row.owner || "").replace(/^run:/, "") : null;
}

// The delete used to be the USER'S ALONE — "never an agent tidying quietly". OVERRIDDEN 2026-10-02 by
// him, and the reasoning that replaced it is better than mine: the bring-in model already made agents
// responsible for landing a lane's work, so leaving them unable to clear the lane afterwards left
// seven rows and seven two-step confirms for him to click through. The 🗑 stays his; it is no longer
// the only door. What keeps that honest is `announceLaneRemoved` in sessions.cjs — a lane cleared by
// anyone announces itself, so his strip drops the row whether or not he was the one who pressed.
// Scoped to run files by construction: the owner is minted from the id, so no path escapes DIR.
function deleteRun(id) {
  try {
    fs.unlinkSync(fileFor(runOwner(String(id || ""))));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// THE RECEIPT (RFC-063) — the one thing derivation cannot recover.
//
// A lane row answers "can I delete this?" by comparing the branch against the tree. That is
// archaeology and the evidence decays: `lane/hooks-end-of-turn` was brought in and committed, both
// files it touched were then rewritten on top of it, and the comparison went blind — blobs no
// longer matched, the patch no longer reversed, so the row said NOT BROUGHT IN about work that was
// already in. The moment the knowledge existed was the moment of the bring-in, and nothing wrote it
// down.
//
// A RECEIPT, NOT A SETTABLE VERDICT, and the distinction is the whole design. "This lane's work is
// in the tree" is a claim about current state — testimony, which derivation must always beat. "I
// applied this lane's diff into autobot at base 6dd6cc9 on 2026-10-02" is a record of an ACT: dated,
// naming the base, checkable against history. So the agent never answers the question; it leaves a
// receipt at the moment it acts, and `out` still beats it (see api/index.js `branchState` and
// `laneVerdict.js` — a receipt against proof is a receipt that is wrong).
//
// WHY ON THE RUN RECORD AND NOT IN A STORE OF ITS OWN: nothing may accumulate in the background.
// This cannot, by construction — no new file (a field on a record that already exists), the user's
// 🗑 unlinks the run file so the receipt dies with the lane it describes, and closed runs already
// sweep themselves after two weeks, so the retention is inherited rather than invented.
//
// A RUN THAT IS NOT THERE IS NOT STAMPED. save() would happily create the file, which would mint a
// lane record out of a receipt for a lane nobody ran — the one way this could accumulate.
// ---------------------------------------------------------------------------------------------
// WHAT IS HAPPENING IN THIS LANE — said by whoever is doing it, in their own words.
//
// HIS RULING, 2026-10-06, and it reverses the ordering RFC-063 shipped with: *"the whole point is
// these lanes tell me shit and they lie, because you always try to derive it… it should say what is
// the correct thing. I could go away and come back and say, boom, this is what's happening in this
// lane. It's not about the system automatically telling me what it is."*
//
// DERIVATION WAS NEVER PROOF, which is the premise that failed. Matching blobs against the tree is a
// guess about residue: it reported `in · committed` for a branch holding nothing (a branch with no
// commits is trivially merged), and `can't tell, 4/11` for a lane that had been applied and then
// reversed — a thing the actor knew exactly and had no way to say. The old hierarchy called that
// guess "proof" and the actor's own account "testimony". For ACTS it is the other way round: an
// agent knows what it did; derivation only sees what is left behind.
//
// SO A STATUS IS FREE TEXT. Not an enum — he was explicit that it could be anything: "brought in,
// tests green", "applied then reversed, not landed", "waiting on review", "needs a rebase",
// "abandoned, keeping the branch for the test". An enum would be this system deciding in advance
// which situations a lane can be in, which is the same mistake as deriving the answer.
//
// It carries `by` and `ts` so the row can say WHO said it and WHEN — that is what makes a statement
// checkable rather than authoritative. Derivation does not go away; it becomes the cross-check
// printed beside this, so a disagreement is visible instead of ranked.
function markStatus(id, { text = "", tone = "", by = "", ts = 0 } = {}) {
  const owner = runOwner(String(id || ""));
  const t = String(text || "").trim();
  try {
    if (!fs.existsSync(fileFor(owner))) return null;
  } catch {
    return null;
  }
  // AN EMPTY STATUS CLEARS IT, deliberately: a wrong statement must be retractable by whoever made
  // it — the half the receipt never had, since a bring-in could be recorded and never undone.
  if (!t) {
    save(owner, { status: null });
    return { cleared: true };
  }
  const status = {
    ts: Number(ts) > 0 ? Number(ts) : Date.now(),
    // Long enough for a sentence, short enough to stay a row. A status that wraps is a report.
    text: t.slice(0, 160),
    tone: ["ok", "warn", "note"].includes(String(tone)) ? String(tone) : "note",
    by: String(by || "").trim().slice(0, 80),
  };
  save(owner, { status });
  return status;
}

// ── ATTACHMENTS — RFC-072 §5 ────────────────────────────────────────────────────────────────────
//
// ONE MISSING FEATURE, SPECIAL-CASED THREE TIMES. Today a run carries things only if it is the
// right KIND: a job run gets a report pointer, a lane gets a branch, and the nine skill runs on his
// strip get NOTHING — open one and you get steps. That asymmetry lives in the record, not in the
// surface, which is why no surface could fix it. His words: *"adding something to attach to a
// specific worklist should be a simple MCP call… it shouldn't be this thing that's complicated
// where some of the jobs say no report."*
//
// So: a run carries `attachments[]`, each `{ kind, ref, project, by, ts }`. The unit is the LIST,
// and a job's list is a list like any other — there is no "jobs can, skills cannot" anywhere in
// this.
//
// AN ATTACHMENT CAN BE TAKEN OFF. The RFC left this open and the first build leaned append-only —
// a `detached` stamp, on the argument that a record which omits is a record that lies. His ruling,
// 2026-10-22: *"obviously you need to be able to remove an attachment. How do you fix mistakes?"*
//
// And the append-only argument does not survive it. It was written when removal was not an option;
// once it is, nothing would ever choose the stamp, and two verbs that look identical mean the wrong
// one gets picked silently. Attaching the wrong report to the wrong run is a typo in the record,
// not an event in the world — preserving it asserts a relationship nobody ever claimed.
const ATTACH_KINDS = ["report", "branch", "document", "arc", "card", "link"];

function attach(id, { kind = "", ref = "", project = "", by = "", ts = 0 } = {}) {
  const owner = runOwner(String(id || ""));
  const k = String(kind || "").trim().toLowerCase();
  const r = String(ref || "").trim();
  if (!ATTACH_KINDS.includes(k)) return { error: `unknown attachment kind "${kind}"`, kinds: ATTACH_KINDS };
  if (!r) return { error: "an attachment needs a ref" };
  try {
    if (!fs.existsSync(fileFor(owner))) return { error: `no run "${id}"` };
  } catch {
    return { error: `no run "${id}"` };
  }
  const cur = readFile(owner);
  const list = Array.isArray(cur.attachments) ? cur.attachments : [];
  // THE SAME THING ATTACHED TWICE IS ONE ATTACHMENT, re-stamped — a procedure that attaches on
  // every pass would otherwise grow the record without bound, and the second entry says nothing
  // the first did not. Something removed and attached again is simply attached: there is no stamp
  // left to clear, which is the point of having one verb.
  const at = list.findIndex((a) => a && a.kind === k && a.ref === r && String(a.project || "") === String(project || ""));
  const entry = {
    kind: k,
    ref: r,
    ...(project ? { project: String(project).trim().slice(0, 80) } : {}),
    by: String(by || "").trim().slice(0, 80),
    ts: Number(ts) > 0 ? Number(ts) : Date.now(),
  };
  if (at === -1) list.push(entry);
  else list[at] = entry;
  save(owner, { attachments: list });
  return entry;
}

/**
 * REMOVE — it should never have been there. His ruling, 2026-10-22: *"obviously you need to be able
 * to remove an attachment. How the fuck do you fix mistakes?"*
 */
function removeAttachment(id, { kind = "", ref = "", project = "" } = {}) {
  const owner = runOwner(String(id || ""));
  const k = String(kind || "").trim().toLowerCase();
  const r = String(ref || "").trim();
  const cur = readFile(owner);
  const list = Array.isArray(cur.attachments) ? cur.attachments : [];
  const at = list.findIndex((a) => a && a.kind === k && a.ref === r && String(a.project || "") === String(project || ""));
  if (at === -1) return { error: `nothing attached as ${kind} ${ref}` };
  const gone = list[at];
  list.splice(at, 1);
  save(owner, { attachments: list });
  return { removed: gone };
}

// WHAT A RUN CARRIES, INCLUDING WHAT IT CARRIED BEFORE THIS EXISTED. The lane branch and the job
// report pointer were fields; they are KINDS now, and rather than migrate every run on disk the
// legacy shapes are read forward. A run written last week answers the same question as one written
// today, which is the whole of "backward compatible — a run with no attachments reads as none".
function attachmentsOf(run = {}) {
  const out = Array.isArray(run.attachments) ? run.attachments.filter(Boolean) : [];
  const has = (k, r) => out.some((a) => a.kind === k && a.ref === r);
  // A `lane:` source IS a branch attachment — the branch is in the source string and always was.
  const src = String(run.source || "");
  if (src.startsWith("lane:")) {
    const branch = src.slice(5);
    if (branch && !has("branch", branch)) out.push({ kind: "branch", ref: branch, by: "", ts: run.updatedAt || 0, derived: true });
  }
  return out;
}

// NUDGE COUNT, KEPT ON THE RUN. A run blocked on a human never completes, so the nudging has to
// stop — and the only honest place for "how many times was this raised" is the record it is about.
// It then stops being a throttle and becomes a FACT a surface can render: "nudged 3 times, no
// movement" tells him more than the nudges ever told the agent.
//
// TAKES THE OWNER, not an id, because `all()` hands the caller an owner and the nudge picks its run
// out of `all()`. A second id→owner conversion at the call site is where the two spellings of a
// lane source came from.
function markNudged(owner, { ts = 0 } = {}) {
  const o = String(owner || "");
  if (!o) return null;
  let prev = {};
  try {
    if (!fs.existsSync(fileFor(o))) return null;
    prev = (readFile(o) || {}).nudges || {};
  } catch {
    return null;
  }
  const nudges = {
    count: (Number(prev && prev.count) || 0) + 1,
    lastAt: Number(ts) > 0 ? Number(ts) : Date.now(),
  };
  save(o, { nudges });
  return nudges;
}

// HOW THE WORK CAME IN, not just that it did. A merge puts the lane's commits into history; an
// apply-as-changes leaves them uncommitted in his tree — and the difference decides whether his tree
// is the only copy of that work. A receipt that records both the same way cannot answer the one
// question he asks after landing a pile: "which of these still only exist in my working directory?"
//
// UNKNOWN IS A REAL VALUE and it is the default. Every receipt written before this field existed
// came in one of the two ways and nobody can now say which, so "" means exactly that rather than
// quietly reading as a merge.
const HOW = ["merge", "changes"];
function markBroughtIn(id, { base = "", repo = "", by = "", how = "", ts = 0 } = {}) {
  const owner = runOwner(String(id || ""));
  try {
    if (!fs.existsSync(fileFor(owner))) return null;
  } catch {
    return null;
  }
  const broughtIn = {
    ts: Number(ts) > 0 ? Number(ts) : Date.now(),
    base: String(base || "").trim().slice(0, 80),
    repo: String(repo || "").trim().slice(0, 80),
    by: String(by || "").trim().slice(0, 80),
    // AN UNRECOGNISED VALUE BECOMES UNKNOWN rather than being stored. A receipt is read by surfaces
    // that branch on this; letting "merged" or "applied" through would mean each surface inventing
    // its own synonyms, which is how one fact becomes three spellings.
    how: HOW.includes(String(how || "").trim()) ? String(how).trim() : "",
  };
  save(owner, { broughtIn });
  return broughtIn;
}


// Every worklist on this machine, newest first — what makes one readable AFTER the fact, by
// something that is not the session that wrote it.
function all() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  // NOT THE SIDECARS: `.chore-stamps.json` lives in this dir too, and a glob on .json would push
  // it into the rows as a worklist owned by "chore-stamps" — the same bug the definitions roster
  // had with `<id>.subs.json`.
  for (const n of names.filter((f) => f.endsWith(".json") && !isSidecar(f))) {
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
        // THE RECEIPT RIDES THE ROW, or the window cannot see it: `laneRuns` filters this list, and
        // the lane strip is drawn from what comes back here. null, never undefined — "no receipt" is
        // an answer the row renders, not a key it has to guess about.
        broughtIn: r.broughtIn && typeof r.broughtIn === "object" ? r.broughtIn : null,
        // THE HEADLINE, when one was set. null — never undefined — so a surface can render the
        // ABSENCE of a statement, which is the ordinary case for a lane nobody has spoken about.
        status: r.status && typeof r.status === "object" && r.status.text ? r.status : null,
        // WHICH REPO the lane's branch lives in — "" when never stamped, which old records are.
        repo: typeof r.repo === "string" ? r.repo : "",
        // ABSENT READS FALSE. No migration: every record written before this existed was
        // commissioned by a human asking for it.
        selfDirected: r.selfDirected === true,
        // HOW MANY TIMES THIS RUN WAS NUDGED, and when last — null when never, so a surface can
        // render the absence rather than printing "nudged 0 times" at every untouched run.
        nudges: r.nudges && typeof r.nudges === "object" ? r.nudges : null,
        // WHAT THE RUN POINTS AT — the nudge's excuse check reads these (a run declared abandoned
        // must carry its account), and a row can wear what its run produced. null, never undefined.
        attachments: Array.isArray(r.attachments) && r.attachments.length ? r.attachments : null,
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
// THE TOOLS, APART FROM THE SERVER THAT CARRIES THEM. One definition, two readers: serverFor wraps
// these for the SDK, and a test can hold the handler and CALL it. That matters here more than usual
// — `markBroughtIn` shipped defined, exported and tested with no door on it at all, called by
// nothing but its own test, so zero receipts ever existed. A door is only proven by being opened.
function toolsFor(onSet, getList = () => [], onBoard = null, getBoard = () => "", getRun = null, checkSource = null, onTouch = null) {
  const { tool } = require("@anthropic-ai/claude-agent-sdk");
  return [
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
        TOOL_ATTACH,
        "Attach something to the list that is running — a report, a branch, a document, an arc " +
          "objective. ANY list takes one: a job's, a lane's, or a plain skill run. This is how a " +
          "run says what it PRODUCED, rather than leaving a reader a page of steps and no way to " +
          "reach the thing. Attaching never touches a screen and never replaces the list.",
        {
          kind: z
            .enum(["report", "branch", "document", "arc", "card", "link"])
            .describe(
              'what sort of thing it is. "arc" is an objective address like ARC-004-O2 — the ' +
                "work that objective commissioned, pointing back at it"
            ),
          ref: z
            .string()
            .describe(
              "the ADDRESS, never a path: a report name, a branch name, an objective like " +
                "ARC-004-O2. A path breaks silently the first time somebody renames the file, and " +
                'the breakage reads as "there is none" rather than "it moved"'
            ),
          project: z
            .string()
            .optional()
            .describe("the repo it lives in, when that is not this one — an arc can live elsewhere"),
          remove: z
            .boolean()
            .optional()
            .describe("take it off — the attachment was wrong, or is no longer what this run produced"),
        },
        async ({ kind, ref, project, remove: off }) => {
          const run = getRun ? getRun() : null;
          if (!run || !run.id)
            return {
              content: [{
                type: "text",
                text: "no run is open — attachments live on a RUN, so start one with a `source` first. (A procedure's own list is the run; your session plan is not one.)",
              }],
            };
          const r = off
            ? removeAttachment(run.id, { kind, ref, project })
            : attach(run.id, { kind, ref, project, by: run.source || "" });
          // THE WRITE ANNOUNCES ITSELF (his catch, 2026-10-26: "it doesn't show any abandoned").
          // The strip reads run files but only re-reads on a run EVENT — an attachment landing
          // silently leaves his rows wearing yesterday's face until something else ticks.
          if (!(r && r.error) && onTouch) { try { onTouch(run.id, run.source || "", off ? "attachment-removed" : "attachment"); } catch {} }
          return {
            content: [{
              type: "text",
              text: r && r.error
                ? r.error
                : `${off ? "removed" : "attached"} ${kind} ${ref}${project ? ` (${project})` : ""} on run ${run.id}`,
            }],
          };
        },
        { alwaysLoad: true }
      ),
      // THE STATUS WRITE WAS A VERB WITH NO DOOR — markStatus existed, tested, and nothing an agent
      // carries could call it except the lane-shaped hub path (which resolves by BRANCH, so a
      // skill or job run was unreachable). The nudge's declared ending made that a live failure:
      // the final notice tells the agent to set the run's status to "abandoned", and a mechanism
      // whose named exit cannot be taken is the exact 3am shape this system exists to refuse.
      tool(
        TOOL_STATUS,
        "Say what is happening with the run that is open — one dated, attributed line that " +
          "becomes the row's headline. An empty text clears it. Declaring \"abandoned\" WITH a " +
          "report attached is the only thing besides completion that stops the idle nudging — " +
          "the word and the account together, never either alone.",
        {
          text: z
            .string()
            .describe(
              'the statement, e.g. "abandoned — blocked on his review" or "waiting on a rebase" — ' +
                'or "" to retract one you got wrong'
            ),
        },
        async ({ text: say }) => {
          const run = getRun ? getRun() : null;
          if (!run || !run.id)
            return {
              content: [{
                type: "text",
                text: "no run is open — a status lives on a RUN, so start one with a `source` first.",
              }],
            };
          const res = markStatus(run.id, { text: say, by: run.source || "" });
          // Same announce as the attachment above — a declared "abandoned" that no row shows is
          // a record he cannot see land, which reads identical to it not landing.
          if (res && onTouch) { try { onTouch(run.id, run.source || "", "status"); } catch {} }
          return {
            content: [{
              type: "text",
              text: !res
                ? "the run record would not take it"
                : res.cleared
                  ? `status cleared on run ${run.id}`
                  : `status on run ${run.id}: ${res.text}`,
            }],
          };
        },
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
  ];
}

function serverFor(...wiring) {
  const { createSdkMcpServer } = require("@anthropic-ai/claude-agent-sdk");
  return createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: toolsFor(...wiring) });
}

// `lastClosed` / `lastClosedBySource` are the board's read half (RFC-067 §4) — definitions.cjs
// joins them to an agent's chore lines. `stampClosed` is exported for the test, which has to be
// able to put an OLD close on the record without a time machine; nothing else should call it, the
// close in writeRun is the only writer.
module.exports = { attach, HOW, removeAttachment, attachmentsOf, ATTACH_KINDS, serverFor, toolsFor, normalize, DIR, STAMPS, read, write, readBoard, writeBoard, all, newRunId, runOwner, openRunFor, writeRun, allDone, pruneRuns, misspelledLane, laneRuns, stripRuns, registeredLanes, deleteRun, runIdForLane, markBroughtIn, markLaneRepo, markStatus, markNudged, stampClosed, lastClosed, lastClosedBySource, placeOf, SERVER, TOOL, TOOL_READ, TOOL_ATTACH, TOOL_BOARD, TOOL_NAME, TOOL_READ_NAME, TOOL_ATTACH_NAME, TOOL_BOARD_NAME, TOOL_STATUS, TOOL_STATUS_NAME, TOOL_NAMES };
