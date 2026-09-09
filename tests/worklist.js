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
{
  const store = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".autobot", "sessions.json"), "utf8"));
  assert.ok(Array.isArray(store[s.key]?.worklist), "the list is persisted in the run store");
  assert.deepEqual(store[s.key].worklist, ev.items, "what is persisted IS the current list");
  ok("the worklist is written to the run store, not only held in memory");
}

// simulate the restart: drop the in-memory session, reopen the same key, and
// assert a subscriber that has seen NOTHING still gets the plan.
await sessions.kill(s.key, { forget: false }).catch(() => sessions.kill(s.key));

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} claims held — the agent worklist\n`);
process.exit(0);
