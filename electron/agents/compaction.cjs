"use strict";

// AUTO-COMPACTION — the release valve.
//
// The usage hook fires the maintenance pass at a threshold and the agent then OFFERS a compaction
// and waits for a press. Right when the human is here, wrong when he is not: an unattended session
// stalls at the offer forever. This makes compaction proceed on its own once the pass is done — a
// visible countdown the human (or the agent) can stop, and a hard ceiling that forces it no matter
// what. It is an emergency release valve: it accepts losing the conversation tail because the
// durable state — worklist, whiteboard, store, documents — survives a compaction by construction.
//
// Two thresholds. SOFT: the maintenance pass fires (it already does), and when its run finishes the
// countdown arms, stoppable. HARD: the valve — the countdown still shows but cannot be stopped.
// Stopping defers TOWARD the hard line, never past it, which is what makes "force at some point"
// true instead of hopeful.
//
// THE PASS-GATE IS AGNOSTIC. This module never learns the word "context-maintenance". The hook on
// the `usage` event already points at a procedure (`do: skill:…`); that pointer opens a run; the
// gate is "did the run that hook asked for go all-done". The caller resolves the hook's `do` and
// hands us `passReady` — repoint the hook and the gate follows it, no code here changes. With no
// usage hook carried, nothing is bound and the soft countdown arms immediately; the hard valve
// never consults the gate at all.
//
// This half is PURE and settings. The timer and the `/compact` push live in sessions.cjs, because
// the clock and the input queue are the session's — the same split nudge.cjs keeps.

const fs = require("fs");
const os = require("os");
const path = require("path");

const FILE = () =>
  process.env.AUTOBOT_COMPACTION_FILE || path.join(os.homedir(), ".autobot", "compaction.json");

// DEFAULTS THAT WORK WITH NO FILE. The numbers are his and arbitrary — the point is they live in
// settings, not baked in. soft 60 · hard 85 · countdown 15s · snooze 70s ("D4 = 70").
const DEFAULTS = Object.freeze({
  on: true,
  softPct: 60,
  hardPct: 85,
  countdownSec: 15,
  snoozeSec: 70,
});

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

// JUNK IS IGNORED FIELD BY FIELD, never by throwing the file away — the same rule nudge.cjs keeps.
function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const softPct = clampInt(r.softPct, 1, 100, DEFAULTS.softPct);
  // THE HARD CEILING CAN NEVER SIT BELOW SOFT — a hard under soft would fire the uncancellable valve
  // before the stoppable countdown ever armed, which is the one configuration that defeats the whole
  // design. So it is floored at soft rather than at 1.
  const hardPct = clampInt(r.hardPct, softPct, 100, Math.max(softPct, DEFAULTS.hardPct));
  return {
    on: typeof r.on === "boolean" ? r.on : DEFAULTS.on,
    softPct,
    hardPct,
    // A floor of 1s, not 0: a zero-second countdown is a compaction with no chance to stop it, which
    // is the hard valve wearing the soft path's clothes.
    countdownSec: clampInt(r.countdownSec, 1, 600, DEFAULTS.countdownSec),
    // 0 is legitimate and means "stop does not defer, it just cancels this one countdown".
    snoozeSec: clampInt(r.snoozeSec, 0, 24 * 3600, DEFAULTS.snoozeSec),
  };
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(FILE(), "utf8")));
  } catch {
    return normalizeSettings(null);
  }
}

function writeSettings(patch = {}) {
  const next = normalizeSettings({ ...readSettings(), ...(patch && typeof patch === "object" ? patch : {}) });
  const f = FILE();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(next, null, 2)}\n`);
  } catch (e) {
    return { ok: false, error: (e && e.message) || "could not write the compaction settings", settings: next };
  }
  return { ok: true, settings: next };
}

// THE PURE DECISION. Given the fill, the clock, and the three facts the session tracks, say what the
// controller should do — never touch state, never emit. The caller owns the timer this returns a
// verdict about.
//
//   pct         — context fill %, or null when unknown (no reading yet)
//   now         — ms
//   settings    — a normalized settings object
//   countdown   — the live countdown {hard} or null
//   snoozeUntil — ms a stop deferred to, or 0
//   passReady   — is the maintenance pass's run done since soft was crossed (caller resolves it)
//
// Verdicts: "start-soft" (arm a stoppable countdown) · "start-hard" (arm the forced valve) ·
// "hold" (conditions not yet met — snoozed, or pass not done) · "clear" (drop a countdown that no
// longer applies, e.g. fill fell back under soft) · "none" (leave everything as it is).
function evaluate({ pct, now = 0, settings, countdown = null, snoozeUntil = 0, passReady = false } = {}) {
  const s = normalizeSettings(settings);
  if (!s.on || pct == null) return { kind: countdown ? "clear" : "none", reason: pct == null ? "no-reading" : "off" };

  // HARD FIRST, and it ignores snooze and the gate entirely — that is what makes it the valve. If a
  // soft countdown is already ticking when fill reaches hard, it is replaced by the forced one so
  // its stop button disappears mid-count; a hard countdown already running is left alone.
  if (pct >= s.hardPct) {
    if (countdown && countdown.hard) return { kind: "none", reason: "hard-running" };
    return { kind: "start-hard", reason: "ceiling" };
  }

  if (pct >= s.softPct) {
    if (countdown) return { kind: "none", reason: "running" };
    if (snoozeUntil && now < snoozeUntil) return { kind: "hold", reason: "snoozed" };
    if (!passReady) return { kind: "hold", reason: "pass-not-done" };
    return { kind: "start-soft", reason: "pass-done" };
  }

  // Below soft — nothing is owed, and any countdown left from a higher reading is stale.
  return { kind: countdown ? "clear" : "none", reason: "below-soft" };
}

// THE GATE MATH, pure and on its own so it can be checked without a session. No source bound →
// open, because the pass is a courtesy of the soft path and never a block. Otherwise the pass's run
// must have finished AFTER fill crossed soft — a run that finished on the PREVIOUS cycle does not
// clear this one. The caller resolves `src` from the usage hook's `do`; this never names a skill.
function passReady({ src = "", doneAt = 0, softAt = 0 } = {}) {
  if (!src) return true;
  return !!(doneAt && softAt && doneAt >= softAt);
}

module.exports = { DEFAULTS, FILE, normalizeSettings, readSettings, writeSettings, evaluate, passReady };
