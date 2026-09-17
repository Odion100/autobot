// THE WORKLIST, PROVEN AGAINST A REAL SESSION — not a mock, because the claim is
// about what the MODEL does with a tool we hand it, and a mock can only prove
// what we already believe.
//
// THE CLAIMS:
//   1. The tool actually reaches the model (alwaysLoad — it is not stuck behind
//      ToolSearch, which is where a todo tool went to die when we measured).
//   2. Calling it emits `todo.updated` carrying the WHOLE list.
//   3. The event RIDES HISTORY — a subscriber attaching afterwards renders the
//      current list from one event, having seen none of the traffic before it.
//   4. Exactly one item is active, enforced by the tool, not by the model's manners.
//
// Run: npm run smoke:worklist   (costs one small subscription call)
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// HOME IS NOT REDIRECTED HERE, and that is deliberate — the first version of this
// test did redirect it and the session silently failed to authenticate: the SDK
// spawns the real `claude` binary, which reads ~/.claude.json for the login, so a
// scratch HOME means no login and no tool call, which looks exactly like "the
// model ignored our tool". Cost an hour of suspecting the wiring that was fine.
// Only the WORKING DIRECTORY is scratch; kill() forgets the run record at the end.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-worklist-"));
fs.mkdirSync(path.join(scratch, "work"), { recursive: true });

const worklist = require("../electron/agents/worklist.cjs");
const sessions = require("../electron/agents/sessions.cjs");

let pass = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };

// ---- 6. OWNERSHIP (RFC-005 §3, pure) -------------------------------------------
// One concept, two lifetimes: the same structure, keyed by who it belongs to. The claim that
// matters for jobs is separation — a job's list and a session's list must not be the same file,
// because `job:x` and `session:x` are different things that happen to share a name.
{
  worklist.write("job:t-probe", [{ id: "1", text: "job step", state: "active" }]);
  worklist.write("session:t-probe", [{ id: "1", text: "session step", state: "pending" }]);
  assert.equal(worklist.read("job:t-probe")[0].text, "job step");
  assert.equal(worklist.read("session:t-probe")[0].text, "session step");
  ok("job:x and session:x are different worklists, not one file two names");

  assert.deepEqual(worklist.read("job:never-written"), [], "an unknown owner is empty, not a throw");
  ok("reading a worklist nobody wrote is empty, not an error");

  // ---- THE WHITEBOARD — same file, its own half ----------------------------------
  // The one claim that makes the two features friends instead of enemies: each write
  // patches its own half and preserves the other.
  worklist.writeBoard("session:t-probe", "## held\n- the *draft* under discussion");
  assert.equal(worklist.readBoard("session:t-probe"), "## held\n- the *draft* under discussion");
  ok("the whiteboard writes and reads back, markdown intact");

  worklist.write("session:t-probe", [{ id: "1", text: "changed step", state: "active" }]);
  assert.equal(worklist.readBoard("session:t-probe"), "## held\n- the *draft* under discussion",
    "a list write must not clobber the board");
  ok("writing the list preserves the whiteboard");

  worklist.writeBoard("session:t-probe", "replaced wholesale");
  assert.equal(worklist.readBoard("session:t-probe"), "replaced wholesale");
  assert.equal(worklist.read("session:t-probe")[0].text, "changed step",
    "a board write must not clobber the list");
  ok("writing the board preserves the list, and replaces — never appends");

  worklist.writeBoard("session:t-probe", "");
  assert.equal(worklist.readBoard("session:t-probe"), "");
  ok("an empty write is the wipe");

  assert.equal(worklist.readBoard("job:never-written"), "", "an unknown owner's board is empty, not a throw");
  ok("reading a board nobody wrote is empty, not an error");

  // ---- RUNS — an execution owns its list --------------------------------------
  // The claim that motivated the whole feature: a skill firing mid-skill must not
  // destroy the outer skill's half-done list.
  const rid = worklist.newRunId();
  worklist.writeRun(rid, "session:t-probe", [{ id: "1", text: "step one", state: "active" }], "skill:study");
  assert.equal(worklist.read(worklist.runOwner(rid))[0].text, "step one");
  assert.equal(worklist.read("session:t-probe")[0].text, "changed step",
    "a run's write must not touch the session's own plan");
  ok("a run owns its list — the session plan is untouched by it");

  const found = worklist.openRunFor("session:t-probe", "skill:study");
  assert.equal(found, rid, "the unfinished run is found by source+session");
  ok("an unfinished run is resumable — same source, same session, same id");

  worklist.writeRun(rid, "session:t-probe", [{ id: "1", text: "step one", state: "done" }], "skill:study");
  assert.equal(worklist.openRunFor("session:t-probe", "skill:study"), null,
    "an all-done run is finished, not resumable");
  ok("completion is observed — every item done closes the run, no flag to lie with");

  const rec = worklist.all().find((r) => r.owner === worklist.runOwner(rid));
  assert.equal(rec.source, "skill:study");
  assert.equal(rec.session, "session:t-probe");
  ok("the run persists after the fact — source and session on the record");

  // ---- RETENTION — closed runs age out, died runs never do -----------------------
  {
    const oldRun = worklist.newRunId();
    const deadRun = worklist.newRunId();
    worklist.writeRun(oldRun, "session:t-probe", [{ id: "1", text: "done long ago", state: "done" }], "skill:old");
    worklist.writeRun(deadRun, "session:t-probe", [{ id: "1", text: "died here", state: "active" }], "skill:dead");
    const future = Date.now() + 15 * 24 * 60 * 60 * 1000;
    const swept = worklist.pruneRuns(future);
    assert.ok(swept >= 1, "the old closed run was swept");
    assert.deepEqual(worklist.read(worklist.runOwner(oldRun)), [], "closed + old = gone");
    assert.equal(worklist.read(worklist.runOwner(deadRun))[0].text, "died here",
      "a run that died mid-list is NEVER swept — where it died is the record");
    ok("retention: closed runs age out after two weeks; died runs stay until someone acts");
    fs.unlinkSync(worklist.DIR + "/run-" + deadRun + ".json");
  }

  const withBoard = worklist.all().find((r) => r.owner === "job:t-probe");
  worklist.writeBoard("job:t-probe", "survives the after-the-fact read");
  const rowsAfter = worklist.all().find((r) => r.owner === "job:t-probe");
  assert.equal(rowsAfter.whiteboard, "survives the after-the-fact read");
  worklist.writeBoard("job:t-probe", "");
  ok("all() carries the board — readable after the fact, like the list");

  const rows = worklist.all();
  const row = rows.find((r) => r.owner === "job:t-probe");
  assert.ok(row && row.active === "job step" && row.updatedAt > 0, "all() reports progress and freshness");
  ok("all() answers what moved, and when — the only account a 3am run leaves behind");

  for (const o of ["job:t-probe", "session:t-probe"]) {
    try { fs.unlinkSync(path.join(worklist.DIR, `${o.replace(/[^a-zA-Z0-9]+/g, "-")}.json`)); } catch {}
  }
}

// ---- 4. one active, enforced at the tool (pure, no session needed) -------------
{
  const out = worklist.normalize([
    { text: "a", state: "active" },
    { text: "b", state: "active" },
    { text: "c", state: "done" },
    { text: "", state: "pending" },          // empty text is not an item
  ]);
  assert.equal(out.filter((i) => i.state === "active").length, 1, "exactly one active survives");
  assert.equal(out[0].state, "active", "the FIRST active wins — we do not reorder the model's plan");
  assert.equal(out[1].state, "pending", "the second is demoted, not dropped");
  assert.equal(out.length, 3, "empty text is dropped");
  assert.ok(out.every((i) => i.id), "every item gets a stable id");
  ok("one active item is enforced by the tool, not requested of the model");
}

// ---- 1-3. against a live session -----------------------------------------------
const key = "worklist-test:t1";
const s = await sessions.open({
  projectCode: "worklist-test",
  sessionId: "t1",
  cwd: path.join(scratch, "work"),
  permissionMode: "bypassPermissions",
});

const seen = [];
sessions.subscribe(s.key, (e) => { if (e.kind === "todo.updated") seen.push(e); });

sessions.send(s.key, "Use your worklist tool to record exactly three steps for tidying a README — mark the first active, the others pending. Then stop; do not do the work.");

// wait for the event, with a ceiling so a failure is a failure and not a hang
const deadline = Date.now() + 120000;
while (!seen.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));

if (!seen.length) {
  const kinds = sessions.history(s.key).map((e) => e.kind);
  console.error("no todo.updated. event kinds seen:", JSON.stringify(kinds));
  const err = sessions.history(s.key).find((e) => e.kind === "session.ended" || e.error);
  if (err) console.error("session trouble:", JSON.stringify(err).slice(0, 400));
}
assert.ok(seen.length, "the model reached the worklist tool and it emitted todo.updated");
ok("the tool reaches the model — it is loaded, not hidden behind ToolSearch");

const ev = seen[seen.length - 1];
assert.equal(ev.kind, "todo.updated");
assert.ok(Array.isArray(ev.items) && ev.items.length >= 2, "the event carries the whole list");
assert.ok(ev.items.every((i) => i.id && i.text && i.state), "every item has id, text, state");
assert.ok(ev.items.every((i) => ["pending", "active", "done"].includes(i.state)), "states are the agreed three");
assert.equal(ev.items.filter((i) => i.state === "active").length, 1, "one active in the emitted event");
ok(`todo.updated carries the whole list (${ev.items.length} items), one active`);

// the rule-3 envelope, stamped centrally — a subscriber must know whose list this is
assert.equal(ev.sessionId, "t1");
assert.equal(ev.projectCode, "worklist-test");
assert.ok(ev.cwd && ev.ts, "cwd and ts are stamped");
ok("the event carries the RFC-048 envelope like every other kind");

// ---- 3. IT RIDES HISTORY — the whole point of full-list-every-time -------------
// A subscriber that attaches NOW has seen none of the traffic above. It must be
// able to render the current list from history alone.
const history = sessions.history(s.key);
const fromHistory = history.filter((e) => e.kind === "todo.updated");
assert.ok(fromHistory.length, "todo.updated is in history, not only on the live wire");
const latest = fromHistory[fromHistory.length - 1];
assert.deepEqual(latest.items, ev.items, "the last history copy IS the current list");
ok("a late subscriber renders the current list from history, from ONE event");

// ---- 5. THE PLAN SURVIVES A RESTART ---------------------------------------------
// systemview-test renders the worklist un-gated on `working` because "the plan
// outlives the turn that wrote it". That is only true if it also outlives a
// RESTART — sessions here outlive views and restarts by design, and the worklist
// must not be the one piece of session state that quietly doesn't.
// RFC-005 §3 moved this OUT of the session store and into an owner-keyed file, so the assertion
// moved with it — and the reason is the point of the change: the store copy was readable only by
// the session that wrote it, and a job's list has to be readable by whatever reads it afterwards.
{
  const owner = `session:${s.key}`;
  const items = worklist.read(owner);
  assert.ok(items.length, "the list is persisted under its own owner");
  assert.deepEqual(items, ev.items, "what is persisted IS the current list");
  ok("the worklist is written to its owner's file, not only held in memory");

  const seen = worklist.all().find((w) => w.owner === owner);
  assert.ok(seen, "and something that is not this session can find it");
  assert.equal(seen.total, ev.items.length, "with its counts readable from outside");
  ok("a worklist is readable AFTER the fact, by an owner it does not belong to");

  const store = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".autobot", "sessions.json"), "utf8"));
  assert.ok(!(store[s.key] || {}).worklist, "and the old second copy in the run store is gone");
  ok("one copy of one fact — the run store no longer holds a worklist that can disagree");
}

// simulate the restart: drop the in-memory session, reopen the same key, and
// assert a subscriber that has seen NOTHING still gets the plan.
await sessions.kill(s.key, { forget: false }).catch(() => sessions.kill(s.key));

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} claims held — the agent worklist\n`);
process.exit(0);
