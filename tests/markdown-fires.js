// smoke:markdown-fires — RFC-073 §2.1/§3, THE PARSE IS THE FIRE.
//
// What this pins is the audience ladder (subscribe= > thread > members), the reply exception (the
// thread decides), the legacy members= read as subscribe=, and the receipt: told= covering the
// audience is silence, told= removed is a re-fire, and no audience anywhere is no fire and no error.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { scan, firesOf, splitList } = require("../electron/markdown/fires.cjs");
const { parse } = require("../electron/markdown/parse.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

const fires = async (doc) => firesOf(await parse(doc), doc);

console.log("the ladder — who hears a fire");
{
  const base = "::members{who=buapi|systemlynx}\n\n";

  let f = await fires(base + ':::approval{ask="Go?" verdict=approved}\nx\n:::');
  assert.deepStrictEqual(f[0].pending, []);
  assert.deepStrictEqual(f[0].held, ["buapi", "systemlynx"]);
  assert.deepStrictEqual(f[0].audience, ["buapi", "systemlynx"]);
  ok("no subscribe= → the members, both of them — HELD for his press, because a plain member is the human-gated path (c11 under the gate)");

  f = await fires('::members{who=buapi|systemlynx auto=buapi}\n\n' + ':::approval{ask="Go?" verdict=approved}\nx\n:::');
  assert.deepStrictEqual(f[0].pending, ["buapi"]);
  assert.deepStrictEqual(f[0].held, ["systemlynx"]);
  ok("auto= splits the fallback: the auto member is told the moment it fires, the plain member waits (the gate)");

  f = await fires(base + ':::approval{ask="Go?" subscribe=buapi verdict=approved}\nx\n:::');
  assert.deepStrictEqual(f[0].pending, ["buapi"]);
  assert.deepStrictEqual(f[0].held, []);
  ok("subscribe=buapi → buapi, immediately — an authored subscription is automatic by definition; systemlynx hears nothing (c12)");

  f = await fires(base + ':::approval{ask="Go?" subscribe=reviewer-x verdict=approved}\nx\n:::');
  assert.deepStrictEqual(f[0].pending, ["reviewer-x"]);
  ok("subscribe= may name a NON-member and they receive it (c13)");

  f = await fires(':::approval{ask="Go?" verdict=approved}\nx\n:::');
  assert.deepStrictEqual(f, []);
  ok("no members and no subscribe= → nobody, and nothing errors (c15)");

  f = await fires(base + "::claim[x works]{id=c1 state=met by=sv at=1 subscribe=buapi}");
  assert.deepStrictEqual(f[0].pending, ["buapi"]);
  assert.match(f[0].summary, /met/);
  ok("a marked ::claim{subscribe=} fires to its audience alone (c14)");

  // RFC-075 — a claim grown a proof is the SAME claim: the mark sits on the opening line of a
  // container now, and the fire reads it there, summary carrying the statement, not the proof.
  f = await fires(base + ':::claim[x works proven]{id=c2 state=met by=sv at=1 subscribe=buapi}\n:::cmd\ntrue\n:::\n:::');
  assert.deepStrictEqual(f[0].pending, ["buapi"]);
  assert.match(f[0].summary, /c2 met — x works proven/);
  ok("a CONTAINER claim fires exactly as a leaf — mark off the opening line, statement in the summary (RFC-075)");

  // RFC-075 round two — a declared reviewer ALWAYS hears the claim: reviewers= unions onto the
  // ladder's answer, so naming one is telling one. Here subscribe= would otherwise exclude them.
  f = await fires(base + "::claim[x]{id=c3 state=met by=sv at=1 subscribe=buapi reviewers=systemlynx}");
  assert.deepStrictEqual(f[0].audience.sort(), ["buapi", "systemlynx"]);
  assert.deepStrictEqual(f[0].pending.sort(), ["buapi", "systemlynx"]);
  ok("a claim's reviewers= joins its audience IMMEDIATELY — an obligation nobody is told about is not one, so it never waits on a press (RFC-075)");
}

console.log("\nthreads — the audience on the edge");
{
  const doc = [
    "::members{who=systemlynx|buapi}",
    "",
    "::::thread{id=t1 subscribe=buapi}",
    "::question[Which way?]{options=a|b answer=a}",
    "::::",
  ].join("\n");
  const f = await fires(doc);
  assert.deepStrictEqual(f[0].pending, ["buapi"]);
  ok("a question with no subscribe= inside a thread takes the THREAD's audience (c19)");

  const reply = [
    "::members{who=systemlynx|buapi}",
    "",
    "::::thread{id=t2 subscribe=buapi}",
    ":::reply{by=systemview subscribe=reviewer-x}",
    "I think a.",
    ":::",
    "::::",
  ].join("\n");
  const r = await fires(reply);
  assert.deepStrictEqual(r[0].pending, ["buapi"]);
  assert.strictEqual(r[0].thread, "t2");
  assert.match(r[0].summary, /replied in t2/);
  ok("a reply's own subscribe= is IGNORED — the thread decides who hears a reply (c20, c29)");

  const legacy = [
    "::members{who=systemlynx|buapi}",
    "",
    "::::thread{id=t3 members=buapi}",
    ':::approval{ask="Go?" verdict=approved}',
    "x",
    ":::",
    "::::",
  ].join("\n");
  const l = await fires(legacy);
  assert.deepStrictEqual(l[0].pending, ["buapi"]);
  ok("a thread still saying members= behaves as subscribe= — nobody lost their audience (c21)");

  const bare = [
    "::members{who=systemlynx|buapi}",
    "",
    "::::thread{id=t4}",
    ':::approval{ask="Go?" verdict=approved}',
    "x",
    ":::",
    "::::",
  ].join("\n");
  const b = await fires(bare);
  assert.deepStrictEqual(b[0].pending, []);
  assert.deepStrictEqual(b[0].held, ["systemlynx", "buapi"]);
  ok("a thread naming nobody inherits the document's members — and inherits the GATE with them (RFC-071, under the gate)");
}

console.log("\nthe receipt — told= is the only baseline");
{
  const base = "::members{who=buapi|systemlynx}\n\n";

  let f = await fires(base + ':::approval{ask="Go?" verdict=approved told=buapi|systemlynx}\nx\n:::');
  assert.deepStrictEqual(f, []);
  ok("told= covering the audience is silence — no second delivery, ever (c17, c31)");

  f = await fires(base + ':::approval{ask="Go?" verdict=approved told=buapi}\nx\n:::');
  assert.deepStrictEqual(f[0].pending, []);
  assert.deepStrictEqual(f[0].held, ["systemlynx"]);
  ok("a partial stamp holds exactly who is still owed it — told= is the one baseline, the lane does not change that (c30, c32)");

  f = await fires(base + ':::approval{ask="Go?" verdict=approved}\nx\n:::');
  assert.deepStrictEqual(f[0].held, ["buapi", "systemlynx"]);
  ok("hand-edit told= off and it is owed again — there is no other baseline (c18)");

  f = await fires(base + ':::approval{ask="Go?"}\nx\n:::\n\nA paragraph edit.\n');
  assert.deepStrictEqual(f, []);
  ok("an edit that answers nothing fires nothing (c16)");

  f = await fires(base + "::gap{id=G-12 resolved=2026-10-25}");
  assert.match(f[0].summary, /gap resolved — G-12/);
  assert.deepStrictEqual(f[0].held, ["buapi", "systemlynx"]);
  ok("a gap completing is a fire — `gap resolved — <id>` to whoever is on it, through the same gate (c29)");
}

console.log("\nscan — one parse, three answers");
{
  const r = await scan("/nowhere/never.md");
  assert.ok(!r.ok && /cannot read/.test(r.error));
  const s = await scan("x.md", "::rfc{id=RFC-9}\n\n::members{who=buapi}\n\n:::approval{ask=Go verdict=approved}\nx\n:::");
  assert.ok(s.ok && s.registration.id === "RFC-9" && s.fires.length === 1);
  ok("scan answers registration and fires off one parse, and an unreadable path is an error, not a throw");

  assert.deepStrictEqual(splitList('"a|b, c"'), ["a", "b", "c"]);
  ok("lists split on | and , with quotes stripped — the one list rule everywhere");
}

{
  // A COMMIT RECORD IS AN ACCOUNT, NOT A DECISION, so it must not wake anybody. Fifteen records
  // written into one report in an evening woke every member fifteen times, for work they already
  // knew about — his catch, with the threads untouched: "is this still sending you updates for no
  // reason?" What tells somebody the work landed is the objective reaching done, which fires.
  const doc = [
    "::members{who=a|b}",
    "",
    "::commit{sha=deadbee}",
    "",
    ":::approval{ask=\"ship it?\" verdict=approved}",
    "approving commits to the thing",
    ":::",
  ].join("\n");
  const names = (await fires(doc)).map((f) => f.name);
  assert.ok(!names.includes("commit"), "a recorded commit does not fire");
  assert.ok(names.includes("approval"), "and a verdict beside it still does");
  ok("a commit record is an account and wakes nobody; the decision beside it still does");
}

console.log(`\n${n} assertions held — the fire scan`);
