// AN UNFINISHED RUN NUDGES ITS AGENT — the rules, proven.
//
// THE CLAIMS:
//   1. `source` is the whole selection rule: a run with one qualifies, the session's own plan never
//      does, and a source outside the configured list is ignored.
//   2. A completed run is never nudged, and neither is an empty one.
//   3. The cooldown holds, the cycle's end is a FINAL NOTICE rather than a stop, and 0 means never.
//   4. The context ceiling refuses — but an UNKNOWN context is not treated as full.
//   5. The nudge NAMES the item left active, so it is already the briefing.
//   6. Moving the list RESETS the count, which is what makes "no movement" literally true.
//   7. The count survives an unrelated write to the same record — the carry-forward trap.
//   8. The idle clock ARMS for a session carrying no hook at all, or this whole feature is dead
//      code that tests green.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// SCRATCH EVERYTHING. A suite that exercises a store must never get the keys to the real house —
// a janitor test once swept the user's live lane rows mid-demo.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-nudge-"));
process.env.AUTOBOT_WORKLISTS_DIR = path.join(scratch, "worklists");
process.env.AUTOBOT_NUDGE_FILE = path.join(scratch, "nudge.json");
fs.mkdirSync(process.env.AUTOBOT_WORKLISTS_DIR, { recursive: true });

const nudge = require("../electron/agents/nudge.cjs");
const worklist = require("../electron/agents/worklist.cjs");

let pass = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };
// AND ITS OPPOSITE. Same latent hole tests/worklist.js had until today: assertions written
// `cond ? ok(...) : bad(...)` with no `bad` in scope have a ReferenceError on their failure path,
// so the first one to go false reports "bad is not defined" at a line number instead of what broke.
const bad = (n) => { console.error(`\n  FAILED  ${n}\n`); process.exitCode = 1; throw new Error(n); };

const CFG = nudge.normalizeSettings(null);
const run = (over = {}) => ({
  owner: "run:r1", session: "session:sv:1", source: "skill:context-maintenance",
  done: 2, total: 5, active: "the thing it stopped on", updatedAt: 1000, nudges: null, ...over,
});
const pick = (over = {}, opts = {}) =>
  nudge.pickNudge({ runs: [run(over)], session: "session:sv:1", quietMin: 99, now: 100000, settings: CFG, ...opts });

// ---- 1. SOURCE IS THE SELECTION RULE -----------------------------------------------------------
assert.ok(pick(), "a skill run with items left should be picked");
assert.equal(pick().run.source, "skill:context-maintenance");
assert.ok(pick({ source: "job:proactive-development" }), "a job run qualifies too");
ok("a run with a job: or skill: source is nudge-worthy");

// His own plan has NO source — which is why "nudge procedures, not plans" needed no rule.
assert.equal(pick({ source: "" }), null);
assert.equal(nudge.sourceCounts("", CFG.sources), false);
ok("the session's own plan is excluded by construction — it carries no source at all");

// A LANE IS CHASED NOW, AND THAT IS A CHANGED DEFAULT rather than a changed rule. The sources are
// derived from the run-kind registry (runKinds.cjs) so a kind arrives WITH its switch, and that
// swept `lane:` into the default list — where his own settings had already put it, and where his
// ask of 2026-11-09 wants it: "make sure that the subagents nudge". What did NOT change is that the
// list is his: take a prefix out and the chaser stops counting it, which is the assertion below.
assert.ok(pick({ source: "lane:lane/a-thing" }), "a lane is chased on the derived default");
assert.equal(
  pick({ source: "lane:lane/a-thing" }, { settings: { ...CFG, sources: ["job:", "skill:"] } }),
  null,
  "…and taking lanes out of the configured list is how he stops it",
);
ok("a lane is chased by default and switched off by his own list — the switch is the rule, not the kind");

// ---- 2. ONLY GENUINELY UNFINISHED ---------------------------------------------------------------
assert.equal(pick({ done: 5, total: 5 }), null);
assert.equal(pick({ done: 0, total: 0 }), null);
ok("a completed run and an empty one are both left alone");

// ---- 3. COOLDOWN, THE CYCLE, AND THE ONLY EXCUSE ------------------------------------------------
assert.equal(pick({ nudges: { count: 1, lastAt: 100000 - 60000 } }), null, "1 minute ago is inside a 30m cooldown");
assert.ok(pick({ nudges: { count: 1, lastAt: 100000 - 40 * 60000 } }), "40 minutes ago is past it");
ok("the cooldown holds, and releases");

// REACHING THE END OF A CYCLE IS NOT AN ENDING (his rule, 2026-10-26: "reaching the end of nudges
// is not stopping — that's not the rule anymore"). The old behaviour — `count >= giveUpAfter →
// never again` — left runs standing at 7/9 forever with nothing anyone could read about why.
// Now the count climbs, the cycle position wraps, and the nudging continues.
{
  const p = pick({ nudges: { count: 3, lastAt: 0 } });
  assert.ok(p, "a run past the old give-up limit is STILL nudged — the count never stops it");
  assert.equal(p.nth, 1, "…and the cycle wrapped: nudge 4 of a 3-cycle is position 1 again");
  const last = pick({ nudges: { count: 2, lastAt: 0 } });
  assert.equal(last.finalNotice, true, "the cycle's last nudge says it is the final notice");
  assert.ok(/FINAL NOTICE/.test(last.text), "…in the text the agent reads");
  assert.ok(/abandoned/.test(last.text) && /report/.test(last.text), "…and it names the only exit: the account attached, the word declared");
  const first = pick({ nudges: { count: 0, lastAt: 0 } });
  assert.ok(!/report/.test(first.text) && !/abandoned/.test(first.text), "an ORDINARY nudge never mentions the exit — the way out of work is not advertised");
  ok("the cycle wraps instead of stopping, and only the final notice names the abandonment door");
}

// THE ONLY EXCUSE IS THE DECLARED ONE: the status STARTS with "abandoned" AND the run carries a
// REPORT. Either half alone is not an ending — the word without the record is testimony, the record
// without the word is a handover nobody ended. And the word is a DECLARATION, not a mention: a
// status that merely contains "abandoned" mid-sentence never excuses anything.
//
// THE ACCOUNT IS A REPORT, AND THIS REVERSES WHAT §2.4 LANDED. A completeness press had widened it
// to any attachment and c14 was marked met on that wording; his ruling, 2026-11-09: *"if the
// worklist is nudging you, you abandon it, it shouldn't stop. It should require you to add the
// report and then a nudge should be reminding you of that."* A branch says what the work touched,
// not why it stopped — and the lenient version let a run buy its way out of the chase with a chip
// it was going to attach anyway. Two surfaces already said report and only this one disagreed: the
// drawer's `isAccounted` and the nudge's own final-notice text.
{
  const att = [{ kind: "report", ref: "why-it-died", by: "sv", ts: 1 }];
  const st = { text: "abandoned — blocked on his review", ts: 1 };
  assert.equal(pick({ status: st, attachments: att }), null, "abandoned + account = excused, nudging stops");
  assert.equal(nudge.excusedOf({ status: st, attachments: att }), true);
  ok("the excuse takes both halves: the run declared abandoned, carrying its account");

  // c13 — abandoned with NOTHING attached: the CHASE continues exactly as if nothing had been said.
  assert.ok(pick({ status: st, attachments: null }), "the word without the record is NOT an excuse");
  // BUT THE NUDGE IS NOT THE SAME NUDGE, and that is a change of his making, 2026-11-09: *"a nudge
  // should be reminding you of that."* This used to assert the texts were IDENTICAL — the bare word
  // changing nothing at all — which is right about the chase and wrong about the agent reading it:
  // a generic idle nudge about a run you believe you have already ended reads as the declaration
  // being ignored, and the obvious response is to declare it again, harder.
  const declared = pick({ status: st, attachments: null }).text;
  declared !== pick().text && /ALREADY DECLARED THIS ONE ABANDONED/.test(declared)
    ? ok("a declared run is chased like any other, but TOLD that the account is what is missing")
    : bad("a declared, unaccounted run gets the same words as an undeclared stall");
  ok("abandoned alone keeps the chase alive, exactly as if nothing had been said");

  // c14 — ONLY A REPORT ENDS IT. A branch, a document or a card attached instead say what the work
  // touched, never why it stopped, and a run could otherwise buy its way out of the chase with a
  // chip it was going to attach anyway.
  const stillChased = (att) => pick({ status: st, attachments: att });
  assert.ok(stillChased([{ kind: "branch", ref: "lane/x", ts: 1 }]), "a branch is not an account");
  assert.ok(stillChased([{ kind: "document", ref: "RFCs/RFC-078", ts: 1 }]), "nor is a document");
  assert.ok(stillChased([{ kind: "card", ref: "1794231762504", ts: 1 }]), "nor is a card");
  assert.equal(stillChased([{ kind: "report", ref: "why-it-died", ts: 1 }]), null, "the report is");
  ok("abandoned ends the nudging only with a REPORT on it — a branch, a document and a card do not");

  // AND THE NUDGE SAYS WHAT IS MISSING, which is the other half of his instruction: *"a nudge
  // should be reminding you of that."* A generic idle nudge about a run the agent believes it has
  // already ended is indistinguishable from the declaration being ignored, and the obvious
  // conclusion from that is to declare it again, harder.
  const toldWhy = stillChased([{ kind: "branch", ref: "lane/x", ts: 1 }]).text;
  /ALREADY DECLARED THIS ONE ABANDONED/.test(toldWhy) && /kind `report`/.test(toldWhy)
    ? ok("a declared, unaccounted run is told the account is what is missing, and which kind")
    : bad("the nudge does not say why a declared run is still being chased: " + toldWhy.slice(0, 200));
  // It says so on the FIRST nudge, not only at the final notice — the exit is already taken, so
  // naming the bill is not advertising the exit.
  /ALREADY DECLARED/.test(toldWhy) ? ok("…and on the first nudge of the cycle, not only the last") : bad("only the final notice says it");

  assert.ok(pick({ status: { text: "waiting on review", ts: 1 }, attachments: att }), "an account without the word is NOT an excuse");
  assert.ok(
    pick({ status: { text: "not abandoned, just slow", ts: 1 }, attachments: att }),
    "the status must START with the word — a mid-sentence mention is no declaration"
  );
  ok("the record without the word, and the word said in passing, both keep the chase alive");
}

assert.equal(nudge.pickNudge({ runs: [run()], session: "session:sv:1", quietMin: 99, settings: { ...CFG, giveUpAfter: 0 } }), null);
ok("giveUpAfter 0 still turns the feature off, said as a number");

assert.equal(nudge.pickNudge({ runs: [run()], session: "session:sv:1", quietMin: 99, settings: { ...CFG, on: false } }), null);
assert.equal(pick({}, { quietMin: 5 }), null);
ok("off is off, and quiet shorter than idleMin is not idle yet");

// ---- 4. THE CONTEXT CEILING, AND WHAT ABSENT MEANS ---------------------------------------------
assert.equal(pick({}, { ctxPct: 85 }), null);
assert.ok(pick({}, { ctxPct: 40 }), "40% has room");
// ABSENT MUST NOT READ AS FULL. ctxPct only exists once a usage report has arrived, so a session
// that has not reported is EARLY — the safest moment to nudge, not the most dangerous.
assert.ok(pick({}, { ctxPct: null }), "an unknown context must not be treated as a full one");
ok("the ceiling refuses a full session, and an unknown context is not a full one");

// ---- 5. THE NUDGE IS THE BRIEFING ---------------------------------------------------------------
const text = pick().text;
assert.ok(text.includes("the thing it stopped on"), "it must name the item left active");
assert.ok(text.includes("skill:context-maintenance") && text.includes("2/5"));
assert.ok(/worklist get/.test(text), "it must point at the list, since the line is only a summary");
assert.ok(/never started/.test(nudge.nudgeText(run({ active: "" }), CFG)), "no active item is itself worth saying");
ok("the nudge names the source, the item left active and how far it got");

// ---- 6 & 7. THE COUNT LIVES ON THE RUN ---------------------------------------------------------
worklist.writeRun("t1", "session:sv:1", [{ text: "a", state: "active" }], "skill:x");
const first = worklist.markNudged("run:t1");
assert.equal(first.count, 1);
assert.equal(worklist.markNudged("run:t1").count, 2);
assert.equal(worklist.all().find((r) => r.owner === "run:t1").nudges.count, 2);
ok("the count is kept on the run and reaches the row a surface draws");

// THE CARRY-FORWARD TRAP, which this file exists to pin: `save()` carries only the keys it names,
// so a key nobody added to that list is destroyed by the next unrelated write. `markStatus` is a
// write that knows nothing about nudges.
worklist.markStatus("t1", { text: "waiting on review" });
assert.equal(worklist.all().find((r) => r.owner === "run:t1").nudges.count, 2, "an unrelated write must not eat the count");
ok("the count survives a write that knows nothing about it");

// MOVEMENT RESETS IT — the thing that makes "nudged 3 times, no movement" true rather than a phrase.
worklist.writeRun("t1", "session:sv:1", [{ text: "a", state: "done" }, { text: "b", state: "active" }], "skill:x");
assert.equal(worklist.all().find((r) => r.owner === "run:t1").nudges, null);
ok("moving the list clears the count, so the next stall earns fresh nudges");

// ---- MOVEMENT SPENDS THE EXCUSE, AND THE ROW CARRIES THE RECORD --------------------------------
// The declared ending (abandoned + account) is read off the run by the selector — so all() must
// ship attachments, and a run that MOVES again is no longer abandoned: one old declaration must
// not excuse every future stall.
{
  worklist.attach("t1", { kind: "report", ref: "why-it-died", by: "sv" });
  worklist.markStatus("t1", { text: "abandoned — blocked on his word" });
  const r = worklist.all().find((x) => x.owner === "run:t1");
  assert.ok(Array.isArray(r.attachments) && r.attachments[0].ref === "why-it-died", "all() ships the attachments the excuse reads");
  assert.equal(nudge.excusedOf(r), true, "declared + accounted = excused");
  worklist.writeRun("t1", "session:sv:1", [{ text: "a", state: "done" }, { text: "b", state: "active" }], "skill:x");
  const moved = worklist.all().find((x) => x.owner === "run:t1");
  assert.equal(moved.status, null, "movement SPENDS the declaration — the run is no longer abandoned");
  assert.ok(Array.isArray(moved.attachments), "…but the account it filed stays; attachments are the record, not the excuse");
  assert.equal(nudge.excusedOf(moved), false, "so the next stall earns fresh nudges, not a free pass");
  ok("movement spends the abandoned declaration; the attached account survives it");
}

// ---- 8. THE CLOCK ACTUALLY ARMS -----------------------------------------------------------------
// Without this the feature is dead code: idleWakeMs returned 0 for a session carrying no idle hook,
// 0 means no timer is armed, and a nudge "on idle" would never once fire for most agents.
const sessions = require("../electron/agents/sessions.cjs");
assert.equal(sessions.idleWakeMs({ carriesHooks: [] }), CFG.idleMin * 60000);
ok("the idle clock arms from the nudge's own setting, for a session carrying no hook at all");

// ---- settings round-trip -------------------------------------------------------------------------
assert.equal(nudge.readSettings().idleMin, CFG.idleMin, "defaults answer with no file on disk");
assert.equal(nudge.writeSettings({ idleMin: 5, sources: ["job:"] }).settings.idleMin, 5);
assert.deepEqual(nudge.readSettings().sources, ["job:"]);
assert.equal(nudge.writeSettings({ idleMin: "nonsense" }).settings.idleMin, CFG.idleMin, "junk falls back field by field");
assert.equal(nudge.writeSettings({ idleMin: 99999 }).settings.idleMin, 1440, "and is clamped, not trusted");
ok("settings default without a file, merge on write, and survive junk one field at a time");

console.log("the call site — the session spelling the worklist stamps, not a property nobody set");
{
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("../electron/agents/sessions.cjs"), "utf8");
  assert.ok(/session:\s*s\.worklistOwner/.test(src), "maybeNudge passes s.worklistOwner to pickNudge");
  assert.ok(!/session:\s*s\.id\b/.test(src), "the dead s.id spelling is gone");
  ok("maybeNudge compares the run's session the way the worklist writes it — s.id matched nothing, ever, and this suite was green while no nudge could fire");
}

console.log("the door — the gate knows the word, and SystemView holds the grant");
{
  const { GRANTS } = require("../electron/apps/capabilities.cjs");
  assert.ok(GRANTS.nudge && GRANTS.nudge.nudge === "*", "the capability table maps nudge");
  const registry = require("../electron/apps/registry.cjs");
  const sv = registry.current().find((a) => a.id === "systemview");
  assert.ok(sv.capabilities.includes("nudge"), "systemview is granted nudge");
  ok("nudge is a word the capability gate knows, and the IDE holds it — a verb with no door tests green and does nothing");
}

console.log("the countdown is the selector's answer — the door ships the pick");
{
  // HIS CATCH, 2026-10-26: "I saw two things counting down at the same time… but you only got one
  // nudge." Rows deriving their own eligibility drew N countdowns for ONE nudge, so the shell now
  // answers WHICH run would be picked — with the same pickNudge that fires.
  const src = fs.readFileSync(require.resolve("../electron/agents/sessions.cjs"), "utf8");
  const m = /function nudgePicks\(\)[\s\S]*?\n}/.exec(src);
  assert.ok(m, "nudgePicks exists beside quietOf");
  assert.ok(/session:\s*s\.worklistOwner/.test(m[0]), "the pick uses the run's own session spelling");
  assert.ok(/quietMin:\s*cfg\.idleMin/.test(m[0]), "evaluated AT maturity — the pick, not the clock, is the question");
  assert.ok(/pickNudge/.test(m[0]), "and it is the SAME selector that fires, never a second formula");
  assert.ok(
    /nudgePicks/.test(fs.readFileSync(require.resolve("../electron/apps/files-host.cjs"), "utf8")),
    "the nudge door ships the pick to the window"
  );
  assert.equal(typeof sessions.nudgePicks, "function", "exported, so a suite can ask");
  assert.deepEqual(sessions.nudgePicks(), {}, "no live sessions here — an empty answer, not a throw");
  ok("the window's countdown reads WHICH run the selector would pick — one countdown per promised nudge");
}

// ---- SESSION AGNOSTIC — THE RUN IS THE AGENT'S -------------------------------------------------
// Work owed to an AGENT used to die with the session it was given to: an assignment handed over in
// the morning kept nudging a session that was idle or gone, and the job that fired into a fresh one
// at noon could not see it. The owner is the agent; the session is only where the run last ran.
{
  const other = { session: "session:sv:99" };          // same agent, a different session of it
  const alien = { session: "session:buapi:1" };        // another agent entirely

  assert.ok(pick(other), "a run from another session OF THE SAME AGENT is still nudged");
  ok("an assignment opened in this morning's session reaches the agent in this afternoon's");

  assert.equal(pick(alien), null, "another agent's run is not this agent's to be nudged about");
  ok("the match is the agent, not every session on the machine");

  // AND THE NUDGE SAYS SO. The rest of that message assumes the agent is holding the list; a list
  // written by a session that no longer exists has to be read cold, and silence about that reads
  // as "you were just doing this".
  assert.ok(/DIFFERENT SESSION/.test(pick(other).text), "the text says where the run came from");
  assert.ok(!/DIFFERENT SESSION/.test(pick().text), "...and stays quiet when it is this session's own run");
  ok("a run arriving from elsewhere is announced as such, and one from here is not");

  // A SESSION WITH NO PROJECT IN ITS KEY (the terminal door's `session:<key>`) hears only itself —
  // treating every unplaceable session as one agent would have them nudged about each other's work.
  assert.ok(nudge.sameAgent("session:k1", "session:k1"), "an unplaceable session matches itself");
  assert.ok(!nudge.sameAgent("session:k1", "session:k2"), "...and nothing else");
  ok("an unplaceable session is its own agent — no project, no sharing");
}

console.log(`\n  ${pass} assertions, all green — an unfinished run nudges its agent\n`);
fs.rmSync(scratch, { recursive: true, force: true });
