// WHICH RUN A SESSION IS "IN" — and why one slot was never enough.
//
// A session held ONE slot (`s.currentRun`), plus `s.lastJobRun` as a reach-back for the common
// order where an agent files its account after marking the final item. Two things read them:
// `jobs.laneCut` (when a lane registers) and `jobs.reported` (when a report is filed).
//
// THE SHAPE THAT BROKE IT IS THE SHAPE THE JOB DOCUMENT REQUIRES. proactive-development says it in
// as many words — "TWO RUNS, AND THEY ARE NOT INTERCHANGEABLE": the JOB's run records that the job
// ran, and each LANE's run is what draws his row. So a real run goes:
//
//     set source job:…      → currentRun = the job run
//     set source lane:…     → currentRun = the LANE run   (the job run is simply overwritten)
//     lane list all-done    → currentRun = null           (lastJobRun untouched: it only fills
//                                                          when a JOB run closes)
//     show quiet:true       → stamp? currentRun is null, lastJobRun is null → NOTHING
//
// Measured 2026-10-19: eight reports filed across six job runs in one night, and every run record
// on disk had `report: null`. The job cards read "finished · no report" while the documents sat in
// the mailbox — the same lie that was chased last night and attributed to the quiet-show flag, when
// the flag was never the cause.
//
// So the slot becomes a short STACK of one dedicated kind: the job run is remembered separately and
// survives any number of lane runs opening and closing underneath it. Pure, because the thing that
// was wrong is a decision, and a decision belongs where it can be claimed.

// WHICH JOB RUN A STAMP BELONGS TO, in priority order:
//   1. the current run, when it IS a job's — the ordinary case;
//   2. the job run held open UNDERNEATH whatever is current — a lane's run, or nothing;
//   3. the job run that most recently closed — the reach-back for "file the report after the last
//      item is done", which is how most agents write.
function jobRunOf({ currentRun = null, jobRun = null, lastJobRun = null } = {}) {
  // THE ID IS PART OF THE POINTER. A `{job, runId: undefined}` stamps nothing and looks exactly
  // like a stamp that worked — the same failure class this whole module exists to end. Caught by
  // this module's own claims.
  if (currentRun && currentRun.id && String(currentRun.source || "").startsWith("job:"))
    return { job: String(currentRun.source).slice(4), runId: currentRun.id };
  if (jobRun && jobRun.job && jobRun.runId) return { job: jobRun.job, runId: jobRun.runId };
  if (lastJobRun && lastJobRun.job && lastJobRun.runId) return { job: lastJobRun.job, runId: lastJobRun.runId };
  return null;
}

// A run became current. Returns the new `jobRun` slot: a job's run is REMEMBERED (it is the thing
// that outlives the lanes it cuts); anything else leaves the slot exactly as it was, which is the
// whole point.
function onRunOpened({ jobRun = null }, run) {
  if (run && String(run.source || "").startsWith("job:"))
    return { job: String(run.source).slice(4), runId: run.id };
  return jobRun;
}

// A run went all-done. A JOB's close clears the slot and fills the reach-back; a LANE's close must
// leave the job slot alone — that erasure is the bug.
function onRunClosed({ jobRun = null, lastJobRun = null }, run) {
  if (run && String(run.source || "").startsWith("job:")) {
    const closed = { job: String(run.source).slice(4), runId: run.id };
    // Only clear the slot if the run that closed IS the one being held — a stale slot from an
    // earlier job must not survive, and an unrelated close must not drop a live one.
    const stillHeld = jobRun && jobRun.runId !== run.id ? jobRun : null;
    return { jobRun: stillHeld, lastJobRun: closed };
  }
  return { jobRun, lastJobRun };
}

module.exports = { jobRunOf, onRunOpened, onRunClosed };
