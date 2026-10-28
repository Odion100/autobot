// smoke:registry — RFC-073 §1.1, IDENTITY AND A POINTER, NOTHING ELSE.
//
// What this pins is the two rules that keep the registry honest: it never holds content, and the id
// is the identity — a moved document updates its row and is never a second one. And the one that
// makes it safe: delete the file, register again, and it is all back. Everything runs against temp
// files through the env overrides, so nothing here touches ~/.autobot.
import assert from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-registry-"));
process.env.AUTOBOT_DOCUMENTS = path.join(tmp, "documents.json");
process.env.AUTOBOT_PROJECTS = path.join(tmp, "projects.json");

const sv = path.join(tmp, "systemview");
const lanes = path.join(tmp, "systemview", "lanes", "a-lane"); // a project INSIDE another's folder
fs.mkdirSync(path.join(sv, "RFCs", "arcs"), { recursive: true });
fs.mkdirSync(path.join(sv, "docs", "designs"), { recursive: true });
fs.mkdirSync(lanes, { recursive: true });
fs.writeFileSync(process.env.AUTOBOT_PROJECTS, JSON.stringify({ systemview: sv, "a-lane": lanes }));

const reg = require("../electron/markdown/registry.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

console.log("upsert — the id is the identity");
{
  const a = reg.upsert({ id: "ARC-004", kind: "arc", path: "RFCs/arcs/ARC-004-x.md", project: "systemview" });
  assert.ok(a.ok && !a.updated);
  const b = reg.upsert({ id: "ARC-004", kind: "arc", path: "docs/ARC-004-renamed.md", project: "systemview" });
  assert.ok(b.ok && b.updated);
  assert.strictEqual(reg.read().length, 1);
  assert.strictEqual(reg.get("ARC-004").path, "docs/ARC-004-renamed.md");
  ok("the same id twice is one row with the newer path — a moved document is not a second document");

  const r = reg.upsert({ id: "RFC-073", kind: "rfc", path: "RFCs/RFC-073.md", project: "systemview", title: "cached title", objectives: 7, text: "prose" });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.dropped.sort(), ["objectives", "text", "title"]);
  assert.deepStrictEqual(Object.keys(reg.get("RFC-073")).sort(), ["at", "id", "kind", "path", "project"]);
  ok("content fields are DROPPED and named — the registry never holds a title, a count or prose");

  const bad = reg.upsert({ id: "X" });
  assert.ok(!bad.ok && /id, a kind and a path/.test(bad.error));
  ok("no kind or path is a refusal, not a half row");
}

console.log("\nlocate — the longest project root wins");
{
  const inner = reg.locate(path.join(lanes, "RFCs", "RFC-001.md"));
  assert.deepStrictEqual(inner, { project: "a-lane", rel: path.join("RFCs", "RFC-001.md") });
  ok("a file under a project nested inside another's folder belongs to the inner one");

  const outer = reg.locate(path.join(sv, "docs", "designs", "RFC-002.md"));
  assert.deepStrictEqual(outer, { project: "systemview", rel: path.join("docs", "designs", "RFC-002.md") });
  ok("…and the outer project keeps everything the inner one does not claim");

  const nowhere = reg.locate("/elsewhere/notes.md");
  assert.deepStrictEqual(nowhere, { project: "", rel: "/elsewhere/notes.md" });
  ok("a file in no project is located, not refused — the path is kept absolute");
}

console.log("\nregister — from the document itself");
{
  const file = path.join(sv, "docs", "designs", "RFC-073-whatever.md");
  fs.writeFileSync(file, "# A design\n\n::rfc{id=RFC-073 arc=ARC-004}\n\nbody\n");
  const r = await reg.register(file);
  assert.ok(r.ok && r.registered);
  const row = reg.get("RFC-073");
  assert.strictEqual(row.kind, "rfc");
  assert.strictEqual(row.project, "systemview");
  assert.strictEqual(row.path, path.join("docs", "designs", "RFC-073-whatever.md"));
  assert.strictEqual(row.arc, "ARC-004");
  ok("an RFC in docs/designs/ — NOT in RFCs/ — registers as an rfc with its arc. Folders do not exist here");

  assert.deepStrictEqual(reg.list({ arc: "ARC-004" }).map((r) => r.id), ["RFC-073"]);
  ok("\"what is being built for this arc\" is a read of the registry");

  const plain = path.join(sv, "RFCs", "RFC-999-no-leaf.md");
  fs.writeFileSync(plain, "# Looks like an RFC by its path\n\nbut says nothing.\n");
  const p = await reg.register(plain);
  assert.ok(p.ok && !p.registered);
  assert.strictEqual(reg.get("RFC-999"), null);
  ok("a file in RFCs/ with no leaf is NOT an RFC — it is a file");

  assert.strictEqual(reg.byPath(file).id, "RFC-073");
  assert.strictEqual(reg.byPath(plain), null);
  ok("byPath answers whether a changed file is one the registry cares about");

  const again = await reg.register(file);
  assert.ok(again.ok && again.registered && again.updated);
  assert.strictEqual(reg.read().filter((r) => r.id === "RFC-073").length, 1);
  ok("re-registering is a no-op by nature — one row, no error");
}

console.log("\nrebuildable — delete it and nothing is lost");
{
  const before = reg.read().length;
  fs.unlinkSync(process.env.AUTOBOT_DOCUMENTS);
  assert.deepStrictEqual(reg.read(), []);
  const file = path.join(sv, "docs", "designs", "RFC-073-whatever.md");
  await reg.register(file);
  assert.strictEqual(reg.get("RFC-073").arc, "ARC-004");
  ok(`the file was deleted (${before} rows) and one parse put the document back — it is a cache, not an authority`);

  assert.ok(reg.remove("RFC-073"));
  assert.ok(!reg.remove("RFC-073"));
  ok("remove says whether it removed anything");
}

console.log("\nnoteFile — the door the triggers call");
{
  const file = path.join(sv, "RFCs", "arcs", "ARC-009-x.md");
  fs.writeFileSync(file, "::arc{id=ARC-009 owner=systemview}\n\n:::objective{id=O1 owner=systemview state=open}\nx\n:::\n");
  const r = await reg.noteFile(file);
  assert.ok(r.ok && r.registered);
  assert.strictEqual(reg.get("ARC-009").kind, "arc");
  ok("a markdown write registers through the same door the watcher and files:write call");

  const js = path.join(sv, "src", "thing.js");
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, "// ::rfc{id=RFC-000} in a comment is not a document\n");
  const s = await reg.noteFile(js);
  assert.ok(s.ok && s.skipped && !s.registered);
  assert.strictEqual(reg.get("RFC-000"), null);
  ok("anything that is not markdown is skipped without being read");

  const gone = await reg.noteFile(path.join(sv, "RFCs", "never-existed.md"));
  assert.ok(!gone.ok && /cannot read/.test(gone.error));
  ok("a path that cannot be read answers with an error — it never throws into the emit that called it");
}

console.log("\nstate — derived by the parse alone, wipeable, never identity");
{
  const file = path.join(sv, "docs", "designs", "RFC-500-stateful.md");
  fs.writeFileSync(file, '::rfc{id=RFC-500}\n\n:::approval{ask="Approve RFC-500?"}\nthe ask\n:::\n');
  await reg.register(file);
  const row = reg.get("RFC-500");
  assert.ok(row.state && row.state.parsed > 0);
  assert.strictEqual(row.state.done, false);
  assert.strictEqual(row.state.approvals, 1);
  ok("registering fills a derived state — not done, one approval waiting, stamped with when it was parsed");

  // RFC-076 §5 ADDED A FLOOR UNDER `built`: a STATUS heading over NO claim blocks is a design
  // claiming it landed without ever having said what landing would mean. So the fixture carries a
  // claim now — which is what a real built RFC carries anyway.
  fs.writeFileSync(
    file,
    '::rfc{id=RFC-500}\n\n:::approval{ask="Approve RFC-500?" verdict=approved}\nthe ask\n:::\n\n' +
      '::claim[do the thing → the thing happens]{id=c1}\n\n## STATUS — built\n'
  );
  await reg.register(file);
  const done = reg.get("RFC-500");
  assert.ok(done.state.done && done.state.verdict === "approved" && done.state.built && done.state.approvals === 0);
  ok("the verdict landing turns the same row done — approvals waiting drops in the same parse, before any window");

  // And the floor itself, from the registry's side: strip the claim and `built` goes with it.
  fs.writeFileSync(file, '::rfc{id=RFC-500}\n\n:::approval{ask="Approve RFC-500?" verdict=approved}\nthe ask\n:::\n\n## STATUS — built\n');
  await reg.register(file);
  assert.strictEqual(reg.get("RFC-500").state.built, undefined);
  assert.strictEqual(reg.get("RFC-500").state.verdict, "approved", "the verdict is untouched — only built fell");
  ok("c12 · a STATUS heading over no claims does not make a row built (§5)");

  reg.setState("RFC-500", null);
  assert.strictEqual(reg.get("RFC-500").state, null);
  assert.strictEqual(reg.get("RFC-500").kind, "rfc");
  await reg.register(file);
  assert.ok(reg.get("RFC-500").state.done);
  ok("state wiped to null breaks nothing and the next parse rebuilds it — identity untouched throughout (§1.4)");

  const sneak = reg.upsert({ id: "RFC-501", kind: "rfc", path: "x.md", project: "systemview", state: { done: true } });
  assert.ok(sneak.ok && sneak.dropped.includes("state"));
  assert.strictEqual(reg.get("RFC-501").state, undefined);
  ok("a caller handing upsert a state is refused by the whitelist — the parse is the only writer of it");
}

console.log("\narc state — the objectives are the progress bar's numbers");
{
  const file = path.join(sv, "RFCs", "arcs", "ARC-010-two-objectives.md");
  fs.writeFileSync(file, "::arc{id=ARC-010 owner=systemview}\n\n:::objective{id=O1 owner=systemview state=done}\na\n:::\n\n:::objective{id=O2 owner=systemview state=open}\nb\n:::\n");
  await reg.register(file);
  const row = reg.get("ARC-010");
  // RFC-076 §4.4 slice 4 added `planned` — how many objectives have a plan pointed at them. With
  // nothing attached it is 0, and nothing else about the row changes because of it.
  // Slice 5 added `complete` beside `planned` — the upward fold's two counts, both 0 here
  // because nothing is attached yet.
  assert.deepStrictEqual(row.state.objectives, { done: 1, total: 2, planned: 0, complete: 0 });
  assert.strictEqual(row.state.done, false);
  fs.writeFileSync(file, "::arc{id=ARC-010 owner=systemview}\n\n:::objective{id=O1 owner=systemview state=done}\na\n:::\n\n:::objective{id=O2 owner=systemview state=done}\nb\n:::\n");
  await reg.register(file);
  assert.ok(reg.get("ARC-010").state.done);
  ok("an arc is done when every objective is — and the row carries done-over-total for the bar (claim 4)");

  // ─── THE OBJECTIVE'S ADDRESS (§4.4, slice 4) ──────────────────────────────────────────────
  //
  // The attachment is the OBJECTIVE's address, not the arc's. These hold the three answers that
  // make slice 5 possible: a plan pointed at an objective plans it, two plans on one objective
  // still plan ONE, and a plan naming only the arc plans nothing at all.
  const planA = path.join(sv, "RFCs", "RFC-600-serves-o1.md");
  fs.writeFileSync(planA, "::rfc{id=RFC-600 arc=ARC-010-O1}\n\nthe plan for O1\n");
  await reg.register(planA);
  assert.strictEqual(reg.get("RFC-600").arc, "ARC-010-O1", "the address is kept on the row as the one relation");
  // THE ARC'S FILE DID NOT CHANGE, and its row has to move anyway — a plan landing on an objective
  // is the event, so the plan's own parse re-derives the arc it serves.
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(reg.get("ARC-010").state.objectives.planned, 1);
  ok("a plan carrying an objective's address plans it — and the arc re-derives without being touched (§4.4)");

  const planB = path.join(sv, "RFCs", "RFC-601-also-serves-o1.md");
  fs.writeFileSync(planB, "::rfc{id=RFC-601 arc=ARC-010-O1}\n\na second plan for the same objective\n");
  await reg.register(planB);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(reg.get("ARC-010").state.objectives.planned, 1, "two plans on one objective is ONE planned");
  ok("several plans on one objective count once — planned counts OBJECTIVES, not attachments");

  // c29 — the old way. A plan naming only the arc claims no objective, so nothing reads as planned.
  const planOld = path.join(sv, "RFCs", "RFC-602-old-way.md");
  fs.writeFileSync(planOld, "::rfc{id=RFC-602 arc=ARC-010}\n\nattached the old way, to the arc itself\n");
  await reg.register(planOld);
  await new Promise((r) => setTimeout(r, 30));
  // The address it DID land as, asserted — a blind review pointed out this half was only described.
  assert.strictEqual(reg.get("RFC-602").arc, "ARC-010", "it is kept, as the arc id and nothing finer");
  assert.strictEqual(reg.get("ARC-010").state.objectives.planned, 1, "the arc-only attachment planned nothing");
  ok("c29 · a plan naming only the arc plans no objective — it is not credited to all of them");

  const planC = path.join(sv, "RFCs", "RFC-603-serves-o2.md");
  fs.writeFileSync(planC, "::rfc{id=RFC-603 arc=ARC-010-O2}\n\nthe plan for O2\n");
  await reg.register(planC);
  await new Promise((r) => setTimeout(r, 30));
  const full = reg.get("ARC-010").state;
  assert.strictEqual(full.objectives.planned, 2);
  assert.strictEqual(full.objectives.total, 2);
  // c30 — SLICE 4 CHANGES NO STATE. Every objective is now planned, and the arc's `done` is still
  // exactly what `::objective state=done` said it was. That is what lets this land without a flag
  // day: surfaces can show "unplanned" while the arc still derives the old way.
  assert.strictEqual(full.done, true, "done is still the objectives' own flags, untouched by planned");
  ok("c30 · every objective planned, and the arc's state is exactly what it was — no flag day (§6)");
}

console.log("\ngap — the fourth kind, written into another project's repo");
{
  const file = path.join(sv, "GAPS", "G-12.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "::gap{id=G-12}\n\nthe parse drops karaoke marks on fenced lines\n");
  await reg.register(file);
  const row = reg.get("G-12");
  assert.strictEqual(row.kind, "gap");
  assert.strictEqual(row.state.done, false);
  ok("a one-line body under a ::gap leaf is a registered document — a gap needs only its leaf");

  // A GAP IS DONE BY DECLARATION AND EVIDENCE (RFC-076 §4.5) — `resolved=` on its own does not
  // reach it. Without the second half, the one state in the system that should be hardest to claim
  // is the easiest: a declaration with nothing behind it.
  fs.writeFileSync(file, "::gap{id=G-12 resolved=2026-10-25}\n\nthe parse drops karaoke marks on fenced lines\n");
  await reg.register(file);
  assert.strictEqual(reg.get("G-12").state.done, false);
  assert.strictEqual(reg.get("G-12").state.resolvedDeclared, true);
  assert.strictEqual(reg.get("G-12").state.hasProof, undefined);
  ok("resolved= alone is NOT done for a gap any more — the row says the declaration is there (§4.5)");

  // Add something runnable and change nothing else. The proof block is unrestricted: a test chip
  // counts where the fix landed in the suite, a run block where it did not.
  fs.writeFileSync(
    file,
    "::gap{id=G-12 resolved=2026-10-25}\n\nthe parse drops karaoke marks on fenced lines\n\n" +
      ":::cmd\nyarn test --testPathPattern=karaoke\n:::\n"
  );
  await reg.register(file);
  assert.strictEqual(reg.get("G-12").state.hasProof, true);
  assert.strictEqual(reg.get("G-12").state.done, true);
  ok("and a proof in the document is what completes it — declaration plus evidence (§4.5)");

  // The fork: rejected shares no term with resolved, and it carries its reason or it is
  // indistinguishable from a gap nobody looked at.
  fs.writeFileSync(file, "::gap{id=G-12 rejected=2026-10-28 why=wontfix}\n\nthe karaoke thing\n");
  await reg.register(file);
  const no = reg.get("G-12").state;
  assert.strictEqual(no.rejected, true);
  assert.strictEqual(no.rejectedWhy, "wontfix");
  assert.strictEqual(no.done, false);
  ok("rejected= with a reason is the gap's OTHER ending, and it is not resolved (§4.5)");

  // c10 — THE CLAIM NAMES TWO SHAPES and only `:::cmd` was pinned anywhere; the `::test` and
  // `:::run` shapes had been probed and nothing held them. A blind review caught it. One gap whose
  // only evidence is a test chip, another whose only evidence is a command, both resolved.
  const byTest = path.join(sv, "GAPS", "G-20.md");
  fs.writeFileSync(byTest, "::gap{id=G-20 resolved=2026-10-28}\n\nthe fix landed in the suite\n\n::test[systemview/karaoke]{ns=Specs.run}\n");
  await reg.register(byTest);
  assert.strictEqual(reg.get("G-20").state.hasProof, true);
  assert.strictEqual(reg.get("G-20").state.done, true);

  const byRun = path.join(sv, "GAPS", "G-21.md");
  fs.writeFileSync(byRun, "::gap{id=G-21 resolved=2026-10-28}\n\nthe suite cannot see this one\n\n:::run{ns=Math.add}\nx\n:::\n");
  await reg.register(byRun);
  assert.strictEqual(reg.get("G-21").state.done, true);
  ok("c10 · a test chip and a run block each close a gap on their own — the proof block is unrestricted");
}

console.log("\nretirement — saved from outside any window, the reason comes with it (§4.2)");
{
  // c31, and it is HERE rather than in markdown-state.js on purpose. A blind review of this RFC's
  // claims caught the gap: the claim's action is *save a registered document* → *its row is
  // re-derived*, and the only retirement evidence that existed was `deriveState` on a string
  // literal — no file written, no register() called, no row produced. This writes a real file into
  // a real temp project and registers it, which is the path the claim names.
  const file = path.join(sv, "docs", "designs", "RFC-700-retired.md");
  fs.writeFileSync(file, "# A design\n\n::rfc{id=RFC-700}\n\nbody\n");
  await reg.register(file);
  assert.strictEqual(reg.get("RFC-700").state.retired, undefined, "live to begin with");

  fs.writeFileSync(file, "# A design\n\n::rfc{id=RFC-700 retired=2026-10-28 retiredAs=shelf}\n\nbody\n");
  await reg.register(file);
  const paused = reg.get("RFC-700").state;
  assert.strictEqual(paused.retired, true);
  assert.strictEqual(paused.retiredAs, "shelf", "the REASON came with it, off a real save");
  ok("c31 · a retirement saved to disk and registered puts its reason on the row");

  fs.writeFileSync(
    file,
    "# A design\n\n::rfc{id=RFC-700 retired=2026-10-28 retiredAs=superseded supersededBy=RFC-701}\n\nbody\n"
  );
  await reg.register(file);
  const sup = reg.get("RFC-700").state;
  assert.strictEqual(sup.retiredAs, "superseded");
  assert.strictEqual(sup.supersededBy, "RFC-701", "and the pointer with it");
  ok("c31 · and superseded carries the document that replaced it, through the same save");

  // Un-retire by editing the file by hand — the row has to let go of the reason too, or a live
  // document keeps saying why it was once put down.
  fs.writeFileSync(file, "# A design\n\n::rfc{id=RFC-700}\n\nbody\n");
  await reg.register(file);
  const back = reg.get("RFC-700").state;
  assert.strictEqual(back.retired, undefined);
  assert.strictEqual(back.retiredAs, undefined, "no residue — the reason left with the retirement");
  assert.strictEqual(back.supersededBy, undefined);
  ok("c31 · un-retiring in the file clears the reason off the row, with no residue");

  // c14's committed guard, which was only ever a probe. An OPEN vocabulary means an unknown
  // subtype must register clean and leave the report readable.
  const rep = path.join(sv, "docs", "designs", "report-odd-subtype.md");
  fs.writeFileSync(rep, "# A view\n\n::report{id=odd-one as=postmortem-haiku retain=99d}\n\nbody\n");
  await reg.register(rep);
  const row = reg.get("odd-one");
  assert.strictEqual(row.kind, "report");
  assert.strictEqual(row.state.retired, undefined, "absent, not false — nothing retired it");
  assert.strictEqual(row.state.done, false, "a report is never done; it is a view");
  ok("c14 · a report subtype nobody has ever used registers clean and stays readable (open vocabulary)");
}


console.log("\na relation that ENDED leaves the row");
{
  // `undefined` means "not saying", explicit `null` means "gone". Without the distinction a merge
  // can only ever ADD: an attribute deleted from a document stays on its row forever, so detaching
  // a plan from an objective is invisible and the arc counts it as planned for good.
  const arc = path.join(sv, "RFCs", "arcs", "ARC-700-detach.md");
  fs.writeFileSync(arc, "::arc{id=ARC-700 owner=systemview}\n\n:::objective{id=O1 owner=systemview state=open}\na\n:::\n");
  await reg.register(arc);

  const plan = path.join(sv, "RFCs", "RFC-700-serves-it.md");
  fs.writeFileSync(plan, "::rfc{id=RFC-700 arc=ARC-700-O1}\n\nthe plan\n");
  await reg.register(plan);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(reg.get("RFC-700").arc, "ARC-700-O1");
  assert.strictEqual(reg.get("ARC-700").state.objectives.planned, 1);
  ok("a plan attached by an objective's address is on the row, and the arc counts it");

  // Take the attachment out of the document and change nothing else.
  fs.writeFileSync(plan, "::rfc{id=RFC-700}\n\nthe plan, no longer serving anything\n");
  await reg.register(plan);
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(reg.get("RFC-700").arc, undefined, "the relation is GONE, not remembered");
  assert.strictEqual(reg.get("ARC-700").state.objectives.planned, 0, "and the arc stops counting it");
  ok("detaching it removes the field AND moves the arc — a row cannot outlive the fact behind it");

  // The partial-caller contract still holds: a caller that says nothing about a field keeps it.
  reg.upsert({ id: "RFC-700", kind: "rfc", path: "RFCs/RFC-700-serves-it.md", project: "systemview", arc: "ARC-700-O1" });
  reg.upsert({ id: "RFC-700", kind: "rfc", path: "RFCs/moved.md", project: "systemview" });
  assert.strictEqual(reg.get("RFC-700").arc, "ARC-700-O1", "undefined is not a removal");
  assert.strictEqual(reg.get("RFC-700").path, "RFCs/moved.md");
  ok("a caller that is silent about a field leaves it alone — only an explicit null removes one");
}

console.log("\nthe arc derives UPWARD — a plan settling moves the arc, and nothing can press it");
{
  // RFC-076 §4.4 slice 5, c24–c28. The arc's completion is read off the PLAN rows' own derived
  // state: an objective is complete when it has at least one plan and every one is settled, and
  // the arc never stores any of it — which is what makes settled the one state nothing can fake.
  const arc = path.join(sv, "RFCs", "arcs", "ARC-800-upward.md");
  fs.writeFileSync(
    arc,
    '::arc{id=ARC-800 owner=systemview}\n\n:::approval{ask="Approve it?" verdict=approved}\nx\n:::\n\n' +
      ":::objective{id=O1 owner=systemview state=open}\na\n:::\n\n:::objective{id=O2 owner=systemview state=open}\nb\n:::\n"
  );
  await reg.register(arc);

  const planFile = (id, addr, settled) =>
    `::rfc{id=${id} arc=${addr}${settled ? ` settled=2026-10-28` : ""}}\n\n:::approval{ask="ok?" verdict=approved}\nx\n:::\n\n` +
    `::::claim[a → b]{id=c1 state=met by=sv note="x"}\n:::cmd\necho proof\n:::\n::::\n\n## STATUS — built 2026-10-28\n`;

  // c24's mechanics — one objective served by a settled plan, the other unplanned.
  const p1 = path.join(sv, "RFCs", "RFC-801-serves-o1.md");
  fs.writeFileSync(p1, planFile("RFC-801", "ARC-800-O1", true));
  await reg.register(p1);
  await new Promise((r) => setTimeout(r, 30));
  let o = reg.get("ARC-800").state.objectives;
  assert.deepStrictEqual(o, { done: 0, total: 2, planned: 1, complete: 1 }, "O1 complete, O2 not even planned");
  ok("a settled plan completes its objective — read off the plan's row, with the arc file untouched");

  // c28 — one objective with no plan holds the whole arc short of settled, forever.
  assert.ok(o.complete < o.total, "the unplanned objective is the floor");
  ok("c28 · an objective with no plan keeps the arc incomplete, however done the others are");

  // c27 — two plans on one objective: both must settle before it completes.
  const p2 = path.join(sv, "RFCs", "RFC-802-also-o1.md");
  fs.writeFileSync(p2, planFile("RFC-802", "ARC-800-O1", false));
  await reg.register(p2);
  await new Promise((r) => setTimeout(r, 30));
  o = reg.get("ARC-800").state.objectives;
  assert.deepStrictEqual(o, { done: 0, total: 2, planned: 1, complete: 0 }, "the unsettled second plan reopens O1");
  ok("c27 · a second, unsettled plan on a complete objective un-completes it — every plan must settle");

  // c25/c26 — plan every objective, settle everything, and the arc completes with NO edit to it.
  fs.writeFileSync(p2, planFile("RFC-802", "ARC-800-O1", true));
  await reg.register(p2);
  const p3 = path.join(sv, "RFCs", "RFC-803-serves-o2.md");
  fs.writeFileSync(p3, planFile("RFC-803", "ARC-800-O2", false));
  await reg.register(p3);
  await new Promise((r) => setTimeout(r, 30));
  o = reg.get("ARC-800").state.objectives;
  assert.deepStrictEqual(o, { done: 0, total: 2, planned: 2, complete: 1 }, "every objective planned, one still moving");
  ok("c26 · every objective planned with a plan unsettled — the in-flight shape, on the row");

  fs.writeFileSync(p3, planFile("RFC-803", "ARC-800-O2", true));
  await reg.register(p3);
  await new Promise((r) => setTimeout(r, 30));
  o = reg.get("ARC-800").state.objectives;
  assert.deepStrictEqual(o, { done: 0, total: 2, planned: 2, complete: 2 });
  // The arc's own file never changed through all of this. The `done` flag — the hand-ticked
  // objectives — is still 0, and the completion is carried beside it rather than through it.
  assert.strictEqual(reg.get("ARC-800").state.done, false, "the hand-ticked flags are a separate fact");
  ok("c25 · settle the last plan and the arc completes, with no edit to the arc's own document");
}

console.log("\nthe leaf is the identity — remove it, and the row follows");
{
  // The honest teardown for a mock or any document that stops being one: strip the leaf and the
  // registration ends. Before this the row lived on forever, pointing at a file that no longer
  // claimed to be anything — listed, drawn, and never corrected by any parse.
  const f = path.join(sv, "RFCs", "RFC-901-mock.md");
  fs.writeFileSync(f, "::rfc{id=RFC-901}\n\na mock being torn down\n");
  await reg.register(f);
  assert.ok(reg.get("RFC-901"));

  fs.writeFileSync(f, "# the same file, no leaf\n\nthe registration block is gone\n");
  const r = await reg.register(f);
  assert.strictEqual(r.registered, false);
  assert.strictEqual(r.removed, "RFC-901", "and the answer says what was removed");
  assert.strictEqual(reg.get("RFC-901"), null, "the row followed the fact");
  ok("removing the leaf un-registers the document — the row cannot outlive the identity");

  // Put the leaf back and it is all back — the registry stays a cache, never an authority.
  fs.writeFileSync(f, "::rfc{id=RFC-901}\n\nthe mock returns\n");
  await reg.register(f);
  assert.ok(reg.get("RFC-901"));
  ok("and putting the leaf back re-registers it — teardown is reversible, like everything here");

  // A plain markdown file that never had a leaf stays a non-event — no row to remove, no error.
  const plain = path.join(sv, "RFCs", "never-a-doc.md");
  fs.writeFileSync(plain, "# notes\n");
  const p2 = await reg.register(plain);
  assert.ok(p2.ok && !p2.registered && !p2.removed);
  ok("a file that was never registered is untouched by the same door");
  reg.remove("RFC-901");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} claims held — the registry`);
