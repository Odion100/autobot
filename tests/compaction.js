// smoke:compaction — THE RELEASE VALVE.
//
// Auto-compaction proceeds on its own once the maintenance pass is done: a stoppable soft countdown,
// and a hard ceiling that forces it. This proves the decision core, the settings floor that keeps
// hard from sitting under soft, the agnostic pass-gate, and the live flow — a soft countdown that
// pushes /compact at zero, a hard one that refuses to be stopped.
//
// THE CLAIMS:
//   1. evaluate() — below soft nothing; soft holds until the pass is done; soft+ready starts the
//      stoppable countdown; hard ignores the gate AND a snooze and forces; hard replaces a running
//      soft; a fill that fell back under soft clears a stale countdown.
//   2. settings — hard can never normalize below soft; the countdown can never be zero seconds.
//   3. passReady() — no source bound is open; a bound source needs its run finished AFTER soft; a
//      run from the previous cycle (before soft) does not clear this one.
//   4. the live flow — a soft countdown emits `compaction.pending` and pushes a bare `/compact` at
//      zero; a hard countdown refuses `stopCountdown`; a soft one cancels and sets the snooze.

import assert from "node:assert";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// A temp settings file so the live-flow test runs a 1-second countdown without touching his real
// ~/.autobot/compaction.json. Set BEFORE requiring, since FILE() reads the env each call.
const TMP = path.join(os.tmpdir(), `compaction-test-${process.pid}.json`);
process.env.AUTOBOT_COMPACTION_FILE = TMP;
fs.writeFileSync(TMP, JSON.stringify({ on: true, softPct: 60, hardPct: 85, countdownSec: 1, snoozeSec: 70 }));

// AND A TEMP LOG DIR, for the same reason and one more: `ledger.cjs` resolves ROOT once at require
// time, so this has to be set before the require below — and without it every line this suite
// writes lands in the file an investigation reads, which is the failure logLife's own comment
// records from 2026-10-19.
const LOGS = fs.mkdtempSync(path.join(os.tmpdir(), "compaction-logs-"));
process.env.AUTOBOT_LEDGER_DIR = LOGS;
const lifeLog = () => {
  try { return fs.readFileSync(path.join(LOGS, "agents.log"), "utf8"); } catch { return ""; }
};

const compaction = require("../electron/agents/compaction.cjs");
const sessions = require("../electron/agents/sessions.cjs");

let n = 0;
const ok = (w) => { n += 1; console.log("  ok  " + w); };
const S = compaction.normalizeSettings({ softPct: 60, hardPct: 85, countdownSec: 15, snoozeSec: 70 });

// 1 · THE DECISION CORE
assert.equal(compaction.evaluate({ pct: 40, settings: S, passReady: true }).kind, "none");
ok("below soft: nothing is owed");
assert.equal(compaction.evaluate({ pct: 65, settings: S, passReady: false }).kind, "hold");
ok("soft but the pass is not done: hold");
assert.equal(compaction.evaluate({ pct: 65, settings: S, passReady: true }).kind, "start-soft");
ok("soft and the pass is done: the stoppable countdown arms");
assert.equal(compaction.evaluate({ pct: 65, now: 1000, snoozeUntil: 5000, settings: S, passReady: true }).kind, "hold");
ok("soft but snoozed: hold until the snooze lapses");
assert.equal(compaction.evaluate({ pct: 90, now: 1000, snoozeUntil: 9e9, settings: S, passReady: false }).kind, "start-hard");
ok("hard ignores the gate AND the snooze — it is the valve");
assert.equal(compaction.evaluate({ pct: 90, settings: S, countdown: { hard: false }, passReady: true }).kind, "start-hard");
ok("hard replaces a running soft countdown");
assert.equal(compaction.evaluate({ pct: 90, settings: S, countdown: { hard: true }, passReady: true }).kind, "none");
ok("a hard countdown already running is left alone");
assert.equal(compaction.evaluate({ pct: 30, settings: S, countdown: { hard: false }, passReady: true }).kind, "clear");
ok("fill fell back under soft: a stale countdown is cleared");

// 2 · THE SETTINGS FLOOR
assert.equal(compaction.normalizeSettings({ softPct: 70, hardPct: 50 }).hardPct, 70, "hard floored at soft");
ok("the hard ceiling can never normalize below soft");
assert.equal(compaction.normalizeSettings({ countdownSec: 0 }).countdownSec, 1, "countdown floored at 1s");
ok("the countdown can never be zero seconds — that would be the valve wearing the soft path's clothes");

// 3 · THE AGNOSTIC GATE MATH
assert.equal(compaction.passReady({ src: "", doneAt: 0, softAt: 0 }), true);
ok("no source bound: the gate is open — the pass is a courtesy, not a block");
assert.equal(compaction.passReady({ src: "skill:x", doneAt: 0, softAt: 1000 }), false);
ok("a bound source with no finished run: closed");
assert.equal(compaction.passReady({ src: "skill:x", doneAt: 2000, softAt: 1000 }), true);
ok("a bound run finished AFTER soft was crossed: open");
assert.equal(compaction.passReady({ src: "skill:x", doneAt: 500, softAt: 1000 }), false);
ok("a run finished on the PREVIOUS cycle (before soft) does not clear this one");

// 4 · THE LIVE FLOW — a hand-built session, exactly the fields the controller reads, an input queue
// and an event sink that record. Survives emit()'s ledger + fireHooks because those guard themselves
// and this session carries no hooks.
const fakeSession = (over = {}) => {
  const pushed = [];
  const emitted = [];
  return {
    pushed, emitted,
    events: [], subs: [(e) => emitted.push(e)],
    hooksFired: new Map(), runsDone: new Map(), turnSeq: 0,
    agentId: undefined, projectCode: "compaction-test", sessionId: "t", cwd: process.cwd(),
    compactionCtl: { softAt: 0, snoozeUntil: 0, countdown: null, timer: null, firedAt: 0 },
    input: { push: (m) => pushed.push(m) },
    ...over,
  };
};

// A hard countdown forces: it pushes /compact at zero and refuses to be stopped.
const hard = fakeSession();
sessions.maybeCompact(hard, 90);
assert.ok(hard.compactionCtl.countdown && hard.compactionCtl.countdown.hard, "a hard countdown armed");
ok("fill past the ceiling arms the forced countdown");
assert.equal(sessions.stopCountdown(hard, "you").ok, false);
ok("the hard ceiling refuses to be stopped — the valve is the valve");
assert.ok(hard.emitted.some((e) => e.kind === "compaction.pending" && e.hard && e.cancellable === false), "pending event is hard + not cancellable");
ok("its pending event says hard, not cancellable");

// A soft countdown: pending emitted, then /compact pushed at zero (countdownSec=1 from the temp file).
const soft = fakeSession();
sessions.maybeCompact(soft, 65);
assert.ok(soft.compactionCtl.countdown && !soft.compactionCtl.countdown.hard, "a soft countdown armed");
assert.ok(soft.emitted.some((e) => e.kind === "compaction.pending" && e.cancellable === true), "soft pending is cancellable");
ok("fill past soft, pass unbound (gate open), arms the stoppable countdown");

await new Promise((r) => setTimeout(r, 1300));
assert.ok(soft.pushed.some((m) => m.message && m.message.content && m.message.content[0] && m.message.content[0].text === "/compact"), "pushed a bare /compact at zero");
ok("at zero it pushes a bare /compact into the input queue");
assert.ok(soft.emitted.some((e) => e.kind === "compaction.fired"), "emitted compaction.fired");
ok("and emits compaction.fired");

// A soft countdown can be stopped, which cancels it and sets the snooze window.
const stoppable = fakeSession();
sessions.maybeCompact(stoppable, 65);
const r = sessions.stopCountdown(stoppable, "buAPI");
assert.ok(r.ok && r.snoozedSec === 70, "stop returns ok with the snooze window");
assert.equal(stoppable.compactionCtl.countdown, null, "countdown cleared");
assert.ok(stoppable.compactionCtl.snoozeUntil > Date.now(), "snooze window set");
assert.ok(stoppable.emitted.some((e) => e.kind === "compaction.cancelled" && e.by === "buAPI"), "cancelled, attributed to who pressed");
ok("a soft countdown stops: cleared, snoozed, and the cancel is attributed");

// 5 · THE VALVE LEAVES A RECORD — the chip is in a window nobody is watching at 3am, so every
// transition says so on disk. Twice "did it ever arm?" had no answer but his eyes.
const life = lifeLog();
assert.match(life, /compaction armed: hard, cannot be stopped at 90% · 1s/);
ok("arming writes which path, the reading that caused it, and the window");
assert.match(life, /compaction armed: soft at 65% · 1s/);
assert.match(life, /compaction fired — \/compact pushed to the input queue/);
ok("the fire is on disk, so a compaction nobody saw is still answerable");
assert.match(life, /compaction stopped by buAPI — snoozed 70s toward the hard line/);
ok("a stop says who stopped it and how long it bought");

// THE HOLD — over soft with nothing counting down, because the pass has not closed since the
// crossing. The state that reads as a broken valve, now the state that says why.
const held = fakeSession({ runsDone: new Map() });
held.compactionCtl.snoozeUntil = Date.now() + 60000;
sessions.maybeCompact(held, 65);
sessions.maybeCompact(held, 65);
const holds = lifeLog().split("\n").filter((l) => l.includes("compaction held at 65%: snoozed"));
assert.equal(held.compactionCtl.countdown, null, "a hold arms nothing");
assert.equal(holds.length, 1, "the hold is logged once per reason, not once per reading");
ok("a hold says why, once — the reading repeats every usage event and the log must not");

try { fs.unlinkSync(TMP); } catch {}
try { fs.rmSync(LOGS, { recursive: true, force: true }); } catch {}
console.log(`\n${n} claims, all green — auto-compaction, the release valve`);
