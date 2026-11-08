// THE DOCUMENT JUDGES — RFC-078 §2.2, judged in the shell over the parse the shell already runs.
//
// ONE SUBJECT PER SUITE: this one is about whether the judges are RIGHT. Whether a violation then
// gets delivered — on, in scope, on this clock, outside its debounce window — is the record's
// gating and lives in tests/nudges.js, which injects a stub judge for exactly that reason.
//
// NOTHING IS STUBBED HERE. Every case writes a real markdown document to a scratch dir and runs the
// real parse and the real judges over it, because the whole subject is "does the parse's derived
// state produce the right verdict" — a faked block list would prove only that the fake was shaped
// the way the assertion expected.
//
// What it covers:
//   1. behavioural-claim-cmd-only — a cmd-only fold is reported; a run block, a test chip, an
//      experiential declaration and an EMPTY fold each silence it (the empty one for its own
//      reason: nothing in the fold is merely unproved, which the claims bar already says).
//   2. met-without-note — an agent's met mark with no statement is reported; the same mark with a
//      note, an unsigned (human) mark, and an unmarked claim are all silent.
//   3. The violation's shape — nudge, path, project, line — because the steering message is
//      composed from those fields and a wrong line sends the reader to the wrong claim.
//   4. forProject — the registry walk, deduped by path so a two-leaf document is judged once.
//   5. Degradation — an unreadable file and an unparseable one are empty, never a throw.
import rawAssert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const judges = require("../electron/markdown/judges.cjs");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "judges-suite-"));

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

// A one-claim document, written for real. `fold` is the claim's body — empty means a leaf claim,
// which is the case that must NOT be reported.
const doc = (name, { attrs = "", fold = "", label = "When the fixture is pressed, it answers" }) => {
  const abs = path.join(scratch, `${name}.md`);
  const body = fold
    ? `::::claim[${label}]{${attrs}}\n${fold}\n::::\n`
    : `::claim[${label}]{${attrs}}\n`;
  fs.writeFileSync(abs, `# ${name}\n\n${body}\n`);
  return abs;
};

const MET = 'id=f1 state=met by=fixture at=1 note="pressed it, it answered"';
const CMD = ":::cmd\necho pressed\n:::";
const RUN = ':::run{title="the spec"}\n- Math.add { "a": 1, "b": 2 }\n  - results.sum = 3\n:::';
const TEST = "::test[Test.Thing.method]{project=fixture}";
const SHOT = "::image{src=./shot.png}";

const names = (vs) => vs.map((v) => v.nudge).sort();

// ---- 1 · behavioural-claim-cmd-only ------------------------------------------------------------
{
  const vs = await judges.forFile(doc("cmd-only", { attrs: MET, fold: CMD }), { path: "cmd-only.md", project: "fx" });
  assert.deepEqual(names(vs), ["behavioural-claim-cmd-only"]);
  ok("a behavioural claim whose fold holds only a cmd is reported — evidence, never the spec");
}
{
  const vs = await judges.forFile(doc("with-run", { attrs: MET, fold: RUN }), { path: "with-run.md" });
  assert.deepEqual(vs, [], "a run block in the fold is a contract spec — silent");
  const vt = await judges.forFile(doc("with-test", { attrs: MET, fold: TEST }), { path: "with-test.md" });
  assert.deepEqual(vt, [], "a test chip is the same — silent");
  ok("give the claim a ::test or a :::run and the judge falls silent — both spellings");
}
{
  const vs = await judges.forFile(
    doc("experiential", { attrs: `id=f1 kind=experiential state=met by=fixture at=1 note="saw it"`, fold: CMD }),
    { path: "experiential.md" },
  );
  assert.deepEqual(vs, [], "declared experiential — the eye settles it, no spec owed");
  ok("an experiential claim is exempt by kind, cmd fold and all");
}
{
  // A SHOWN proof on a BEHAVIOURAL claim is still not a spec — the fold has evidence, so it is this
  // judge's case and not the empty-fold one.
  const vs = await judges.forFile(doc("shot-only", { attrs: MET, fold: SHOT }), { path: "shot-only.md" });
  assert.deepEqual(names(vs), ["behavioural-claim-cmd-only"]);
  ok("a behavioural claim proved only by a screenshot is reported too — shown is not a contract");
}
{
  // THE NARROWING, STATED: an EMPTY fold is not this judge's business. A leaf claim cannot carry a
  // proof at all, so it is unproved — which the claims bar already reports and the host already
  // refuses to count met. Reporting it here would nudge every unfinished claim in the system.
  const vs = await judges.forFile(doc("leaf", { attrs: MET }), { path: "leaf.md" });
  assert.deepEqual(vs, [], "a leaf claim with nothing in it is unproved, not cmd-only");
  ok("an empty fold is left to the claims bar — this judge is only for a fold that LOOKS settled");
}

// ---- 2 · met-without-note ----------------------------------------------------------------------
{
  const vs = await judges.forFile(
    doc("no-note", { attrs: "id=f1 state=met by=fixture at=1", fold: RUN }),
    { path: "no-note.md", project: "fx" },
  );
  assert.deepEqual(names(vs), ["met-without-note"]);
  ok("an agent's met mark carrying no statement is reported (c32)");
}
{
  const vs = await judges.forFile(doc("with-note", { attrs: MET, fold: RUN }), { path: "with-note.md" });
  assert.deepEqual(vs, [], "the same mark with its note — silent");
  const human = await judges.forFile(
    doc("human-press", { attrs: "id=f1 state=met at=1", fold: RUN }),
    { path: "human-press.md" },
  );
  assert.deepEqual(human, [], "no by= is a human's press — its own evidence, never nudged");
  const unmarked = await judges.forFile(doc("unmarked", { attrs: "id=f1", fold: RUN }), { path: "unmarked.md" });
  assert.deepEqual(unmarked, [], "an unmarked claim is not a violation of anything");
  ok("a note, a human's press, and an unmarked claim are each silent — the rule is an AGENT's word");
}

// ---- 3 · THE VIOLATION'S SHAPE -----------------------------------------------------------------
{
  // Composed into the steering message by nudges.cjs, so a wrong `line` sends the reader to the
  // wrong claim and a missing `path` makes the pointer useless.
  const abs = doc("shape", { attrs: MET, fold: CMD });
  const [v] = await judges.forFile(abs, { path: "RFCs/shape.md", project: "sv" });
  assert.equal(v.nudge, "behavioural-claim-cmd-only");
  assert.equal(v.path, "RFCs/shape.md", "the path is the one it was asked about, not the absolute");
  assert.equal(v.project, "sv");
  // The fixture writes `# name`, a blank, then the claim — line 3, 1-indexed.
  assert.equal(v.line, 3, "the claim's own line, so the reader is taken to the claim");
  assert.ok(/f1/.test(v.detail), "the detail names the claim id");
  ok("a violation carries nudge, path, project and the claim's LINE — the pointer the steer needs");
}

// ---- 4 · forProject — the registry walk --------------------------------------------------------
{
  const a = doc("proj-a", { attrs: MET, fold: CMD });
  const b = doc("proj-b", { attrs: "id=f1 state=met by=fixture at=1", fold: RUN });
  // A TWO-LEAF DOCUMENT IS TWO ROWS ON ONE FILE — judged once, or every violation arrives twice.
  const rows = [
    { path: "proj-a.md", project: "fx" },
    { path: "proj-a.md", project: "fx" },
    { path: "proj-b.md", project: "fx" },
    { path: "elsewhere.md", project: "other" },
  ];
  const stub = { read: () => rows, absPathOf: (r) => path.join(scratch, String(r.path)) };
  const vs = await judges.forProject("fx", { registry: stub });
  assert.deepEqual(names(vs), ["behavioural-claim-cmd-only", "met-without-note"]);
  assert.equal(vs.filter((v) => v.path === "proj-a.md").length, 1, "the duplicated row was judged ONCE");
  assert.ok(vs.every((v) => v.project === "fx"), "another project's rows are not in this answer");
  assert.deepEqual(await judges.forProject("", { registry: stub }), [], "no project code is no answer");
  assert.ok(a && b);
  ok("the sweep walks one project's registered documents, deduped by path, and nobody else's");
}

// ---- 5 · DEGRADATION ---------------------------------------------------------------------------
{
  assert.deepEqual(await judges.forFile(path.join(scratch, "nope.md"), {}), [], "a file that is not there");
  const junk = path.join(scratch, "junk.md");
  fs.writeFileSync(junk, "::::claim[unclosed fold\n:::cmd\necho\n");
  assert.deepEqual(await judges.forFile(junk, { path: "junk.md" }), [], "a document whose fences do not close");
  const broken = { read: () => { throw new Error("registry unreadable"); }, absPathOf: () => "" };
  assert.deepEqual(await judges.forProject("fx", { registry: broken }), [], "a registry that cannot be read");
  ok("unreadable, unparseable, or an unwalkable registry: empty, never a throw into a clock");
}

// ---- 6 · THE NAMES ARE THE CONTRACT ------------------------------------------------------------
{
  // nudges.cjs gates by NAME off the record, so a judge whose name drifts from its `nudges.json`
  // entry is a judge that silently stops being deliverable.
  assert.deepEqual(judges.names, ["behavioural-claim-cmd-only", "met-without-note"]);
  const seed = require("../electron/agents/nudges.cjs").SEED.map((e) => e.name);
  assert.ok(seed.includes("behavioural-claim-cmd-only"), "the first judge has its seed entry");
  ok("the judges' names match the record's — a name drift would make a judge undeliverable");
}

// ---- 7 · THE DERIVATION PATH OFFERS NO ESCALATION ---------------------------------------------
{
  // WHAT THIS DOES AND DOES NOT ESTABLISH, because the first version of it over-claimed and a
  // blind review caught that. RFC-078's c33 ("never does a document violation become a gap") is a
  // bound on the MANAGER's conduct — its implementation is a sentence in `job:work-audit`, and an
  // agent with Write can file a `::gap{}` document any time it decides to. No test over these
  // modules can establish that, because the manager does not use them. Delete that sentence from
  // the job document and the "never" dies with zero code change here.
  //
  // So this check is COVERAGE, not that proof: the derivation path neither performs nor assists an
  // escalation, and the violation it hands on carries no address outside the document's own
  // project. That is worth guarding on its own — an escalation added here would be the cheapest
  // possible route to breaking the bound — and it is NOT the claim.
  //
  // NOT COVERED, said out loud: `sessions.cjs` is the third module in the route (it delivers the
  // steer) and is not guarded here, because it legitimately contains the word in its registration
  // predicate `::(arc|rfc|report|gap){`. A substring guard over that file would be noise.
  const strip = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments too — a JSDoc mentioning gaps is not a gap path
      .replace(/\/\/[^\n]*/g, "")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``"); // and template strings, for the same reason
  for (const [name, rel] of [
    ["judges.cjs", "../electron/markdown/judges.cjs"],
    ["nudges.cjs", "../electron/agents/nudges.cjs"],
  ])
    assert.ok(
      !/gap/i.test(strip(fs.readFileSync(new URL(rel, import.meta.url), "utf8"))),
      `${name} has no gap path in its CODE — comments and template strings may say the word`,
    );

  // EVERY JUDGE, not one fixture's worth. The shape is the contract: five fields, and the only
  // project any of them names is the document's own — which is the honest statement. `project` IS
  // a repo name, so "it names no repo" would be false; what is true is that it names no OTHER one.
  const doc = path.join(scratch, "c33.md");
  fs.writeFileSync(doc, '::::claim[a behavioural claim with only a cmd behind it]{id=g1}\n:::cmd\necho hi\n:::\n::::\n::claim[a wordless met mark]{id=g2 state=met by=someone at=1}\n');
  const found = await judges.forFile(doc, { path: "c33.md", project: "fx" });
  assert.equal(found.length, judges.names.length, "both judges report on this document — the shape is checked for each");
  for (const v of found) {
    assert.deepEqual(Object.keys(v).sort(), ["detail", "line", "nudge", "path", "project"], `${v.nudge}: five fields`);
    assert.equal(v.project, "fx", `${v.nudge}: the only project named is the document's own`);
    assert.ok(v.detail.startsWith(`${v.nudge === "met-without-note" ? "g2" : "g1"} `),
      `${v.nudge}: even the prose opens with the claim's own id`);
  }
  ok("the derivation path offers no escalation: no gap path in either module's code, and every judge's violation names only the document's own project");
}

try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
console.log(`\n  ${asserts} assertions across ${pass} checks — the judges read the parse, in this process`);
