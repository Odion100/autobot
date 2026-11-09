// THE NUDGE RECORD AND THE WRITE-TIME DIAL — RFC-078 §2.1 + §2.3, the shell half, proven.
//
// THE RULES UNDER TEST:
//   1. The record seeds itself on first read — the two §2.1 entries, exactly — and a half-edited
//      file is read field by field, never overwritten by the thing that failed to parse it.
//   2. The chaser's entry is identity/on/scope ONLY, and this module never touches nudge.json.
//   3. The gate's precedence: no entry → off; `on` must be literally true; "global" hits everyone;
//      a slot list hits those slots alone; any other string is a project code and hits it alone.
//   4. His words win while written; the built-in line arrives while the field stays empty.
//   5. The ask: markdown only, gated before the parse, pointered after it, debounced per
//      nudge × document × session, deaf to sweep-clock nudges.
//   6. Degradation is law: a hub down, older (404), or answering junk means [] — never a crash.
//   7. The wiring (source-read, the house pattern tests/nudge.js set): emit() asks on
//      file.changed, delivery rides the chaser's own input-queue push, and the hub is only ever
//      asked — no listener anywhere in the record module.
//
// AND THE SWEEP CLOCK — RFC-078 §2.3, slice 3.3 (c11, c35):
//   8. `run-untouched-for-days`: a SOURCED, still-open run that has not moved for `afterDays`
//      days is a standing violation; movement is any write except the chaser's nudge stamp;
//      abandoned-with-account ends it; the knob, the switch, the scope and the clock all gate it;
//      delivery is bookkept per nudge × run × session under the chaser's cooldownMin.
//   9. The project sweep: walked once per connected project per cooldown window — never per
//      tick — deaf to write-clock and shell-local names, capped per sweep with the overflow
//      rotating through later windows, degrading to silence like every ask here.
//  10. The chaser's stamp is NOT movement: markNudged leaves the run's updatedAt where it was.
//  11. The wiring: the idle tick runs the standing judges behind its own turn-guard (that IS
//      turn-end delivery), and both clocks deliver through one deliverSteers.
//
// AND THE AUDIT QUEUE — RFC-078 §2.7, slice 3.4 (c24's shell half):
//  12. A registered-document write appends {project, path, at} to the queue — behind the SAME
//      gate the judges ask rides (one predicate, two riders) and on the same emit() seam —
//      debounced per document: a burst in one window is ONE entry, and a later write inside the
//      window refreshes nothing. Reads are tolerant (missing/junk = empty), the write is atomic
//      (tmp+rename), and this half only ever appends — removal belongs to the drain (3.5).
import rawAssert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// SCRATCH EVERYTHING — the suite must never get the keys to the real house. The seed-on-first-read
// is real behaviour, so it happens HERE, against this temp file, never against ~/.autobot.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-nudges-"));
const RECORD = path.join(scratch, "nudges.json");
process.env.AUTOBOT_NUDGES_FILE = RECORD;
const PROJECTS = path.join(scratch, "projects.json");
process.env.AUTOBOT_PROJECTS_FILE = PROJECTS;
const QUEUE = path.join(scratch, "audit-queue.json");
process.env.AUTOBOT_AUDIT_QUEUE_FILE = QUEUE;
process.env.AUTOBOT_WORKLISTS_DIR = path.join(scratch, "worklists");
fs.mkdirSync(process.env.AUTOBOT_WORKLISTS_DIR, { recursive: true });

// THE JUDGES ARE STUBBED, NOT THE TRANSPORT — there is no transport. The document judges are a
// module in this same process (markdown/judges.cjs), injected here through `__setJudges`, which
// makes this suite about the thing it is actually for: the GATING. `ANSWER` is what the judges
// found; `CALLS` is every ask they were given, so "the judges were not even consulted" stays
// checkable, and now it records the ASK (which document, which project) rather than a URL string.
// The judges' own correctness is tests/judges.js — one subject per suite.
let ANSWER = null;
let FAIL = null; // the judges throwing — an unreadable or unparseable document
const CALLS = [];
const asList = (a) => (Array.isArray(a) ? a : a && Array.isArray(a.violations) ? a.violations : []);
const JUDGE_STUB = {
  names: ["behavioural-claim-cmd-only", "met-without-note"],
  forFile: async (abs, { path: rel = "", project = "" } = {}) => {
    CALLS.push({ ask: "file", path: rel || abs, project });
    if (FAIL) throw new Error("the judges could not read it");
    return asList(ANSWER);
  },
  forProject: async (pc) => {
    CALLS.push({ ask: "project", project: String(pc || "") });
    if (FAIL) throw new Error("the judges could not walk it");
    return asList(ANSWER);
  },
};

const nudges = require("../electron/agents/nudges.cjs");
const corrections = require("../electron/agents/corrections.cjs");
nudges.__setJudges(JUDGE_STUB);

// THE SIGN-OFF COUNTS ASSERTIONS — every call through this proxy is one checked fact, so the
// closing line is arithmetic, never testimony.
let asserts = 0;
const assert = new Proxy(rawAssert, {
  get(t, k) {
    const v = t[k];
    return typeof v === "function" ? (...a) => { asserts++; return v.apply(t, a); } : v;
  },
  apply(t, _this, a) { asserts++; return t(...a); },
});

let pass = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };

const writeRecord = (list) => fs.writeFileSync(RECORD, `${JSON.stringify(list, null, 2)}\n`);
const SESSION = { project: "sv", slot: "sv", session: "session:sv:1" };
const dial = (over = {}) =>
  nudges.judgeWrite({ path: "/repo/RFCs/RFC-9.md", ...SESSION, now: 1000000, ...over });
// BY NAME, NEVER BY POSITION — the record grew a fourth seed row (open-corrections) and every
// `list[2]` in this file silently started talking about a different nudge. An index is a reference
// that goes wrong without going red.
const row = (list, name) => list[list.findIndex((e) => e.name === name)];
const UNTOUCHED = "run-untouched-for-days";

const VIOLATION = { nudge: "behavioural-claim-cmd-only", path: "/repo/RFCs/RFC-9.md", line: 12, project: "sv", detail: "c3 holds a :::cmd and no spec" };

// ---- 1. THE SEED ------------------------------------------------------------------------------
{
  assert.ok(!fs.existsSync(RECORD), "scratch starts with no record");
  const list = nudges.entries();
  assert.equal(list.length, 4);
  assert.equal(list[0].name, "run-chaser");
  assert.equal(list[1].name, "behavioural-claim-cmd-only");
  assert.equal(list[2].name, "open-corrections");
  assert.equal(list[3].name, "run-untouched-for-days");
  assert.ok(fs.existsSync(RECORD), "the first read wrote the seed to disk");
  const onDisk = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  assert.deepEqual(Object.keys(onDisk[0]).sort(), ["clock", "message", "name", "on", "scope", "severity"],
    "the chaser's entry is identity, on/off and scope — none of its nudge.json knobs ride along (c4)");
  assert.equal(onDisk[1].debounceMin, 10);
  assert.equal(onDisk[1].clock, "write");
  // THE CORRECTIONS ENTRY — RFC-078 §2.8, slice 3.12. Write clock like the judge above it, its own
  // window, and a message his to write; the BUILT_IN line is what arrives while it stays empty,
  // and without one the nudge would be on, in scope and permanently silent.
  assert.deepEqual(Object.keys(row(onDisk, "open-corrections")).sort(), ["clock", "debounceMin", "message", "name", "on", "scope", "severity"],
    "open-corrections carries exactly the record fields plus its window");
  assert.equal(row(onDisk, "open-corrections").clock, "write");
  assert.equal(row(onDisk, "open-corrections").message, "", "seeded wordless — his to write");
  assert.ok(nudges.BUILT_IN["open-corrections"], "…and it HAS a built-in line, or it could never fire (c57)");
  // THE STANDING JUDGE'S ENTRY — sweep clock, one numeric knob (afterDays), message his to edit.
  assert.deepEqual(Object.keys(row(onDisk, UNTOUCHED)).sort(), ["afterDays", "clock", "message", "name", "on", "scope", "severity"],
    "run-untouched-for-days carries exactly the record fields plus its one knob");
  assert.equal(row(onDisk, UNTOUCHED).clock, "sweep");
  assert.equal(row(onDisk, UNTOUCHED).afterDays, 7);
  assert.equal(row(onDisk, UNTOUCHED).message, "");
  ok("an absent record seeds itself with the §2.1 entries, the corrections nudge and the standing judge, knobs in their place");
}
{
  fs.writeFileSync(RECORD, "{ this is not json");
  const list = nudges.entries();
  assert.equal(list.length, 4, "an unreadable record answers as the seed in memory");
  assert.equal(fs.readFileSync(RECORD, "utf8"), "{ this is not json", "…and the broken file is NOT overwritten");
  ok("a corrupt record is read as the seed without destroying what he half-edited");
}
{
  writeRecord([{ name: "behavioural-claim-cmd-only", on: "yes", scope: 42, severity: "shout", message: 7, clock: "lunar" }]);
  const [e] = nudges.entries();
  assert.equal(e.on, true);
  assert.equal(e.scope, "global");
  assert.equal(e.severity, "steer");
  assert.equal(e.message, "");
  assert.equal(e.clock, "write", "a junk clock falls back to the seed's clock for a known nudge");
  assert.equal(e.debounceMin, 10, "…and the seed's debounce survives the junk");
  ok("junk is ignored field by field, never by throwing the entry away");
}
{
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  assert.ok(!/nudge\.json/.test(src.replace(/\/\/[^\n]*/g, "")), "nudges.cjs never names the chaser's own settings file outside a comment");
  assert.ok(!/require\("\.\/nudge\.cjs"\)/.test(src), "…and never requires the chaser module (c4: its knobs stay untouched)");
  assert.ok(!/createServer|\.listen\(/.test(src), "no listener — nothing can push into the record module (c12)");
  ok("the record module cannot touch nudge.json and opens no listener anything could push through (c4, c12)");
}

// ---- 2. THE GATE'S PRECEDENCE -----------------------------------------------------------------
{
  writeRecord([
    { name: "global-one", on: true, scope: "global", severity: "steer", message: "m", clock: "write" },
    { name: "off-one", on: false, scope: "global", severity: "steer", message: "m", clock: "write" },
    { name: "project-one", on: true, scope: "sv", severity: "steer", message: "m", clock: "write" },
    { name: "slots-one", on: true, scope: ["systemview-test", "manager"], severity: "steer", message: "m", clock: "write" },
  ]);
  assert.equal(nudges.enabledFor("never-recorded", { project: "sv", slot: "sv" }), false);
  ok("a nudge with no entry in the record is OFF — the record is the authority");

  assert.equal(nudges.enabledFor("off-one", { project: "sv", slot: "sv" }), false);
  assert.equal(nudges.enabledFor("global-one", { project: "sv", slot: "sv" }), true);
  ok("the switch is obeyed before any scope is read — off is silence (c41)");

  assert.equal(nudges.enabledFor("project-one", { project: "sv", slot: "sv" }), true);
  assert.equal(nudges.enabledFor("project-one", { project: "bu", slot: "bu" }), false);
  ok("a project-scoped nudge never reaches a session of any other project (c2)");

  assert.equal(nudges.enabledFor("slots-one", { project: "sv", slot: "systemview-test" }), true);
  assert.equal(nudges.enabledFor("slots-one", { project: "sv", slot: "sv" }), false);
  assert.equal(nudges.enabledFor("slots-one", { project: "manager", slot: "" }), false);
  ok("a slot-list scope steers those agents alone — a matching project buys nothing (c34)");
}

// ---- 3. HIS WORDS, OR THE BUILT-IN ------------------------------------------------------------
{
  writeRecord([{ name: "behavioural-claim-cmd-only", on: true, scope: "global", severity: "steer", message: "", clock: "write", debounceMin: 10 }]);
  assert.ok(/a behavioural claim owes a ::test or :::run/.test(nudges.messageOf("behavioural-claim-cmd-only")),
    "an empty message delivers the built-in line");
  writeRecord([{ name: "behavioural-claim-cmd-only", on: true, scope: "global", severity: "steer", message: "his words, verbatim", clock: "write", debounceMin: 10 }]);
  assert.equal(nudges.messageOf("behavioural-claim-cmd-only"), "his words, verbatim");
  assert.equal(nudges.messageOf("run-chaser"), "", "the chaser composes its own words elsewhere — no built-in here");
  assert.ok(/worklist get/.test(nudges.BUILT_IN["run-untouched-for-days"]),
    "the standing judge carries a built-in law line too — the run's facts ride the header it composes");
  ok("the built-in line holds until he writes one; then his words are what arrives (c1)");
}

// ---- 4. THE DIAL ------------------------------------------------------------------------------
const seedRecord = () => { try { fs.unlinkSync(RECORD); } catch {} nudges.entries(); };

{
  seedRecord();
  nudges.__resetFired();
  CALLS.length = 0;
  ANSWER = { ok: true, violations: [VIOLATION] };
  const out = await dial();
  assert.equal(out.length, 1);
  assert.equal(out[0].nudge, "behavioural-claim-cmd-only");
  assert.ok(/a behavioural claim owes a ::test or :::run/.test(out[0].text), "the steer carries the message");
  assert.ok(/\/repo\/RFCs\/RFC-9\.md:12/.test(out[0].text), "…and the violation's path:line pointer");
  assert.ok(/from the harness, not the human/.test(out[0].text), "…and introduces itself, like every nudge here");
  assert.equal(CALLS.length, 1);
  assert.deepEqual(CALLS[0], { ask: "file", path: "/repo/RFCs/RFC-9.md", project: "sv" },
    "the judges are asked about THAT document, in this process — no wire, nothing pushed (c12)");
  ok("a violation on a write becomes one steering message carrying the law and the pointer");
}
{
  nudges.__resetFired();
  CALLS.length = 0;
  assert.deepEqual(await dial({ path: "/repo/src/thing.js" }), []);
  assert.equal(CALLS.length, 0, "a .js write never costs a parse");
  ok("only a markdown path — the only thing that can be a registered document — is judged");
}
{
  // THE EDITED MESSAGE RIDES THE NEXT FIRING (c1, end to end through the dial).
  nudges.__resetFired();
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  list[1].message = "spec first, story second";
  writeRecord(list);
  const out = await dial();
  assert.ok(/spec first, story second/.test(out[0].text), out[0].text);
  assert.ok(!/owes a ::test/.test(out[0].text), "the built-in line is gone the moment his words exist");
  ok("editing the record's message changes what the very next firing delivers — no restart, no cache (c1)");
}
{
  // THE SWITCH, OBEYED BY THE MACHINERY (c41): off means the hub is not even dialled.
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  list[1].on = false;
  writeRecord(list);
  nudges.__resetFired();
  CALLS.length = 0;
  assert.deepEqual(await dial(), []);
  assert.equal(CALLS.length, 0, "with every write-nudge off, the moment passes unjudged");
  ok("switched off, the moment passes in silence — the machinery obeys the record, not a panel (c41)");
}
{
  // SCOPE AT THE DIAL (c2, c34): out-of-scope sessions neither hear nor dial.
  seedRecord();
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  list[1].scope = "sv";
  writeRecord(list);
  nudges.__resetFired();
  CALLS.length = 0;
  ANSWER = { ok: true, violations: [VIOLATION] };
  assert.equal((await dial()).length, 1, "the named project is steered");
  assert.deepEqual(await dial({ project: "bu", slot: "bu", session: "session:bu:1" }), []);
  assert.equal(CALLS.length, 1, "the other project's write was never even judged");
  list[1].scope = ["systemview-test"];
  writeRecord(list);
  nudges.__resetFired();
  assert.equal((await dial({ slot: "systemview-test" })).length, 1);
  assert.deepEqual(await dial({ slot: "sv", session: "session:sv:2" }), []);
  ok("scope gates the dial itself — a project hears alone (c2), listed slots hear alone (c34)");
}
{
  // THE DEBOUNCE (c10): a burst inside the window earns ONE message, per document, per session.
  //
  // ASSERTED THROUGH THE REAL PIPELINE, which is two steps now: `judgeWrite` DERIVES and
  // `confirmSteer` re-derives at delivery and stamps. The window used to be spent at derivation,
  // and that was wrong for one reason — a steer dropped at delivery for being already fixed would
  // have spent it anyway, silencing the next genuine violation on the document. c10's keying is
  // exactly as approved (nudge × document × session); only the moment of the stamp moved, so this
  // section exercises the pair rather than the first half alone.
  seedRecord();
  nudges.__resetFired();
  ANSWER = { ok: true, violations: [VIOLATION] };
  const spoke = async (opts = {}) => {
    const steers = await dial(opts);
    let went = 0;
    for (const st of steers) if (await nudges.confirmSteer(st, { session: opts.session || "session:sv:1", now: opts.now })) went++;
    return went;
  };
  assert.equal(await spoke({ now: 1000000 }), 1, "the first write speaks");
  assert.equal(await spoke({ now: 1000000 + 2 * 60000 }), 0, "two minutes later: inside the 10-minute window");
  assert.equal(await spoke({ now: 1000000 + 9 * 60000 }), 0, "nine minutes later: still inside");
  assert.equal(await spoke({ now: 1000000 + 11 * 60000 }), 1, "past the window, it may speak again");
  assert.equal(await spoke({ now: 1000000 + 12 * 60000, session: "session:sv:other" }), 1,
    "a DIFFERENT session's write is its own bookkeeping row");
  ANSWER = { ok: true, violations: [{ ...VIOLATION, path: "/repo/RFCs/RFC-10.md" }] };
  assert.equal(await spoke({ now: 1000000 + 12 * 60000, path: "/repo/RFCs/RFC-10.md" }), 1,
    "a DIFFERENT document is too — the key is nudge × document × session");
  ok("a burst of writes inside the debounce window arrives as one message, keyed per nudge × document × session (c10)");
}
{
  // A SWEEP-CLOCK NUDGE NEVER FIRES AT WRITE TIME — and the entry used to pin it CARRIES words,
  // so this test holds the clock gate itself and cannot pass through an empty message instead.
  // (The first version used the chaser's entry, whose message is empty — the clock-gate mutation
  // stayed green behind the nothing-to-say gate, which is exactly the hole this rewrite closes.)
  writeRecord([
    { name: "behavioural-claim-cmd-only", on: true, scope: "global", severity: "steer", message: "", clock: "write", debounceMin: 10 },
    { name: "sweepy", on: true, scope: "global", severity: "steer", message: "sweep words", clock: "sweep" },
  ]);
  nudges.__resetFired();
  ANSWER = { ok: true, violations: [{ nudge: "sweepy", path: "/repo/RFCs/RFC-9.md", line: 1 }] };
  assert.deepEqual(await dial(), []);
  // …and the chaser's own entry is deaf here too, for both reasons at once.
  ANSWER = { ok: true, violations: [{ nudge: "run-chaser", path: "/repo/RFCs/RFC-9.md", line: 1 }] };
  assert.deepEqual(await dial(), []);
  ok("a violation naming a sweep-clock nudge is left for the sweep — write time is deaf to it");
}
{
  // JUNK VIOLATIONS are skipped one by one, never by dropping the answer.
  nudges.__resetFired();
  ANSWER = { ok: true, violations: [null, 7, { path: "/x.md" }, { nudge: "never-recorded", path: "/x.md" }, VIOLATION] };
  const out = await dial();
  assert.equal(out.length, 1);
  assert.equal(out[0].nudge, "behavioural-claim-cmd-only");
  ok("junk rows and unrecorded nudges in the answer are skipped; the real violation still steers");
}

// ---- 5. DEGRADATION IS LAW --------------------------------------------------------------------
// WITH THE JUDGING IN THIS PROCESS THERE IS ONE FAILURE LEFT, NOT A LADDER. The three modes this
// section used to cover — a hub that is down, a hub too old to carry the route, a hub answering
// non-JSON — were all transport, and transport is gone: the shell no longer asks an app it hosts.
// What remains is a document it cannot read or parse, and a judge that throws. Both read as nothing
// to report, which is the rule that survived the move.
{
  seedRecord();
  nudges.__resetFired();
  FAIL = "throw";
  assert.deepEqual(await dial(), [], "a judge that throws on an unreadable document");
  FAIL = null;
  for (const [answer, what] of [
    [[], "a document with nothing wrong in it"],
    [null, "no answer at all"],
    ["nope", "an answer that is not a list"],
    [42, "a bare number"],
  ]) {
    nudges.__resetFired();
    ANSWER = answer;
    assert.deepEqual(await dial(), [], what);
  }
  ok("an unreadable document or an unexpected answer: nothing fires and nothing crashes — absence reads as nothing to report");
}

// ---- 5.5 THE RECORD'S WRITE SIDE (RFC-078 §2.5) ------------------------------------------------
// The panel flips a switch and THIS is what changes. One entry, one patch, merged by name — never
// the whole list, because a surface that must hold the record to change one switch overwrites
// whatever a concurrent edit just wrote.
{
  seedRecord();
  const before = nudges.entries();
  const r = nudges.writeEntry("behavioural-claim-cmd-only", { on: false });
  assert.equal(r.ok, true);
  assert.equal(r.entry.on, false, "the answer carries what was stored, not what was sent");
  // THE FILE IS WHAT CHANGED, and a fresh read is what proves it — the machinery reads this file on
  // every ask, so a write the next read cannot see is a setting that does nothing (c17, c41).
  assert.equal(nudges.entries().find((e) => e.name === "behavioural-claim-cmd-only").on, false);
  // AND ONLY THAT ENTRY MOVED.
  const after = nudges.entries();
  assert.equal(after.length, before.length, "no entry appeared or vanished");
  ["run-chaser", "run-untouched-for-days"].forEach((n) =>
    assert.deepEqual(after.find((e) => e.name === n), before.find((e) => e.name === n), `${n} untouched`),
  );
  ok("one entry, one field: the record file changes and the next read honors it (c17)");
}
{
  // A NAME THE FILE HAS NEVER SEEN IS APPENDED — how a nudge the seed grew later gets its row.
  seedRecord();
  const n0 = nudges.entries().length;
  const r = nudges.writeEntry("a-judge-added-later", { clock: "sweep", message: "words" });
  assert.equal(r.ok, true);
  assert.equal(nudges.entries().length, n0 + 1);
  const added = nudges.entries().find((e) => e.name === "a-judge-added-later");
  assert.equal(added.message, "words");
  assert.equal(added.on, true, "a new entry is on unless it says otherwise");
  ok("a name absent from the record is appended, not refused");
}
{
  // THE PATCH GOES THROUGH THE SAME NORMALIZER THE READ SIDE USES, so the panel cannot put the
  // machinery into a state the machinery would not have read.
  seedRecord();
  nudges.writeEntry("behavioural-claim-cmd-only", { severity: "shout", clock: "whenever", debounceMin: -9 });
  const e = nudges.entries().find((x) => x.name === "behavioural-claim-cmd-only");
  assert.equal(e.severity, "steer", "an unknown severity falls back, never lands");
  assert.equal(e.clock, "write", "an unknown clock falls back to the seed's");
  assert.ok(e.debounceMin >= 0, "a negative debounce cannot be stored");
  assert.deepEqual(nudges.writeEntry("", { on: false }), { ok: false, error: "a nudge is addressed by name" });
  ok("junk is normalized or refused — the panel cannot write a record the machinery would not read");
}
{
  // ATOMIC, and the record survives a write that cannot land: a read after a failed write must see
  // the old file rather than half of one.
  seedRecord();
  const good = nudges.entries();
  const prev = process.env.AUTOBOT_NUDGES_FILE;
  process.env.AUTOBOT_NUDGES_FILE = path.join(scratch, "no", "such", "dir", "nudges.json");
  const r = nudges.writeEntry("behavioural-claim-cmd-only", { on: false });
  process.env.AUTOBOT_NUDGES_FILE = prev;
  assert.ok(r.ok === true || r.ok === false, "it answers rather than throwing");
  assert.deepEqual(nudges.entries(), good, "the real record is untouched by a write aimed elsewhere");
  ok("a write that cannot land is an answer, never a half-written record");
}

// ---- 6. THE WIRING, READ FROM THE SOURCE (the house pattern, tests/nudge.js) --------------------
{
  const src = fs.readFileSync(new URL("../electron/agents/sessions.cjs", import.meta.url), "utf8");
  assert.ok(/if \(event\.kind === "file\.changed"\) maybeSteerWrite\(s, event\)/.test(src),
    "emit() — the one seam both file.changed halves cross — is where the dial hooks in");
  const m = /function maybeSteerWrite\(s, event\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m, "maybeSteerWrite exists");
  const body = m[0];
  assert.ok(/nudges\s*\.judgeWrite\(/.test(body), "the gating and the dial live in nudges.cjs, not re-derived here");
  assert.ok(/project: s\.projectCode/.test(body) && /session: s\.key/.test(body),
    "the session's own identity is what the gates and the debounce see");
  assert.ok(/deliverSteers\(s, steers\)/.test(body),
    "delivery goes through the one shared ride — a second copy per clock is how clocks drift apart");
  const d = /function deliverSteers\(s, steers\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(d, "deliverSteers exists — one delivery for every steering nudge, whichever clock judged it");
  assert.ok(/s\.input\.push\(/.test(d[0]) && /s\.nextTurnFromHook = true/.test(d[0]),
    "delivery is the chaser's own ride — a user turn on the session's input queue, marked as no human's (c9)");
  assert.ok(/kind: "nudge\.steered"/.test(d[0]), "…with a receipt in the feed, because nothing runs invisibly");
  assert.ok(!/for \(const \w+ of sessions/.test(body) && !/for \(const \w+ of sessions/.test(d[0]),
    "and it reaches ONLY the session the event was emitted into — no walk over other sessions (c9)");
  const chaser = /function maybeNudge\(s, quietMin\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(chaser && /nudge\.readSettings\(\)/.test(chaser[0]) && !/nudges\./.test(chaser[0]),
    "the chaser still reads its OWN settings file and never this record — its knobs are untouched (c4)");
  ok("the wiring: emit→dial on file.changed, identity from the session, delivery on the chaser's ride, chaser untouched");
}

// ---- 7. THE STANDING RUN JUDGE — run-untouched-for-days (c11) -----------------------------------
const DAY = 86400000;
const NOW = 200 * DAY; // a fake clock: `now` is a parameter everywhere, so no timer is ever faked
const mkRun = (over = {}) => ({
  owner: "run:r1", session: "session:sv:1", source: "skill:x", done: 1, total: 3,
  active: "step", updatedAt: NOW - 8 * DAY, status: null, attachments: null, ...over,
});
const judgeRuns = (runs, over = {}) =>
  nudges.judgeRuns({ runs, project: "sv", slot: "sv", session: "session:sv:1", now: NOW, cooldownMin: 30, ...over });

{
  seedRecord();
  nudges.__resetFired();
  const out = judgeRuns([mkRun()]);
  assert.equal(out.length, 1);
  assert.equal(out[0].nudge, "run-untouched-for-days");
  assert.equal(out[0].run, "run:r1");
  assert.equal(out[0].days, 8);
  assert.ok(/untouched for 8 days/.test(out[0].text), "the message names how long it has sat");
  assert.ok(/`skill:x`/.test(out[0].text), "…and the run's source");
  assert.ok(/1\/3/.test(out[0].text), "…and where it stands");
  assert.ok(/from the harness, not the human/.test(out[0].text), "…and introduces itself, like every nudge here");
  assert.ok(/worklist get/.test(out[0].text), "the built-in law line rides while the message stays empty");
  ok("a sourced run untouched past the threshold is a standing violation naming its source and its days");
}
{
  nudges.__resetFired();
  assert.deepEqual(judgeRuns([mkRun({ updatedAt: NOW - 2 * DAY })]), [], "moved two days ago: not standing");
  assert.equal(judgeRuns([mkRun({ updatedAt: NOW - 7 * DAY })]).length, 1, "exactly the threshold: standing");
  nudges.__resetFired();
  assert.deepEqual(judgeRuns([mkRun({ updatedAt: NOW - 7 * DAY + 60000 })]), [], "a minute short of it: not yet");
  ok("the days threshold is a floor on the fake clock — movement inside it is silence");
}
{
  nudges.__resetFired();
  assert.deepEqual(judgeRuns([mkRun({ source: "" })]), [], "a session's own plan is never judged");
  assert.deepEqual(judgeRuns([mkRun({ done: 3 })]), [], "every item done: the run closed properly");
  assert.deepEqual(judgeRuns([mkRun({ done: 0, total: 0 })]), [], "an empty list is not an open run");
  assert.deepEqual(judgeRuns([mkRun({ updatedAt: 0 })]), [], "a record with no clock cannot be aged honestly");
  ok("only a sourced, still-open run can stand in violation");
}
{
  // THE §2.4 ENDING ENDS THIS TOO — abandoned WITH the account; the word alone changes nothing.
  nudges.__resetFired();
  const excusedRun = mkRun({ status: { text: "abandoned — blocked on his review", ts: NOW - 9 * DAY }, attachments: [{ kind: "report", ref: "r" }] });
  assert.deepEqual(judgeRuns([excusedRun]), [], "abandoned with its account attached: the judging stops (default rule)");
  assert.equal(judgeRuns([mkRun({ status: { text: "abandoned — honest", ts: NOW - 9 * DAY } })]).length, 1,
    "the word with nothing attached keeps the judge alive — exactly the chaser's own law (c13)");
  nudges.__resetFired();
  assert.deepEqual(judgeRuns([mkRun()], { excused: () => true }), [],
    "the caller's own excusedOf is honored when passed — one definition, the chaser's (§2.4)");
  ok("abandoned-with-account ends the standing judge the same way it ends the chase");
}
{
  // THE KNOB: afterDays is the entry's, editable like any field, junk falling back to the seed's 7.
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(list, UNTOUCHED).afterDays = 30;
  writeRecord(list);
  nudges.__resetFired();
  assert.deepEqual(judgeRuns([mkRun()]), [], "8 days is quiet under a 30-day knob");
  assert.equal(judgeRuns([mkRun({ updatedAt: NOW - 31 * DAY })]).length, 1, "31 days is not");
  row(list, UNTOUCHED).afterDays = "soon";
  writeRecord(list);
  assert.equal(row(nudges.entries(), UNTOUCHED).afterDays, 7, "a junk knob falls back to the seed's 7, never to nothing");
  ok("afterDays is his knob — honored when sane, seeded when junk");
}
{
  // THE GATES, SAME LAW AS EVERY NUDGE: switch (c41), scope (c2), the record's absence, the clock.
  seedRecord();
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(list, UNTOUCHED).on = false;
  writeRecord(list);
  nudges.__resetFired();
  assert.deepEqual(judgeRuns([mkRun()]), [], "switched off, the moment passes in silence (c41)");
  row(list, UNTOUCHED).on = true;
  row(list, UNTOUCHED).scope = "bu";
  writeRecord(list);
  assert.deepEqual(judgeRuns([mkRun()]), [], "scoped to another project, this one hears nothing (c2)");
  writeRecord([list[0], list[1]]);
  assert.deepEqual(judgeRuns([mkRun()]), [], "no entry in the record means OFF — the record is the authority");
  seedRecord();
  const edited = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(edited, UNTOUCHED).clock = "write";
  writeRecord(edited);
  assert.deepEqual(judgeRuns([mkRun()]), [], "moved onto the write clock, the sweep leaves it alone — its own clock, symmetrically");
  ok("the standing judge obeys the record's switch, scope, presence and clock like every nudge");
}
{
  // THE COOLDOWN DISCIPLINE (c35): the chaser's window, bookkept per nudge × run × session.
  seedRecord();
  nudges.__resetFired();
  assert.equal(judgeRuns([mkRun()]).length, 1);
  assert.deepEqual(judgeRuns([mkRun()], { now: NOW + 10 * 60000 }), [], "ten minutes on: inside the 30-minute window");
  assert.equal(judgeRuns([mkRun()], { now: NOW + 31 * 60000 }).length, 1, "past the window, it may speak again");
  assert.equal(judgeRuns([mkRun({ owner: "run:r2" })], { now: NOW + 10 * 60000 }).length, 1,
    "a DIFFERENT run is its own bookkeeping row");
  assert.equal(judgeRuns([mkRun()], { now: NOW + 40 * 60000, session: "session:sv:other" }).length, 1,
    "and a different target session is too — per nudge × run × session");
  ok("standing deliveries ride the chaser's cooldown, keyed per nudge × run × session (c35)");
}
{
  // HIS WORDS WIN HERE TOO (c1) — the header keeps the facts his message cannot know.
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(list, UNTOUCHED).message = "park it or finish it";
  writeRecord(list);
  nudges.__resetFired();
  const [st] = judgeRuns([mkRun()]);
  assert.ok(/park it or finish it/.test(st.text));
  assert.ok(!/worklist get/.test(st.text), "the built-in line is gone the moment his words exist");
  assert.ok(/untouched for 8 days/.test(st.text) && /`skill:x`/.test(st.text),
    "the source and the days still arrive — they are the judge's facts, not the message's");
  ok("editing the standing judge's message delivers his words on the next firing (c1)");
}

// ---- 8. THE PROJECT-WIDE DOOR ON THE SWEEP (c11) ------------------------------------------------
// A hub-backed sweep nudge for the fixtures — the seed ships none ON the sweep clock, so the suite
// writes the record a hand-edit would: that is the record being the setting, not a test cheat.
const SWEEP_ENTRY = { name: "met-without-note", on: true, scope: "global", severity: "steer", message: "a met mark owes the statement beside it", clock: "sweep" };
const sweepRecord = () => { seedRecord(); const l = JSON.parse(fs.readFileSync(RECORD, "utf8")); l.push(SWEEP_ENTRY); writeRecord(l); };
const SWEEP_VIOLATION = { nudge: "met-without-note", path: "/repo/RFCs/RFC-9.md", line: 4, project: "sv", detail: "c2 met, no note" };
const dialProject = (over = {}) =>
  nudges.judgeProject({ project: "sv", slot: "sv", session: "session:sv:1", now: NOW, cooldownMin: 30, ...over });

{
  sweepRecord();
  nudges.__resetFired();
  nudges.__resetSweep();
  CALLS.length = 0;
  FAIL = null;
  ANSWER = { ok: true, violations: [SWEEP_VIOLATION] };
  const out = await dialProject();
  assert.equal(out.length, 1);
  assert.equal(out[0].nudge, "met-without-note");
  assert.ok(/a met mark owes the statement/.test(out[0].text), "the steer carries the message");
  assert.ok(/\/repo\/RFCs\/RFC-9\.md:4/.test(out[0].text), "…and the violation's path:line pointer");
  assert.ok(/from the harness, not the human/.test(out[0].text), "…and introduces itself");
  assert.equal(CALLS.length, 1);
  assert.deepEqual(CALLS[0], { ask: "project", project: "sv" },
    "the judges are asked per PROJECT — the sweep question, in this process, nothing pushed (c12)");
  ok("a standing registry violation becomes one steering message off the project sweep");
}
{
  // THE FREQUENCY CEILING: once per project per cooldown window — never per tick, never per session.
  assert.deepEqual(await dialProject({ now: NOW + 5 * 60000 }), []);
  assert.deepEqual(await dialProject({ now: NOW + 5 * 60000, session: "session:sv:2" }), []);
  assert.equal(CALLS.length, 1, "five minutes of ticks and a second session bought ZERO new sweeps");
  nudges.__resetFired();
  assert.equal((await dialProject({ now: NOW + 31 * 60000 })).length, 1, "past the window, the project is asked again");
  assert.equal(CALLS.length, 2);
  ok("the registry is swept once per project per cooldown window — the tick multiplies nothing (c11)");
}
{
  // ARMED OR NOT EVEN ASKED: no sweep-clock DOCUMENT nudge on and in scope → no walk at all.
  seedRecord(); // the seed's only sweep entries are run-state — nothing for the document judges
  nudges.__resetSweep();
  CALLS.length = 0;
  assert.deepEqual(await dialProject(), []);
  assert.equal(CALLS.length, 0, "run-state sweep nudges never arm the document sweep");
  sweepRecord();
  const l = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(l, "met-without-note").on = false;
  writeRecord(l);
  nudges.__resetSweep();
  assert.deepEqual(await dialProject(), []);
  assert.equal(CALLS.length, 0, "switched off, the moment passes without a sweep (c41)");
  row(l, "met-without-note").on = true;
  row(l, "met-without-note").scope = "bu";
  writeRecord(l);
  nudges.__resetSweep();
  assert.deepEqual(await dialProject(), []);
  assert.equal(CALLS.length, 0, "out of scope, the project is not even asked (c2)");
  ok("with nothing armed for the sweep, the registry is not even walked");
}
{
  // DEAF TO THE WRONG NAMES: write-clock nudges wait for their clock; run-state names are judged by
  // judgeRuns, never off a document answer; unrecorded names are OFF; junk rows are skipped.
  sweepRecord();
  nudges.__resetFired();
  nudges.__resetSweep();
  ANSWER = { ok: true, violations: [
    { nudge: "behavioural-claim-cmd-only", path: "/x.md", line: 1 },
    { nudge: "run-untouched-for-days", path: "/x.md", line: 1 },
    { nudge: "run-chaser", path: "/x.md", line: 1 },
    { nudge: "never-recorded", path: "/x.md", line: 1 },
    null, 7, { path: "/no-name.md" },
    SWEEP_VIOLATION,
  ] };
  const out = await dialProject();
  assert.equal(out.length, 1);
  assert.equal(out[0].nudge, "met-without-note");
  ok("the sweep delivers sweep-clock document nudges alone — write-clock, run-state, unrecorded and junk all pass through it");
}
{
  // DEGRADATION IS LAW HERE TOO — and a failed walk still spends the window, never per tick.
  nudges.__resetSweep();
  nudges.__resetFired();
  FAIL = "throw";
  assert.deepEqual(await dialProject(), [], "a registry that cannot be walked means nothing to report");
  CALLS.length = 0;
  assert.deepEqual(await dialProject({ now: NOW + 60 * 60000 }), []);
  assert.equal(CALLS.length, 1);
  assert.deepEqual(await dialProject({ now: NOW + 61 * 60000 }), []);
  assert.equal(CALLS.length, 1, "the failed walk still spent the window — it is not retried every tick");
  FAIL = null;
  ok("a walk that throws reads as nothing to report, and is retried on the window, never per tick");
}
{
  // THE CAP, AND THE ROTATION THAT KEEPS IT HONEST: a registry carrying years of debt steers three
  // at a time, least-recently-steered first, so the overflow ARRIVES later instead of starving.
  nudges.__resetFired();
  nudges.__resetSweep();
  const many = [1, 2, 3, 4, 5].map((n) => ({ nudge: "met-without-note", path: `/repo/RFCs/RFC-${n}.md`, line: n }));
  ANSWER = { ok: true, violations: many };
  const first = await dialProject();
  assert.equal(first.length, 3, "one sweep delivers at most three");
  assert.deepEqual(first.map((v) => v.path), ["/repo/RFCs/RFC-1.md", "/repo/RFCs/RFC-2.md", "/repo/RFCs/RFC-3.md"]);
  const second = await dialProject({ now: NOW + 31 * 60000 });
  assert.equal(second.length, 3);
  assert.ok(second.some((v) => v.path === "/repo/RFCs/RFC-4.md") && second.some((v) => v.path === "/repo/RFCs/RFC-5.md"),
    "the next window reaches the violations the cap held back — nothing starves, nothing was stored");
  ok("the sweep caps per window and rotates the standing debt through later windows");
}

// ---- 9. THE CONNECTED-PROJECT ROSTER ------------------------------------------------------------
{
  fs.writeFileSync(PROJECTS, JSON.stringify({ sv: "/repo/sv", bu: "/repo/bu" }));
  assert.deepEqual(nudges.connectedProjects(), ["sv", "bu"]);
  fs.writeFileSync(PROJECTS, "not json at all");
  assert.deepEqual(nudges.connectedProjects(), [], "a junk roster is no roster");
  fs.writeFileSync(PROJECTS, JSON.stringify(["sv"]));
  assert.deepEqual(nudges.connectedProjects(), [], "a list is not the map this file has always been");
  fs.unlinkSync(PROJECTS);
  assert.deepEqual(nudges.connectedProjects(), [], "and no file is simply no projects — never a crash");
  ok("the sweep's roster is ~/.autobot/projects.json, read tolerantly like every file here");
}

// ---- 10. THE CHASER'S STAMP IS NOT MOVEMENT -----------------------------------------------------
{
  // Without this, every chased run reads permanently fresh and the standing judge is silenced on
  // exactly the runs it exists to name — "nudged 3 times, no movement" must stay literally true.
  const worklist = require("../electron/agents/worklist.cjs");
  worklist.writeRun("u1", "session:sv:1", [{ text: "a", state: "active" }], "skill:x");
  const f = path.join(worklist.DIR, "run-u1.json");
  const aged = JSON.parse(fs.readFileSync(f, "utf8"));
  aged.updatedAt = 1000;
  fs.writeFileSync(f, JSON.stringify(aged, null, 2));
  worklist.markNudged("run:u1");
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).updatedAt, 1000,
    "a nudge stamp leaves the movement clock exactly where it was");
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).nudges.count, 1, "…while the count still lands");
  worklist.markStatus("u1", { text: "waiting on review" });
  assert.ok(JSON.parse(fs.readFileSync(f, "utf8")).updatedAt > 1000,
    "a status write IS movement — it moves the clock like any real touch");
  ok("markNudged bookkeeps without touching updatedAt; a real write still moves it");
}

// ---- 11. THE SWEEP WIRING, READ FROM THE SOURCE (c11, c35) --------------------------------------
{
  const src = fs.readFileSync(new URL("../electron/agents/sessions.cjs", import.meta.url), "utf8");
  const tick = /function armIdle\(s\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(tick, "armIdle exists");
  assert.ok(/maybeNudge\(s, quietMin\)/.test(tick[0]) && /maybeSweepJudges\(s\)/.test(tick[0]),
    "the standing judges ride the SAME tick the chaser rides — a second clock, not a second mechanism (c11)");
  assert.ok(/if \(s\.turnActive \|\| s\.toolsInFlight > 0\) return/.test(tick[0]),
    "…behind the tick's own turn-guard, which is what makes every standing delivery turn-end (c35)");
  const sweep = /function maybeSweepJudges\(s\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(sweep, "maybeSweepJudges exists");
  const sb = sweep[0];
  assert.ok(/nudges\.judgeRuns\(/.test(sb), "the shell-local standing judge runs on the tick (c11)");
  assert.ok(/excused: nudge\.excusedOf/.test(sb),
    "…with the chaser's own §2.4 closed-condition passed in — one definition of 'ended honestly'");
  assert.ok(/nudge\.sameAgent\(/.test(sb), "…over this agent's own runs, by the chaser's ownership rule");
  assert.ok(/nudges\.connectedProjects\(\)/.test(sb),
    "the project door is gated on the connected roster — projects.json, not a guess");
  assert.ok(/nudges\s*\.judgeProject\(/.test(sb), "…and the project-wide door is dialled from the same tick (c11)");
  assert.ok(/cooldownMin/.test(sb), "both halves ride the chaser's cooldown discipline (c35)");
  assert.ok((sb.match(/deliverSteers\(/g) || []).length >= 2 && !/for \(const \w+ of sessions/.test(sb),
    "delivery is the one shared ride, to the ticking session alone — no walk over other sessions");
  ok("the wiring: one tick, two standing judges, the chaser's guard and cooldown, one delivery ride");
}

// ---- 12. THE AUDIT QUEUE — RFC-078 §2.7, slice 3.4 ----------------------------------------------
// The system reaches out to the manager: no agent ever asks for an audit. The shell half appends
// and dedupes-within-window ONLY — an entry leaves the queue when the drain (3.5) removes it.
const readQueueFile = () => JSON.parse(fs.readFileSync(QUEUE, "utf8"));
{
  assert.ok(!fs.existsSync(QUEUE), "scratch starts with no queue");
  assert.deepEqual(nudges.readAuditQueue(), [], "a missing queue reads as empty — never a crash");
  const entry = nudges.enqueueAudit({ path: "/repo/RFCs/RFC-9.md", project: "sv", now: 5000000 });
  assert.deepEqual(entry, { project: "sv", path: "/repo/RFCs/RFC-9.md", at: 5000000 });
  assert.deepEqual(readQueueFile(), [entry], "the entry on disk is {project, path, at} — nothing more");
  assert.equal(nudges.enqueueAudit({ path: "/repo/src/thing.js", project: "sv", now: 5000000 }), null);
  assert.equal(nudges.enqueueAudit({ path: "/repo/RFCs/RFC-8.md", project: "", now: 5000000 }), null);
  assert.equal(readQueueFile().length, 1, "a .js write and a projectless write never reach the queue");
  ok("a registered-document write appends {project, path, at}; anything else never touches the file (c24)");
}
{
  // THE WINDOW — c24's twenty-in-one half: one entry per document per debounce window, and a later
  // write inside the window refreshes NOTHING, not even `at` — the drain reads the document fresh.
  for (let i = 1; i <= 20; i++)
    nudges.enqueueAudit({ path: "/repo/RFCs/RFC-9.md", project: "sv", now: 5000000 + i * 20000 });
  const q = readQueueFile();
  assert.equal(q.length, 1, "twenty writes to one document inside the window land as ONE entry");
  assert.equal(q[0].at, 5000000, "…and the survivor keeps its first stamp — a later write refreshes nothing");
  assert.ok(nudges.enqueueAudit({ path: "/repo/RFCs/RFC-10.md", project: "sv", now: 5000000 + 60000 }),
    "a DIFFERENT document inside the window is its own entry — the window is per document");
  assert.ok(nudges.enqueueAudit({ path: "/repo/RFCs/RFC-9.md", project: "sv", now: 5000000 + 11 * 60000 }),
    "past the window the same document may enqueue again — removal is the drain's (3.5), never this half's");
  assert.equal(readQueueFile().length, 3, "and this half only ever GREW the queue");
  assert.equal(nudges.AUDIT_DEBOUNCE_MIN, 10, "the default window matches the seed's write-dial debounceMin");
  assert.equal(nudges.enqueueAudit({ path: "/repo/RFCs/RFC-9.md", project: "sv", now: 5000000 + 12 * 60000 }),
    null, "one minute after the re-enqueue: inside the new window");
  assert.ok(nudges.enqueueAudit({ path: "/repo/RFCs/RFC-9.md", project: "sv", now: 5000000 + 12 * 60000, debounceMin: 0 }),
    "a zero window disables the debounce — the knob is honored");
  ok("a burst inside the window is one entry per document, un-refreshed; the queue is append-only here");
}
{
  // TOLERANT LIKE EVERY FILE HERE — and junk rows are dropped one by one, never the whole queue.
  fs.writeFileSync(QUEUE, "{ this is not json");
  assert.deepEqual(nudges.readAuditQueue(), [], "junk reads as empty");
  assert.ok(nudges.enqueueAudit({ path: "/repo/RFCs/RFC-1.md", project: "sv", now: 9000000 }),
    "…and the next append still lands — the junk never crashes the write path that feeds the queue");
  fs.writeFileSync(QUEUE, JSON.stringify({ a: 1 }));
  assert.deepEqual(nudges.readAuditQueue(), [], "a non-list is no queue");
  fs.writeFileSync(QUEUE, JSON.stringify([null, 7, { project: "sv" }, { project: "sv", path: "/x.md", at: 123 }, { path: "/y.md", at: 5 }]));
  assert.deepEqual(nudges.readAuditQueue(), [{ project: "sv", path: "/x.md", at: 123 }],
    "junk ROWS are dropped one by one — the good entry survives");
  ok("missing, junk, or half-junk: the queue reads tolerantly and the feed it rides never breaks");
}
{
  // ATOMIC: write then read back exactly, no tmp residue, and the source says tmp+rename — a drain
  // reading mid-write sees the old queue or the new one, never half a JSON file.
  const list = [{ project: "sv", path: "/a.md", at: 1 }, { project: "bu", path: "/b.md", at: 2 }];
  assert.equal(nudges.writeAuditQueue(list), true);
  assert.deepEqual(nudges.readAuditQueue(), list, "write then read back: the round trip is exact");
  assert.ok(!fs.readdirSync(scratch).some((f) => f.includes("audit-queue.json.tmp")),
    "no tmp residue left beside the queue");
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  const w = /function writeAuditQueue\(list\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(w && /\.tmp-/.test(w[0]) && /renameSync/.test(w[0]),
    "the write goes to a tmp file and renames into place — old or new, never half");
  ok("the queue write is atomic: exact round trip, tmp+rename, no residue");
}
{
  // ONE GATE, TWO RIDERS — the anti-drift assertion: the judges dial and the audit enqueue share
  // the single registered-document predicate, so they cannot disagree about what a document is.
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  const bare = src.replace(/\/\/[^\n]*/g, "");
  assert.equal((bare.match(/\\\.\(md\|markdown\)/g) || []).length, 1,
    "ONE markdown predicate in the whole module — a second copy is how the dial and the queue drift");
  const jw = /async function judgeWrite\([\s\S]*?\n\}/.exec(src);
  const eq = /function enqueueAudit\([\s\S]*?\n\}/.exec(src);
  assert.ok(jw && /isRegisteredDocumentWrite\(p\)/.test(jw[0]), "the judges dial rides the shared gate");
  assert.ok(eq && /isRegisteredDocumentWrite\(p\)/.test(eq[0]), "…and the enqueue rides the SAME one");
  for (const [p, is] of [["/a/doc.md", true], ["/a/doc.markdown", true], ["/a/DOC.MD", true], ["/a/x.js", false], ["/a/doc.mdx", false], ["", false]])
    assert.equal(nudges.isRegisteredDocumentWrite(p), is, `gate(${p || "(empty)"}) should be ${is}`);
  ok("the judges ask and the audit enqueue fire on one shared gate — they cannot drift apart");
}
{
  // THE WIRING: the enqueue rides the dial's own seam in sessions.cjs — and nowhere else.
  const src = fs.readFileSync(new URL("../electron/agents/sessions.cjs", import.meta.url), "utf8");
  const m = /function maybeSteerWrite\(s, event\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m && /nudges\.enqueueAudit\(\{ path: event\.path, project: s\.projectCode \}\)/.test(m[0]),
    "the enqueue rides the judges dial's own seam — one moment, one gate, no second wiring to drift");
  assert.ok(!/enqueueAudit/.test(src.replace(m[0], "")),
    "…and NOWHERE else: the dial seam is the only place a write becomes an audit entry");
  ok("the wiring: the same file.changed that asks the judges enqueues for the manager (c24)");
}

// ---- 8 · THE STEER IS RE-DERIVED AT DELIVERY, AND ONLY THEN STAMPED --------------------------
//
// The write clock's steer is a QUEUED TURN, taken whenever the session next yields — and in
// between, the agent is usually still working on the very document that was judged. So the fix
// routinely lands BEFORE the message arrives, and the message then describes a violation that no
// longer exists. RFC-078's principle is that a fixed violation does not get removed, it STOPS
// EXISTING; the queue was the one place that stopped being true.
//
// The stamp moved with it, and that is the half worth understanding: stamping at derivation would
// spend the debounce window on a message about to be dropped, silencing the NEXT genuine violation
// on the same document. c10's keying is untouched — still per nudge × document × session — only
// the moment of the stamp moved.
{
  nudges.__resetFired();
  const steer = { nudge: "behavioural-claim-cmd-only", path: "/repo/RFCs/RFC-9.md", abs: "/repo/RFCs/RFC-9.md", project: "sv", line: 12 };

  // STILL STANDING — delivered, and the window is stamped HERE.
  ANSWER = { ok: true, violations: [VIOLATION] };
  assert.equal(await nudges.confirmSteer(steer, { session: "s1" }), true, "a violation that still stands is delivered");
  assert.equal(
    nudges.firedWithin("behavioural-claim-cmd-only", { doc: "/repo/RFCs/RFC-9.md", session: "s1", min: 10 }),
    true,
    "…and the stamp landed at DELIVERY — the window is spent only on a message that actually went",
  );
  ok("a steer whose violation still stands is delivered, and the debounce is stamped at delivery");
}
{
  nudges.__resetFired();
  const steer = { nudge: "behavioural-claim-cmd-only", path: "/repo/RFCs/RFC-9.md", abs: "/repo/RFCs/RFC-9.md", project: "sv", line: 12 };

  // FIXED IN THE MEANTIME — dropped, and crucially the window is NOT spent.
  ANSWER = { ok: true, violations: [] };
  assert.equal(await nudges.confirmSteer(steer, { session: "s1" }), false, "a violation gone by delivery is dropped");
  assert.equal(
    nudges.firedWithin("behavioural-claim-cmd-only", { doc: "/repo/RFCs/RFC-9.md", session: "s1", min: 10 }),
    false,
    "and the window was NOT spent on it — the next genuine violation on this document can still speak",
  );

  // THE DOCUMENT IS RE-READ, not remembered: the ask is recorded against the absolute path.
  assert.ok(CALLS.some((c) => c.ask === "file" && c.path === "/repo/RFCs/RFC-9.md"),
    "delivery asked the judges again rather than trusting the steer it was handed");

  // A DIFFERENT judge's violation standing on the same document does not rescue this steer.
  ANSWER = { ok: true, violations: [{ ...VIOLATION, nudge: "met-without-note" }] };
  assert.equal(await nudges.confirmSteer(steer, { session: "s1" }), false,
    "another judge's violation on the same document is not this steer's — dropped by NAME, not by document");
  ok("a steer fixed before the turn came round is dropped, by name, and spends no window");
}
{
  nudges.__resetFired();
  const steer = { nudge: "behavioural-claim-cmd-only", path: "/repo/RFCs/RFC-9.md", abs: "/repo/RFCs/RFC-9.md", project: "sv" };
  ANSWER = { ok: true, violations: [VIOLATION] };

  // TWO DERIVATIONS, ONE MESSAGE. With the stamp at delivery, judgeWrite can legitimately produce
  // two steers for one burst; the window collapses them HERE instead of at derivation.
  assert.equal(await nudges.confirmSteer(steer, { session: "s1" }), true, "the first one goes");
  assert.equal(await nudges.confirmSteer(steer, { session: "s1" }), false, "the second is swallowed by the window");
  assert.equal(await nudges.confirmSteer(steer, { session: "s2" }), true, "another session has its own row — never debounced by mine");
  ok("the window collapses a burst at delivery, per session — c10's keying unchanged, only its moment moved");
}
{
  nudges.__resetFired();
  // A JUDGE THAT CANNOT ANSWER MUST NEVER SWALLOW A STANDING VIOLATION — the same direction every
  // other failure in this module falls. Deliver, and stamp, so it cannot also loop.
  FAIL = true;
  const steer = { nudge: "behavioural-claim-cmd-only", path: "/repo/RFCs/RFC-9.md", abs: "/repo/RFCs/RFC-9.md", project: "sv" };
  assert.equal(await nudges.confirmSteer(steer, { session: "s1" }), true, "an unreadable re-check delivers rather than silently dropping");
  assert.equal(nudges.firedWithin("behavioural-claim-cmd-only", { doc: "/repo/RFCs/RFC-9.md", session: "s1", min: 10 }), true,
    "…and it is stamped, so a judge that is broken for an hour cannot nudge every turn");
  FAIL = null;

  // A SWEEP OR RUN STEER HAS NOTHING TO RE-READ and must pass through untouched — those clocks
  // derive and deliver inside one tick, and they stamp themselves.
  nudges.__resetFired();
  assert.equal(await nudges.confirmSteer({ nudge: "run-chaser", run: "abc" }, { session: "s1" }), true,
    "a run steer carries no document — delivered as derived");
  assert.equal(nudges.firedWithin("run-chaser", { doc: "", session: "s1", min: 10 }), false,
    "…and this door did not stamp it — the run clock owns its own bookkeeping");
  assert.equal(await nudges.confirmSteer(null, { session: "s1" }), false, "nothing is not a steer");
  ok("an unreadable re-check still delivers; a steer with no document passes through and is not stamped here");
}

// ---- 13. CORRECTIONS ON THE QUEUE — RFC-078 §2.8, slice 3.8 -------------------------------------
// The reader PARSES an entry now rather than rebuilding it from three keys. It used to map every
// row to exactly {project, path, at}; writeAuditQueue then persisted that stripped list, so a
// field added to an entry was destroyed by the next read-write cycle with no error anywhere.
{
  const corr = { id: "k1", at: 7000, by: "manager", for: "sv", target: "RFCs/RFC-9.md#c18", text: "the note does not support the mark" };
  fs.writeFileSync(QUEUE, JSON.stringify([{ project: "sv", path: "/repo/RFCs/RFC-9.md", at: 5000, corrections: [corr] }]));
  const back = nudges.readAuditQueue();
  assert.equal(back.length, 1, "the entry survives the read");
  assert.deepEqual(back[0].corrections, [corr], "…and its correction comes through field for field");
  // THE ROUND TRIP IS THE WHOLE CLAIM (c43): read, write what you read, read again.
  assert.equal(nudges.writeAuditQueue(back), true);
  assert.deepEqual(nudges.readAuditQueue()[0].corrections, [corr],
    "read → write → read leaves the correction intact — the cycle that used to destroy it");
  ok("a correction on an entry survives the read-write cycle — the reader parses the entry, it no longer rebuilds it");
}
{
  // AN ENTRY WITH NO CORRECTIONS CARRIES NO EMPTY ARRAY — the shape the shell has always written
  // stays exactly what it was, so nothing downstream learns a new field it does not need.
  fs.writeFileSync(QUEUE, JSON.stringify([{ project: "sv", path: "/repo/RFCs/RFC-9.md", at: 5000 }]));
  assert.deepEqual(nudges.readAuditQueue(), [{ project: "sv", path: "/repo/RFCs/RFC-9.md", at: 5000 }],
    "an entry with nothing owed reads as {project, path, at} and gains no empty corrections array");
  fs.writeFileSync(QUEUE, JSON.stringify([{ project: "sv", path: "/x.md", at: 1, corrections: [] }]));
  assert.deepEqual(nudges.readAuditQueue(), [{ project: "sv", path: "/x.md", at: 1 }],
    "…and an empty array on disk is read back as no field at all");
  ok("the old entry shape is untouched — corrections appear only where something is actually owed");
}
{
  // A PATHLESS ENTRY IS LEGITIMATE ONLY WHEN SOMETHING IS OWED ON IT (c46). A correction about a
  // practice, a repo or an agent's conduct has no document write behind it and no path to name.
  // With nothing owed, a row with no path is still junk: no document to read, nothing to do.
  const about = { id: "k2", at: 1, by: "manager", for: "sv", target: "the handbook's worklist chapter", text: "no chapter exists" };
  fs.writeFileSync(QUEUE, JSON.stringify([
    { project: "sv", at: 1, corrections: [about] },
    { project: "sv", at: 2 },
  ]));
  const q = nudges.readAuditQueue();
  assert.equal(q.length, 1, "the pathless row with nothing owed is dropped; the one carrying a correction is not");
  assert.equal(q[0].corrections[0].target, "the handbook's worklist chapter",
    "…and a target that is not a document comes through intact — the field is deliberately unconstrained");
  ok("an entry with no document behind it survives only while it carries a correction, target intact");
}
{
  // JUNK CORRECTIONS ARE DROPPED ONE BY ONE, the same discipline as junk entries — and the three
  // fields that make one addressable are required: no id is nothing to clear, no `for` is nobody
  // to deliver to, no text is nothing to say.
  fs.writeFileSync(QUEUE, JSON.stringify([{ project: "sv", path: "/x.md", at: 1, corrections: [
    null, 7, "words",
    { at: 1, by: "m", for: "sv", text: "t" },
    { id: "a", by: "m", for: "", text: "t" },
    { id: "b", by: "m", for: "sv", text: "" },
    { id: "ok", by: "m", for: "sv", text: "kept" },
  ] }]));
  const kept = nudges.readAuditQueue()[0].corrections;
  assert.equal(kept.length, 1, "six unusable rows dropped, the usable one kept");
  assert.equal(kept[0].id, "ok");
  assert.equal(kept[0].at, 0, "a missing stamp normalizes rather than disqualifying — age is not addressability");
  assert.equal(kept[0].target, "", "…and so does a missing target");
  fs.writeFileSync(QUEUE, JSON.stringify([{ project: "sv", path: "/x.md", at: 1, corrections: "not a list" }]));
  assert.deepEqual(nudges.readAuditQueue(), [{ project: "sv", path: "/x.md", at: 1 }],
    "a corrections field that is not a list is no corrections at all — never a crash");
  ok("junk corrections are dropped row by row; id, for and text are what make one addressable");
}

// ---- 14. THE DOORS — RFC-078 §2.8, slices 3.9 and 3.10 -----------------------------------------
// Submitting, clearing, reading and removing are VERBS now, not an agent editing JSON under a job
// document's instructions. The difference is that a verb can refuse, and a rule that can refuse is
// a mechanism rather than a hope — which is what moved four of this section's claims.
const reset = () => fs.writeFileSync(QUEUE, "[]");
{
  reset();
  for (const [bad, word] of [
    [{ for: "sv", text: "t" }, "project"],
    [{ project: "sv", text: "t" }, "owes"],
    [{ project: "sv", for: "sv" }, "words"],
  ]) {
    const r = nudges.submitCorrection(bad);
    assert.equal(r.ok, false, `submit without a ${word} is refused`);
    assert.ok(typeof r.reason === "string" && r.reason.length > 10, "…and the refusal is a sentence somebody can read, never a false");
  }
  assert.deepEqual(nudges.readAuditQueue(), [], "and NOTHING was written by any of the three");
  ok("a submit missing its project, its owner or its words is refused in a sentence, and writes nothing (c42)");
}
{
  // NO DOCUMENT WRITE BEHIND IT — the correction about a practice, a repo, an agent's conduct.
  reset();
  const r = nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", target: "the worklist chapter", text: "no chapter exists", now: 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.joined, false, "it created its own entry rather than joining one");
  const q = nudges.readAuditQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].path, "", "the entry has no path — nothing wrote a document");
  assert.equal(q[0].corrections[0].target, "the worklist chapter");
  assert.equal(q[0].corrections[0].for, "sv");
  ok("a correction with no document behind it creates its own entry and survives the read (c46)");
}
{
  // JOINING — the write dial refuses a document enqueued inside its window, so the entry a
  // correction wants may already be there and may be the only one it ever gets.
  reset();
  nudges.enqueueAudit({ path: "/repo/RFCs/RFC-9.md", project: "sv", now: 4000 });
  const r = nudges.submitCorrection({ project: "sv", path: "/repo/RFCs/RFC-9.md", by: "manager", for: "bu", text: "the spec no longer pays for the sentence", now: 5000 });
  assert.equal(r.ok, true);
  assert.equal(r.joined, true);
  const q = nudges.readAuditQueue();
  assert.equal(q.length, 1, "it joined the standing entry rather than adding a second (c47)");
  assert.equal(q[0].at, 4000, "…and the entry keeps its own stamp — joining is not re-enqueuing");
  assert.equal(q[0].corrections.length, 1);
  const two = nudges.submitCorrection({ project: "sv", path: "/repo/RFCs/RFC-9.md", by: "manager", for: "bu", text: "and the account omits the hole", now: 5000 });
  assert.equal(two.ok, true);
  const ids = nudges.readAuditQueue()[0].corrections.map((c) => c.id);
  assert.equal(ids.length, 2, "a second correction joins the same entry");
  assert.equal(new Set(ids).size, 2, "…with its own address, even submitted in the same millisecond (c45)");
  ok("a correction joins the entry already standing for its document, each with its own id");
}
{
  // THE READ, from the other side of the same file — and it is a READ (c58).
  reset();
  nudges.submitCorrection({ project: "sv", by: "manager", for: "bu", text: "yours", now: 1 });
  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "mine", now: 2 });
  nudges.submitCorrection({ project: "sv", by: "manager", for: "bu", text: "yours too", now: 3 });
  const mine = nudges.correctionsFor("bu");
  assert.equal(mine.length, 2, "two of the three are addressed to bu");
  assert.deepEqual(mine.map((c) => c.text), ["yours", "yours too"]);
  assert.ok(mine.every((c) => c.project === "sv"), "each carries the entry's project back with it");
  assert.deepEqual(nudges.correctionsFor("nobody"), [], "an agent with none gets none");
  assert.deepEqual(nudges.correctionsFor(""), [], "and a nameless ask gets nothing rather than everything");
  const before = fs.readFileSync(QUEUE, "utf8");
  nudges.correctionsFor("bu"); nudges.correctionsFor("sv");
  assert.equal(fs.readFileSync(QUEUE, "utf8"), before, "reading changed the file not one byte (c58)");
  ok("an agent gets the corrections addressed to it and no others, and looking never writes (c54, c58)");
}
{
  // CLEARING IS NOT THE OWNER'S — the principle, as a refusal rather than a rule in a document.
  reset();
  const made = nudges.submitCorrection({ project: "sv", by: "manager", for: "bu", text: "fix the thing", now: 1 });
  const id = made.correction.id;
  const self = nudges.clearCorrection({ id, by: "bu" });
  assert.equal(self.ok, false, "the agent it is for cannot clear it (c48)");
  assert.ok(self.reason.includes("bu"), "…and the refusal names who owes it");
  assert.equal(nudges.correctionsFor("bu").length, 1, "and the correction is still standing");
  assert.equal(nudges.clearCorrection({ id: "nope", by: "manager" }).ok, false, "an id nothing matches is refused");
  assert.equal(nudges.clearCorrection({ id, by: "" }).ok, false, "clearing unsigned is refused");
  const done = nudges.clearCorrection({ id, by: "manager" });
  assert.equal(done.ok, true, "somebody who is not the owner clears it");
  assert.deepEqual(nudges.correctionsFor("bu"), [], "it is gone from the queue (c52)");
  // AND THE PATHLESS ENTRY GOES WITH IT. It existed only to carry that correction — no document
  // behind it, nothing for a drain to read — so with the last one cleared there is nothing left
  // for it to be. An entry with a path would stay and wait for its drain; this one is finished.
  assert.deepEqual(nudges.readAuditQueue(), [], "the entry that existed only to carry it is gone too");

  // A PATHED ENTRY SURVIVES ITS LAST CORRECTION and drops the field rather than keeping an empty
  // list — it still has a document the drain has not checked.
  reset();
  nudges.enqueueAudit({ path: "/repo/RFCs/RFC-7.md", project: "sv", now: 10 });
  const onDoc = nudges.submitCorrection({ project: "sv", path: "/repo/RFCs/RFC-7.md", by: "manager", for: "bu", text: "x", now: 11 });
  assert.equal(nudges.clearCorrection({ id: onDoc.correction.id, by: "manager" }).ok, true);
  assert.deepEqual(nudges.readAuditQueue(), [{ project: "sv", path: "/repo/RFCs/RFC-7.md", at: 10 }],
    "the entry is back to exactly the shape the shell writes — no empty corrections array left behind");
  ok("a correction is cleared by somebody other than its owner; the entry keeps only what it still has reason to be (c51, c52)");
}
{
  // CORRECTED IS OUT — the inversion. Checked is no longer enough.
  reset();
  // THESE PATHS ARE FICTIONAL, so the gone-document escape below would fire on every one of them.
  // `here` is what says "the document is still on disk" — the ordinary case this block is about.
  const here = () => true;
  nudges.enqueueAudit({ path: "/repo/RFCs/RFC-9.md", project: "sv", now: 4000 });
  const held = nudges.removeEntry({ project: "sv", path: "/repo/RFCs/RFC-9.md", at: 4000, exists: here });
  assert.equal(held.ok, true, "with nothing owed, the entry leaves exactly as the drain takes it today (c50)");
  assert.deepEqual(nudges.readAuditQueue(), []);

  nudges.enqueueAudit({ path: "/repo/RFCs/RFC-8.md", project: "sv", now: 6000 });
  const made = nudges.submitCorrection({ project: "sv", path: "/repo/RFCs/RFC-8.md", by: "manager", for: "bu", text: "not supported by the work", now: 6500 });
  const refused = nudges.removeEntry({ project: "sv", path: "/repo/RFCs/RFC-8.md", at: 6000, exists: here });
  assert.equal(refused.ok, false, "an entry holding an open correction REFUSES to leave (c49)");
  assert.ok(/open correction/.test(refused.reason), "…and says why, in words");
  assert.ok(/\b1 open correction\b/.test(refused.reason), "…and the refusal carries the COUNT, not just the phrase");
  assert.equal(nudges.readAuditQueue().length, 1, "and it is still standing");
  assert.equal(nudges.removeEntry({ project: "sv", path: "/nope.md", at: 1, exists: here }).ok, false, "an entry nothing matches is refused");

  nudges.clearCorrection({ id: made.correction.id, by: "manager" });
  assert.equal(nudges.removeEntry({ project: "sv", path: "/repo/RFCs/RFC-8.md", at: 6000, exists: here }).ok, true,
    "cleared, the entry is free to leave (c52)");
  assert.deepEqual(nudges.readAuditQueue(), [], "the queue finally empties — on repair, not on attention");
  ok("an entry holding a correction refuses to leave; cleared, it goes — the queue measures repair (c49, c50, c52)");
}
{
  // THE 3AM RULE OUTRANKS THE HOLD — §2.8's own bound, which was prose and nothing else until a
  // blind pass asked what happens to a correction on a document that no longer exists. Holding it
  // forever is exactly the silt the rule was written against: an immortal row nobody can act on,
  // because the document can never be re-audited and the correction can never be answered.
  reset();
  const here = () => true;
  const gone = () => false;
  nudges.enqueueAudit({ path: "/repo/RFCs/DELETED.md", project: "sv", now: 100 });
  const made = nudges.submitCorrection({ project: "sv", path: "/repo/RFCs/DELETED.md", by: "manager", for: "bu", text: "unanswerable now", now: 150 });
  assert.equal(nudges.removeEntry({ project: "sv", path: "/repo/RFCs/DELETED.md", at: 100, exists: here }).ok, false,
    "while the document is there, the hold stands");
  const swept = nudges.removeEntry({ project: "sv", path: "/repo/RFCs/DELETED.md", at: 100, exists: gone });
  assert.equal(swept.ok, true, "with the document gone, the entry leaves WITH its corrections");
  assert.equal(swept.gone, true, "…and says that is why");
  assert.equal(swept.carried, 1, "…and says what it took with it, so the pass account can name them");
  assert.deepEqual(nudges.readAuditQueue(), [], "no immortal row");

  // AND IT CANNOT REACH A PATHLESS ENTRY. A correction about a practice has nothing on disk for
  // its existence to be a fact about, so the hold there is absolute — otherwise every submitted
  // correction with no document behind it would be swept the moment anybody drained the queue.
  reset();
  nudges.submitCorrection({ project: "sv", by: "manager", for: "bu", target: "the handbook", text: "still owed", now: 200 });
  const entry = nudges.readAuditQueue()[0];
  const tried = nudges.removeEntry({ project: "sv", path: "", at: entry.at, exists: gone });
  assert.equal(tried.ok, false, "a pathless entry is never swept by the gone-document escape");
  assert.ok(/open correction/.test(tried.reason), "…it refuses for the ordinary reason");
  assert.equal(nudges.readAuditQueue().length, 1, "and it stands");
  ok("a gone document takes its corrections with it and says so; a pathless entry never can (§2.8's 3am bound)");
}
{
  // THE RE-READ (c44). A door must compute its write against what is on disk NOW, not against a
  // list read earlier — the whole-file replace is last-writer-wins, and corrections give this file
  // as many writers as there are agents. Simulated by writing underneath a stale snapshot.
  reset();
  const stale = nudges.readAuditQueue();                       // a snapshot, taken early
  assert.deepEqual(stale, []);
  nudges.enqueueAudit({ path: "/repo/RFCs/OTHER.md", project: "bu", now: 100 }); // somebody else writes
  nudges.submitCorrection({ project: "sv", by: "manager", for: "bu", text: "mine", now: 200 });
  const q = nudges.readAuditQueue();
  assert.equal(q.length, 2, "the other writer's entry SURVIVED a door that opened before it existed");
  assert.ok(q.some((e) => e.path === "/repo/RFCs/OTHER.md"), "…by name");
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  for (const fn of ["submitCorrection", "clearCorrection", "removeEntry", "enqueueAudit"]) {
    const body = new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`).exec(src);
    assert.ok(body && /mutateQueue\(/.test(body[0]), `${fn} writes through mutateQueue — never writeAuditQueue on a stale list`);
  }
  const m = /function mutateQueue\([\s\S]*?\n\}/.exec(src);
  assert.ok(m && /const fresh = readAuditQueue\(\)/.test(m[0]), "and mutateQueue re-reads immediately before handing the mutator the list");
  ok("every write re-reads and re-applies — a door that opened before another writer does not erase it (c44)");
}

// ---- 15. THE BOUND, AND THE DOOR'S WIRING — RFC-078 §2.8, slices 3.9/3.10 ----------------------
// §2.2 already ruled that a derived violation is never queued: it is re-derived at every dial, so
// it vanishes the moment the work is fixed and there is nothing to store. What that protects is
// not tidiness — it is ONE VIOLATION ARRIVING ONCE. A derived violation that also became a
// correction would reach its agent twice, by two routes, with no relation between the copies.
{
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const fn of ["judgeWrite", "judgeDocument", "judgeRuns", "judgeProject"]) {
    const body = new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`).exec(bare);
    assert.ok(body, `${fn} is in the module`);
    assert.ok(!/submitCorrection/.test(body[0]),
      `${fn} never submits a correction — a derived violation reaches its agent once, as a steer (c48)`);
  }
  // AND THE DOOR DOES NOT DERIVE EITHER, which is the same bound from the other side: nothing in
  // the corrections face asks a judge for anything, so a correction is always something somebody
  // judged and never something a dial produced.
  const door = fs.readFileSync(new URL("../electron/agents/corrections.cjs", import.meta.url), "utf8");
  // CALLS, not the word — "a finding you judged" is prose in the tool's own description and is
  // exactly the distinction this bound is about: a correction is something somebody judged, never
  // something a dial derived.
  for (const judge of ["judgeWrite", "judgeDocument", "judgeRuns", "judgeProject", "forFile", "forProject"])
    assert.ok(!new RegExp(`${judge}\\s*\\(`).test(door), `the corrections door never calls ${judge}`);
  ok("no derivation path submits a correction and no correction path derives — one violation, one route (c48)");
}
{
  // THE REFUSAL IS SAID. A door that refuses and returns is a door whose refusal an agent can drop
  // on the floor: the call failed, nothing was written, and the only trace is a return value
  // nobody re-reads. Same shape and same reason as the dropped steer.
  reset();
  const said = [];
  const tools = corrections.toolsFor({ slot: "manager", projectCode: "sv", onRefused: (r) => said.push(r) });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ["clear", "drop", "mine", "submit"], "four verbs, named");

  const bad = await byName.submit.handler({ text: "something", for: "" }, {});
  assert.ok(/refused/.test(bad.content[0].text), "the refusal comes back to the calling turn");
  assert.equal(said.length, 1, "…AND it was said into the session");
  assert.equal(said[0].verb, "submit");
  assert.ok(said[0].reason.length > 10, "with the reason, in words");

  const good = await byName.submit.handler({ for: "bu", text: "the note does not support the mark", target: "a practice" }, {});
  const id = JSON.parse(good.content[0].text).id;
  assert.ok(id, "a good submit comes back with the correction's address");
  assert.equal(said.length, 1, "and nothing was said — only refusals are");

  const selfClear = corrections.toolsFor({ slot: "bu", projectCode: "bu", onRefused: (r) => said.push(r) })
    .find((t) => t.name === "clear");
  const no = await selfClear.handler({ id }, {});
  assert.ok(/refused/.test(no.content[0].text), "the owner clearing its own is refused at the door too");
  assert.equal(said.length, 2, "…and that refusal was said as well");

  const mine = await corrections.toolsFor({ slot: "bu" }).find((t) => t.name === "mine").handler({}, {});
  assert.ok(/does not support/.test(mine.content[0].text), "bu reads its own correction back");
  const none = await corrections.toolsFor({ slot: "nobody" }).find((t) => t.name === "mine").handler({}, {});
  assert.ok(/nothing is owed/.test(none.content[0].text), "an agent owing nothing is told so in words, not with an empty list");
  ok("every refusal reaches the agent's chat as well as its turn; an empty owing says so in words");
}
{
  // WHAT THE DOOR SAYS ABOUT WHAT IT DID. One defect class, found three times in one night: a verb
  // composes an advisory into its answer, the MCP door hand-picks fields off that answer, and the
  // advisory dies one inch from the agent that needed it. The mark tool lost `noteNotWritten`;
  // submit mis-stated `joined`; drop threw away `gone` and `carried`. Each one is silent, each one
  // leaves the caller believing something false about a write that already happened — so the
  // ANSWER is asserted here, not just the effect on the file.
  reset();
  const tools = corrections.toolsFor({ slot: "manager", projectCode: "sv" });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const read = (r) => JSON.parse(r.content[0].text);

  // JOINED MEANS AN ENTRY WAS STANDING (c47). A path matching nothing MAKES its own entry, and
  // reporting that as a join tells the submitter its document was already under audit when it was
  // not — which is exactly backwards for an auditor deciding whether anyone has looked.
  const fresh = path.join(scratch, "fresh-document.md");
  fs.writeFileSync(fresh, "::rfc{id=RFC-0}\n");
  const first = read(await byName.submit.handler({ for: "bu", text: "the first", path: fresh }, {}));
  assert.equal(first.joined, false, "a path no entry matches MAKES one — that is not a join");
  const second = read(await byName.submit.handler({ for: "bu", text: "the second", path: fresh }, {}));
  assert.equal(second.joined, true, "…and the next correction on that path joins the entry now standing");
  assert.equal(nudges.readAuditQueue().filter((e) => e.path === fresh).length, 1, "one entry, two corrections");
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  assert.ok(!/joined: !!String\(p/.test(src), "`joined` is not computed from whether a path was passed");

  // THE GONE-DOCUMENT ESCAPE REACHES THE CALLER (c64). removeEntry's own comment promises "the
  // answer says what it carried so the drain's account can name them" — and the door was picking
  // two fields off it, so a removal that took open corrections with it was indistinguishable from
  // an ordinary checked one. The drain cannot name what it was never told.
  const standing = nudges.readAuditQueue().find((e) => e.path === fresh);
  fs.rmSync(fresh);
  const gone = read(await byName.drop.handler({ project: "sv", path: fresh, at: standing.at }, {}));
  assert.equal(gone.ok, true, "a gone document's entry leaves even while holding corrections");
  assert.equal(gone.gone, true, "…and the door SAYS it went by the escape, not by being checked");
  assert.equal(gone.carried, 2, "…naming how many open corrections it took with it");

  // AND THE ORDINARY REMOVAL CLAIMS NEITHER — `gone` is not a field that is always there.
  reset();
  const live = path.join(scratch, "a-document-that-stays.md");
  fs.writeFileSync(live, "::rfc{id=RFC-1}\n");
  nudges.enqueueAudit({ project: "sv", path: live, now: 5_000_000 });
  const checked = read(await byName.drop.handler({ project: "sv", path: live, at: 5_000_000 }, {}));
  assert.equal(checked.ok, true, "a checked entry with nothing owed leaves");
  assert.equal(checked.gone, undefined, "…and says nothing about a gone document, because there was none");
  ok("the door says which of the two things it did — joined or made, gone or checked (c47, c64)");
}
{
  // THE WIRING, read from source the way this file reads every other seam — the server is built,
  // it is handed to the session, and its refusal hook emits into the feed and the life log.
  const host = fs.readFileSync(new URL("../electron/agents/sessions.cjs", import.meta.url), "utf8");
  assert.ok(/require\("\.\/corrections\.cjs"\)/.test(host), "the host requires the door");
  assert.ok(/corrections\.serverFor\(\{/.test(host), "…builds its server");
  assert.ok(/\[corrections\.SERVER\]: correctionsServer/.test(host), "…and hands it to the session like every other one");
  const hook = /onRefused: \(\{ verb, reason \}\) => \{[\s\S]*?\n    \},/.exec(host);
  assert.ok(hook, "the refusal hook is wired");
  assert.ok(/emit\(s, \{ kind: "correction\.refused"/.test(hook[0]), "…emitting into this session's feed");
  assert.ok(/logLife\(s,/.test(hook[0]), "…and writing the life-log line beside it");
  assert.ok(/mcp__\(context\|corrections\|/.test(host), "and its tools are recognised as harness tools");
  ok("the corrections door is wired into the session, and its refusals ride the feed the dropped steer rides");
}

// ---- 16. THE QUEUE FIRES — RFC-078 §2.8, slice 3.12 --------------------------------------------
// What makes it a queue and not a list. The correction rides the write-time clock §2.3 already
// runs: a session writes a registered document, the clock steers that session, and if that
// session's agent owes anything the steer carries it. The clock reaches the session that WROTE and
// no other — exactly wrong for delivering somebody else's finding, exactly right for telling an
// agent what it owes, because that agent IS the session in the room.
const owedSteer = (out) => out.find((o) => o.nudge === "open-corrections");
{
  seedRecord(); reset(); nudges.__resetFired();
  ANSWER = { ok: true, violations: [] };
  assert.equal(owedSteer(await dial()), undefined, "an agent owing nothing is not steered");

  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", target: "the handbook", text: "no worklist chapter exists", now: 10 });
  nudges.__resetFired();
  const st = owedSteer(await dial());
  assert.ok(st, "with one correction open, the agent's own next document write carries it (c53)");
  assert.ok(/1 open correction\b/.test(st.text), "the steer says how many");
  assert.ok(/no worklist chapter exists/.test(st.text), "…and the correction's own words");
  assert.ok(/about the handbook/.test(st.text), "…and what it is about");
  assert.ok(/manager/.test(st.text), "…and who wrote it");
  assert.equal(st.slot, "sv", "it carries the slot, because delivery re-derives whether THIS agent still owes");
  ok("an agent with an open correction is steered about it on its own next write (c53)");
}
{
  // SOMEBODY ELSE'S CORRECTION IS NOT YOURS. The filter is `for`, not the project the entry sits in.
  seedRecord(); reset(); nudges.__resetFired();
  nudges.submitCorrection({ project: "sv", by: "manager", for: "bu", text: "theirs", now: 10 });
  assert.equal(owedSteer(await dial()), undefined, "a correction addressed to another agent never steers this one");
  ok("the steer is addressed by `for` — an agent is never told about work it does not owe");
}
{
  // SWITCHED OFF, THE MOMENT PASSES IN SILENCE (c55) — the record is the authority, as for every
  // other nudge in this document. This is the obedience half, and it is the one a previous pass
  // over this RFC claimed control of and never claimed obedience to.
  seedRecord(); reset(); nudges.__resetFired();
  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "fix it", now: 10 });
  assert.ok(owedSteer(await dial()), "armed, it fires");
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(list, "open-corrections").on = false;
  writeRecord(list);
  nudges.__resetFired();
  assert.equal(owedSteer(await dial()), undefined, "switched off, the moment passes in silence (c55)");
  ok("the correction nudge obeys its own switch — off is silence, not a quieter message (c55)");
}
{
  // SCOPE IS HONOURED (c56): named slots hear it, everyone else does not.
  seedRecord(); reset(); nudges.__resetFired();
  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "fix it", now: 10 });
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(list, "open-corrections").scope = ["bu", "agentci"];
  writeRecord(list);
  nudges.__resetFired();
  assert.equal(owedSteer(await dial()), undefined, "an agent outside the scope is never steered about one (c56)");
  row(list, "open-corrections").scope = ["bu", "sv"];
  writeRecord(list);
  nudges.__resetFired();
  assert.ok(owedSteer(await dial()), "…and a slot inside it is");
  ok("the correction nudge honours a slot-list scope like every other nudge (c56)");
}
{
  // IT HAS WORDS OF ITS OWN (c57). messageOf returns "" for a name with no authored message and no
  // built-in line, and the clock then drops the steer outright — "nothing to say is not a
  // delivery". A nudge shipped without a built-in line is on, in scope, undebounced and silent,
  // which is a failure mode with no symptom anywhere.
  seedRecord(); reset(); nudges.__resetFired();
  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "fix it", now: 10 });
  const seeded = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  assert.equal(row(seeded, "open-corrections").message, "", "the record seeds it WORDLESS — his to write");
  assert.ok(nudges.messageOf("open-corrections", nudges.entries()).length > 20,
    "…and it still has something to say, from BUILT_IN (c57)");
  assert.ok(owedSteer(await dial()), "so it fires with no authored message at all");
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(list, "open-corrections").message = "go and read your corrections";
  writeRecord(list);
  nudges.__resetFired();
  assert.ok(/go and read your corrections/.test(owedSteer(await dial()).text), "his words win while written (c1)");
  ok("the correction nudge is never silent for having nothing to say — the built-in line is why (c57)");
}
{
  // DELIVERY RE-DERIVES WHAT IT IS ABOUT, which is not a document violation. Asking the judges
  // about this nudge would find nothing and drop it every time; what it re-reads is whether the
  // agent still owes anything, so a correction cleared between derivation and delivery is not
  // announced — the same honesty the fixed-violation drop was built for.
  seedRecord(); reset(); nudges.__resetFired();
  const made = nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "fix it", now: 10 });
  const st = owedSteer(await dial());
  assert.ok(st, "derived");
  nudges.clearCorrection({ id: made.correction.id, by: "manager" });
  assert.equal(await nudges.confirmSteer(st, { session: "session:sv:1" }), false,
    "cleared before the turn came round, it is DROPPED rather than announced");
  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "and another", now: 20 });
  nudges.__resetFired();
  assert.equal(await nudges.confirmSteer(st, { session: "session:sv:1" }), true, "still owed, it is delivered");
  ok("a correction steer re-derives whether the agent still owes — not whether the document still violates");
}

// ---- 17. THE TWO BOUNDARIES — RFC-078 §2.8, c61 and c62 ----------------------------------------
{
  // THE SHELL STILL NEVER LEARNS WHAT A BLOCK IS (§1's boundary, c61). enqueueAudit gates on "a
  // write to a registered document" and nothing inside the file. Corrections put claim addresses
  // INTO the file the shell writes, and this amendment is the first thing to put structured
  // content anywhere near that line — so the append has to stay incurious about it.
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  const eq = /function enqueueAudit\([\s\S]*?\n\}/.exec(src);
  assert.ok(eq, "enqueueAudit is in the module");
  for (const word of ["target", "corrections", "\\.for\\b", "\\.text\\b"])
    assert.ok(!new RegExp(word).test(eq[0]), `the append never reads a correction's ${word.replace(/\\[bB.]/g, "")}`);
  // And it demonstrably does not: an entry appended beside a correction leaves it untouched.
  reset();
  nudges.submitCorrection({ project: "sv", path: "/repo/RFCs/RFC-9.md", by: "manager", for: "bu", target: "RFCs/RFC-9.md#c1", text: "words", now: 1 });
  nudges.enqueueAudit({ path: "/repo/RFCs/OTHER.md", project: "sv", now: 20 * 60000 });
  const [held] = nudges.readAuditQueue().filter((e) => e.corrections);
  assert.equal(held.corrections[0].target, "RFCs/RFC-9.md#c1", "a correction's target survives the shell appending beside it, unread");
  ok("the shell appends an entry without ever reading a correction's target — §1's boundary holds (c61)");
}
{
  // THE QUEUE IS NOT A SECOND STORE OF DOCUMENT STATE (c62). The work-audit job is emphatic that a
  // finding lands on the document and never in a side file, "because the document is the state";
  // on its face, writing findings into a JSON file is exactly that. The resolution is that the two
  // hold DIFFERENT FACTS — the claim carries the finding, the queue carries the obligation — and
  // what makes it true rather than a sentence is that nothing in this path can write a document.
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  const door = fs.readFileSync(new URL("../electron/agents/corrections.cjs", import.meta.url), "utf8");
  for (const [where, text] of [["the queue module", src], ["the corrections door", door]])
    for (const writer of ["writeAttr", "markBlock", "announceDocument", "writeFile"])
      assert.ok(!new RegExp(`${writer}\\s*\\(`).test(text), `${where} never calls ${writer} — it cannot write a document's state`);

  // AND A CORRECTION CARRIES NO CLAIM STATE. The normalizer is the whole vocabulary: id, at, by,
  // for, target, text. A `state` or `met` on it would be the document's answer living here too.
  reset();
  nudges.submitCorrection({ project: "sv", by: "manager", for: "bu", text: "x", now: 1, state: "unmet", met: true });
  const c = nudges.readAuditQueue()[0].corrections[0];
  assert.deepEqual(Object.keys(c).sort(), ["at", "by", "for", "id", "target", "text"],
    "a correction is who, whom, about what and in what words — never a claim's state");
  assert.equal(c.state, undefined, "a state passed in is not carried");
  assert.equal(c.met, undefined, "and neither is a verdict");
  ok("the queue holds who owes what and never a document's state — two facts, two homes (c62)");
}

// ---- 18. WHAT THE FIRST WALK'S BLIND PASS FOUND MISSING — RFC-078 §2.8 -------------------------
// Every check here exists because a second opinion over the twenty-one marks named a clause the
// evidence did not actually pay for. They are grouped rather than scattered so the reason they
// exist stays legible.
{
  // c45's LOAD-BEARING CLAUSE: "clearing one never takes another with it." Every clearCorrection
  // in this file until now cleared from an entry holding exactly one correction, so the isolation
  // the sentence promises was asserted nowhere — the code would have passed, which is not the same
  // as the claim being checked.
  reset();
  const a = nudges.submitCorrection({ project: "sv", path: "/x.md", by: "manager", for: "bu", text: "first", now: 1 });
  const b = nudges.submitCorrection({ project: "sv", path: "/x.md", by: "manager", for: "bu", text: "second", now: 1 });
  const c = nudges.submitCorrection({ project: "sv", path: "/x.md", by: "manager", for: "sv", text: "third", now: 1 });
  assert.equal(new Set([a, b, c].map((r) => r.correction.id)).size, 3, "three on one entry, three addresses");
  assert.equal(nudges.clearCorrection({ id: b.correction.id, by: "manager" }).ok, true);
  const left = nudges.readAuditQueue()[0].corrections;
  assert.equal(left.length, 2, "clearing one took exactly one");
  assert.deepEqual(left.map((x) => x.text).sort(), ["first", "third"], "…and the other two are untouched, by name");
  assert.ok(left.every((x) => x.id !== b.correction.id), "the cleared one is the one that went");
  ok("several corrections on one entry are independently addressable — clearing one leaves the others (c45)");
}
{
  // c49's THIRD CLAUSE: "the refusal reaches the agent's chat." The door test covered submit and
  // clear; `drop` was routed through the same helper and checked by nothing, which is the
  // one-verb-generally failure. Every refusing verb is now exercised THROUGH the door.
  reset();
  const said = [];
  const tools = corrections.toolsFor({ slot: "manager", projectCode: "sv", onRefused: (r) => said.push(r) });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  // A REAL FILE, because the door reaches the real filesystem: a fictional path is a GONE document
  // and the 3am escape would sweep the entry rather than hold it. That the escape fires here at all
  // is the §2.8 bound working — this block is about the ordinary case, so it needs a document.
  const held = path.join(scratch, "HELD.md");
  fs.writeFileSync(held, "# held\n");
  nudges.enqueueAudit({ path: held, project: "sv", now: 500 });
  await byName.submit.handler({ for: "bu", text: "held", path: held }, {});
  const no = await byName.drop.handler({ path: held, at: 500 }, {});
  assert.ok(/refused/.test(no.content[0].text), "drop is refused while a correction stands");
  assert.deepEqual(said.map((x) => x.verb), ["drop"], "…and THAT refusal reached the session, named by its own verb (c49)");
  assert.ok(/open correction/.test(said[0].reason), "with the reason, in words");
  // AND THE UNIVERSAL, which no single verb's claim can carry: every verb that can refuse routes
  // its refusal through the same hook. A fifth verb added without it breaks nothing visible, so
  // the guard is structural — and it matches the CALL, never one expression shape, because a verb
  // that grows a second branch and moves its refusal off the ternary has not stopped refusing.
  const door = fs.readFileSync(new URL("../electron/agents/corrections.cjs", import.meta.url), "utf8");
  const calls = [...door.matchAll(/(.{0,12})refused\("(\w+)", r\)/g)];
  const refusing = [...new Set(calls.map((m) => m[2]))].sort();
  assert.deepEqual(refusing, ["clear", "drop", "submit"], "every verb that can refuse hands its refusal to the hook — all three, by name");
  for (const m of calls)
    assert.ok(/return |\? |: /.test(m[1]), `…and ${m[2]}'s refusal is RETURNED, not computed and dropped`);
  ok("every refusing verb says so in the session, drop included — the universal, not one verb generally (c42, c49, c51)");
}
{
  // c48's BOUND, derived rather than hardcoded. The first version looped over four judge names
  // written out by hand, so a FIFTH judge that submitted a correction would have left it green.
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  const derivation = [...src.matchAll(/(?:async )?function (judge\w+)\(/g)].map((m) => m[1]);
  assert.ok(derivation.length >= 4, `every judge* function in the module is checked — found ${derivation.join(", ")}`);
  for (const fn of derivation) {
    const body = new RegExp(`(?:async )?function ${fn}\\([\\s\\S]*?\\n\\}`).exec(src);
    assert.ok(body && !/submitCorrection/.test(body[0]), `${fn} never submits a correction (c48)`);
  }
  ok(`no derivation path submits a correction — every judge* in the module, found by reading rather than by a list (c48)`);
}
{
  // c62's GUARD WAS VACUOUS on one of its four names: `writeFile\s*\(` matches nothing anywhere in
  // autobot, while nudges.cjs calls fs.writeFileSync three times for the queue itself. A guard that
  // cannot fail is worse than no guard, because it reads as coverage. The honest structural
  // statement is that neither file can reach the markdown writer AT ALL.
  const src = fs.readFileSync(new URL("../electron/agents/nudges.cjs", import.meta.url), "utf8");
  const door = fs.readFileSync(new URL("../electron/agents/corrections.cjs", import.meta.url), "utf8");
  for (const [where, text] of [["the queue module", src], ["the corrections door", door]]) {
    for (const writer of ["writeAttr", "markBlock", "announceDocument"])
      assert.ok(!new RegExp(`${writer}\\s*\\(`).test(text), `${where} never calls ${writer}`);
    assert.ok(!/require\(["'][^"']*markdown\/write/.test(text), `${where} cannot even REACH the document writer`);
  }
  // And the queue's own fs writes go to the queue and nowhere else.
  const writes = [...src.matchAll(/fs\.writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
  assert.ok(writes.length > 0, "the module does write files — this is not a vacuous check");
  assert.ok(writes.every((t) => /tmp|f\b|file/i.test(t)), `every fs write targets the record or the queue: ${writes.join(" | ")}`);
  ok("neither the queue nor its door can write a document — asserted by reach, not by a name that matches nothing (c62)");
}
{
  // MISSING: THE DEBOUNCE, the third of the three things §2.8 says have to be true about the
  // nudge, and the unstated condition that made c53's sentence read broader than the mechanism.
  // Every corrections block above resets the stamp before dialling; this one deliberately does not.
  seedRecord(); reset(); nudges.__resetFired();
  ANSWER = { ok: true, violations: [] };
  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "fix it", now: 10 });
  const first = (await dial()).find((o) => o.nudge === "open-corrections");
  assert.ok(first, "the first write carries it");
  assert.ok(await nudges.confirmSteer(first, { session: "session:sv:1" }), "and delivery stamps the window");
  const second = (await dial()).find((o) => o.nudge === "open-corrections");
  assert.equal(second, undefined, "a second write to the same document inside the window is SILENT — one message per burst");
  const elsewhere = (await dial({ path: "/repo/RFCs/OTHER.md" })).find((o) => o.nudge === "open-corrections");
  assert.ok(elsewhere, "…and the window is per document, so a different one still carries it");
  const otherSession = (await dial({ session: "session:sv:2" })).find((o) => o.nudge === "open-corrections");
  assert.ok(otherSession, "…and per session, so another session has its own");
  ok("the correction nudge is throttled per nudge × document × session like every other — a burst earns one message");
}
{
  // MISSING: the nudge is EXCLUDED from arming the document judges, by name, and that exclusion
  // protects c41 — "switched off, the hub is not even dialled". One edit to a .some() predicate
  // voids it silently, so it is asserted rather than left to a comment.
  seedRecord(); reset(); nudges.__resetFired();
  const list = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  row(list, "behavioural-claim-cmd-only").on = false;
  writeRecord(list);
  nudges.submitCorrection({ project: "sv", by: "manager", for: "sv", text: "owed", now: 10 });
  CALLS.length = 0;
  nudges.__resetFired();
  const out = await dial();
  assert.equal(CALLS.length, 0, "with every write-clock JUDGE off, the document is not parsed — even though a correction is owed (c41)");
  assert.ok(out.find((o) => o.nudge === "open-corrections"), "…and the correction steer still fires, because it never needed the document");
  ok("the corrections nudge rides the write clock's moment without arming its parse — c41's guarantee survives");
}
{
  // MISSING: the identity a correction is submitted under is the CALLER's, not an argument. If an
  // agent could set `by`, "somebody other than the owner clears it" would mean nothing.
  reset();
  const mine = corrections.toolsFor({ slot: "manager", projectCode: "sv" }).find((t) => t.name === "submit");
  await mine.handler({ for: "bu", text: "signed by the door", by: "somebody-else", author: "nor-this" }, {});
  const [c] = nudges.correctionsFor("bu");
  assert.equal(c.by, "manager", "the door stamps the caller's own slot — `by` is not an argument it accepts");
  const door = fs.readFileSync(new URL("../electron/agents/corrections.cjs", import.meta.url), "utf8");
  assert.ok(/by: me,/.test(door), "…and it is wired that way, not merely ignored");
  ok("a correction is signed by whoever submitted it — no agent can forge another's name on one");
}
{
  // c60's ALTITUDE. The pane's suite fabricates {present, readable} fixtures, so the fact those
  // two are DISTINCT was asserted nowhere on the shell side: the handler could have been changed
  // to always say readable and the window would have said the reassuring thing, green.
  reset();
  const ok3 = nudges.queueAnswer({ read: () => "[]" });
  assert.equal(ok3.present, true); assert.equal(ok3.readable, true);
  // `readable` means WHAT WAS THERE PARSED. A file that is not there has no bytes to fail, so it
  // is absent and not unreadable — two different facts rather than one failure said twice, which
  // is the whole reason both fields exist.
  const missing = nudges.queueAnswer({ read: () => { const e = new Error("nope"); e.code = "ENOENT"; throw e; } });
  assert.equal(missing.present, false, "a file that is not there reports absent");
  assert.equal(missing.readable, true, "…and is NOT also called unreadable — nothing was there to fail to parse");
  const junk = nudges.queueAnswer({ read: () => "{ this is not json" });
  assert.equal(junk.present, true, "a file that exists reports present");
  assert.equal(junk.readable, false, "…and unreadable, which is the case the careful wording exists for");
  assert.notDeepEqual([junk.present, junk.readable], [missing.present, missing.readable],
    "the two failures are DISTINGUISHABLE — the whole point, since both yield zero rows");
  const host = fs.readFileSync(new URL("../electron/apps/files-host.cjs", import.meta.url), "utf8");
  assert.ok(/corrections:queue", \(\) => nudges\.queueAnswer\(\)/.test(host),
    "and the window's handler is that function, not a second copy of its logic");
  ok("absent, unreadable and empty are three different answers from the shell, and the window's door is this one (c60)");
}

console.log(`\n  ${asserts} assertions across ${pass} checks — the record gates, the judges are asked in-process, nothing crosses a wire`);
