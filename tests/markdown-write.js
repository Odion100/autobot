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

// A CHARACTER THE GRAMMAR CANNOT READ BACK MUST NEVER REACH THE LINE. Measured 2026-10-25: a `"`
// inside a note= value was escaped by JSON.stringify as \", the grammar read the backslash as data
// and the quote as the terminator, and the whole ::claim BLOCK stopped parsing — 22 of 41 claims
// silently deleted while every write answered ok. Braces are the same class one step later: a `{`
// in a value defeats the end-of-line bag matcher, so the NEXT write appends a second bag.
//
// Pinned by PARSING WHAT WAS WRITTEN, never by matching the output string: the bug was invisible in
// the line (it looked plausible) and only a parse could see the block was gone.
{
  const { parse } = require("../electron/markdown/parse.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdw-"));
  const file = path.join(tmp, "claims.md");
  const base = "::claim[Something is true]{id=c1 state=unmet}";

  const survives = async (note, second) => {
    fs.writeFileSync(file, base + "\n");
    const r = writeAttr(file, 1, { note });
    if (second) writeAttr(file, 1, { told: "autobot" });
    const out = await parse(fs.readFileSync(file, "utf8"));
    const all = (out && out.blocks) || (Array.isArray(out) ? out : []);
    const claims = all.filter((b) => b.name === "claim");
    return { claims, r, line: fs.readFileSync(file, "utf8") };
  };

  await (async () => {
    const control = await survives("it works fine");
    assert.strictEqual(control.claims.length, 1, "the control parses");
    assert.ok(!control.r.sanitized, "a clean value reports no sanitizing");
    ok("a plain note round-trips and reports nothing altered");

    const quoted = await survives('he said "yes" to it');
    assert.strictEqual(quoted.claims.length, 1, "a quote must not delete the block");
    assert.ok(!/\\"/.test(quoted.line), "no backslash-escaped quote reaches the line");
    assert.deepStrictEqual(quoted.r.sanitized, ["note"], "and the caller is TOLD its value was altered");
    ok("a double quote in a note keeps the claim alive, and the swap is reported rather than silent");

    const braced = await survives("the bag {a:1} inside", true);
    assert.strictEqual(braced.claims.length, 1, "braces must not split the bag");
    assert.strictEqual((braced.line.match(/\}\{/g) || []).length, 0, "a second write extends the bag, never appends one");
    ok("a brace in a value no longer makes the next write append a second attribute bag");

    for (const [what, note] of [
      ["pipes and equals", "a|b c=d"],
      ["an arrow", "then → e"],
      ["backticks and brackets", "call `fn()` on [x]"],
      ["both at once", 'he said "use {this}" loudly'],
    ]) {
      const r = await survives(note, true);
      assert.strictEqual(r.claims.length, 1, `${what} must round-trip`);
    }
    ok("pipes, equals, arrows, backticks and brackets all still round-trip untouched");
  })();

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${n} claims held — the platform's write`);
