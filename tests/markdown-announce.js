// smoke:markdown-announce — RFC-073 §3, THE ANNOUNCE DOOR END TO END (no live sessions).
//
// What this pins: one call registers AND fires off one parse; the emitted event points back at the
// thing (project, path, kind, id, block, line); told= is stamped ONLY for who was actually reached —
// nobody live and no writer means no stamp, so the fire stays visible for the sweep (c30/c32) — and
// the WRITER is stamped without being woken, because its own tool call put the answer there (c31).
import assert from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-announce-"));
process.env.AUTOBOT_DOCUMENTS = path.join(tmp, "documents.json");
process.env.AUTOBOT_PROJECTS = path.join(tmp, "projects.json");
process.env.AUTOBOT_CORPORA = path.join(tmp, "corpora.json"); // read at docs.cjs load — must be set before any require
fs.writeFileSync(path.join(tmp, "corpora.json"), "[]"); // empty by default: only the trigger block adds a registry corpus, and it STUBS index so nothing real embeds
const root = path.join(tmp, "systemview");
fs.mkdirSync(path.join(root, "RFCs"), { recursive: true });
fs.writeFileSync(process.env.AUTOBOT_PROJECTS, JSON.stringify({ systemview: root }));

const sessions = require("../electron/agents/sessions.cjs");
const reg = require("../electron/markdown/registry.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

const events = [];
const off = sessions.subscribeAmbient((e) => events.push(e));

const file = path.join(root, "RFCs", "RFC-200-announce.md");
const DOC = [
  "# RFC-200",
  "",
  "::rfc{id=RFC-200}",
  // auto=buapi puts the one member on the immediate lane — this block proves the DELIVERY
  // mechanics; the gate itself (held vs immediate) is proven in its own section below.
  "::members{who=buapi auto=buapi}",
  "",
  ':::approval{ask="Approve RFC-200?" verdict=approved}',
  "the ask",
  ":::",
].join("\n");

console.log("one parse — register and fire");
{
  fs.writeFileSync(file, DOC);
  const r = await sessions.announceDocument(file);
  assert.ok(r.ok && r.registered);
  const row = reg.get("RFC-200");
  assert.ok(row && row.kind === "rfc" && row.state.done);
  ok("the announce door registered the document and its derived state in the same parse (c36's mechanism)");

  const e = events.find((x) => x.kind === "document.updated");
  assert.ok(e, "the fire was emitted");
  assert.strictEqual(e.members, "|buapi|");
  assert.strictEqual(e.docKind, "rfc");
  assert.strictEqual(e.docId, "RFC-200");
  assert.strictEqual(e.block, "approval");
  assert.strictEqual(e.line, 6);
  assert.match(e.summary, /approved — Approve RFC-200\?/);
  ok("the event points back at the thing — project, path, kind, id, block, line, and the block's own summary (c28, c29)");

  assert.ok(!/told=/.test(fs.readFileSync(file, "utf8")));
  assert.strictEqual(r.fired, 0);
  ok("nobody live and no writer → told= NOT stamped; the fire stays owed (c30)");

  events.length = 0;
  await sessions.announceDocument(file);
  assert.ok(events.find((x) => x.kind === "document.updated"));
  ok("…and the next parse fires it again — undelivered is visible, not forgotten (c32's input)");
}

console.log("\nthe writer is stamped, never woken");
{
  events.length = 0;
  const r = await sessions.announceDocument(file, { by: "buapi" });
  assert.strictEqual(r.fired, 1);
  assert.match(fs.readFileSync(file, "utf8").split("\n")[5], /told=buapi/);
  ok("the writer's own parse stamps it told — its tool call put the answer there (c31)");

  events.length = 0;
  const again = await sessions.announceDocument(file);
  assert.strictEqual(again.fired, 0);
  assert.ok(!events.find((x) => x.kind === "document.updated"));
  ok("told= covering the audience is silence — parse it a hundred times, one delivery ever (c17, c31)");
}

console.log("\nthe registry is the filter");
{
  const plain = path.join(root, "RFCs", "no-leaf.md");
  fs.writeFileSync(plain, ':::approval{ask="Go?" verdict=approved}\nx\n:::\n\n::members{who=buapi}\n');
  events.length = 0;
  const r = await sessions.announceDocument(plain);
  assert.ok(r.ok && r.registered === false);
  assert.ok(!events.find((x) => x.kind === "document.updated"));
  ok("an unregistered document fires nothing — the lookup said no before any routing (c33's shape)");

  const js = await sessions.announceDocument(path.join(root, "x.js"));
  assert.ok(js.ok && js.skipped);
  ok("anything that is not markdown is skipped without a read");

  const prose = path.join(root, "RFCs", "notes.md");
  fs.writeFileSync(prose, "# Notes\n\nNo leaf anywhere.\n");
  const cheap = await sessions.announceDocument(prose);
  assert.ok(cheap.ok && cheap.registered === false && cheap.parsed === false);
  ok("an unknown document with no leaf in its head costs a lookup and a head-read — NO parse (c33)");
}

console.log("\nthe sweep re-announces what the registry knows");
{
  // RFC-200 is covered; add a second fire to it (a claim mark) and sweep with a writer nowhere —
  // the sweep emits it, stamps nothing, and a later writer-parse closes it.
  fs.appendFileSync(file, "\n::claim[it registers → a row]{id=c1 state=met by=sv at=1 subscribe=buapi}\n");
  events.length = 0;
  await sessions.sweepDocuments();
  const e = events.find((x) => x.kind === "document.updated" && x.block === "claim");
  assert.ok(e, "the sweep found the new fire off the registry alone");
  assert.match(e.summary, /c1 met/);
  ok("a session-start sweep parses registered documents and emits what is still owed (c32)");
}

console.log("\nthe gate — a plain member's fires wait for the press");
{
  // His ruling, 2026-11-06: a plain member is the human-gated path. The decision lands in the
  // document either way — delivery is what waits.
  const gated = path.join(root, "RFCs", "RFC-202-managed.md");
  fs.writeFileSync(gated, [
    "# RFC-202",
    "",
    "::rfc{id=RFC-202}",
    "::members{who=buapi}",
    "",
    ':::approval{ask="Ship RFC-202?" verdict=approved}',
    "the ask",
    ":::",
  ].join("\n"));
  events.length = 0;
  const r = await sessions.announceDocument(gated);
  assert.ok(r.ok && r.registered);
  assert.ok(!events.find((x) => x.kind === "document.updated"));
  assert.ok(!/told=/.test(fs.readFileSync(gated, "utf8")));
  ok("a managed document stays QUIET — the decision is recorded, no member is woken, nothing is stamped");

  const held = await sessions.documentFires(gated);
  assert.ok(held.ok && held.fires.length === 1);
  assert.deepStrictEqual(held.fires[0].pending, []);
  assert.deepStrictEqual(held.fires[0].held, ["buapi"]);
  ok("the fires door shows the held lane — what the pin renders, one definition, fetched not re-derived");

  events.length = 0;
  const rel = await sessions.releaseDocumentFires(gated);
  const e = events.find((x) => x.kind === "document.updated");
  assert.ok(e && e.members === "|buapi|" && e.block === "approval");
  assert.ok(rel.ok && rel.released === 0 && rel.held === 1);
  assert.ok(!/told=/.test(fs.readFileSync(gated, "utf8")));
  ok("the press releases: the event goes out to the held member — nobody live, so told= stays unstamped and the fire stays owed");

  const narrow = await sessions.releaseDocumentFires(gated, { member: "nobody-here" });
  assert.ok(narrow.ok && narrow.released === 0 && narrow.held === 0);
  ok("a narrowed release touches only the named member's lane");

  // the writer is never owed its own decision, whichever lane membership put it in
  const byWriter = path.join(root, "RFCs", "RFC-203-writer.md");
  fs.writeFileSync(byWriter, [
    "::rfc{id=RFC-203}",
    "::members{who=buapi}",
    "",
    ':::approval{ask="Go?" verdict=approved}',
    "x",
    ":::",
  ].join("\n"));
  const w = await sessions.announceDocument(byWriter, { by: "buapi" });
  assert.ok(w.ok && w.fired === 1);
  assert.match(fs.readFileSync(byWriter, "utf8"), /told=buapi/);
  ok("the writer's own parse stamps a HELD member told — its tool call put the answer there (c31 crosses the gate)");
}

console.log("\nthe doc-registry keeps itself current off the same parse");
{
  // The registry was chosen as the corpus feed precisely so nobody re-indexes by hand: the one
  // moment a registered document changes is this parse, so a registry-fed corpus covering the
  // project is re-indexed HERE, fire-and-forget. Real embedding needs the model (docs.js swaps a
  // vector double in to assert chunks; this suite does not), so what this pins is the TRIGGER —
  // that the save calls index() for the covering corpus and skips corpora of other projects. The
  // embedding itself is docs.js's 81 assertions.
  const docsEngine = require("../electron/agents/docs.cjs");
  fs.writeFileSync(
    process.env.AUTOBOT_CORPORA,
    JSON.stringify([
      { name: "sv-reg", kind: "working", registry: "systemview" },
      { name: "other-reg", kind: "working", registry: "someone-else" },
    ]),
  );
  const asked = [];
  const realIndex = docsEngine.index;
  docsEngine.index = (name, opts) => { asked.push(name); return Promise.resolve({ ok: true }); };
  // THE TRIGGER IS DEBOUNCED — one trailing pass per project, not one per parse. The startup sweep
  // re-announces every registered row for every resuming session, and the per-parse version was ~27
  // racing hash passes on the main process at the moment he clicks the tab (his report, the hour it
  // armed). So the pin is now TWO assertions: a burst of parses asks ONCE, and it still asks only the
  // covering corpus. The seam shortens the trailing window the way __setIdleTick shortens the tick.
  sessions.__setRegistryReindexMs(20);
  const probe = path.join(root, "RFCs", "RFC-204-current.md");
  fs.writeFileSync(probe, "# RFC-204\n\n::rfc{id=RFC-204}\n\nthe freshly registered design body.\n");
  await sessions.announceDocument(probe);
  await sessions.announceDocument(probe); // the burst — a sweep hits the same rows again
  await sessions.announceDocument(probe);
  assert.equal(asked.length, 0, "nothing indexes inside the burst — the pass is trailing");
  await new Promise((r) => setTimeout(r, 120)); // past the shortened window
  docsEngine.index = realIndex;
  assert.deepEqual(asked, ["sv-reg"], "one pass, for the covering corpus alone — the burst coalesced");
  assert.ok(!asked.includes("other-reg"), "and another project's corpus was left alone");
  ok("a burst of registered saves re-indexes the covering corpus ONCE, trailing — and only that corpus (his design, minus the startup storm)");
  fs.writeFileSync(process.env.AUTOBOT_CORPORA, "[]"); // later announce calls must not spawn a real index with no vector double
}

console.log("\nmarkBlock — the agent's door, with its rules");
{
  const doc = path.join(root, "RFCs", "RFC-201-marks.md");
  fs.writeFileSync(doc, [
    "# RFC-201",
    "",
    "::rfc{id=RFC-201}",
    "::members{who=buapi}",
    "",
    "::claim[open the list → rows]{id=c1}",
    "",
    ":::objective{id=O1 owner=buapi state=open}",
    "the work",
    ":::",
  ].join("\n"));
  await sessions.announceDocument(doc);

  const bare = await sessions.markBlock(doc, 6, { state: "met" }, "buapi");
  assert.ok(!bare.ok && /refused: a claim marked without note=/.test(bare.error));
  assert.ok(!/state=met/.test(fs.readFileSync(doc, "utf8")));
  ok("a claim mark without note= is REFUSED by the verb, and nothing was written (c35)");

  events.length = 0;
  const marked = await sessions.markBlock(doc, 6, { state: "met", note: "ran it; saw the row" }, "buapi");
  assert.ok(marked.ok && marked.marked === "claim");
  const line6 = fs.readFileSync(doc, "utf8").split("\n")[5];
  assert.match(line6, /state=met by=buapi at=\d+ note="ran it; saw the row"/);
  assert.match(line6, /told=buapi/);
  ok("a proper mark lands state= by=<caller> at= note= in ONE write, and the fire stamped the writer told (c35)");

  const obj = await sessions.markBlock(doc, 8, { state: "done" }, "buapi");
  assert.ok(obj.ok && obj.marked === "objective");
  assert.match(fs.readFileSync(doc, "utf8").split("\n")[7], /state=done/);
  ok("an objective moves through the same door — the move IS the announcement");

  // A NEW MARK CLEARS THE RECEIPT — told= is per-decision, not per-block. Without this, whoever
  // heard the first mark could never hear a changed one: the stale stamp read as fully delivered
  // forever (measured live 2026-11-06 — after one release, no press on a block reached anybody).
  const remark = await sessions.markBlock(doc, 6, { state: "unmet", note: "it regressed" }, "systemview");
  assert.ok(remark.ok);
  const reline = fs.readFileSync(doc, "utf8").split("\n")[5];
  assert.match(reline, /state=unmet/);
  assert.ok(!/told=buapi/.test(reline), "the old audience is owed the NEW decision");
  ok("re-marking clears told= — whoever heard the old state is owed the new one (the receipt is per-decision)");

  const prose = await sessions.markBlock(doc, 2, { state: "met", note: "x" }, "buapi");
  assert.ok(!prose.ok && /nothing to mark/.test(prose.error));
  ok("a line holding neither block refuses — the verb cannot write into prose");

  // A CLAIM GROWN A PROOF FOLD IS STILL A CLAIM. The doctrine grows `::claim` to a `::::claim`
  // container the moment it carries evidence — and the two-colon matcher refused exactly those,
  // so the better a claim got, the deader the door (found marking RFC-076's c19/c20/c22, each
  // standing right there with its proof folded in, the verb answering "nothing to mark").
  const grown = path.join(tmp, "grown.md");
  fs.writeFileSync(grown, [
    "# a plan",
    "",
    "::rfc{id=RFC-202}",
    "::members{who=buapi}",
    "",
    "::::claim[the grown one]{id=c1}",
    ":::cmd",
    "echo proof",
    ":::",
    "::::",
  ].join("\n"));
  await sessions.announceDocument(grown);
  const container = await sessions.markBlock(grown, 6, { state: "met", note: "ran it; saw it" }, "buapi");
  assert.ok(container.ok && container.marked === "claim", container.error || "");
  assert.match(fs.readFileSync(grown, "utf8").split("\n")[5], /state=met by=buapi/);
  ok("a ::::claim container marks through the same door — growing the proof fold cannot kill the verb");
}

off();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} assertions held — the announce door`);
