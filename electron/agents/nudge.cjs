// AN UNFINISHED RUN NUDGES ITS AGENT.
//
// His ask: *"the worklists have a sort of cool down that nudges you, the agent, when you didn't
// complete it."* And then the refinement that collapsed the whole design: *"job and skill nudge."*
//
// WHY `source` IS THE WHOLE SELECTION RULE. A run carries one and a session's own plan does not —
// `run.started(source, id)` and `todo.updated(source, run)` have said so since runs existed. So
// "nudge procedures, not plans" needs no new concept and no per-list special case: nudge anything
// with a source, and the bare session plan is excluded for free rather than by a rule somebody
// wrote. That matters because a plan is ALLOWED to outlive a quiet stretch — a list carrying
// "UNPROVEN: needs his press" is parked on purpose, and nagging about it teaches the agent to
// ignore nudges.
//
// WHY THIS IS NOT A HOOK. A hook only fires for an agent that CARRIES it — the tick lives on the
// profile and is the human's to set. A nudge delivered that way is a nudge most agents never get,
// which is exactly the failure document delivery already hit and rejected ("the chip said buAPI
// was a member while buAPI heard nothing"). Hooks stay available to anyone wanting more; this is
// the floor everybody gets.
//
// WHAT IT MUST NOT BECOME: a thing that nags forever. A run blocked on a human never completes, so
// the count is kept ON THE RUN and the nudging stops — and the count is then a fact a surface can
// render ("nudged 3 times, no movement"), which is more useful than the nudge was.
const fs = require("fs");
const os = require("os");
const path = require("path");

// Beside `hooks/` and `jobs/`, because this is harness policy and the harness is what reads it.
// The window writes it through a door (systemview.cjs) rather than owning a second copy — a
// setting the window holds and the harness cannot see is a setting that does nothing.
const FILE = () =>
  process.env.AUTOBOT_NUDGE_FILE || path.join(os.homedir(), ".autobot", "nudge.json");

// DEFAULTS THAT WORK WITH NO FILE AT ALL. The file is an override, never a requirement: a fresh
// machine nudges correctly and nobody has to be told to create anything.
const DEFAULTS = Object.freeze({
  on: true,
  // Quiet minutes before the first nudge. Deliberately longer than the shortest idle hook here
  // (chore-round at 20) is not required — this is its own listener and sets its own floor.
  idleMin: 20,
  // Between nudges FOR THE SAME RUN. The cooldown he asked for by name.
  cooldownMin: 30,
  // THE CYCLE LENGTH, not a stopping point — the name is older than the rule. Reaching it is the
  // cycle's FINAL NOTICE: the position wraps and the nudging continues until the run closes or is
  // declared abandoned with its account attached (cycleOf, excusedOf). 0 turns the feature off.
  giveUpAfter: 3,
  // Never nudge a session fuller than this. A nudge at 95% spends the context the agent needs to
  // finish the thing it is being nudged about, which makes the nudge actively harmful.
  ctxCeilingPct: 70,
  // WHICH SOURCES COUNT — prefixes, matched literally. His: "job and skill nudge."
  sources: ["job:", "skill:"],
});

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

// JUNK IS IGNORED FIELD BY FIELD, never by throwing the file away. A settings file half-edited by
// hand should lose the line that is wrong, not every line that was right.
function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const sources = Array.isArray(r.sources)
    ? r.sources.map((s) => String(s || "").trim()).filter(Boolean)
    : null;
  return {
    on: typeof r.on === "boolean" ? r.on : DEFAULTS.on,
    idleMin: clampInt(r.idleMin, 1, 24 * 60, DEFAULTS.idleMin),
    cooldownMin: clampInt(r.cooldownMin, 1, 24 * 60, DEFAULTS.cooldownMin),
    // 0 is a legitimate value and means "never nudge", so the floor is 0 rather than 1.
    giveUpAfter: clampInt(r.giveUpAfter, 0, 100, DEFAULTS.giveUpAfter),
    ctxCeilingPct: clampInt(r.ctxCeilingPct, 1, 100, DEFAULTS.ctxCeilingPct),
    // An EMPTY list is not the same as an absent one: [] means nothing qualifies, which is a way
    // to turn this off that survives somebody flipping `on` back.
    sources: sources ? sources : DEFAULTS.sources.slice(),
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
    return { ok: false, error: (e && e.message) || "could not write the nudge settings", settings: next };
  }
  return { ok: true, settings: next };
}

const sourceCounts = (source, sources) => {
  const s = String(source || "");
  if (!s) return false; // the session's own plan — excluded by construction, not by a rule
  return sources.some((p) => s.startsWith(p));
};

// WHAT THE AGENT IS ACTUALLY TOLD. Not "you have an incomplete list" — that is a sentence you have
// to go look something up to act on. It names the source, the item left active, and how far the
// run got, so the nudge is already the briefing.
//
// AND IT INTRODUCES ITSELF, AND IT CARRIES THE RULE (his critique, 2026-10-26: "did not even
// mention that it was a worklist nudge… talking as if the agent knows… doesn't seem to be
// reminding you of a rule"). A nudge lands by definition on a session that lost its thread —
// quiet, maybe compactions deep — so a message that assumes context is a message written for the
// one agent that will never receive it. It says what it is (the harness's idle nudge, no human
// typed it), why it fired, where it stands on the give-up clock, and the law that makes it
// binding: WORK TO COMPLETION — the worklist's own mantra, the philosophy the list exists for.
// THE CYCLE, DERIVED — NEVER STORED TWICE. The record keeps one monotonic count (the full truth:
// ×7 means seven nudges ever); where this nudge stands in its cycle is arithmetic on it. Reaching
// the end of a cycle is NOT an ending (his rule, 2026-10-26: "reaching the end of nudges is not
// stopping — that's not the rule anymore"): the count keeps climbing, the position wraps, and the
// nudging continues until the run earns one of its two endings.
function cycleOf(run, cfg) {
  const giveUp = Math.max(1, Number(cfg && cfg.giveUpAfter) || 1);
  const prior = Number(run && run.nudges && run.nudges.count) || 0;
  const nth = (prior % giveUp) + 1; // this nudge's position, 1-based
  return { nth, of: giveUp, finalNotice: nth === giveUp };
}

// THE ONLY TWO ENDINGS (his design, 2026-10-26, verbatim frame: report required, status confirmed).
// A run stops being nudged when it CLOSES, or when it is DECLARED abandoned — the status says the
// word AND a report attachment carries the account. Both halves, deliberately: the word without the
// record is testimony, the record without the word is a handover nobody ended. Movement spends the
// declaration (writeRun clears an abandoned status), so one old excuse cannot cover a new stall.
// "Abandoned" is the word on purpose — agents will grind out the last two items rather than write
// it next to their own run.
function excusedOf(run) {
  const st = run && run.status && typeof run.status === "object" ? String(run.status.text || "") : "";
  if (!/abandon/i.test(st)) return false;
  const atts = Array.isArray(run && run.attachments) ? run.attachments : [];
  return atts.some((a) => a && a.kind === "report");
}

function nudgeText(run, cfg) {
  const done = Number(run.done) || 0;
  const total = Number(run.total) || 0;
  const active = String(run.active || "").trim();
  const { nth, of, finalNotice } = cycleOf(run, cfg);
  const stalled = active
    ? `the item left active is: "${active}"`
    : `nothing is marked active, which is its own problem — ${total - done} item(s) never started`;
  const head =
    `⏰ Idle nudge — from the harness, not the human. Your session went quiet with a run still ` +
    `open on the worklist: \`${run.source}\` stands at ${done}/${total} and ${stalled}. ` +
    `(Nudge ${nth} of ${of} this cycle.)\n\n` +
    `The rule this enforces is the worklist's own mantra: WORK TO COMPLETION. A sourced run is a ` +
    `procedure the system is watching — it completes only when every item is done, and nothing ` +
    `else marks it complete. Read \`worklist get\` before acting — this line is a summary and the ` +
    `list is the state.`;
  // ORDINARY NUDGES STAY CLEAN (his: the exit is named only on the final notice). Naming the
  // abandonment door every time would advertise the way out of work; the cycle's last word is
  // where it belongs, beside the fact that the nudging does not otherwise stop.
  if (!finalNotice) {
    return (
      `${head} Then drive it to done — or leave it exactly where it stopped; never tidy the list ` +
      `to look complete, because where a procedure died is the most useful thing it records.`
    );
  }
  return (
    `${head}\n\nThis is the cycle's FINAL NOTICE — and it is not a stopping point: the cycle ` +
    `resets and the nudging continues until this run earns one of its two endings. Either drive ` +
    `the list to done, or end it honestly: file the account as a report (\`show()\`) saying why it ` +
    `cannot go further, attach it to this run (\`worklist attach\`, kind \`report\`), and declare ` +
    `it (\`worklist status\`, text starting "abandoned"). The report and the word together are ` +
    `what stop the nudging — nothing else does.`
  );
}

/**
 * Which run, if any, should be nudged right now. PURE — no clock, no disk, no session.
 *
 * Returns `{ run, text }`, or `null` with nothing selected. The caller does the pushing; keeping
 * the decision separable is what lets the rules be tested without standing up a session, and the
 * rules are the part that goes wrong.
 */
function pickNudge({ runs = [], session = "", now = Date.now(), quietMin = 0, ctxPct = null, settings } = {}) {
  const cfg = settings || readSettings();
  if (!cfg.on) return null;
  if (!cfg.giveUpAfter) return null; // 0 = no cycle length = the feature is off by that knob
  if (quietMin < cfg.idleMin) return null;
  // ctxPct is ABSENT until a usage report has arrived, and absent must not mean "full" — a session
  // that has not reported yet is early, which is the safest time to nudge.
  if (ctxPct != null && Number(ctxPct) > cfg.ctxCeilingPct) return null;

  const candidates = (runs || []).filter((r) => {
    if (!r || String(r.session || "") !== String(session || "")) return false;
    if (!sourceCounts(r.source, cfg.sources)) return false;
    const total = Number(r.total) || 0;
    const done = Number(r.done) || 0;
    if (!total || done >= total) return false; // nothing open, or all-done: the run closed properly
    // THE COUNT NEVER STOPS THE NUDGING (his rule — the old line here read `count >= giveUpAfter
    // return false`, a silent timeout that left runs standing at 7/9 forever with nothing anyone
    // could read about why). The only excuse is the DECLARED one: abandoned + the account attached.
    if (excusedOf(r)) return false;
    const n = r.nudges && typeof r.nudges === "object" ? r.nudges : null;
    const lastAt = Number(n && n.lastAt) || 0;
    if (lastAt && now - lastAt < cfg.cooldownMin * 60000) return false; // cooling down
    return true;
  });
  if (!candidates.length) return null;

  // THE STALEST ONE, not the newest. Two unfinished runs means the one nobody has touched longest
  // is the one actually abandoned; nudging the recent one would surface the list the agent is
  // most likely still holding in its head.
  candidates.sort((a, b) => (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0));
  const run = candidates[0];
  return { run, text: nudgeText(run, cfg), ...cycleOf(run, cfg) };
}

module.exports = { DEFAULTS, FILE, normalizeSettings, readSettings, writeSettings, sourceCounts, nudgeText, pickNudge, cycleOf, excusedOf };
