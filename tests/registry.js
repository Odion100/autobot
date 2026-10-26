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

  fs.writeFileSync(file, '::rfc{id=RFC-500}\n\n:::approval{ask="Approve RFC-500?" verdict=approved}\nthe ask\n:::\n\n## STATUS — built\n');
  await reg.register(file);
  const done = reg.get("RFC-500");
  assert.ok(done.state.done && done.state.verdict === "approved" && done.state.built && done.state.approvals === 0);
  ok("the verdict landing turns the same row done — approvals waiting drops in the same parse, before any window");

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
  assert.deepStrictEqual(row.state.objectives, { done: 1, total: 2 });
  assert.strictEqual(row.state.done, false);
  fs.writeFileSync(file, "::arc{id=ARC-010 owner=systemview}\n\n:::objective{id=O1 owner=systemview state=done}\na\n:::\n\n:::objective{id=O2 owner=systemview state=done}\nb\n:::\n");
  await reg.register(file);
  assert.ok(reg.get("ARC-010").state.done);
  ok("an arc is done when every objective is — and the row carries done-over-total for the bar (claim 4)");
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

  fs.writeFileSync(file, "::gap{id=G-12 resolved=2026-10-25}\n\nthe parse drops karaoke marks on fenced lines\n");
  await reg.register(file);
  assert.strictEqual(reg.get("G-12").state.done, true);
  ok("resolved= on the leaf is what DONE means for a gap (§1.4)");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} claims held — the registry`);
