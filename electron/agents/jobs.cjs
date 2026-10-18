// JOBS — RFC-005 part one, §2.1 and §2.2.
//
// Odion's definition, and it decides everything below: *the difference between doing something and
// doing a job is that a job is OBSERVABLE.* Not that it is scheduled, not that it is unattended.
// A job is a package — the work, the log of it happening, what it produced, and how it rated.
//
// THE DOCUMENT IS THE JOB; THE CONFIG IS A PROJECTION OF IT. A job begins as a planning session
// with a human and ends as a written agreement: what it does, what it must never do, what "done"
// looks like, what to do when it is unsure. `job.json` is derived from that agreement, never the
// other way round — which is why `doc` is not an optional field here and an empty one is refused.
//
// AND THE DOCUMENT IS LOADED WHOLE, NEVER RETRIEVED AGAINST. This is the correction autobot won
// and it is the reason this module has no corpus in it. Retrieval is lossy by design: a corpus
// answers with the chunks that scored, which is right for REFERENCE, where a miss costs a re-read
// — and wrong for INSTRUCTIONS, where "never email the client directly" sitting in a chunk that
// did not score means the constraint silently does not exist at 3am. Unattended and invisible, the
// two conditions we are building for. A skill file loads whole for the same reason; a job document
// is that shape. What DOES need retrieval is the job's history (§6) — the experience, not the
// instruction — and that is a separate, append-only, `working` corpus.
//
// WHAT THIS MODULE IS NOT. It does not fire anything and it does not know what a session is. The
// engine must never know that workers (part two) exists, and the same discipline applies one layer
// down: this is the store and the projection, and the runner reads it.
const fs = require("fs");
const os = require("os");
const path = require("path");
const definitions = require("./definitions.cjs");
const hooks = require("./hooks.cjs");
const worklist = require("./worklist.cjs");

// System level, beside ~/.autobot/hooks — owned by no app, the same as presence and the system
// context. A job that lives inside an application is a job that dies with it.
const DIR = path.join(os.homedir(), ".autobot", "jobs");

const slug = (n) =>
  String(n || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const dirOf = (id) => path.join(DIR, slug(id));
const runsDirOf = (id) => path.join(dirOf(id), "runs");

// A job's worklist owner (RFC-005 §3). The worklist is the job's progress model — one active item,
// a live model rather than a log, an honest completion signal — and it is the same structure a
// session uses, keyed differently. Not a parallel "job steps" model, which would drift.
const ownerOf = (id) => `job:${slug(id)}`;

// ---------------------------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------------------------
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// THE DOCUMENT IS READ FROM DISK EVERY TIME, never cached on the record. A job document is edited
// between runs — that is the point of it being a document — and a cached copy is the version that
// was true when the shell started.
function doc(id) {
  try { return fs.readFileSync(path.join(dirOf(id), "job.md"), "utf8"); } catch { return ""; }
}

function get(id) {
  const j = readJson(path.join(dirOf(id), "job.json"));
  if (!j) return null;
  const runs = runsOf(id);
  const text = doc(id);
  return {
    ...j,
    id: slug(j.id || id),
    dir: dirOf(id),
    doc: text,
    // READ FROM THE DOCUMENT, NOT FROM THE PROJECTION, for the same reason `doc` is: the document
    // is edited between runs, and a job whose part 2 gained an input this morning must refuse for
    // it this afternoon without waiting for someone to re-save — and one that dropped an input must
    // stop demanding it the same way. `job.json` carries the same list for a surface that only
    // reads the projection; this is the one that answers.
    requires: requiresIn(text) || [],
    worklistOwner: ownerOf(id),
    // THE LIVE LIST, with the same correction as `finishRun` below: the items a run writes land
    // under `run:<runId>`, so reading only the job owner showed a job mid-flight as having no plan.
    // Newest run first — `runsOf` already sorts that way.
    worklist: (() => {
      const own = worklist.read(ownerOf(id));
      if (own.length) return own;
      const latest = runsOf(id)[0];
      return latest ? worklist.read(`run:${String(latest.id)}`) : [];
    })(),
    runs: runs.length,
    lastRun: runs[0] || null,
  };
}

function list() {
  let names = [];
  try { names = fs.readdirSync(DIR, { withFileTypes: true }); } catch { return []; }
  return names
    .filter((d) => d.isDirectory())
    .map((d) => get(d.name))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// ---------------------------------------------------------------------------------------------
// Writing. `job.json` is an AgentDefinition plus three fields — ADOPTED, not paralleled (RFC-003's
// rule). The definition half runs through definitions.normalize() rather than being re-whitelisted
// here, so a job can never express a field an agent cannot: anything else translates at the SDK
// boundary forever, and the translation is what rots.
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// WHAT IT MUST BE GIVEN (RFC-067 §2, part 2). The inputs, NAMED — and named somewhere a machine
// can read, because a refusal that cannot be computed is a refusal nobody ever gets.
//
// THE DECLARATION LIVES IN THE DOCUMENT, in its front matter, for the same reason everything else
// about a job does: `job.json` is a projection and the document is the job, so a job whose inputs
// were declared only in the projection could be edited into disagreeing with itself. A job
// document is a skill-shaped markdown file and already has front matter to put a field in.
//
//   ---
//   requires: ["period", "ledger"]      ← or: requires: period, ledger
//   ---
//
// A JOB THAT DECLARES NOTHING NEEDS NOTHING, and that is a real answer rather than a hole: plenty
// of jobs take their target from the moment that fired them. What it is NOT is a licence to guess —
// nothing is being inferred from prose here, because inferring the inputs from a paragraph is the
// guess part 2 exists to forbid, one level up.
const toNames = (v) => {
  const arr = Array.isArray(v)
    ? v
    : typeof v === "string"
      ? v.split(",")
      : v && typeof v === "object"
        ? Object.keys(v)
        : null;
  if (!arr) return null;
  const out = [...new Set(arr.map((n) => String(n || "").trim()).filter(Boolean))];
  return out.length ? out : null;
};

function requiresIn(text) {
  // hooks.parseFrontMatter, not a second parser — the hook file and the job document have the same
  // small, documented front matter, and two parsers for one format is one of them being wrong.
  const { meta } = hooks.parseFrontMatter(String(text || ""));
  return toNames(meta.requires);
}

// An input is MISSING when it is absent or empty. An empty string is not a value a job can act on,
// so treating it as supplied would be the guess wearing a key.
const supplied = (v) => !(v === undefined || v === null || (typeof v === "string" && v.trim() === ""));

// The refusal, BY NAME — the whole requirement, and the one the design calls worthless if it is
// not enforced. It names the job, every input that is missing, and that nothing ran, so the row in
// the feed is an account a human can act on rather than a silence they have to notice.
function refusalFor(id, missing = [], declared = []) {
  const names = missing.map((n) => `\`${n}\``).join(", ");
  return (
    `The \`${id}\` job was NOT run: it must be given ${names}, and ${missing.length === 1 ? "it was" : "they were"} ` +
    `not supplied. A missing input is a refusal, not a guess — nothing was started and no run was opened. ` +
    `This job declares it must be given: ${declared.join(", ") || "(nothing)"}. ` +
    `Fix the hook's \`with:\` and it will run on the next match.`
  );
}

// WHAT A JOB WAS GIVEN, CHECKED — the gate, and the only way to open a job's run. Answers the same
// shape whether it passed or failed, so no caller has to know two return conventions, and never
// throws for a condition that is the system working: a job that does not exist and a job given too
// little are both refusals with a name in them.
function check(id, inputs = {}) {
  const job = get(id);
  if (!job)
    return { ok: false, job: null, missing: [], declared: [], refusal: `There is no job named \`${slug(id)}\` — nothing ran.` };
  const declared = Array.isArray(job.requires) ? job.requires : [];
  const given = inputs && typeof inputs === "object" ? inputs : {};
  const missing = declared.filter((n) => !supplied(given[n]));
  return {
    ok: missing.length === 0,
    job,
    declared,
    missing,
    refusal: missing.length ? refusalFor(job.id, missing, declared) : "",
  };
}

// ---------------------------------------------------------------------------------------------
// THE RUN OPENS AND CLOSES, AND IT IS THE WORKLIST'S RUN — not a second one. A job's progress model
// is already the worklist (§3), `allDone` is already how completion is OBSERVED rather than
// declared, and `source: "job:<id>"` is already the source `job-authoring` tells a job to write and
// `clearedBy` already resolves for a persisting hook. So there is nothing here to invent: this opens
// that run at the moment the job is GIVEN, so the record exists before the agent has written a word.
//
// RESUME BEFORE MINT. A second pointer for the same job in the same session must land on the same
// run — openRunFor is what makes that true, and it is also what makes the agent's own first
// `worklist.set({ source: "job:<id>" })` continue THIS run instead of minting a rival. That join is
// on (source, session), which is why `session` is required here and why a fire path that cannot name
// the session cannot honestly open a run.
//
// ONE PENDING ITEM, NAMED FOR THE JOB. A run with no items can never be all-done, so it could never
// close; this way the run says "given, not started" from birth and reads as exactly that if nobody
// ever picks it up. A job that dies stays where it died — nothing here sweeps it.
function given(id, { session = "", inputs = {}, why = "", event = null } = {}) {
  const gate = check(id, inputs);
  if (!gate.ok) return gate;
  if (!String(session || "").trim())
    return { ...gate, ok: false, refusal: `The \`${gate.job.id}\` job needs a session to open its run against — none was given, so nothing ran.` };

  const source = ownerOf(gate.job.id);
  const back = worklist.openRunFor(session, source);
  const runId = back || worklist.newRunId();
  const items = back
    ? worklist.read(worklist.runOwner(runId))
    : [{ id: "1", text: `${gate.job.name} — given, not started`, state: "pending" }];
  worklist.writeRun(runId, session, items, source, { selfDirected: true });
  // The job's OWN record of the run (§2.4) — why it ran, which is the question you must be able to
  // answer at 3am. Only for a run being born: a resumed one already has its receipt and rewriting it
  // would re-date the start of work that began earlier.
  if (!back) startRun(gate.job.id, { runId, why, event });
  return { ...gate, runId, source, items, resumed: !!back };
}

// AND THE CLOSE IS AN OBSERVATION, NOT A CALL AN AGENT MAKES. `allDone` on the persisted items is
// the only evidence; a job that says it finished with an item still active has not. Answers false
// and writes nothing in that case, because where a procedure died is the record.
function done(id, runId) {
  const items = worklist.read(worklist.runOwner(String(runId || "")));
  if (!worklist.allDone(items)) return false;
  finishRun(id, runId, { status: "finished" });
  return true;
}

function save(input = {}) {
  const id = slug(input.id);
  if (!id) throw new Error("a job needs an id");
  const text = String(input.doc || "").trim();
  // THE DOCUMENT IS NOT OPTIONAL. A job with a config and no agreement is a cron line: there is
  // nothing to load whole when it fires, nothing that says what it must never do, and nothing a
  // human can read on Monday to know what they agreed to. §2.1 is the job; this is that, enforced.
  if (!text) throw new Error("a job needs its document — job.json is a projection of it, not a substitute");

  const def = definitions.normalize({ name: id, ...(input.definition || {}) }).def;
  // NO TRIGGER LIVES HERE ANY MORE (2026-10-07). A job used to carry its own `trigger: {on, when}`
  // and `onMissed`, validated here and matched by `due()` — the pre-RFC design, from before a job
  // was "a skill with the job parts". It was removed rather than wired, because it could not be
  // wired: `given()` is the only door that opens a run and it REFUSES without a session, and a job
  // matched straight off an event has no session to run in. The hook path answers that by
  // construction — the carry names the agent — so the job's own trigger was a field that could
  // only ever half-work. RFC-067 §3: a job is triggered exactly as a skill is. One path.

  const prev = readJson(path.join(dirOf(id), "job.json")) || {};
  const rec = {
    id,
    name: String(input.name || prev.name || id),
    definition: def,
    // The two questions a run is judged against. `confirmation` is checkable by the job itself —
    // it is how a run knows it finished rather than stopped. `evaluation` is the human's, and §5
    // is why it is stored rather than assumed: a rated history is task learning arriving as a
    // byproduct, and an unrated one is a pile of transcripts.
    confirmation: String(input.confirmation || prev.confirmation || "").trim(),
    evaluation: String(input.evaluation || prev.evaluation || "").trim(),
    // RFC-067 §2 PART TWO — WHAT IT MUST BE GIVEN, as names a machine can compare. The prose in
    // the document is for the human reading part 2; this is the same declaration in the one form
    // `given()` can refuse against.
    //
    // DERIVED FROM THE DOCUMENT AND FROM NOTHING ELSE — no `input.requires` parameter and no
    // carry-forward from the previous projection, both of which were tried and both of which make
    // the same mistake: they let the projection outlive the document. A job whose part 2 drops an
    // input would keep demanding it, which is a refusal nobody can remove by editing the job, and
    // §2.1's inversion exactly — the projection having become the authority. Every other field here
    // carries forward because its only home is this file; this one has a home that outranks it.
    requires: requiresIn(text) || [],
    enabled: input.enabled === false ? false : true,
    createdAt: prev.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  fs.mkdirSync(runsDirOf(id), { recursive: true });
  fs.writeFileSync(path.join(dirOf(id), "job.md"), text.endsWith("\n") ? text : `${text}\n`);
  fs.writeFileSync(path.join(dirOf(id), "job.json"), JSON.stringify(rec, null, 2));
  return get(id);
}

function remove(id) {
  try {
    fs.rmSync(dirOf(id), { recursive: true, force: true });
    // The worklist belongs to the job, so it goes with it. A list whose owner no longer exists is
    // the kind of orphan that shows up in all() forever and nobody can explain.
    try { fs.unlinkSync(path.join(worklist.DIR, `${ownerOf(id).replace(/[^a-zA-Z0-9]+/g, "-")}.json`)); } catch {}
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// Runs (§2.4). A hook fires and dissolves into the feed; a job must leave a record — what ran,
// what happened, what it produced, and how it rated. One file per run, newest first, append-only:
// never rewritten, which is what makes the history safe to index later (§6) without staleness
// bookkeeping.
// ---------------------------------------------------------------------------------------------
function runsOf(id) {
  let names = [];
  try { names = fs.readdirSync(runsDirOf(id)); } catch { return []; }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => readJson(path.join(runsDirOf(id), n)))
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

// `why` is not decoration and it is not optional in spirit: §4's first property is that a trigger
// must be EXPLAINABLE — you must always be able to answer "why did this run?" at 3am. The receipt
// says what matched. A run with no `why` is a run nobody can account for.
function startRun(id, { runId, why = "", event = null } = {}) {
  const rid = String(runId || `${Date.now()}`);
  const rec = { id: rid, job: slug(id), startedAt: Date.now(), why, event, status: "running" };
  fs.mkdirSync(runsDirOf(id), { recursive: true });
  fs.writeFileSync(path.join(runsDirOf(id), `${rid}.json`), JSON.stringify(rec, null, 2));
  return rec;
}

function finishRun(id, runId, patch = {}) {
  const file = path.join(runsDirOf(id), `${String(runId)}.json`);
  const rec = readJson(file);
  if (!rec) return null;
  const next = {
    ...rec,
    ...patch,
    finishedAt: patch.finishedAt || Date.now(),
    status: patch.status || "finished",
    // The worklist AS IT STOOD when the run ended — copied onto the record rather than referenced,
    // because the live list moves on and a run record is an account of a moment. This is the only
    // place the worklist is duplicated, and it is duplicated on purpose: history is a copy by
    // definition.
    //
    // READ OFF THE RUN, NOT OFF THE JOB (fixed 2026-10-08). It read `ownerOf(id)` — owner
    // `job:<id>` — while every item is written by `worklist.writeRun` under owner `run:<runId>`.
    // So the field that is the whole account of the moment came back `[]` on every job that ever
    // closed, and the claim above was false for as long as it existed. It survived green because
    // the suite asserted `status`, `finishedAt` and `why` and never this. The job owner is kept as
    // a fallback: it is where the design always said the list lives, and an older record written
    // that way must not lose its history to this fix.
    worklist: (() => {
      const fromRun = worklist.read(`run:${String(runId)}`);
      return fromRun.length ? fromRun : worklist.read(ownerOf(id));
    })(),
  };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

// §5 — the rating is the loop. Separate from finishRun because a rating arrives when a human READS
// the report, which is later, and often never if the surface makes them navigate to it.
// THE RUN POINTS AT A REPORT, AND STORES NONE (2026-10-08, his call: *"you have a job, it just
// needs to point to a report"*). RFC-066 §5 is the settled half and it was settled by deleting the
// alternative: *"a report already has a home. `show` files one into the reports panel,
// `nav({report})` opens it, `comments`/`reply` thread on it — the surface he actually reads reports
// in."* A second report store hanging off this record is the exact thing that retraction removed,
// so what lands here is a PATH and a label — the pointer the job card follows, and nothing a
// drifting copy could be made out of.
//
// WRITTEN FROM THE SESSION, not by the agent asking. An agent files its report with `show` like
// anything else; the host notices that a job's run is open in that session and stamps it. There is
// no verb for an agent to remember and nothing it can claim: the pointer exists because a document
// was really filed.
function reported(id, runId, { path: p = "", label = "" } = {}) {
  const file = path.join(runsDirOf(id), `${String(runId)}.json`);
  const rec = readJson(file);
  if (!rec) return null;
  const at = String(p || "").trim();
  if (!at) return rec;
  // THE NEWEST FILING WINS, and the earlier ones are kept. A job that files twice — a draft and
  // then the real thing — would otherwise lose the first silently, and "what did it hand me" is
  // the one question this field exists to answer.
  const prior = Array.isArray(rec.reports) ? rec.reports : [];
  const reports = [...prior.filter((r) => r.path !== at), { path: at, label: String(label || "").trim(), ts: Date.now() }];
  const next = { ...rec, reports, report: reports[reports.length - 1] };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

// A LANE THE RUN CUT, recorded on the JOB's record — his design, 2026-10-14: *"the job refers to
// the lane. The whole point is it's organized properly in the strip."* The lane is disposable by
// construction — its branch lands or dies, its worklist record goes at cleanup — so the relation
// lives on the thing that survives: this record, which already carries the report pointer and the
// rating, is the one surface that can point at everything a run produced. The FACT of the cut only
// (branch, repo, when): whether the branch is in or out stays derived live by the lanes verb at
// display time, so this field cannot rot when the lane is landed or deleted later.
function laneCut(id, runId, { branch = "", repo = "" } = {}) {
  const file = path.join(runsDirOf(id), `${String(runId)}.json`);
  const rec = readJson(file);
  if (!rec) return null;
  const b = String(branch || "").trim();
  if (!b) return rec;
  // Re-registering the same branch (a harness restart replays the write) must not double the row.
  const prior = (Array.isArray(rec.lanes) ? rec.lanes : []).filter((l) => l.branch !== b);
  const next = { ...rec, lanes: [...prior, { branch: b, repo: String(repo || ""), ts: Date.now() }] };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

// HIS OWN MARK ON A RUN — and it is a THIRD thing, beside the two that already exist. The card's
// word today is DERIVED (running / finished / finished · landed) and an agent can set `status` in
// its own words; neither says *"I have been through this myself."* His ask, 2026-10-18: *"I want
// the display to also be a selector… I wanna just know that I've gone through it. And then I'll
// delete it."* So this is the human's lane on the same row: free text, his vocabulary, cleared by
// an empty string — and it changes nothing about cleanup, because the delete is still his press.
//
// It does NOT overwrite `status`. An agent saying "blocked on your press" and him saying "walked
// it" are two different facts, and collapsing them would lose whichever was written second.
function markState(id, runId, state) {
  const file = path.join(runsDirOf(id), `${String(runId)}.json`);
  const rec = readJson(file);
  if (!rec) return null;
  const mark = String(state == null ? "" : state).trim().slice(0, 40);
  const next = { ...rec };
  if (mark) { next.state = mark; next.stateAt = Date.now(); }
  else { delete next.state; delete next.stateAt; } // a mark nobody can retract is worse than none
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

// The words the window offers first — his, from the ask. Not a closed set: `markState` takes any
// text, because a vocabulary the human cannot extend is a vocabulary he works around.
const STATES = ["walked it", "approved", "needs another look", "mine to finish"];

function rateRun(id, runId, { rating, note = "" } = {}) {
  const file = path.join(runsDirOf(id), `${String(runId)}.json`);
  const rec = readJson(file);
  if (!rec) return null;
  const next = { ...rec, rating: rating == null ? null : Number(rating), ratingNote: String(note || ""), ratedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

module.exports = {
  DIR,
  dirOf,
  ownerOf,
  doc,
  get,
  list,
  save,
  remove,
  // RFC-067 §2 part 2 and §3 — the gate, the giving, and the close. `check` answers "was this job
  // given what it declared?"; `given` is the only door that opens a job's run, so a run cannot
  // exist for a job that was given too little; `done` observes the close off the run record.
  requiresIn,
  check,
  given,
  done,
  runsOf,
  startRun,
  finishRun,
  reported,
  markState,
  STATES,
  laneCut,
  rateRun,
};
