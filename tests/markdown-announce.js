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
  "::members{who=buapi}",
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

  const prose = await sessions.markBlock(doc, 2, { state: "met", note: "x" }, "buapi");
  assert.ok(!prose.ok && /nothing to mark/.test(prose.error));
  ok("a line holding neither block refuses — the verb cannot write into prose");
}

off();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} claims held — the announce door`);
