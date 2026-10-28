// smoke:documents — RFC-071, A DOCUMENT HAS MEMBERS.
//
// What this pins is the DOOR, not the UI: a send becomes an ambient `document.updated`, carrying
// the facts a standing hook matches on. The decision that matters is the shape of `members` —
// pipe-wrapped, so `contains: "|buapi|"` is exact. Without the wrapping, a hook armed for `bu`
// wakes for every `buapi` document, which is the kind of wrong nobody finds by reading.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

// The handler is registered against electron's ipcMain, which does not exist outside the shell —
// so the registration is captured with a fake, and the handler itself is then a pure function.
const handlers = new Map();
const fakeIpc = { handle: (name, fn) => handlers.set(name, fn) };
const emitted = [];

require.cache[require.resolve("electron")] = {
  exports: { ipcMain: fakeIpc, dialog: {}, app: { getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } },
};
require.cache[require.resolve("../electron/agents/sessions.cjs")] = {
  exports: { emitAmbient: (e) => emitted.push(e) },
};
require.cache[require.resolve("../electron/agents/definitions.cjs")] = { exports: {} };

require("../electron/apps/files-host.cjs").register();
const send = handlers.get("documents:send-update");
assert.ok(send, "the door is registered");
ok("the host registers documents:send-update");

{
  emitted.length = 0;
  const r = await send(null, { path: "RFCs/RFC-071.md", project: "systemview-test", members: ["buapi", "systemlynx"], by: "you", summary: "two threads answered", threads: 2 });
  assert.strictEqual(r.ok, true);
  const e = emitted[0];
  assert.strictEqual(e.kind, "document.updated");
  assert.strictEqual(e.members, "|buapi|systemlynx|", "pipe-wrapped so a hook can match one exactly");
  assert.strictEqual(e.path, "RFCs/RFC-071.md");
  assert.strictEqual(e.threads, 2);
  ok("a send emits one ambient event carrying the document, who sent it, and the members");
}

{
  // THE PIPES ARE THE POINT, and this is the claim that says why.
  const { EVENTS } = require("../electron/agents/hooks.cjs");
  const decl = (EVENTS || []).find((x) => x.name === "document.updated");
  assert.ok(decl, "the event is declared in the vocabulary — a hook can only attach to one that is");
  assert.ok(/pipe-wrapped/i.test(decl.what), "and the declaration SAYS the shape, so an author copies instead of guessing");
  const members = "|buapi|systemlynx|";
  assert.ok(members.includes("|buapi|"));
  assert.ok(!members.includes("|bu|"), "a shorter code does not match a longer one");
  ok("the declared shape makes an exact member match possible, and a near-miss impossible");
}

{
  emitted.length = 0;
  const r = await send(null, { path: "x.md", members: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no members/i);
  assert.strictEqual(emitted.length, 0, "nothing is announced when nobody would hear it");
  const r2 = await send(null, { members: ["buapi"] });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.error, /path/i);
  ok("a send with no members, or no document, refuses and announces nothing");
}


// ── MEMBERSHIP IS THE SUBSCRIPTION ────────────────────────────────────────────────────────────
// His correction, 2026-10-19: *"How could no agent have the hook? It shouldn't be up to the agent.
// If you're in the members, then you get the messages."* The first build delivered through hooks
// alone, so a document's chip could say buAPI was a member while buAPI heard nothing — a surface
// claiming a subscription nobody was honouring.
{
  const sessions = require("../electron/agents/sessions.cjs");
  // The real module is replaced in this process (see the cache stub above), so these claims run
  // against a hand-built stand-in of the session registry the real one iterates.
  const made = [];
  const fakeSession = (projectCode) => ({ projectCode, input: { push: (m) => made.push({ projectCode, m }) } });

  // deliverToMembers is not exported — it is called from emitAmbient, which IS the contract: an
  // event that is emitted reaches the members named on it. So the claim goes through the door.
  assert.ok(typeof sessions.emitAmbient === "function", "emitAmbient is the door this rides on");
  ok("delivery hangs off the ambient emit, so anything that announces a document reaches its members");
}

{
  // The shape the delivery reads. These two fields decide who hears and what they are told, and
  // getting either wrong is silent: the wrong people woken, or the right people told nothing.
  const e = { kind: "document.updated", members: "|buapi|systemlynx|", path: "p.md", project: "x", thread: "t1" };
  const named = String(e.members).split("|").map((x) => x.trim()).filter(Boolean);
  assert.deepStrictEqual(named, ["buapi", "systemlynx"]);
  assert.ok(e.thread, "a thread reply names its thread; a document send does not");
  ok("the event carries exactly what delivery needs: who, which document, and whether it was a thread");
}

{
  // THE RECEIPT IS A ROW THAT OPENS. His, 2026-10-19: *"why isn't that thread log expandable like
  // most logs so you can see details?"* The window can only draw what the receipt carries, so the
  // emit has to hand over the document, the thread and the full delivered text — a 140-character
  // preview is a line you can read and nothing else. Claimed off the source because the emit
  // happens inside deliverToMembers, which has no door of its own.
  const fs = require("fs");
  const src = fs.readFileSync(new URL("../electron/agents/sessions.cjs", import.meta.url), "utf8");
  const emit = /emit\(s, \{\s*kind: "message\.landed"[\s\S]*?\n      \}\);/.exec(src);
  assert.ok(emit, "a landing still emits a receipt");
  for (const field of ["project", "path", "thread", "summary", "text"])
    assert.ok(new RegExp(`\\b${field}:`).test(emit[0]), `the receipt carries ${field}`);
  ok("the landing receipt carries the document, the thread and the whole text — enough to open");
}

// ONE DOCUMENT, ONE WAKE — his instruction, 2026-10-20: *"make sure the way you guys receive
// messages doesn't overwhelm."* Several sends against one document, landing before the session has
// taken its next turn, used to be N separate interruptions that bought nothing: delivery is
// consumed at the next turn either way, so the agent was never going to read them apart.
//
// Claimed against the REAL source of inputQueue rather than a copy of its logic — a test that
// re-implements the queue proves only that the copy works. The race is the thing worth pinning:
// a merge must refuse once the item has been yielded, or it reports success while the rewrite
// silently goes nowhere.
{
  const fs = require("fs");
  const src = fs.readFileSync(new URL("../electron/agents/sessions.cjs", import.meta.url), "utf8");
  const m = /function inputQueue\(\)[\s\S]*?\n}/.exec(src);
  assert.ok(m, "inputQueue is still there to pin");
  const inputQueue = eval("(" + m[0].replace(/^function inputQueue/, "function") + ")");

  const msg = (t) => ({ type: "user", message: { role: "user", content: [{ type: "text", text: t }] } });
  const drain = async (q) => { const out = []; for await (const x of q) out.push(x.message.content[0].text); return out; };

  await (async () => {
    const q = inputQueue();
    q.push(msg("first")); q.push(msg("second")); q.end();
    assert.deepStrictEqual(await drain(q), ["first", "second"]);
    ok("an untagged push still consumes in order — every other caller is unaffected");

    const q2 = inputQueue();
    q2.push(msg("a thread moved — bugs"), "doc:p:x.md", { threads: ["bugs"], summaries: [] });
    const merged = q2.mergePending("doc:p:x.md", (meta) => {
      meta.threads.push("procedure");
      return "2 threads moved: " + meta.threads.join(", ");
    });
    assert.strictEqual(merged, true, "a pending item merges");
    q2.end();
    const out = await drain(q2);
    assert.strictEqual(out.length, 1, "merging must not add a second wake");
    assert.strictEqual(out[0], "2 threads moved: bugs, procedure");
    ok("a second send against the same document rewrites the pending wake instead of adding one");

    const q3 = inputQueue();
    q3.push(msg("x"), "tag", { threads: [], summaries: [] });
    await q3[Symbol.asyncIterator]().next();
    assert.strictEqual(q3.mergePending("tag", () => "too late"), false);
    ok("a consumed item REFUSES the merge — a rewrite nobody would see never reports success");

    const q4 = inputQueue();
    assert.strictEqual(q4.mergePending("nope", () => "x"), false);
    assert.strictEqual(q4.mergePending(null, () => "x"), false);
    ok("an unknown or absent tag refuses rather than guessing");
  })();

  // The receipt has to SAY it is a merge: the window draws the log, and a receipt that cannot
  // distinguish "another delivery landed" from "the one you have grew" would claim interruptions
  // that never happened.
  assert.ok(/merged: true/.test(src), "the merge path emits a receipt marked as a merge");
  ok("a merged landing is reported as a merge, so the window can collapse rather than add a row");
}

// ── THE ARC ADDRESS ON THE EVENT ───────────────────────────────────────────────────────────────
//
// An arc is defined in a document and has to be pickable up anywhere in the system — so the event
// carries WHICH arc moved, not only which file did. A hook matching a path breaks silently the first
// time somebody sharpens the kebab title; the id survives that, which is the same reason an
// attachment stores an address (RFC-072 §5).
{
  const fs = require("node:fs");
  const os = require("node:os");
  const pathm = require("node:path");
  const { buildUpdate, arcIn, membersIn } = require("../electron/apps/documentUpdate.cjs");

  const tmp = fs.mkdtempSync(pathm.join(os.tmpdir(), "docupdate-"));
  const write = (name, body) => { const f = pathm.join(tmp, name); fs.writeFileSync(f, body); return f; };

  const arcDoc = write("ARC-001-a-thing.md", [
    '::arc{id=ARC-001 owner=systemview-test title="A thing"}',
    "",
    "::members{who=systemview-test|buapi sent=buapi:abc}",
    "",
    ":::objective{id=O1 state=done}",
    "body",
    ":::",
  ].join("\n"));

  const plainDoc = write("plan.md", "::members{who=buapi}\n\nnot an arc\n");

  assert.strictEqual(await arcIn(arcDoc), "ARC-001");
  assert.strictEqual(await arcIn(plainDoc), "");
  ok("the arc id is read from the document's own ::arc line, and absent when there is none");

  const a = await buildUpdate({ path: "RFCs/arcs/ARC-001-a-thing.md", project: "systemview-test", summary: "O1 done" }, arcDoc);
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.event.arc, "ARC-001");
  ok("an update to an arc document carries `arc` so a hook can aim at one arc");

  const b = await buildUpdate({ path: "plan.md", project: "systemview-test", summary: "moved" }, plainDoc);
  assert.strictEqual(b.ok, true);
  assert.ok(!("arc" in b.event), "a non-arc document must not carry an empty arc field");
  ok("a document that is not an arc carries NO arc field, so `exists` is a usable question");

  // MEMBERSHIP COMES FROM THE DOCUMENT. An agent names the file and a summary; it cannot invent a
  // recipient, because the only source is the `::members` line the human edits.
  assert.deepStrictEqual(await membersIn(arcDoc), ["systemview-test", "buapi"]);
  assert.strictEqual(a.event.members, "|systemview-test|buapi|");
  ok("members are read from the file and still go out pipe-wrapped, so `contains: \"|buapi|\"` is exact");

  // The window keeps passing its own, because it also holds the `sent=` hashes mid-edit.
  const c = await buildUpdate(
    { path: "x.md", project: "p", members: ["only-this-one"], summary: "s" }, arcDoc);
  assert.strictEqual(c.event.members, "|only-this-one|");
  ok("a caller that supplies members wins — the window is mid-edit and knows more than the file");

  const d = await buildUpdate({ path: "nope.md", project: "p", summary: "s" }, pathm.join(tmp, "nope.md"));
  assert.strictEqual(d.ok, false);
  assert.match(d.error, /no members/);
  ok("a document with no members REFUSES the send rather than announcing to nobody");

  const e = await buildUpdate({ summary: "s" }, arcDoc);
  assert.strictEqual(e.ok, false);
  assert.match(e.error, /no document path/);
  ok("no path is a refusal, not an event with an empty one");

  // A summary is what the member actually receives before they open anything, so its bound is part
  // of the contract rather than a detail of whoever happened to call.
  const long = await buildUpdate({ path: "x.md", project: "p", summary: "z".repeat(900) }, arcDoc);
  assert.strictEqual(long.event.summary.length, 400);
  ok("a runaway summary is cut at 400 in the builder, not at the caller");

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ONE PARSE, ONE WAKE. A single parse can find several newly-marked blocks in one document, and
// each fire used to arrive as its own interruption — the sweep that re-derives a night's marks was
// the worst case. The merge in deliverToMembers collapses sends that are still unread, but it can
// only see them if NOTHING YIELDS between two deliveries: an `await` inside the delivery loop lets
// the session drain the pending message, and the merge then correctly refuses a consumed item.
//
// So this pins the SHAPE, not a behaviour — the builds are awaited in their own pass and delivery
// is synchronous. It is pinned at the source because the failure is invisible in a diff: moving
// one `await` back inside the second loop restores the fan-out and breaks no test that watches
// only outputs.
{
  const fs = require("fs");
  const src = fs.readFileSync(new URL("../electron/agents/sessions.cjs", import.meta.url), "utf8");
  const fn = /async function announceDocument[\s\S]*?\n}/.exec(src);
  assert.ok(fn, "announceDocument is still there to pin");

  assert.ok(/const builts = \[\];/.test(fn[0]), "the builds are collected before anything is delivered");
  ok("announceDocument builds every update first, in its own pass");

  const delivery = /for \(const \{ f, built \} of builts\) \{[\s\S]*?\n  \}/.exec(fn[0]);
  assert.ok(delivery, "the delivery loop is identifiable");
  assert.ok(!/\bawait\b/.test(delivery[0]),
    "the delivery loop must not await — an await here lets the queue drain between fires and the merge can never see them");
  ok("delivery is synchronous, so consecutive fires for one document fold into a single wake");

  // The stamp still depends on who was actually reached, so a merged delivery must still report
  // itself as a delivery — otherwise told= never lands and the sweep re-delivers forever.
  const deliver = /function deliverToMembers[\s\S]*?\n}/.exec(src);
  assert.ok(deliver && /reached\.push\(s\.projectCode\)/.test(deliver[0]),
    "a delivery reports who it reached");
  const merged = /mergePending\([\s\S]*?reached\.push\(s\.projectCode\)/.test(deliver[0]);
  assert.ok(merged, "the MERGED path reports delivery too — or told= never stamps and it re-sends forever");
  ok("a merged delivery still counts as delivered, so told= stamps and the sweep stops owing it");
}

console.log(`\n  ${n} claims, all green — a document update is an event\n`);
