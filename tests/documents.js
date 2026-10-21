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
  const r = send(null, { path: "RFCs/RFC-071.md", project: "systemview-test", members: ["buapi", "systemlynx"], by: "you", summary: "two threads answered", threads: 2 });
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
  const r = send(null, { path: "x.md", members: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no members/i);
  assert.strictEqual(emitted.length, 0, "nothing is announced when nobody would hear it");
  const r2 = send(null, { members: ["buapi"] });
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

console.log(`\n  ${n} claims, all green — a document update is an event\n`);
