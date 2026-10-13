// smoke:jobpath — THE WHOLE PATH, ONCE, END TO END. RFC-067 §3 and §4.
//
// WHY THIS FILE EXISTS. Every piece of the jobs feature had its own claims — the gate in
// tests/jobs.js, the pointer in tests/hooks.js, the verbs in tests/context.js, the board in
// tests/agent-definitions.js, the stamp in tests/worklist.js. Four lanes, five suites, all green,
// and the sentence nobody had ever asserted was the only one that matters:
//
//   a hook fires → the job is given → a run opens → the run closes → the board checks the line off
//
// Five modules have to agree for that to be true, and five suites proving their own halves is
// exactly the shape in which an integration can be broken while everything passes. It had in fact
// never happened on this machine: no job document existed, so no job had ever been given.
//
// THE DOOR, NOT THE MODULE. The hook here is written through the `hooksWrite` TOOL rather than
// hooks.save(), because the tool refused every pointer that was not `skill:` until 2026-10-07 — the
// engine could fire a job hook that the one agent-facing door could not write. A test that called
// hooks.save() directly passed throughout. Same for the board: the `chores` TOOL renders it, and the
// tool was the half with no claims of its own.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// A SCRATCH HOME BEFORE ANY REQUIRE. Five modules resolve their directories from homedir at load,
// once — definitions, hooks, worklist, jobs, and the hooks fire-rate ledger. Run against the real
// home this file would write jobs and hooks into his machine and hand `pruneRuns` the keys to his
// live lane records (see worklist.cjs's DIR comment: it has deleted them before).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-jobpath-"));
process.env.HOME = scratch;
os.homedir = () => scratch;
process.env.AUTOBOT_WORKLISTS_DIR = path.join(scratch, "worklists");
fs.mkdirSync(process.env.AUTOBOT_WORKLISTS_DIR, { recursive: true });

const definitions = require("../electron/agents/definitions.cjs");
const hooks = require("../electron/agents/hooks.cjs");
const worklist = require("../electron/agents/worklist.cjs");
const jobs = require("../electron/agents/jobs.cjs");
const ctx = require("../electron/agents/context.cjs");

for (const [what, dir] of [["jobs", jobs.DIR], ["hooks", hooks.DIR], ["worklists", worklist.DIR]]) {
  if (!String(dir).startsWith(scratch)) {
    console.error(`FAIL ${what} is pointing at ${dir} — the scratch home did not take`);
    process.exit(1);
  }
}

let pass = 0;
const ok = (name) => { pass++; console.log(`  ok  ${name}`); };
const said = (r) => ((r && r.content) || []).map((c) => c.text).join("");

const SLOT = "jobpath";
const PROJECT = "jobpath-proj";
// `session:<projectCode>:<id>` — the scheme the lane rows and the chore stamps both parse. A bare
// `session:<slot>` reads as place "-" and the board would never see the close.
const SESSION = `session:${PROJECT}:s1`;
const JOB = "month-close";
const DOC = `---
requires: ["period"]
---
# Close the month

**The aim.** Reconcile one month and file the result.

**What it must be given.** \`period\` — the month to close, as YYYY-MM.

**The procedure.** Read the ledger, reconcile, write the summary.

**The handover.** A summary at ~/books/<period>/close.md. Its existence is "done".

**The bounds.** Never touch a period that is already closed. When unsure, ask.
`;

(async () => {
  // ── 1 · the agreement exists, and it declares what it needs ───────────────────────────────
  const job = jobs.save({ id: JOB, name: "Close the month", doc: DOC });
  assert.deepStrictEqual(job.requires, ["period"]);
  ok("a job is its document — and the document's `requires:` is what the system will refuse against");

  // ── 2 · the hook is written through the TOOL, pointing at a JOB, carrying its inputs ───────
  // The tool, not hooks.save(): see the header. This claim is the door.
  const tools = ctx.toolsFor({ slot: SLOT, projectCode: "jobpath-proj", by: SLOT });
  const hooksWrite = tools.find((t) => t.name === "hooksWrite");
  const chores = tools.find((t) => t.name === "chores");
  assert.ok(hooksWrite && chores, "hooksWrite and chores are both in toolsFor's output");

  const refusedPointer = await hooksWrite.handler({ name: "nonsense", on: "user.prompt", do: "the accounting one" }, {});
  assert.ok(refusedPointer.isError && /must be a pointer/.test(said(refusedPointer)));
  ok("a `do` that is not a pointer is still refused — opening the door to jobs did not open it to prose");

  const wrote = await hooksWrite.handler(
    { name: "close-the-month", on: "user.prompt", when: { text: { contains: "close the month" } },
      do: `job:${JOB}`, with: { period: "2026-09" }, note: "he said it out loud" },
    {},
  );
  assert.ok(!wrote.isError, said(wrote));
  ok("hooksWrite writes a JOB pointer — the engine has fired these since RFC-067 §3, and this door refused them until today");
  assert.ok(/with period/.test(said(wrote)), said(wrote));
  ok("...and the read-back names the inputs it carries, because `with:` is the half a `when` cannot express");
  assert.ok(/It is INERT/.test(said(wrote)));
  ok("...and it says out loud that it fires for nobody — writing a hook is the proposal, carrying it is the approval");

  // A hook that could never satisfy the job is refused AT THE WRITING DOOR, not at 3am.
  const starved = await hooksWrite.handler(
    { name: "close-the-month-badly", on: "user.prompt", do: `job:${JOB}` },
    {},
  );
  assert.ok(starved.isError && /period/.test(said(starved)), said(starved));
  ok("a hook that cannot supply what the job declares is refused by NAME where somebody is watching");

  // ── 3 · nothing fires for an agent that does not carry it ─────────────────────────────────
  const event = { kind: "user.prompt", text: "please close the month for me" };
  assert.deepStrictEqual(hooks.fire(event, { carries: [], session: SESSION }), []);
  ok("an uncarried hook fires for nobody — the human's tick is the arming, and it is not a formality");

  // ── 4 · carried, it fires, and the job is GIVEN ───────────────────────────────────────────
  definitions.save({ name: SLOT, projectCode: "jobpath-proj", hooks: ["close-the-month"], chores: [{ what: `job:${JOB}`, period: "monthly" }] });
  assert.deepStrictEqual(definitions.get(SLOT).def.hooks, ["close-the-month"]);
  ok("the carry lives on the agent definition, beside the chore line that will check itself off");

  const [fired] = hooks.fire(event, { carries: ["close-the-month"], session: SESSION, fired: new Map(), turn: 1 });
  assert.ok(fired, "the carried hook matched");
  assert.strictEqual(fired.job, JOB);
  assert.deepStrictEqual(fired.with, { period: "2026-09" });
  assert.strictEqual(fired.given, true);
  assert.ok(fired.runId, "a run id came back from the fire");
  ok("the hook fires and the job is GIVEN, with its declared input supplied — one dispatch path, which is the whole of §3");

  const pointer = hooks.pointerText(fired, event);
  assert.ok(/has been GIVEN to you/.test(pointer), pointer);
  assert.ok(/period/.test(pointer) && /2026-09/.test(pointer), pointer);
  assert.ok(!/ignore it if it does not apply/.test(pointer));
  ok("the pointer says GIVEN and names what it was given — and carries none of the skill pointer's licence to decline");

  // ── 5 · the run exists, sourced by the job, and nothing else minted a store ───────────────
  const owner = jobs.ownerOf(JOB);
  assert.strictEqual(owner, `job:${JOB}`);
  const run = worklist.all().find((r) => r.owner === `run:${fired.runId}`);
  assert.ok(run, "the run file exists under run:<id>");
  assert.strictEqual(run.source, owner);
  assert.strictEqual(run.session, SESSION);
  ok("giving opened a run in the worklist store sourced `job:<id>` — the same store every skill uses, not a second one");

  // THE SESSION OWNER IS NOT A LABEL. The board scopes a line to the agent's PLACEMENT, and the
  // place is parsed out of the run's session (`session:<projectCode>:<id>`) — so a job given in a
  // session whose owner does not carry the project would close a run the board could never see.
  assert.strictEqual(worklist.placeOf(SESSION), "jobpath-proj");
  ok("...and the run's session carries the project, which is the only handle the board has on whose work it was");

  // ── 6 · an unfinished job does not close, and the board does not lie about it ─────────────
  assert.strictEqual(jobs.done(JOB, fired.runId), false);
  ok("a job whose list is not all-done does NOT close — the close is observed, never claimed");

  const before = await chores.handler({}, {});
  assert.ok(/NOT DONE/.test(said(before)), said(before));
  ok("and the board reads NOT DONE while the work is open — nothing is ticked by starting");

  // ── 7 · the agent works its own list, and finishing it closes the job ────────────────────
  // Through the worklist the way an agent actually drives one: its own source, its own items.
  worklist.writeRun(fired.runId, SESSION, [{ text: "reconcile 2026-09", state: "done" }], owner);
  assert.strictEqual(jobs.done(JOB, fired.runId), true);
  ok("every item done CLOSES the job — off the run record, with no flag an agent could lie with");

  const runs = jobs.runsOf(JOB);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].status, "finished");
  assert.ok(runs[0].finishedAt > 0, "and it is stamped with when");
  assert.ok(runs[0].why && /close-the-month/.test(runs[0].why), runs[0].why);
  ok("the run record keeps WHY it ran — §4: you must be able to answer that at 3am");

  // THE LIST IT FINISHED, which this claim used to assert in its NAME and never in its body. The
  // snapshot read owner `job:<id>` while every item is written under `run:<runId>`, so the field
  // the code calls "the worklist AS IT STOOD when the run ended" came back `[]` on every job that
  // ever closed — and the suite stayed green because it only ever checked status, finishedAt and
  // why. Found by a behaviour eval predicting it from the two owners, 2026-10-08.
  assert.ok(Array.isArray(runs[0].worklist) && runs[0].worklist.length > 0,
    "the finished record's worklist snapshot is EMPTY: " + JSON.stringify(runs[0].worklist));
  assert.ok(runs[0].worklist.every((i) => i.state === "done"),
    "and every item on it reads done, because that is the moment it is a copy of");
  ok("...and the list it finished, item by item — the account of the moment is actually in it");

  // ── 7b · THE RUN RECORD POINTS AT A REPORT, AND STORES NONE ──────────────────────────────
  // His call: *"you have a job, it just needs to point to a report."* And RFC-066 §5 settled where
  // a report lives by DELETING the alternative — `show` files it into the reports panel, which is
  // the surface he actually reads reports in. So what lands on the run is a pointer.
  const filed = ".systemview/report.jobpath-proj.Closed-2026-09.md";
  jobs.reported(JOB, fired.runId, { path: filed, label: "Closed 2026-09" });
  const withReport = jobs.runsOf(JOB)[0];
  assert.strictEqual(withReport.report.path, filed);
  assert.strictEqual(withReport.report.label, "Closed 2026-09");
  ok("a finished run POINTS at the report it filed — a path and a label, never a copy of the prose");

  jobs.reported(JOB, fired.runId, { path: ".systemview/report.jobpath-proj.Closed-2026-09-v2.md" });
  const twice = jobs.runsOf(JOB)[0];
  assert.strictEqual(twice.reports.length, 2);
  assert.ok(/v2/.test(twice.report.path));
  ok("...and a second filing is kept beside the first, newest as THE report — a draft must not vanish silently");

  assert.strictEqual(jobs.reported(JOB, fired.runId, { path: "  " }).report.path, twice.report.path);
  ok("an empty path changes nothing — there is no way to blank the pointer by accident");

  // ── 8 · AND THE LINE CHECKS ITSELF OFF ───────────────────────────────────────────────────
  // The sentence this whole file exists for. Nobody ticked anything.
  const after = await chores.handler({}, {});
  assert.ok(!after.isError, said(after));
  assert.ok(/\[x\]/.test(said(after)), said(after));
  assert.ok(/month-close/.test(said(after)));
  assert.ok(!/NOT DONE/.test(said(after)), said(after));
  ok("THE LINE CHECKED ITSELF OFF — a hook fired, a job was given, a run opened and closed, and the board says done. Nobody marked it");

  assert.ok(/never a stored tick/.test(said(after)));
  ok("...and the board says so about itself: read off closed run records, never a stored tick");

  // ── 9 · the check is a QUERY, so it survives the janitor and does not survive the period ──
  worklist.pruneRuns(Date.now() + 15 * 24 * 60 * 60 * 1000);
  const swept = await chores.handler({}, {});
  assert.ok(/\[x\]/.test(said(swept)), said(swept));
  ok("the line stays checked after the 14-day sweep took the run record — the stamp is what the sweep leaves behind");

  // ── 10 · the verb's own refusals, which had no claims anywhere ────────────────────────────
  const noSlot = ctx.toolsFor({ slot: "", projectCode: "jobpath-proj" }).find((t) => t.name === "chores");
  assert.ok(/no agent slot/.test(said(await noSlot.handler({}, {}))));
  ok("a session with no agent slot carries no chores, and the verb says that rather than answering empty");

  const bare = ctx.toolsFor({ slot: "nobody-home", projectCode: "jobpath-proj" }).find((t) => t.name === "chores");
  const bareSaid = said(await bare.handler({}, {}));
  assert.ok(/No chores are on your definition/.test(bareSaid), bareSaid);
  ok("an agent with no lines gets a stated absence — an unknown agent is not an error");

  assert.ok(ctx.TOOL_NAMES.includes("mcp__context__chores"));
  ok("chores is in TOOL_NAMES, which is what sessions.cjs hands the SDK as allowedTools");

  // ── 11 · THE OTHER WAY A JOB IS HANDED OVER ───────────────────────────────────────────────
  // RFC-067 §3 names two: a hook, or the human. `given()` is the only door that opens a job's run
  // record and it is reached only through a hook — so the human path produced a worklist run with
  // the right source and NO job record, and everything reading that record failed SILENTLY: no
  // report pointer could land, the status never flipped, the card had nothing to show. Found by a
  // behaviour eval on 2026-10-08, not by any of the claims above, because every one of them came
  // in through the hook.
  //
  // The fix opens the record when a `job:`-sourced run opens, and says in `why` how it arrived —
  // the gate is NOT claimed to have run, because a human supplying inputs in a sentence cannot be
  // checked against a hook's `with:`.
  {
    const NAMED = "named-by-hand";
    jobs.save({ id: NAMED, name: "Named by hand", doc: `# ${NAMED}\n\nHanded over in a sentence.\n` });
    assert.strictEqual(jobs.runsOf(NAMED).length, 0, "no run before anything happens");

    // what sessions.cjs does when the agent writes a job-sourced list with no hook involved
    const runId = worklist.newRunId();
    jobs.startRun(NAMED, { runId, why: "named in the conversation, not fired by a hook — its declared inputs were not machine-checked" });
    worklist.writeRun(runId, "session:hand", [{ id: "s1", text: "do it", state: "active" }], `job:${NAMED}`, {});

    const opened = jobs.runsOf(NAMED);
    assert.strictEqual(opened.length, 1, "a job named in the conversation gets a run record too");
    assert.strictEqual(opened[0].status, "running");
    ok("a job handed over in a sentence leaves the same record as one a hook fired — the human path is not a silent path");

    assert.ok(/not fired by a hook/.test(opened[0].why) && /not machine-checked/.test(opened[0].why),
      "and the record says how it arrived");
    ok("...and it does NOT claim the input gate ran — a sentence cannot be checked against a hook's `with:`");

    // the two links that were dead on this path
    jobs.reported(NAMED, runId, { path: ".systemview/report.x.By-hand.md", label: "By hand" });
    assert.strictEqual(jobs.runsOf(NAMED)[0].report.path, ".systemview/report.x.By-hand.md");
    ok("the report pointer lands on it, which it could not do when there was no record to patch");

    worklist.writeRun(runId, "session:hand", [{ id: "s1", text: "do it", state: "done" }], `job:${NAMED}`, {});
    jobs.done(NAMED, runId);
    assert.strictEqual(jobs.runsOf(NAMED)[0].status, "finished");
    ok("and it closes — so the card can read finished with a report waiting, on either path");
  }

  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(`\n${pass} claims held — the job path, end to end`);
})().catch((e) => {
  console.error("FAIL", e);
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
  process.exit(1);
});
