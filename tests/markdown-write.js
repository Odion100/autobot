// smoke:markdown-write — RFC-073 §3.1, ONE WRITER.
//
// What this pins is that write.cjs behaves exactly as SystemView's setDirectiveAttr does — the
// null-removes rule, the empty-value quoting, the no-op answers — because until the package seam
// (RFC-053 §4) lets the renderer import this file, the two copies are kept one IN BEHAVIOUR by
// this fixture. And the file door: stamping an attribute that is already there changes nothing,
// so a told= re-stamp cannot fire the watcher.
import assert from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { setAttr, writeAttr } = require("../electron/markdown/write.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

console.log("setAttr — the ported rules");
{
  const doc = ':::approval{ask="Approve this?"}\nthe ask\n:::';
  const next = setAttr(doc, 1, { verdict: "approved" });
  assert.strictEqual(next.split("\n")[0], ':::approval{ask="Approve this?" verdict=approved}');
  ok("an answer lands inside the braces of the named line");

  const multi = setAttr("::claim[x]{id=c1}", 1, { state: "met", by: "buapi", at: 123, note: "saw it run" });
  assert.strictEqual(multi, '::claim[x]{id=c1 state=met by=buapi at=123 note="saw it run"}');
  ok("several attributes land in ONE write — a claim's mark is four fields, not four writes");

  const removed = setAttr('::question[x]{options=a|b answer=a}', 1, { answer: null });
  assert.strictEqual(removed, "::question[x]{options=a|b}");
  ok("null REMOVES — un-answering leaves the document looking unanswered");

  const empty = setAttr("::::thread{id=t1}", 1, { members: "" });
  assert.strictEqual(empty, '::::thread{id=t1 members=""}');
  ok('an empty value is quoted — members="" parses as present-and-empty, bare members= is not a directive');

  assert.strictEqual(setAttr("::claim[x]{id=c1}", 1, { id: "c1" }), null);
  assert.strictEqual(setAttr("no directive here", 9, { a: "b" }), null);
  ok("writing what is already true, or past the end, answers null — a no-op is not a change");

  const noBraces = setAttr("::claims", 1, { count: "3" });
  assert.strictEqual(noBraces, "::claims{count=3}");
  ok("a bare leaf grows its braces on the first attribute");

  const quoted = setAttr("::claim[Write `::rfc{id=RFC-073}` at the top → it renders]{id=c8}", 1, { told: "buapi" });
  assert.strictEqual(quoted, "::claim[Write `::rfc{id=RFC-073}` at the top → it renders]{id=c8 told=buapi}");
  ok("the attr bag is the braces at the END of the line — a braced example in the label is never written into");

  const prose = setAttr('::claim[x]{id=c17 note="told= is the only baseline"}', 1, { told: "buapi" });
  assert.strictEqual(prose, '::claim[x]{id=c17 note="told= is the only baseline" told=buapi}');
  ok("a key named INSIDE a quoted value is prose, not an attribute — the stamp appends, never edits the note");

  const removes = setAttr('::claim[x]{id=c17 note="state= stays" state=met}', 1, { state: null });
  assert.strictEqual(removes, '::claim[x]{id=c17 note="state= stays"}');
  ok("…and removal drops the real attribute while the note keeps its words");
}

console.log("\nwriteAttr — the file door");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-write-"));
  const file = path.join(tmp, "doc.md");
  fs.writeFileSync(file, ':::approval{ask="Go?" subscribe=buapi}\nbody\n:::\n');

  const w = writeAttr(file, 1, { told: "buapi" });
  assert.ok(w.ok && w.changed);
  assert.match(fs.readFileSync(file, "utf8").split("\n")[0], /told=buapi/);
  ok("the stamp lands in the file");

  const again = writeAttr(file, 1, { told: "buapi" });
  assert.ok(again.ok && !again.changed);
  ok("re-stamping what is already there changes NOTHING — no write, no watcher fire");

  const gone = writeAttr(path.join(tmp, "never.md"), 1, { a: "b" });
  assert.ok(!gone.ok && /cannot read/.test(gone.error));
  ok("a path that cannot be read answers with an error — it never throws");

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${n} claims held — the platform's write`);
