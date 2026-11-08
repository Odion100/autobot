// THE NUDGE RECORD AND THE WRITE-TIME DIAL — RFC-078 §2.1 + §2.3, the shell half, proven.
//
// THE RULES UNDER TEST:
//   1. The record seeds itself on first read — the two §2.1 entries, exactly — and a half-edited
//      file is read field by field, never overwritten by the thing that failed to parse it.
//   2. The chaser's entry is identity/on/scope ONLY, and this module never touches nudge.json.
//   3. The gate's precedence: no entry → off; `on` must be literally true; "global" hits everyone;
//      a slot list hits those slots alone; any other string is a project code and hits it alone.
//   4. His words win while written; the built-in line arrives while the field stays empty.
//   5. The dial: markdown only, gated before the fetch, pointered after it, debounced per
//      nudge × document × session, deaf to sweep-clock nudges.
//   6. Degradation is law: a hub down, older (404), or answering junk means [] — never a crash.
//   7. The wiring (source-read, the house pattern tests/nudge.js set): emit() dials on
//      file.changed, delivery rides the chaser's own input-queue push, and the hub is only ever
//      dialled — no listener anywhere in the record module.
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

// NO LIVE HUB — the dial is stubbed the way tests/hub-skew.js stubs it. `ANSWER` is what the hub
// says; `CALLS` is every URL it was asked, so "the hub was not even dialled" is checkable.
let ANSWER = null;
let FAIL = null; // "down" | "404" | "bad-json" — the degradation dials
const CALLS = [];
global.fetch = async (url) => {
  CALLS.push(String(url));
  if (FAIL === "down") throw new Error("ECONNREFUSED");
  if (FAIL === "404") return { ok: false, status: 404, json: async () => ({}) };
  if (FAIL === "bad-json") return { ok: true, status: 200, json: async () => { throw new Error("unexpected token"); } };
  return { ok: true, status: 200, json: async () => ANSWER };
};

const nudges = require("../electron/agents/nudges.cjs");

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
const VIOLATION = { nudge: "behavioural-claim-cmd-only", path: "/repo/RFCs/RFC-9.md", line: 12, project: "sv", detail: "c3 holds a :::cmd and no spec" };

// ---- 1. THE SEED ------------------------------------------------------------------------------
{
  assert.ok(!fs.existsSync(RECORD), "scratch starts with no record");
  const list = nudges.entries();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "run-chaser");
  assert.equal(list[1].name, "behavioural-claim-cmd-only");
  assert.ok(fs.existsSync(RECORD), "the first read wrote the seed to disk");
  const onDisk = JSON.parse(fs.readFileSync(RECORD, "utf8"));
  assert.deepEqual(Object.keys(onDisk[0]).sort(), ["clock", "message", "name", "on", "scope", "severity"],
    "the chaser's entry is identity, on/off and scope — none of its nudge.json knobs ride along (c4)");
  assert.equal(onDisk[1].debounceMin, 10);
  assert.equal(onDisk[1].clock, "write");
  ok("an absent record seeds itself with the two §2.1 entries, the chaser's carrying no chaser knobs");
}
{
  fs.writeFileSync(RECORD, "{ this is not json");
  const list = nudges.entries();
  assert.equal(list.length, 2, "an unreadable record answers as the seed in memory");
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
  assert.ok(!/createServer|\.listen\(/.test(src), "no listener — the hub is only ever dialled, never dialled BY (c12)");
  ok("the record module cannot touch nudge.json and holds no door a hub could push through (c4, c12)");
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
  assert.ok(/\/systemview\/api\/judges\?path=%2Frepo%2FRFCs%2FRFC-9\.md$/.test(CALLS[0]),
    "the hub is asked at its judges door, path encoded — a GET dial, nothing pushed (c12)");
  ok("a violation on a write becomes one steering message carrying the law and the pointer");
}
{
  nudges.__resetFired();
  CALLS.length = 0;
  assert.deepEqual(await dial({ path: "/repo/src/thing.js" }), []);
  assert.equal(CALLS.length, 0, "a .js write never costs a dial");
  ok("only a markdown path — the only thing that can be a registered document — dials the hub");
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
  assert.equal(CALLS.length, 0, "with every write-nudge off, the moment passes without a dial");
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
  assert.equal(CALLS.length, 1, "the other project's write never even dialled");
  list[1].scope = ["systemview-test"];
  writeRecord(list);
  nudges.__resetFired();
  assert.equal((await dial({ slot: "systemview-test" })).length, 1);
  assert.deepEqual(await dial({ slot: "sv", session: "session:sv:2" }), []);
  ok("scope gates the dial itself — a project hears alone (c2), listed slots hear alone (c34)");
}
{
  // THE DEBOUNCE (c10): a burst inside the window earns ONE message, per document, per session.
  seedRecord();
  nudges.__resetFired();
  ANSWER = { ok: true, violations: [VIOLATION] };
  assert.equal((await dial({ now: 1000000 })).length, 1);
  assert.equal((await dial({ now: 1000000 + 2 * 60000 })).length, 0, "two minutes later: inside the 10-minute window");
  assert.equal((await dial({ now: 1000000 + 9 * 60000 })).length, 0, "nine minutes later: still inside");
  assert.equal((await dial({ now: 1000000 + 11 * 60000 })).length, 1, "past the window, it may speak again");
  assert.equal((await dial({ now: 1000000 + 12 * 60000, session: "session:sv:other" })).length, 1,
    "a DIFFERENT session's write is its own bookkeeping row");
  ANSWER = { ok: true, violations: [{ ...VIOLATION, path: "/repo/RFCs/RFC-10.md" }] };
  assert.equal((await dial({ now: 1000000 + 12 * 60000, path: "/repo/RFCs/RFC-10.md" })).length, 1,
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
{
  seedRecord();
  for (const [mode, what] of [
    ["down", "a hub that is down"],
    ["404", "an older hub with no judges route"],
    ["bad-json", "a hub answering something that is not JSON"],
  ]) {
    nudges.__resetFired();
    FAIL = mode;
    assert.deepEqual(await dial(), [], what);
  }
  FAIL = null;
  for (const [answer, what] of [
    [{ ok: true }, "an answer with no violations key"],
    [{ ok: true, violations: "nope" }, "violations that are not a list"],
    [42, "a bare number"],
    [null, "a null body"],
  ]) {
    nudges.__resetFired();
    ANSWER = answer;
    assert.deepEqual(await dial(), [], what);
  }
  ok("down, older, or answering an unexpected shape: nothing fires and nothing crashes — absence reads as nothing to report");
}
{
  // THE BARE-LIST SHAPE is also accepted — the hub half may answer either spelling.
  nudges.__resetFired();
  ANSWER = [VIOLATION];
  assert.equal((await dial()).length, 1);
  ok("a hub answering the violations as a bare list is read the same");
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
  assert.ok(/s\.input\.push\(/.test(body) && /s\.nextTurnFromHook = true/.test(body),
    "delivery is the chaser's own ride — a user turn on the session's input queue, marked as no human's (c9)");
  assert.ok(/kind: "nudge\.steered"/.test(body), "…with a receipt in the feed, because nothing runs invisibly");
  assert.ok(!/for \(const \w+ of sessions/.test(body),
    "and it reaches ONLY the session the event was emitted into — no walk over other sessions (c9)");
  const chaser = /function maybeNudge\(s, quietMin\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(chaser && /nudge\.readSettings\(\)/.test(chaser[0]) && !/nudges\./.test(chaser[0]),
    "the chaser still reads its OWN settings file and never this record — its knobs are untouched (c4)");
  ok("the wiring: emit→dial on file.changed, identity from the session, delivery on the chaser's ride, chaser untouched");
}

console.log(`\n  ${asserts} assertions across ${pass} checks — the record gates, the dial asks, the hub is never a pusher`);
