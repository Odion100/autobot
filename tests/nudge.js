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

// ---- A QUIET SUBAGENT NUDGES THE AGENT THAT SPAWNED IT (2026-11-09) --------------------------
// His ask: "make sure that the subagents nudge… you could see when they're quiet or when they're
// idle and there's a countdown right there. of control how long they can be idle before they
// update you." A subagent has no run record, so pickNudge could never see one — this is the
// selector for the half that lives in session state.
{
  const MIN = 60000;
  const now = 10_000_000;
  const cfg = nudge.normalizeSettings({ on: true, subagentIdleMin: 10, cooldownMin: 30, ctxCeilingPct: 70 });

  // THE THRESHOLD IS HIS NUMBER, AND IT IS THE ONLY THING THAT DECIDES.
  const quiet = { parent: "toolu_a", brief: "audit the claims", lastTs: now - 11 * MIN };
  const fresh = { parent: "toolu_b", brief: "write the spec", lastTs: now - 2 * MIN };
  assert.equal(nudge.pickSubagentNudge({ subagents: [fresh], now, settings: cfg }), null, "two minutes quiet is a subagent thinking, not an idle one");
  const picked = nudge.pickSubagentNudge({ subagents: [quiet], now, settings: cfg });
  assert.ok(picked, "eleven minutes past a ten-minute threshold is idle");
  assert.equal(picked.subagent.parent, "toolu_a");
  assert.equal(picked.mins, 11, "it reports the elapsed minutes it measured");

  // AND IT MOVES WITH THE SETTING — the whole point of the number existing.
  const patient = nudge.normalizeSettings({ on: true, subagentIdleMin: 60, cooldownMin: 30 });
  assert.equal(nudge.pickSubagentNudge({ subagents: [quiet], now, settings: patient }), null, "raise the threshold to an hour and eleven minutes is no longer idle");
  const twitchy = nudge.normalizeSettings({ on: true, subagentIdleMin: 1, cooldownMin: 30 });
  assert.ok(nudge.pickSubagentNudge({ subagents: [fresh], now, settings: twitchy }), "drop it to a minute and two minutes is");
  ok("the subagent idle threshold is a SETTING, and it is the only thing that decides idle");

  // SILENCE IS NOT DEATH, AND THE TEXT MUST NOT SAY IT IS. The window settled this wording for
  // laneLiveness ("the tone escalates but the words never diagnose") and the nudge inherits it —
  // a host that cannot tell a thinking model from a hung one must not pick one in writing.
  assert.match(picked.text, /quiet|emitted nothing/i, "it says what it measured");
  assert.match(picked.text, /audit the claims/, "and names the subagent by its brief, so the agent knows which one");
  for (const word of [/\bstalled\b/i, /\bstuck\b/i, /\bhung\b/i, /\bdead\b/i, /\bcrashed\b/i, /\bfroze/i])
    assert.ok(!word.test(picked.text), `the nudge never diagnoses — found ${word}`);
  ok("the subagent nudge reports elapsed and never diagnoses — stalled, stuck, hung, dead all absent");

  // A FINISHED SUBAGENT IS NOT IDLE. It stopped because it was done.
  assert.equal(nudge.pickSubagentNudge({ subagents: [{ ...quiet, ended: true }], now, settings: cfg }), null, "a subagent whose result came back is finished, not quiet");
  // NEVER EMITTED ANYTHING is not something a clock can time.
  assert.equal(nudge.pickSubagentNudge({ subagents: [{ parent: "toolu_c", lastTs: 0 }], now, settings: cfg }), null, "with no first event there is no clock to run");
  ok("finished and never-started are both excluded — only a subagent that spoke and then stopped");

  // THE COOLDOWN HOLDS, per subagent, off the stamp the caller keeps.
  assert.equal(nudge.pickSubagentNudge({ subagents: [{ ...quiet, nudgedAt: now - 5 * MIN }], now, settings: cfg }), null, "nudged five minutes ago, cooling down");
  assert.ok(nudge.pickSubagentNudge({ subagents: [{ ...quiet, nudgedAt: now - 31 * MIN }], now, settings: cfg }), "past the cooldown it nudges again");

  // THE CEILING REFUSES, same rule as a run's nudge: spending the context the agent needs to deal
  // with the thing it is being nudged about makes the nudge harmful.
  assert.equal(nudge.pickSubagentNudge({ subagents: [quiet], now, ctxPct: 95, settings: cfg }), null, "a nearly-full session is not nudged");
  assert.ok(nudge.pickSubagentNudge({ subagents: [quiet], now, ctxPct: null, settings: cfg }), "…and an UNKNOWN context is not treated as full");
  assert.equal(nudge.pickSubagentNudge({ subagents: [quiet], now, settings: { ...cfg, on: false } }), null, "the master switch is still the master switch");
  ok("cooldown, context ceiling and the master switch govern the subagent nudge exactly as they govern a run's");

  // THE QUIETEST ONE, not the newest — the forgotten one is the one that has been silent longest.
  const two = nudge.pickSubagentNudge({ subagents: [{ parent: "recent", lastTs: now - 12 * MIN }, { parent: "ancient", lastTs: now - 90 * MIN }], now, settings: cfg });
  assert.equal(two.subagent.parent, "ancient", "the longest-silent subagent is picked");
  ok("the quietest subagent is the one nudged about");

  // THE DEFAULT IS THE OLD HARDCODED NUMBER, so no row changes meaning on upgrade.
  assert.equal(nudge.DEFAULTS.subagentIdleMin, 10, "the default is laneLiveness' old hardcoded warn threshold");
  assert.equal(nudge.normalizeSettings({}).subagentIdleMin, 10, "…and a file that never mentions it reads the same");
  // 0 CLAMPS TO THE FLOOR, not to the default — the same thing `idleMin` and `cooldownMin` do with
  // the same clampInt, and consistency across the three minute fields beats a special case here.
  assert.equal(nudge.normalizeSettings({ subagentIdleMin: 0 }).subagentIdleMin, 1, "0 would mean idle the instant it stops talking — clamped to the one-minute floor");
  assert.equal(nudge.normalizeSettings({ subagentIdleMin: 99999 }).subagentIdleMin, 24 * 60, "and a day is the ceiling");
  ok("the threshold defaults to the number it replaced, and clamps at both ends");
}

// ---- A SUBAGENT'S CLOCK IS KEPT IN SESSION STATE (2026-11-09) ---------------------------------
// It has to be: a subagent has NO run record — no source, no items, no owner file — which is
// exactly why the disk-reading chaser could never see one. Three facts, three shapes of event, and
// one trap: the nudge's own receipt must not reset the silence it reports.
{
  const sessions = require("../electron/agents/sessions.cjs");
  const s = {};
  const T = 1_000_000;
  const ev = (e, ts) => sessions.noteSubagent(s, { ts: ts || T, ...e });

  // THE SPAWN starts nothing but the record — a subagent that has not emitted yet has no clock,
  // because timing it from the spawn would nudge about one that is still starting up.
  ev({ kind: "tool.call", name: "Agent", id: "toolu_1", input: { prompt: "audit the claims\nsecond line ignored" } });
  let [u] = sessions.subagentsOf(s);
  assert.equal(u.parent, "toolu_1");
  assert.equal(u.brief, "audit the claims", "the first line of the prompt is the brief — a whole prompt is not a row");
  assert.equal(u.lastTs, 0, "spawned is not alive: no event from inside it yet, so no clock");
  assert.equal(u.ended, false);

  // TASK IS THE SAME TOOL. The SDK has called it both things across versions, and a name the match
  // misses is a subagent whose clock never starts at all.
  ev({ kind: "tool.call", name: "Task", id: "toolu_2", input: { prompt: "the other one" } });
  assert.equal(sessions.subagentsOf(s).length, 2, "Agent and Task both spawn subagents");
  // ...AND AN ORDINARY TOOL CALL DOES NOT.
  ev({ kind: "tool.call", name: "Bash", id: "toolu_3", input: { command: "ls" } });
  assert.equal(sessions.subagentsOf(s).length, 2, "a Bash call is not a subagent");

  // THE CLOCK TICKS ON ANYTHING CARRYING `parent` — text, thinking, a tool call, a tool result.
  ev({ kind: "assistant.text", parent: "toolu_1", text: "working" }, T + 1000);
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_1").lastTs, T + 1000, "an event from inside the subagent is the clock");
  ev({ kind: "tool.call", parent: "toolu_1", id: "inner", name: "Read" }, T + 2000);
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_1").lastTs, T + 2000, "…including its own tool calls");

  // AN EVENT WITH A `parent` NOBODY SPAWNED still gets a record, because it is still something
  // running that nothing else accounts for — the same reason unseenSubagents reports a registered
  // lane with no row rather than dropping it.
  ev({ kind: "assistant.text", parent: "toolu_orphan" }, T + 3000);
  assert.ok(sessions.subagentsOf(s).some((x) => x.parent === "toolu_orphan"), "an unspawned parent is still tracked, not dropped");

  // THE END COMES FROM THE SPAWNING CALL'S RESULT, and never from the events going quiet — quiet
  // is the state this map exists to measure, so inferring death from it would be circular.
  ev({ kind: "tool.result", id: "toolu_2", ok: true }, T + 4000);
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_2").ended, true, "the spawning call's result is the subagent's ending");
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_1").ended, false, "and it ends only the one it belongs to");

  // A RESULT FROM *INSIDE* A SUBAGENT IS NOT ITS ENDING. It carries `parent`; the spawning call's
  // result does not. Without that distinction a subagent's first inner tool result would end it.
  ev({ kind: "tool.result", id: "inner", parent: "toolu_1", ok: true }, T + 5000);
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_1").ended, false, "an inner tool result is work, not an ending");
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_1").lastTs, T + 5000, "…and it ticks the clock");

  // A FINISHED SUBAGENT'S CLOCK IS FROZEN. Late events must not resurrect it into "alive".
  const endedAt = sessions.subagentsOf(s).find((x) => x.parent === "toolu_2").lastTs;
  ev({ kind: "assistant.text", parent: "toolu_2" }, T + 9000);
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_2").lastTs, endedAt, "an ended subagent's clock does not restart");
  ok("a subagent's clock starts on its first inner event, ticks on every one, and stops only at the spawning call's result");

  // THE TRAP, AND IT IS THE WHOLE REASON THE RECEIPT CARRIES AN EMPTY `parent`. The nudge emits a
  // `subagent.nudged` receipt ABOUT a subagent — if that receipt were stamped with the subagent's
  // id, it would tick the very clock it is reporting on and no second nudge could ever fire.
  const before = sessions.subagentsOf(s).find((x) => x.parent === "toolu_1").lastTs;
  ev({ kind: "subagent.nudged", parent: "", subagent: "toolu_1", quietMin: 20 }, T + 99_000);
  assert.equal(sessions.subagentsOf(s).find((x) => x.parent === "toolu_1").lastTs, before, "the nudge's own receipt does NOT reset the silence it reports");
  ok("the nudge receipt cannot reset the clock it measures — the second nudge stays possible");
}

console.log(`\n  ${pass} assertions, all green — an unfinished run nudges its agent\n`);
fs.rmSync(scratch, { recursive: true, force: true });
