// smoke:run-slots — WHICH RUN A STAMP BELONGS TO, as the pure decision it is.
//
// WHY THIS FILE EXISTS. A job's run record is the surface that points at everything a run produced:
// its report, the lanes it cut, whether it finished. The pointer is stamped from the session's run
// slots — and those slots could not survive the shape the job document REQUIRES ("two runs, and
// they are not interchangeable": the job's run, and a registered run per lane).
//
// Measured on disk, 2026-10-19, on the JOB-side records (the ones the card reads): eight reports
// filed across six `job:proactive-development` runs, and the pointers land on the WRONG RUN — the
// newest run has none, one points at another run's report, four point at the previous session's.
// The reach-back explains all three: with `currentRun` null the stamp falls through to the job run
// that most recently closed, which is a neighbour rather than the one that filed.
//
// These claims are about the decision only. Whether sessions.cjs calls them at the right moments is
// covered by reading the three call sites; there is no harness that drives a live session's run
// slots, and pretending otherwise would be worse than saying so.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { jobRunOf, onRunOpened, onRunClosed } = require("../electron/agents/runSlots.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

const JOB = { id: "r-job", source: "job:proactive-development" };
const LANE = { id: "r-lane", source: "lane:lane/a-thing" };
const SKILL = { id: "r-skill", source: "skill:context-maintenance" };

// ── 1 · THE ORDINARY CASE ─────────────────────────────────────────────────────────────────────
{
  assert.deepStrictEqual(jobRunOf({ currentRun: JOB }), { job: "proactive-development", runId: "r-job" });
  ok("a report filed while the job's run is current stamps that run");
}

// ── 2 · THE BUG, AS A CLAIM ───────────────────────────────────────────────────────────────────
// The whole night's failure in four lines: open a job, register a lane, close the lane, file.
{
  let s = { currentRun: null, jobRun: null, lastJobRun: null };
  s.jobRun = onRunOpened(s, JOB);
  s.currentRun = JOB;

  s.currentRun = LANE;                       // registering the lane takes the single slot
  s.jobRun = onRunOpened(s, LANE);           // …and must not disturb the held job run
  assert.deepStrictEqual(s.jobRun, { job: "proactive-development", runId: "r-job" });

  const after = onRunClosed(s, LANE);        // the lane's list goes all-done
  s.jobRun = after.jobRun;
  s.lastJobRun = after.lastJobRun;
  s.currentRun = null;                       // nothing is current, which is true

  assert.deepStrictEqual(jobRunOf(s), { job: "proactive-development", runId: "r-job" });
  ok("a lane opening and closing underneath a job leaves the job's run stampable — the eight-reports-no-pointer bug");
}

// ── 3 · THE REACH-BACK STILL WORKS ────────────────────────────────────────────────────────────
// Most agents file the account AFTER marking the last item, so the job's run is already closed.
{
  let s = { currentRun: JOB, jobRun: { job: "proactive-development", runId: "r-job" }, lastJobRun: null };
  const after = onRunClosed(s, JOB);
  assert.deepStrictEqual(after.lastJobRun, { job: "proactive-development", runId: "r-job" });
  assert.strictEqual(after.jobRun, null, "its own close clears the slot it was holding");
  assert.deepStrictEqual(
    jobRunOf({ currentRun: null, jobRun: after.jobRun, lastJobRun: after.lastJobRun }),
    { job: "proactive-development", runId: "r-job" },
  );
  ok("a report filed after the job's last item still stamps it — the reach-back is unchanged");
}

// ── 4 · A STALE SLOT MUST NOT OUTRANK A LIVE ONE ──────────────────────────────────────────────
{
  const held = { job: "proactive-development", runId: "r-job-2" };
  const after = onRunClosed({ jobRun: held, lastJobRun: null }, JOB); // an OLDER job run closing
  assert.deepStrictEqual(after.jobRun, held, "the live job run is still held");
  assert.deepStrictEqual(after.lastJobRun, { job: "proactive-development", runId: "r-job" });
  assert.deepStrictEqual(jobRunOf({ jobRun: after.jobRun, lastJobRun: after.lastJobRun }), held);
  ok("one job run closing does not drop another that is still open, and the live one wins");
}

// ── 5 · A REPORT OUTSIDE ANY JOB IS JUST A REPORT ─────────────────────────────────────────────
// Most reports are: a conversation, a refinement, an answer. Those must stamp nothing.
{
  assert.strictEqual(jobRunOf({}), null);
  assert.strictEqual(jobRunOf({ currentRun: LANE }), null);
  assert.strictEqual(jobRunOf({ currentRun: SKILL }), null);
  assert.strictEqual(jobRunOf(), null);
  ok("a lane's run, a skill's run, or no run at all stamps nothing — a report outside a job is just a report");
}

// ── 6 · A SKILL'S RUN IS NOT A JOB'S, OPENING OR CLOSING ──────────────────────────────────────
// `skill:` sources run through the same door and must behave exactly like a lane here.
{
  let s = { currentRun: JOB, jobRun: onRunOpened({}, JOB), lastJobRun: null };
  s.jobRun = onRunOpened(s, SKILL);
  const after = onRunClosed(s, SKILL);
  assert.deepStrictEqual(jobRunOf({ ...s, ...after, currentRun: null }), { job: "proactive-development", runId: "r-job" });
  ok("a skill run nested in a job behaves like a lane — the job underneath stays stampable");
}

// ── 7 · MALFORMED SLOTS ANSWER NULL RATHER THAN HALF A POINTER ────────────────────────────────
// A pointer with a job and no runId would stamp nothing and look like it had.
{
  assert.strictEqual(jobRunOf({ jobRun: { job: "x" } }), null);
  assert.strictEqual(jobRunOf({ lastJobRun: { runId: "y" } }), null);
  // A current run with no id is the same half-pointer, through the branch that looked safest.
  assert.strictEqual(jobRunOf({ currentRun: { source: "job:x" } }), null);
  ok("a half-written slot answers null instead of a pointer that cannot land");
}

console.log(`\n  ${n} claims, all green — a job keeps its run under a lane\n`);
