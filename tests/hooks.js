// smoke:hooks — CARRYING A HOOK SURVIVES A SAVE.
//
// The bug this exists for: three hooks were enabled, the switches moved, the agent ran them — and
// the `hooks` key was gone from disk. It only showed up after a re-init, because the live session
// still held the list in memory from when it opened. So the surface said enabled, the agent behaved
// enabled, and the truth on disk was empty. Every assertion here is about the WRITE path, because
// that is the half nobody watches.
//
// THROWAWAY IDS ONLY. Writes agents named `smoke-hooks-*` under the real agents dir and deletes
// them; it never touches a definition anyone uses.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const defs = require("../electron/agents/definitions.cjs");
const hooks = require("../electron/agents/hooks.cjs");

const ID = "smoke-hooks-agent";
const HOOK = "smoke-hooks-authored";
const HOOK2 = "smoke-hooks-renamed";
let failed = 0;
const ok = (what, cond) => { console.log(`${cond ? "  ✓" : "  ✗"} ${what}`); if (!cond) failed++; };
const eq = (what, a, b) => ok(`${what} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const onDisk = (id) => JSON.parse(fs.readFileSync(path.join(defs.DIR, `${id}.json`), "utf8"));

try {
  console.log("\nnormalize keeps the field at all — the whitelist IS the definition");
  defs.save({ id: ID, name: "smoke hooks", prompt: "a throwaway", hooks: ["context-retrieval", "context-maintenance"] });
  eq("written to disk", onDisk(ID).def.hooks, ["context-retrieval", "context-maintenance"]);

  console.log("\nA SAVE THAT NEVER MENTIONS HOOKS MUST NOT DROP THEM");
  // This is the exact shape that wiped them: some other field is edited and the payload simply has
  // no `hooks` key. Anything that reads the whitelist and rebuilds `def` from scratch will silently
  // lose every field the caller didn't happen to send.
  defs.save({ id: ID, prompt: "edited somewhere else entirely" });
  eq("still carried after an unrelated edit", onDisk(ID).def.hooks, ["context-retrieval", "context-maintenance"]);
  eq("and the edit landed", onDisk(ID).def.prompt, "edited somewhere else entirely");

  console.log("\nthe profile's own save shape — the flattened record, def: undefined");
  const rec = defs.get(ID);
  defs.save({ id: rec.id, name: rec.name, ...rec.def, projectCode: rec.projectCode, cwd: rec.cwd, permissionMode: rec.permissionMode, def: undefined });
  eq("survives a full-form save", onDisk(ID).def.hooks, ["context-retrieval", "context-maintenance"]);

  console.log("\nturning one off is a real write, not a UI state");
  defs.save({ id: ID, hooks: ["context-retrieval"] });
  eq("one left", onDisk(ID).def.hooks, ["context-retrieval"]);
  defs.save({ id: ID, hooks: [] });
  eq("empty is a value, not an absence", onDisk(ID).def.hooks, []);

  console.log("\nfiring: a hook reaches an agent ONLY if that agent carries it");
  const all = hooks.index ? hooks.index() : hooks.list();
  ok("the library has hooks to test with", Array.isArray(all) && all.length > 0);
  const name = (all.find((h) => h.on === "compaction.after") || all[0] || {}).name;
  if (name) {
    const ev = { kind: (all.find((h) => h.name === name) || {}).on || "compaction.after" };
    const carrying = hooks.fire(ev, { agentId: ID, projectCode: "smoke", carries: [name], fired: new Map() });
    const bare = hooks.fire(ev, { agentId: ID, projectCode: "smoke", carries: [], fired: new Map() });
    ok(`carried → fires (${name})`, carrying.some((h) => h.name === name));
    ok("not carried → silent", bare.length === 0);
  }

  console.log("\nwhat the session will actually carry, read the way sessions.cjs reads it");
  defs.save({ id: ID, hooks: ["context-retrieval"] });
  const agent = defs.get(ID);
  const carries = Array.isArray(agent.def && agent.def.hooks) ? agent.def.hooks : [];
  eq("carriesHooks at open", carries, ["context-retrieval"]);
  // -------------------------------------------------------------------------------------------
  // AUTHORING (RFC-005 §7). Hooks became writable by an agent, which makes two things testable
  // that did not exist before: that the event vocabulary is checked at the WRITING door, and that
  // a hook records who wrote it. The second is the one with teeth — without an author there is no
  // way to stop one writer overwriting another's hook, and no way to tell them apart afterwards.
  console.log("\nthe hookable vocabulary is checked where hooks are WRITTEN, not where they fire");
  ok("a real event passes", hooks.isEvent("compaction.after"));
  ok("a typo does not", !hooks.isEvent("compaction.finished"));
  ok("hook.fired is not offered — it is the injection loop", !hooks.isEvent("hook.fired"));

  console.log("\nauthor survives the round trip to disk");
  hooks.save({ name: HOOK, on: "usage", do: "skill:context-maintenance", when: { pct: { gte: 70 } },
               kind: "context", guard: "once-per-session", author: "agent:smoke", note: "throwaway" });
  const mine = hooks.list().find((h) => h.name === HOOK);
  eq("author read back", mine && mine.author, "agent:smoke");
  eq("kind is written explicitly, never left to a default", mine && mine.kind, "context");
  eq("when survives as an object", mine && mine.when, { pct: { gte: 70 } });

  console.log("\nwho may overwrite whom");
  ok("a new name is nobody's yet", hooks.mayWrite(null, "agent:smoke"));
  ok("mine, by me", hooks.mayWrite(mine, "agent:smoke"));
  ok("mine, NOT by another agent", !hooks.mayWrite(mine, "agent:other"));
  ok("the operator owns everything", hooks.mayWrite(mine, "user"));
  ok("hand-written (unattributed) reads as the operator's", !hooks.mayWrite({ author: "" }, "agent:smoke"));

  console.log("\na rename is a move, not a copy — two files is a hook that fires twice");
  hooks.save({ name: HOOK2, wasName: HOOK, on: "usage", do: "skill:context-maintenance", author: "agent:smoke" });
  const after = hooks.list().map((h) => h.name);
  ok("new name exists", after.includes(HOOK2));
  ok("old name is gone", !after.includes(HOOK));

  console.log("\nan authored hook is INERT — the write is the proposal, the carry is the approval");
  const ev = { kind: "usage", pct: 90 };
  ok("nobody carries it → silent", hooks.fire(ev, { carries: [], fired: new Map() }).length === 0);
  ok("carried → fires", hooks.fire(ev, { carries: [HOOK2], fired: new Map() }).some((h) => h.name === HOOK2));

  // -------------------------------------------------------------------------------------------
  // RFC-012 — WHEN THE POINTER LANDS, AND WHETHER IT COMES BACK.
  //
  // The bug behind all of this: a pointer was pushed the instant its event matched, which put it
  // on the input queue beside the message the human had just sent. It competed with his request
  // and lost — observed live, at 60% context, where the pass only happened because he asked why it
  // had not. The two halves of the fix are tested separately because they fail separately: the
  // classification decides WHERE a pointer goes, `until` decides whether missing it is fatal.
  console.log("\nsession-level pointers are held for the yield; in-turn hooks do not move");
  eq("usage → the turn boundary", hooks.deliverAt({ on: "usage" }), "turn-end");
  eq("compaction.after → the turn boundary", hooks.deliverAt({ on: "compaction.after" }), "turn-end");
  // THE ONE THAT MUST NOT REGRESS. A hook watching `git push` exists to land NEAR the action;
  // deferring it to the end of the turn delivers it after the push it was watching for.
  eq("tool.call stays immediate", hooks.deliverAt({ on: "tool.call" }), "now");
  eq("tool.result stays immediate", hooks.deliverAt({ on: "tool.result" }), "now");
  eq("permission.request stays immediate", hooks.deliverAt({ on: "permission.request" }), "now");
  eq("an author may override either way", hooks.deliverAt({ on: "tool.call", deliver: "turn-end" }), "turn-end");
  eq("and back", hooks.deliverAt({ on: "usage", deliver: "now" }), "now");

  console.log("\n`until` is CONFIG beside `guard`, not a second kind of hook");
  hooks.save({ name: HOOK, on: "usage", do: "skill:context-maintenance", when: { pct: { gte: 60 } },
               guard: "once-per-session", until: "run", author: "agent:smoke", note: "throwaway" });
  const persist = hooks.list().find((h) => h.name === HOOK);
  eq("until survives the round trip", persist && persist.until, "run");
  eq("bare `run` means this hook's own pointer", hooks.clearedBy(persist), "skill:context-maintenance");
  eq("or name a different source", hooks.clearedBy({ until: "run:job:nightly" }), "job:nightly");
  ok("no until → does not persist", !hooks.persists({ on: "usage", guard: "once-per-session" }));

  console.log("\nuncleared, it comes back every turn — the guard is suspended, not honoured");
  {
    const fired = new Map();
    const ctxAt = (turn) => ({ carries: [HOOK], fired, cleared: new Map(), turn });
    const hot = { kind: "usage", pct: 82 };
    ok("turn 1 fires", hooks.fire(hot, ctxAt(1)).some((h) => h.name === HOOK));
    // ONE PER TURN, NOT ONE PER EVENT. `usage` is emitted per assistant message AND at the yield,
    // so without the turn number a persisting hook would queue a pointer for every message.
    ok("a second match in the SAME turn does not fire again", !hooks.fire(hot, ctxAt(1)).some((h) => h.name === HOOK));
    ok("turn 2 fires again, despite once-per-session", hooks.fire(hot, ctxAt(2)).some((h) => h.name === HOOK));
    ok("turn 3 too", hooks.fire(hot, ctxAt(3)).some((h) => h.name === HOOK));
  }

  console.log("\nand the RUN RECORD clears it — never the agent's say-so");
  {
    const fired = new Map();
    const hot = { kind: "usage", pct: 82 };
    ok("fires while nothing has run", hooks.fire(hot, { carries: [HOOK], fired, cleared: new Map(), turn: 1 }).length === 1);
    // A pass that finished BEFORE the pointer went out is not an answer to it — otherwise a run
    // from an hour ago silences a hook that has not been read once.
    const stale = new Map([["skill:context-maintenance", (fired.get(HOOK).firstTs || 0) - 60000]]);
    ok("a run that finished earlier does not count", hooks.fire(hot, { carries: [HOOK], fired, cleared: stale, turn: 2 }).length === 1);
    const done = new Map([["skill:context-maintenance", Date.now() + 1000]]);
    ok("a run all-done since the pointer clears it", hooks.fire(hot, { carries: [HOOK], fired, cleared: done, turn: 3 }).length === 0);
    // Once cleared the ordinary guard applies again, and once-per-session means it is done.
    ok("and once-per-session then holds", hooks.fire(hot, { carries: [HOOK], fired, cleared: done, turn: 4 }).length === 0);
    // A DIFFERENT PROCEDURE IS NOT THIS ONE. The source has to match, or any finished run at all
    // would clear every persisting hook in the session.
    const other = new Map([["skill:study", Date.now() + 1000]]);
    const f2 = new Map();
    hooks.fire(hot, { carries: [HOOK], fired: f2, cleared: new Map(), turn: 1 });
    ok("somebody else's run does not clear it", hooks.fire(hot, { carries: [HOOK], fired: f2, cleared: other, turn: 2 }).length === 1);
  }

  console.log("\nthe pointer text follows the timing");
  {
    const end = hooks.pointerText({ name: "x", on: "usage", do: "skill:context-maintenance", until: "run" }, { kind: "usage" });
    ok("a turn-end pointer stops apologising", !/Finish what you are doing first/.test(end));
    ok("it says the turn is already handed back", /handed the turn back/.test(end));
    ok("a persisting one says it will return, and what clears it", /returns every turn/.test(end) && /run record/.test(end));
    const now = hooks.pointerText({ name: "x", on: "tool.call", do: "skill:study" }, { kind: "tool.call" });
    ok("an in-turn pointer keeps the deferral, and needs it", /Finish what you are doing first/.test(now));
  }

  // -------------------------------------------------------------------------------------------
  // THE BOUNDARY ITSELF, driven without a model on the other end. `result` is the SDK's real
  // yield, so these claims are about a signal we HAVE — the debounce only has to survive the gap
  // between that yield and a turn the human had already queued.
  console.log("\nthe pointer waits for the yield, and a pause is not an ending");
  await (async () => {
    const sessions = require("../electron/agents/sessions.cjs");
    const fake = () => ({
      key: "smoke:hooks", sessionId: "smoke", projectCode: "smoke", cwd: process.cwd(), model: "",
      events: [], subs: new Set(), toolsInFlight: 0, sent: [],
      input: { push(m) { this.owner.sent.push(m.message.content[0].text); } },
      hooksFired: new Map(), pendingHooks: new Map(), runsDone: new Map(),
      turnSeq: 0, turnActive: false, turnEndTimer: null, carriesHooks: [HOOK],
    });
    const mk = () => { const s = fake(); s.input.owner = s; return s; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const s = mk();
    // the mid-turn ruler tick — the event that used to deliver the pointer beside his message
    sessions.fireHooks(s, { kind: "usage", snapshot: true, pct: 82 });
    eq("nothing is pushed mid-turn", s.sent.length, 0);
    ok("it is held, not dropped", s.pendingHooks.size === 1);
    sessions.fireHooks(s, { kind: "tool.call", name: "Bash" });
    sessions.fireHooks(s, { kind: "usage", snapshot: true, pct: 84 });
    eq("still nothing, however long the turn runs", s.sent.length, 0);
    eq("and three matches are still one pointer", s.pendingHooks.size, 1);

    sessions.armTurnEnd(s);
    eq("not even at the instant of the yield", s.sent.length, 0);
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("delivered once the turn has settled", s.sent.length, 1);
    ok("and it is the pointer, not the payload", /context-hook name="smoke-hooks-authored"/.test(s.sent[0]));

    // THE FAILURE THE DEBOUNCE EXISTS FOR: a turn the human had already queued gets announced
    // between the yield and the flush. Firing into that gap puts the pointer right back beside his
    // message, which is the whole thing this change is undoing.
    const t = mk();
    sessions.fireHooks(t, { kind: "usage", snapshot: true, pct: 82 });
    sessions.armTurnEnd(t);
    sessions.fireHooks(t, { kind: "user.prompt", text: "actually, one more thing" });
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("a new turn cancels the flush", t.sent.length, 0);
    eq("and the pointer is still held for the NEXT ending", t.pendingHooks.size, 1);
    sessions.armTurnEnd(t);
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("which it gets", t.sent.length, 1);

    // AND A MOMENT THAT ARRIVES AT AN IDLE SESSION STILL LANDS. session.started, a message from
    // another session, a page event — none of them are inside a turn, so there is no yield coming.
    // Holding for one would mean waiting until the human happened to speak, which for an
    // unattended agent is never.
    const u = mk();
    sessions.fireHooks(u, { kind: "usage", snapshot: true, pct: 82 });
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("an idle session gets it without waiting for a turn that is not coming", u.sent.length, 1);

    // ---------------------------------------------------------------------------------------
    // THE IDLE EVENT — the turn ended and nobody came back. Driven with the real timer, not a
    // mocked clock, so the claims are about the mechanism as it will actually run; IDLE_MS is
    // read from the module and temporarily shortened, which is the only way to assert a
    // five-minute quiet inside a smoke test.
    // QUIET TICKS AND REPORTS; THE HOOK DECIDES WHAT COUNTS. No threshold lives in the emitter,
    // so what these claims check is that `quietMin` keeps an honest count, that activity resets
    // it, and that a hook's own `when` is what picks a duration out of it.
    console.log("\nquiet ticks, and the hook picks its own threshold");
    {
      const REAL = sessions.IDLE_TICK_MS;
      const SOON = "smoke-idle-nudge", LONG = "smoke-idle-long", LONG15 = "smoke-idle-15";
      hooks.save({ name: SOON, on: "idle", when: { quietMin: { gte: 1 } }, do: "skill:context-maintenance", kind: "context", author: "agent:smoke" });
      hooks.save({ name: LONG, on: "idle", when: { quietMin: { gte: 3 } }, do: "skill:study", kind: "context", author: "agent:smoke" });
      hooks.save({ name: LONG15, on: "idle", when: { quietMin: { gte: 15 } }, do: "skill:doc-maintenance", kind: "context", author: "agent:smoke" });

      // NOBODY LISTENING, NOTHING RUNS. The cost of the signal exists only where it was asked for.
      const none = mk();
      none.carriesHooks = [];
      sessions.armTurnEnd(none);
      eq("an agent with no idle hook arms no clock", none.idleTimer, null);
      eq("and its wake interval is nothing at all", sessions.idleWakeMs(none), 0);

      // THE WAKE RATE IS THE HOOKS' THRESHOLDS, NOT A CONSTANT. Waking every minute to learn it
      // is not 15 yet is work nobody ordered.
      eq("one hook at 15 minutes → wake every 15", sessions.idleWakeMs({ carriesHooks: [LONG15] }), 15 * 60000);
      eq("plus one at 1 minute → wake at the smallest", sessions.idleWakeMs({ carriesHooks: [LONG15, SOON] }), 60000);

      // DERIVED FROM THE CLOCK, NOT COUNTED — so a throttled or slept timer still tells the truth.
      // The hook's own event carries the answer, so that is what gets asserted.
      sessions.__setIdleTick(60);
      const i = mk();
      i.carriesHooks = [SOON];
      sessions.armTurnEnd(i);
      ok("a listening agent does arm one", !!i.idleTimer);
      i.quietSince = Date.now() - 7 * 60000;  // as if the machine had been asleep seven minutes
      await wait(150);
      const held = i.pendingHooks.get(SOON);
      ok("one late wake still delivers the pointer", !!held);
      eq("and reports the REAL elapsed quiet, not a tick count", held && held.event.quietMin, 7);
      eq("and NOTHING was written to the feed", i.events.length, 0);

      // ACTIVITY RESETS IT — he came back, so the session is not quiet at all.
      sessions.fireHooks(i, { kind: "user.prompt", text: "actually —" });
      eq("he came back, so the stretch is discarded", i.quietSince, 0);
      sessions.armTurnEnd(i);
      ok("and the next yield starts a fresh one", i.quietSince > 0);
      sessions.__setIdleTick(REAL);

      // THE THRESHOLD IS THE HOOK'S, NOT THE EMITTER'S — one event, two durations, no constant
      // anywhere in the harness. This is the whole reason the emitter reports instead of judging.
      const at = (m, carries) => hooks.fire({ kind: "idle", quietMin: m }, { carries, fired: new Map(), cleared: new Map(), turn: m }).length;
      eq("at 1 quiet minute the nudge fires", at(1, [SOON]), 1);
      eq("the long-work hook does not", at(1, [LONG]), 0);
      eq("at 3 minutes it does", at(3, [LONG]), 1);
      eq("and both fire once it is quiet enough for both", at(3, [SOON, LONG]), 2);
      for (const n of [SOON, LONG, LONG15]) { try { hooks.remove(n); } catch {} }
    }

    // -------------------------------------------------------------------------------------------
    // THE FIRE RATE — his decomposition. `when` is a condition about NOW; the rate is a fact about
    // this hook and this agent over TIME, and they are orthogonal. Every claim here is about the
    // half that was broken: a rate longer than one session silently became once-per-session,
    // because the fire history lived in a Map the session threw away.
    console.log("\nthe fire rate is persisted, parsed, and refused when malformed");
    {
      const RATE = "smoke-rate-daily";
      const FIRED = path.join(process.env.HOME || "", ".autobot", "hooks-fired.json");
      const keep = (() => { try { return fs.readFileSync(FIRED, "utf8"); } catch { return null; } })();
      try { fs.unlinkSync(FIRED); } catch {}

      eq("30m", hooks.parseDur("30m"), 1800000);
      eq("3d12h", hooks.parseDur("3d12h"), 302400000);
      eq("2w", hooks.parseDur("2w"), 1209600000);
      eq("bare digits are still seconds, so old hooks keep their meaning", hooks.parseDur("302400"), 302400000);
      ok("and a duration it cannot read is NaN, never zero", Number.isNaN(hooks.parseDur("2weeks")));

      // REFUSED AT THE WRITING DOOR. `cooldown:2w` used to save, read back, and fire every time.
      const bad = (r) => { try { hooks.save({ name: "smoke-rate-bad", on: "idle", do: "skill:study", kind: "context", author: "agent:smoke", rate: r }); return false; } catch { return true; } };
      ok("cooldown:2weeks is refused", bad("cooldown:2weeks"));
      ok("once-per-fortnight is refused", bad("once-per-fortnight"));
      ok("cooldown:2w is accepted", !bad("cooldown:2w"));
      try { hooks.remove("smoke-rate-bad"); } catch {}

      hooks.save({ name: RATE, on: "idle", when: {}, do: "skill:doc-maintenance", kind: "context", author: "agent:smoke", rate: "once-per-day" });
      const ev = { kind: "idle", quietMin: 20 };
      // a FRESH fired Map each time is exactly what a restarted session looks like
      const go = () => hooks.fire(ev, { agentId: "agent:smoke", carries: [RATE], fired: new Map(), cleared: new Map(), turn: 1 });
      const first = go();
      eq("it fires once", first.length, 1);
      hooks.recordFired(first[0], { agentId: "agent:smoke" });
      eq("and is held for the rest of the day", go().length, 0);
      eq("HELD ACROSS A RESTART — the rate is not session state", go().length, 0);

      // and the calendar turns over
      const st = JSON.parse(fs.readFileSync(FIRED, "utf8"));
      st[`agent:smoke|${RATE}`].ts = Date.now() - 26 * 3600000;
      fs.writeFileSync(FIRED, JSON.stringify(st));
      eq("a new day releases it", go().length, 1);

      // PER AGENT, NOT PER HOOK: a shared hook carried by two agents has two cadences.
      eq("another agent is not silenced by mine", hooks.fire(ev, { agentId: "agent:other", carries: [RATE], fired: new Map(), cleared: new Map(), turn: 1 }).length, 1);

      try { hooks.remove(RATE); } catch {}
      if (keep == null) { try { fs.unlinkSync(FIRED); } catch {} } else fs.writeFileSync(FIRED, keep);
    }
  })();
} finally {
  try { fs.unlinkSync(path.join(defs.DIR, `${ID}.json`)); } catch {}
  for (const n of [HOOK, HOOK2]) { try { hooks.remove(n); } catch {} }
}

console.log(failed ? `\n✗ ${failed} failed\n` : "\n✓ hooks smoke passed\n");
process.exit(failed ? 1 : 0);
