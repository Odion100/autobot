// smoke:jobs — RFC-005 §2. The job store: the document, the projection, the runs.
//
// THE CLAIM THAT MATTERS MOST is the one that looks like bureaucracy: a job without its document
// is refused. §2.1 is that the document IS the job and job.json is a projection of it — so a job
// that has a trigger and a definition but no written agreement is a cron line. There is nothing to
// load whole when it fires, nothing that says what it must never do, and nothing a human can read
// on Monday to know what they agreed to. Everything else here is plumbing; that one is the design.
//
// Writes under its own scratch home and removes nothing of his. It used to say "writes under
// ~/.autobot/jobs/smoke-* and removes them. It never touches a real job" — true about jobs, and
// silent about the rest: closing a run stamps the CHORE BOARD, so every run of this suite wrote a
// `job:smoke-job-probe` key into his live `.chore-stamps.json` and re-stamped it on each run
// (measured 2026-10-18 — the key had been accumulating there for as long as the suite has existed).
// A suite stands up what it needs and leaves nothing behind, so it gets the same scratch home its
// sibling `job-path` has, and the same proof that the scratch TOOK.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// A SCRATCH HOME BEFORE ANY REQUIRE — these modules resolve their directories from homedir at load
// time, once, so a redirect after the require reaches nothing.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-jobs-"));
process.env.HOME = scratch;
os.homedir = () => scratch;
process.env.AUTOBOT_WORKLISTS_DIR = path.join(scratch, "worklists");
fs.mkdirSync(process.env.AUTOBOT_WORKLISTS_DIR, { recursive: true });

const jobs = require("../electron/agents/jobs.cjs");
const worklist = require("../electron/agents/worklist.cjs");

// PROVE THE SCRATCH TOOK, or refuse to run. An invented env var and a hopeful comment is how a
// "scratch" suite wrote into the live agents store once already; the guard is the only thing that
// turns an assumption into a fact.
for (const [what, dir] of [["jobs", jobs.DIR], ["worklists", worklist.DIR], ["chore stamps", worklist.STAMPS]]) {
  if (!String(dir).startsWith(scratch)) {
    console.error(`FAIL ${what} is pointing at ${dir} — the scratch home did not take`);
    process.exit(1);
  }
}

const ID = "smoke-job-probe";
let pass = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
const DOC = "# smoke job\n\nWhat it does: nothing.\nWhat it must never do: anything.\n";

try {
  jobs.remove(ID);

  // ---- §2.1 the document is the job ----------------------------------------------------------
  {
    assert.throws(() => jobs.save({ id: ID, definition: { prompt: "go" } }), /document/,
      "a job with no document is refused");
    ok("a job without its written agreement is refused — job.json is a projection, not a substitute");

    assert.throws(() => jobs.save({ id: "", doc: DOC }), /id/);
    ok("a job needs an id");
  }

  // ---- §2.2 the durable definition -----------------------------------------------------------
  {
    const j = jobs.save({
      id: ID,
      name: "smoke job",
      doc: DOC,
      definition: { prompt: "do the thing", model: "sonnet", skills: ["context-retrieval"], nonsense: "dropped" },
      confirmation: "the file exists",
      evaluation: "was it worth reading?",
    });
    assert.ok(fs.existsSync(path.join(j.dir, "job.md")), "job.md is on disk");
    assert.ok(fs.existsSync(path.join(j.dir, "job.json")), "job.json is on disk");
    ok("a job is a directory with its document beside its projection");

    assert.equal(j.doc.trim(), DOC.trim(), "the document is read back whole");
    ok("the document is read from disk, never cached — it is edited between runs");

    assert.equal(j.definition.prompt, "do the thing");
    assert.equal(j.definition.model, "sonnet");
    assert.ok(!("nonsense" in j.definition), "a field an AgentDefinition cannot express is dropped");
    ok("the definition half is an AgentDefinition — ADOPTED, not paralleled (RFC-003)");

    assert.ok(!("trigger" in j), "a job carries no trigger of its own");
    assert.ok(!("onMissed" in j), "and no downtime policy, which only a scheduler could honour");
    ok("A JOB CARRIES NO TRIGGER (2026-10-07). It used to carry `trigger` + `onMissed`, validated on save and matched by a `due()` nothing ever called — the pre-RFC design. It was removed rather than wired because it could not be wired: `given()` refuses without a session and an event carries none, so the field could arm and never run. The hook answers WHO by its carry, and that is the one path that fires (RFC-067 §3)");

    assert.equal(typeof jobs.due, "undefined", "the second matcher is gone, not merely uncalled");
    ok("one dispatch path, and nothing left beside it that looks like one");
  }

  // ---- §2.4 the run record, and §5 the rating -------------------------------------------------
  {
    const r = jobs.startRun(ID, { runId: "r1", why: "watch w1 moved 41 → 42", event: { kind: "page.value-changed" } });
    assert.equal(r.status, "running");
    assert.ok(r.why, "a run carries why it ran");
    ok("a run records WHY it started — §4: you must be able to answer that at 3am");

    worklist.write(jobs.ownerOf(ID), [{ id: "1", text: "step one", state: "done" }]);
    const f = jobs.finishRun(ID, "r1", { produced: "a file" });
    assert.equal(f.status, "finished");
    assert.equal(f.worklist[0].text, "step one", "the worklist as it stood is copied onto the record");
    ok("a finished run keeps the worklist it left behind — history is a copy by definition");

    const rated = jobs.rateRun(ID, "r1", { rating: 4, note: "useful" });
    assert.equal(rated.rating, 4);
    assert.ok(rated.ratedAt > 0);
    ok("§5 — the rating is separate from finishing, because it arrives when a human READS it");

    // HIS MARK — a third lane on the row, beside the derived word and the agent's status
    const marked = jobs.markState(ID, "r1", "  walked it  ");
    assert.equal(marked.state, "walked it", "trimmed, stored verbatim — his words, not a code");
    assert.ok(marked.stateAt > 0);
    assert.equal(marked.status, "finished", "and it leaves the run's OWN status alone");
    assert.equal(marked.rating, 4, "and the rating it was given");
    ok("his mark rides the run record beside the status, never over it");

    const relabelled = jobs.markState(ID, "r1", "approved");
    assert.equal(relabelled.state, "approved", "he can change his mind");
    const cleared = jobs.markState(ID, "r1", "   ");
    assert.ok(!("state" in cleared), "and clear it — a mark nobody can retract is worse than none");
    assert.ok(!("stateAt" in cleared), "the stamp goes with it");
    ok("the mark is his to change and to clear, and clearing leaves no ghost");

    assert.equal(jobs.markState(ID, "nope", "walked it"), null, "no record, no mark invented");
    assert.ok(Array.isArray(jobs.STATES) && jobs.STATES.includes("walked it"));
    ok("the offered vocabulary exists and a missing run is answered with null, not a new file");

    const j = jobs.get(ID);
    assert.equal(j.runs, 1);
    assert.equal(j.lastRun.id, "r1");
    ok("a job knows its own history without anybody assembling it");
  }

  // ---- §3 the worklist belongs to the job ------------------------------------------------------
  {
    assert.equal(jobs.ownerOf(ID), `job:${ID}`);
    assert.equal(jobs.get(ID).worklist[0].text, "step one");
    ok("a job's progress model IS the worklist — owned by the job, not by whatever session ran it");
  }

  // ---- RFC-067 §2 part 2 — WHAT IT MUST BE GIVEN, and the refusal -----------------------------
  //
  // The one requirement the design calls worthless if it is not enforced: a missing input is a
  // REFUSAL, not a guess. Which means it has to be computable — a declaration that lives only in a
  // paragraph is a refusal nobody can ever compute, so it is a refusal nobody ever gets. These
  // claims are about the declaration being machine-readable, the refusal naming what was missing,
  // and — the one with teeth — no run existing for a job that was given too little.
  {
    const NEEDY = `---\nrequires: ["period", "ledger"]\n---\n\n# needs two things\n\n## 2 · What it must be given\n` +
      `- \`period\` — the month to close. A missing one is a refusal, not a guess.\n- \`ledger\` — which book.\n`;
    jobs.save({ id: ID, name: "needy job", doc: NEEDY });

    assert.deepEqual(jobs.get(ID).requires, ["period", "ledger"]);
    ok("a job's declared inputs are read off its document — part 2 in the one form a refusal can be computed from");

    const none = jobs.check(ID, {});
    assert.equal(none.ok, false);
    assert.deepEqual(none.missing, ["period", "ledger"]);
    assert.match(none.refusal, /`period`/);
    assert.match(none.refusal, /`ledger`/);
    assert.match(none.refusal, /not a guess/);
    ok("a job given nothing is refused BY NAME — every missing input said out loud, not a count");

    assert.deepEqual(jobs.check(ID, { period: "2026-09" }).missing, ["ledger"]);
    ok("and the refusal names only what is actually missing — one input short is still a refusal");

    assert.deepEqual(jobs.check(ID, { period: "   ", ledger: "main" }).missing, ["period"]);
    ok("an empty value is a MISSING value — a blank is the guess wearing a key, not a supplied input");

    assert.equal(jobs.check(ID, { period: "2026-09", ledger: "main", extra: 1 }).ok, true);
    ok("given everything it declared, it passes — an extra the job never asked for is not an error");

    const ghost = jobs.check("smoke-job-nobody-wrote", {});
    assert.equal(ghost.ok, false);
    assert.match(ghost.refusal, /smoke-job-nobody-wrote/);
    ok("a job nobody authored is a refusal that names it, not a crash and not a silent pass");

    // THE DOCUMENT IS THE JOB, so it is also the live answer to what the job demands. A job whose
    // part 2 gained an input this morning must refuse for it this afternoon — waiting for someone
    // to re-save would make the projection the authority, which is the inversion §2.1 forbids.
    fs.writeFileSync(path.join(jobs.dirOf(ID), "job.md"), `---\nrequires: ["period"]\n---\n\n# now needs one\n`);
    assert.deepEqual(jobs.get(ID).requires, ["period"]);
    assert.equal(jobs.check(ID, { period: "2026-09" }).ok, true);
    ok("editing the document changes what the job demands, with nobody re-saving — the projection is not the authority");

    jobs.save({ id: ID, name: "needy job", doc: `# declares nothing\n` });
    assert.deepEqual(jobs.get(ID).requires, []);
    assert.equal(jobs.check(ID, {}).ok, true);
    ok("a job that declares nothing needs nothing — a real answer, and not a licence to guess for one that does");
  }

  // ---- §3 / RFC-067 §3 — THE RUN OPENS AND CLOSES, and it is the worklist's run ----------------
  //
  // Not a second run store. `allDone` is already how completion is OBSERVED rather than declared,
  // and `job:<id>` is already the source the job document tells the agent to write — so giving a
  // job opens THAT run, at the moment it is given, and the agent's own first write continues it.
  {
    const SESSION = "session:smoke-jobs:1";
    jobs.save({ id: ID, name: "needy job", doc: `---\nrequires: ["period"]\n---\n\n# needs a period\n` });

    const refused = jobs.given(ID, { session: SESSION, inputs: {} });
    assert.equal(refused.ok, false);
    assert.equal(refused.runId, undefined, "a refused job has no run");
    assert.equal(worklist.all().filter((r) => r.source === `job:${ID}`).length, 0);
    ok("A REFUSED JOB OPENS NO RUN — there can be no record of work for a job that was given too little");

    assert.equal(jobs.given(ID, { inputs: { period: "p" } }).ok, false);
    ok("and neither does one with no session to open it against — a run is joined by source AND session");

    const g = jobs.given(ID, { session: SESSION, inputs: { period: "2026-09" }, why: "the smoke test gave it" });
    try {
      assert.equal(g.ok, true);
      assert.equal(g.source, `job:${ID}`, "sourced with the job's own owner — the source clearedBy resolves");
      const items = worklist.read(worklist.runOwner(g.runId));
      assert.equal(items.length, 1, "one pending item — a run with none could never be all-done, so never close");
      assert.equal(items[0].state, "pending");
      ok("giving a job OPENS a run in the worklist store, sourced `job:<id>` — no second store minted");

      const again = jobs.given(ID, { session: SESSION, inputs: { period: "2026-09" } });
      assert.equal(again.runId, g.runId, "the same run, not a rival");
      assert.equal(again.resumed, true);
      ok("a second giving in the same session RESUMES that run — the join the agent's own write uses");

      const rec = jobs.runsOf(ID).find((r) => r.id === g.runId);
      assert.ok(rec && /gave it/.test(rec.why), "the job's own record carries why");
      ok("the run's birth records WHY it ran — §4: you must be able to answer that at 3am");

      // COMPLETION IS OBSERVED. A job that says it finished with an item still pending has not.
      worklist.writeRun(g.runId, SESSION, [{ id: "1", text: "step", state: "active" }], g.source);
      assert.equal(jobs.done(ID, g.runId), false, "mid-flight is not done");
      assert.equal((jobs.runsOf(ID).find((r) => r.id === g.runId) || {}).status, "running");
      ok("a job that died mid-list does NOT close, and nothing tidies it — where it died is the record");

      worklist.writeRun(g.runId, SESSION, [{ id: "1", text: "step", state: "done" }], g.source);
      assert.equal(jobs.done(ID, g.runId), true);
      assert.equal((jobs.runsOf(ID).find((r) => r.id === g.runId) || {}).status, "finished");
      ok("every item done CLOSES it — observed off the run record, with no flag an agent could lie with");
    } finally {
      // the run lives in the real worklist store, not under the job — it goes back by hand
      if (g.runId) worklist.deleteRun(g.runId);
    }
  }

  // ---- deleting takes the worklist with it ------------------------------------------------------
  {
    jobs.remove(ID);
    assert.equal(jobs.get(ID), null, "the job is gone");
    assert.equal(worklist.read(`job:${ID}`).length, 0, "and so is its worklist");
    ok("deleting a job leaves no orphan worklist nobody can explain");
  }

  // ---- RFC-005 §10 / RFC-004 §1 — the seam is a CAPABILITY, not a convention -------------------
  // Workers is the app that proves this: it reads and defines jobs and asks for nothing else. If
  // the only way to show a job were `files:read` over the home directory, the grant would be
  // "read everything" wearing a job's name — the exemption RFC-004 §1 exists to prevent.
  {
    const caps = require("../electron/apps/capabilities.cjs");
    const FULL = {
      jobs: { list: 1, get: 1, runs: 1, events: 1, subscribe: 1, save: 1, remove: 1, rate: 1 },
      watches: { list: 1, save: 1, remove: 1 },
      files: { readFile: 1, writeFile: 1 },
    };
    const reader = caps.build(FULL, ["jobs:read"]);
    assert.ok(reader.jobs.list && reader.jobs.subscribe, "a reader can watch");
    assert.ok(!reader.jobs.save && !reader.jobs.rate, "a reader cannot define or rate");
    assert.ok(reader.watches.list && !reader.watches.save, "a reader sees watches but cannot arm one");
    ok("jobs:read is watching — it cannot define what runs unattended");

    const full = caps.build(FULL, ["jobs:read", "jobs:write"]);
    assert.ok(full.jobs.save && full.jobs.rate && full.watches.save, "both grants compose into one namespace");

    // THE GRANT HAS TO BE ON THE APP THAT READS JOBS, or the capability table is correct and the
    // surface is blind. SystemView shipped a Jobs section before it was granted `jobs:read`: the
    // preload handed over no `jobs` namespace at all, the list came back empty, and the section
    // printed "No jobs exist yet" while two jobs sat on disk — a surface testifying instead of
    // reading state. Asserted here rather than in the window, because the grant lives here.
    const registry = require("../electron/apps/registry.cjs");
    const sv = registry.APPS.find((a) => a.id === "systemview");
    assert.ok(sv, "the systemview app is in the registry");
    assert.ok(sv.capabilities.includes("jobs:read"),
      "systemview is granted jobs:read — without it `window.systemview.jobs` is never exposed");
    const svHas = caps.build({ jobs: { list() {}, get() {}, runs() {}, rate() {}, save() {} } }, sv.capabilities);
    assert.ok(svHas.jobs && svHas.jobs.list && svHas.jobs.runs,
      "...and the namespace it actually receives can list and read runs");
    assert.ok(svHas.jobs.rate, "and rate, which is how a run is scored where its report is read");
    ok("the IDE is GRANTED jobs:read — a surface without it cannot tell an empty list from a blind one");
    assert.ok(!full.files, "and nothing leaks in that was not asked for");
    ok("jobs:write adds defining and rating, and brings no files with it");

    assert.deepEqual(caps.build(FULL, []), {}, "no grants, no surface");
    ok("absent, not denied — an app with no grant has no methods to call");
  }

  console.log(`\n${pass} claims held — jobs\n`);
} finally {
  try { jobs.remove(ID); } catch {}
}
process.exit(0);
