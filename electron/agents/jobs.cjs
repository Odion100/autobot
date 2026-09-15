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
  return {
    ...j,
    id: slug(j.id || id),
    dir: dirOf(id),
    doc: doc(id),
    worklistOwner: ownerOf(id),
    worklist: worklist.read(ownerOf(id)),
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
function save(input = {}) {
  const id = slug(input.id);
  if (!id) throw new Error("a job needs an id");
  const text = String(input.doc || "").trim();
  // THE DOCUMENT IS NOT OPTIONAL. A job with a config and no agreement is a cron line: there is
  // nothing to load whole when it fires, nothing that says what it must never do, and nothing a
  // human can read on Monday to know what they agreed to. §2.1 is the job; this is that, enforced.
  if (!text) throw new Error("a job needs its document — job.json is a projection of it, not a substitute");

  const def = definitions.normalize({ name: id, ...(input.definition || {}) }).def;
  const trigger = input.trigger && typeof input.trigger === "object" ? input.trigger : null;
  if (trigger) {
    if (!hooks.isEvent(trigger.on) && !VIRTUAL_EVENTS.includes(String(trigger.on || "")))
      throw new Error(`"${trigger.on}" is not an event this system emits, so the job would never fire`);
    if (trigger.when && typeof trigger.when !== "object") throw new Error("trigger.when must be an object");
  }

  const prev = readJson(path.join(dirOf(id), "job.json")) || {};
  const rec = {
    id,
    name: String(input.name || prev.name || id),
    definition: def,
    trigger,
    // The two questions a run is judged against. `confirmation` is checkable by the job itself —
    // it is how a run knows it finished rather than stopped. `evaluation` is the human's, and §5
    // is why it is stored rather than assumed: a rated history is task learning arriving as a
    // byproduct, and an unrated one is a pile of transcripts.
    confirmation: String(input.confirmation || prev.confirmation || "").trim(),
    evaluation: String(input.evaluation || prev.evaluation || "").trim(),
    // §2.3 — the answer to downtime, recorded per job because both branches are defensible and
    // only silence is not. Default skip; `run` means catch up.
    onMissed: input.onMissed === "run" ? "run" : "skip",
    enabled: input.enabled === false ? false : true,
    createdAt: prev.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  fs.mkdirSync(runsDirOf(id), { recursive: true });
  fs.writeFileSync(path.join(dirOf(id), "job.md"), text.endsWith("\n") ? text : `${text}\n`);
  fs.writeFileSync(path.join(dirOf(id), "job.json"), JSON.stringify(rec, null, 2));
  return get(id);
}

// Events that no module emits yet but a job may legitimately be written against: the clock and
// external arrivals (§2.3). They are listed rather than waved through, so a typo is still caught —
// the check exists because a job on an event nobody emits is silent, and silence is the failure
// this whole document is about.
const VIRTUAL_EVENTS = ["schedule.due", "schedule.missed", "external.arrived"];

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
    worklist: worklist.read(ownerOf(id)),
  };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

// §5 — the rating is the loop. Separate from finishRun because a rating arrives when a human READS
// the report, which is later, and often never if the surface makes them navigate to it.
function rateRun(id, runId, { rating, note = "" } = {}) {
  const file = path.join(runsDirOf(id), `${String(runId)}.json`);
  const rec = readJson(file);
  if (!rec) return null;
  const next = { ...rec, rating: rating == null ? null : Number(rating), ratingNote: String(note || ""), ratedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  return next;
}

// ---------------------------------------------------------------------------------------------
// Matching — §1, and the whole reason this module is short. Jobs build ON the hooks seam, not
// beside it: `matchesWhen` is the matcher hooks already use, so a job trigger and a hook condition
// can never mean different things by the same JSON. A second dispatch path would duplicate
// matching, guards, scope and receipts, and would be the half that drifts.
// ---------------------------------------------------------------------------------------------
function due(event = {}) {
  const kind = String(event.kind || "");
  if (!kind) return [];
  return list().filter(
    (j) => j.enabled && j.trigger && j.trigger.on === kind && hooks.matchesWhen(j.trigger.when, event)
  );
}

module.exports = {
  DIR,
  VIRTUAL_EVENTS,
  dirOf,
  ownerOf,
  doc,
  get,
  list,
  save,
  remove,
  runsOf,
  startRun,
  finishRun,
  rateRun,
  due,
};
