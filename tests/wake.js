// smoke:wake — AN OUTSIDE EVENT STARTS A TURN, NEVER RIDES HIS MESSAGE.
//
// His order, 2026-10-26: *"the queue is mine… why is events coming from outside being queued?"*
// The defect: a user message handed to the CLI mid-turn lands in the CLI's OWN queue — his queue —
// and rides his next message instead of starting a turn. A push onto an IDLE CLI provably starts
// one (the nudge fires only on idle, and wakes). So deliverToMembers holds a busy session's
// delivery beside the hooks RFC-012 already holds, and flushes it at the settled boundary.
//
// THE CLAIMS:
//   1. A held delivery FLUSHES at the boundary: pushed into the input queue, composed from
//      everything that merged into it while held, tagged, labelled as the mechanism's turn — and
//      the hold is empty afterwards.
//   2. The flush respects the boundary it was given: a turn that restarted, or tools still in
//      flight, flush nothing and the hold survives for the next boundary.
//   3. The busy path never pushes — held, merged in place on a second send, receipted as held
//      (pinned at the source; deliverToMembers has no door of its own).
import assert from "node:assert";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const sessions = require("../electron/agents/sessions.cjs");
let n = 0;
const ok = (w) => { n += 1; console.log("  ok  " + w); };

// A hand-built session: exactly the fields the flush reads, and an input queue that records.
const fake = (over = {}) => {
  const pushed = [];
  return {
    pushed,
    turnActive: false,
    toolsInFlight: 0,
    turnEndTimer: null,
    pendingHooks: new Map(),
    pendingDeliveries: new Map(),
    nextTurnFromHook: false,
    input: { push: (m, tag, meta) => pushed.push({ m, tag, meta }) },
    ...over,
  };
};

{
  const s = fake();
  s.pendingDeliveries.set("doc:sv:x.md", { project: "sv", path: "x.md", threads: ["t1"], summaries: ["he replied in t1"] });
  sessions.flushTurnEndHooks(s);
  assert.equal(s.pushed.length, 1, "one held delivery, one push");
  const text = s.pushed[0].m.message.content[0].text;
  assert.match(text, /A thread you are in moved — sv:x\.md, thread t1/);
  assert.match(text, /he replied in t1/);
  assert.match(text, /Read the file rather than trusting this line/);
  assert.equal(s.pushed[0].tag, "doc:sv:x.md", "the push keeps its tag, so a late send can still merge");
  assert.equal(s.nextTurnFromHook, true, "the turn this starts is the mechanism's, never the human typing");
  assert.equal(s.pendingDeliveries.size, 0, "the hold is empty after the flush");
  ok("a held delivery flushes at the boundary: composed, tagged, labelled, hold emptied");
}

{
  // Composed from EVERYTHING it absorbed while held — two threads, two summaries, ONE wake.
  const s = fake();
  s.pendingDeliveries.set("doc:sv:x.md", { project: "sv", path: "x.md", threads: ["t1", "t2"], summaries: ["first", "second"] });
  sessions.flushTurnEndHooks(s);
  assert.equal(s.pushed.length, 1, "merging while held must not add a second wake");
  const text = s.pushed[0].m.message.content[0].text;
  assert.match(text, /2 threads you are in moved — sv:x\.md: t1, t2/);
  assert.match(text, /first second/);
  ok("a delivery that grew while held composes once, with everything it absorbed");
}

{
  const busy = fake({ turnActive: true });
  busy.pendingDeliveries.set("doc:sv:x.md", { project: "sv", path: "x.md", threads: [], summaries: [] });
  sessions.flushTurnEndHooks(busy);
  assert.equal(busy.pushed.length, 0, "a restarted turn flushes nothing");
  assert.equal(busy.pendingDeliveries.size, 1, "and the hold survives for the next boundary");

  const tools = fake({ toolsInFlight: 2 });
  tools.pendingDeliveries.set("doc:sv:x.md", { project: "sv", path: "x.md", threads: [], summaries: [] });
  sessions.flushTurnEndHooks(tools);
  assert.equal(tools.pushed.length, 0, "tools in flight flush nothing");
  assert.equal(tools.pendingDeliveries.size, 1);
  ok("a pause is not an ending: an active turn or tools in flight keep the hold intact");
}

// ---- the busy path, pinned at the source — deliverToMembers has no door of its own ------------
{
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../electron/agents/sessions.cjs"), "utf8");
  const body = src.slice(src.indexOf("function deliverToMembers"));
  assert.ok(/if \(s\.turnActive \|\| s\.toolsInFlight > 0\)/.test(body), "delivery asks whether the session is busy before pushing");
  assert.ok(/s\.pendingDeliveries\.set\(tag, meta\)/.test(body), "a busy session's delivery is HELD, never handed to the CLI's queue");
  assert.ok(/s\.pendingDeliveries\.get\(tag\)/.test(body), "a second send against the same document merges into the HELD one first");
  assert.ok(/held: true/.test(body), "the receipt says it was held, so the window draws the truth rather than claiming a wake");
  ok("a busy session never gets the push — held, merged in place, receipted as held");
}

console.log(`\n  ${n} claims, all green — an outside event starts a turn, never rides his message\n`);
