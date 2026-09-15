// smoke:jobs — RFC-005 §2. The job store: the document, the projection, the runs.
//
// THE CLAIM THAT MATTERS MOST is the one that looks like bureaucracy: a job without its document
// is refused. §2.1 is that the document IS the job and job.json is a projection of it — so a job
// that has a trigger and a definition but no written agreement is a cron line. There is nothing to
// load whole when it fires, nothing that says what it must never do, and nothing a human can read
// on Monday to know what they agreed to. Everything else here is plumbing; that one is the design.
//
// Writes under ~/.autobot/jobs/smoke-* and removes them. It never touches a real job.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const jobs = require("../electron/agents/jobs.cjs");
const worklist = require("../electron/agents/worklist.cjs");

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
      trigger: { on: "page.value-changed", when: { watch: { equals: "w1" } } },
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

    assert.equal(j.onMissed, "skip", "§2.3 — skip by default for anything periodic");
    ok("downtime defaults to skip; catching up is something a job has to ask for");
  }

  // ---- the trigger is checked where it is WRITTEN ---------------------------------------------
  {
    assert.throws(() => jobs.save({ id: ID, doc: DOC, trigger: { on: "page.exploded" } }), /never fire/);
    ok("a trigger on an event nobody emits is refused — a silent job is the failure we are avoiding");

    const j = jobs.save({ id: ID, doc: DOC, trigger: { on: "schedule.due", when: { job: { equals: ID } } } });
    assert.equal(j.trigger.on, "schedule.due");
    ok("the clock and external arrivals are allowed ahead of their emitters — listed, not waved through");
  }

  // ---- matching reuses the hooks matcher (§1) --------------------------------------------------
  {
    jobs.save({ id: ID, doc: DOC, trigger: { on: "page.value-changed", when: { watch: { equals: "w1" } } } });
    assert.equal(jobs.due({ kind: "page.value-changed", watch: "w1" }).length, 1, "the matching job is due");
    assert.equal(jobs.due({ kind: "page.value-changed", watch: "w2" }).length, 0, "a different watch is not");
    assert.equal(jobs.due({ kind: "session.started" }).length, 0, "a different event is not");
    ok("a job trigger and a hook condition mean the same thing by the same JSON — one matcher, not two");

    jobs.save({ id: ID, doc: DOC, enabled: false, trigger: { on: "page.value-changed", when: { watch: { equals: "w1" } } } });
    assert.equal(jobs.due({ kind: "page.value-changed", watch: "w1" }).length, 0);
    ok("a disabled job matches nothing");
    jobs.save({ id: ID, doc: DOC, enabled: true, trigger: { on: "page.value-changed", when: { watch: { equals: "w1" } } } });
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
