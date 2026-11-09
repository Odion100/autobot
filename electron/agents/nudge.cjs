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
// WHAT IT MUST NOT BECOME: a thing that nags with nothing to show for it. A run blocked on a human
// never completes on its own, so the count is kept ON THE RUN — and the count is then a fact a
// surface can render ("nudged 3 times, no movement"), which is more useful than the nudge was.
//
// THE NUDGING ITSELF DOES NOT TIME OUT. There are exactly two endings: the run CLOSES, or it is
// DECLARED abandoned with its account attached (excusedOf). Reaching the end of a cycle is a FINAL
// NOTICE and the position wraps — a deadline the agent can simply outlast is a deadline that
// teaches it to wait, which is the one thing a nudge may not teach.
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
  // HOW LONG A SUBAGENT MAY BE QUIET BEFORE IT COUNTS AS IDLE — his ask, 2026-11-09: "the lanes is
  // where the subagents go. You could see when they're quiet or when they're idle and there's a
  // countdown right there. of control how long they can be idle before they update you."
  //
  // IT IS ITS OWN NUMBER, NOT `idleMin`, because the two clocks measure different things. `idleMin`
  // is how long THIS agent may sit before being pointed back at its own run — a conversation's
  // pace, 20 minutes. This is how long a SUBAGENT may go without emitting anything before the
  // agent that spawned it should look: a different question, a different tolerance, and bolting it
  // onto `idleMin` would mean one slider governing both and neither set where he wants it.
  //
  // THE DEFAULT IS THE OLD HARDCODED NUMBER. `laneLiveness` warned at `mins >= 10` with nothing
  // able to change it; 10 here keeps every row reading exactly as it did and makes the number his.
  subagentIdleMin: 10,
  // WHICH SOURCES COUNT — prefixes, matched literally. His: "job and skill nudge."
  //
  // `correction:` is here because a correction IS work somebody owes, and the whole of his control
  // over how it nudges is this list — same idle window, same cooldown, same ceiling, same switch.
  // No per-source knobs (his simplification, 2026-11-09: "I can just make it work on what it works
  // now, basically how the settings are now").
  // DERIVED FROM THE KINDS (worklist.cjs KINDS) rather than typed, so a kind that arrives
  // arrives WITH its switch — which is his ask: "that could go to the worklist settings as well,
  // as which one counts". A typed list here is how `correction:` came to be chased by the code and
  // called unheld by the door in the same breath.
  sources: Object.freeze(require("./runKinds.cjs").PREFIXES.slice()),
  // WHO MAY ASSIGN WORK TO ANOTHER AGENT — one slot name, and empty means nobody.
  //
  // THE AUTHORITY IS A NAME HERE RATHER THAN A FIELD ON EVERY DEFINITION, and that is his design:
  // the profile's lever is allow/deny per agent, so gating `assign` that way would mean unchecking
  // a tool on every agent that must not have it — "most of the tools are already assigned to
  // everybody". One name in the settings he already opens to control the nudging is the same
  // control with none of that work, and it sits beside the thing it governs.
  //
  // EMPTY IS THE DEFAULT AND IT MEANS REFUSED, not "anyone". A blank authority that admitted
  // everybody would hand every agent the power to write another agent's list, which is the one
  // outcome this field exists to prevent.
  manager: "",
  // HOW LONG A CLOSED RUN IS KEPT — AND IT IS TWO NUMBERS, because they are two kinds of thing.
  //
  // His ask was about the LISTS: "how quickly the worklist gets deleted should be added to the
  // worklist settings." Applied to every run record it emptied his jobs and lanes tabs — 93 job and
  // lane sources left closed-run residue in `.chore-stamps.json` with no record behind it. His
  // correction: "I never meant the job lanes… I was only talking about what is the list. If I was
  // talking about all of them, I would have said the work lists."
  //
  // The reasoning that justified twelve hours — a run attaches its product, so the row is only a
  // receipt — is TRUE OF A SKILL RUN and false of a lane. A skill's list is a procedure's own
  // bookkeeping, read the day it ran and never again. A lane is a BRANCH somebody may come back to
  // in a fortnight, with a report pointer and a bring-in receipt hanging off it; sweeping its record
  // orphans the branch and loses what came of it.
  //
  // A run that DIED mid-list is never swept at either setting.
  keepHours: 12, // closed SKILL and session lists — the receipts
  keepWorkHours: 24 * 14, // closed JOB and LANE runs — the things with artifacts attached
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
    // Same bounds as the other minute fields: a floor of 1 because 0 would mean "idle the instant
    // it stops talking", which every thinking subagent is.
    subagentIdleMin: clampInt(r.subagentIdleMin, 1, 24 * 60, DEFAULTS.subagentIdleMin),
    // An EMPTY list is not the same as an absent one: [] means nothing qualifies, which is a way
    // to turn this off that survives somebody flipping `on` back.
    sources: sources ? sources : DEFAULTS.sources.slice(),
    // A SLOT NAME, OR NOTHING. Trimmed, and anything that is not a string becomes empty rather
    // than being coerced — `manager: true` admitting a caller named "true" is the kind of accident
    // a whitelist exists to stop.
    manager: typeof r.manager === "string" ? r.manager.trim() : "",
    // FLOOR OF 1 HOUR, not 0. "Delete closed runs instantly" reads like a tidiness setting and is
    // really a way to lose the record of work that just finished, before anybody has read it — and
    // it is unrecoverable, unlike every other value here.
    keepHours: clampInt(r.keepHours, 1, 24 * 14, DEFAULTS.keepHours),
    // A LONGER FLOOR, deliberately: a lane's record is the only thing tying a branch to the work it
    // came from, so "sweep it within the hour" is not a tidiness choice anybody should be offered.
    keepWorkHours: clampInt(r.keepWorkHours, 24, 24 * 90, DEFAULTS.keepWorkHours),
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
// A run stops being nudged when it CLOSES, or when it is DECLARED abandoned — the status STARTS
// with the word AND the run carries at least one attachment holding the account. Both halves,
// deliberately: the word without the record is testimony, the record without the word is a
// handover nobody ended. Movement spends the declaration (writeRun clears an abandoned status), so
// one old excuse cannot cover a new stall. "Abandoned" is the word on purpose — agents will grind
// out the last two items rather than write it next to their own run.
//
// THE ACCOUNT IS A REPORT, AND THAT IS HIS RULING — 2026-11-09, given with some impatience because
// he has given it before: *"if the worklist is nudging you, you abandon it, it shouldn't stop. It
// should require you to add the report and then a nudge should be reminding you of that."*
//
// THIS REVERSES WHAT §2.4 LANDED, deliberately and in the open. The first wiring demanded kind
// `report`; a completeness press widened it to any attachment, and c14 was marked met on that
// wording. The cost showed up in use: a BRANCH is not an account of why work stopped, and a run
// could buy its way out of the chase with a chip it was going to attach anyway. Two other surfaces
// already disagreed with the lenient version and both said report — the drawer's own `isAccounted`
// (ACCOUNT_KINDS = {report}) and the final-notice text twenty lines below, which has always told
// the agent to write a report document and attach it with kind `report`. One fact had three
// answers and the lenient one was the outlier.
//
// THE STATUS STILL HAS TO START WITH "abandoned" — a declaration, not a mention. The old
// `/abandon/i`-anywhere let "not abandoned, just slow" read as the word being said.
const ACCOUNT_KINDS = new Set(["report"]);

function excusedOf(run) {
  const st = run && run.status && typeof run.status === "object" ? String(run.status.text || "") : "";
  if (!/^\s*abandoned/i.test(st)) return false;
  const atts = Array.isArray(run && run.attachments) ? run.attachments : [];
  return atts.some((a) => a && ACCOUNT_KINDS.has(String(a.kind || "")));
}

// IS THIS RUN DECLARED AND UNACCOUNTED — the state his instruction is about. The word is said, the
// report is not there, and the nudging therefore continues; a nudge that did not SAY why would read
// as the declaration being ignored.
function declaredUnaccounted(run) {
  const st = run && run.status && typeof run.status === "object" ? String(run.status.text || "") : "";
  if (!/^\s*abandoned/i.test(st)) return false;
  return !excusedOf(run);
}

function nudgeText(run, cfg, { session } = {}) {
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
    `list is the state.` +
    // A RUN CAN NOW ARRIVE FROM ANOTHER SESSION, and the rest of this message assumes the agent is
    // holding that list in its head. It is not: a list written by a session that no longer exists
    // has to be read cold, and a nudge that does not say so reads as "you were just doing this".
    (session && run.session && String(run.session) !== String(session)
      ? `\n\nTHIS RUN WAS OPENED IN A DIFFERENT SESSION of yours — the work is owed by you, not ` +
        `by that session, which is why it reached you here. You are not holding this list: read ` +
        `it, and read the whiteboard with it, before you decide anything about it.`
      : "");
  // THE DECLARED-BUT-UNACCOUNTED NUDGE — his instruction, 2026-11-09: the chase continues and the
  // nudge "should be reminding you of that". Without this the agent reads a generic idle nudge
  // about a run it believes it has already ended, which is indistinguishable from the declaration
  // being ignored — and the obvious conclusion from that is to declare it again, harder.
  if (declaredUnaccounted(run)) {
    return (
      `${head}\n\nYOU HAVE ALREADY DECLARED THIS ONE ABANDONED, and the chase is continuing ` +
      `because the account is not on it. The word alone does not end a run — if it did, every ` +
      `stall could be talked out of existence. What is missing is one thing: the REPORT. Write ` +
      `the account as a report document (a file with a \`::report\` leaf) saying why this cannot ` +
      `go further, attach it to this run (\`worklist attach\`, kind \`report\`), and the nudging ` +
      `stops on the next tick — the declaration you already made still stands. A branch, a ` +
      `document or a card attached instead will NOT do it: those say what the work touched, not ` +
      `why it stopped.`
    );
  }
  // AND THIS ONE IS EXEMPT FROM THE RULE BELOW, which is why it sits above it: naming the exit
  // on every ordinary nudge would advertise the way out of work, but this agent has ALREADY
  // taken that exit and is being told the account it owes. That is not an advertisement, it
  // is the bill.
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
    `the list to done, or end it honestly: write the account as a report document (a file with a ` +
    `\`::report\` leaf) saying why it cannot go further, attach it to this run ` +
    `(\`worklist attach\`, kind \`report\`), and declare ` +
    `it (\`worklist status\`, text starting "abandoned"). The account attached and the word ` +
    `declared, together, are what stop the nudging — nothing else does.`
  );
}

/**
 * Which run, if any, should be nudged right now. PURE — no clock, no disk, no session.
 *
 * Returns `{ run, text }`, or `null` with nothing selected. The caller does the pushing; keeping
 * the decision separable is what lets the rules be tested without standing up a session, and the
 * rules are the part that goes wrong.
 */
// WHOSE RUN IT IS. A run used to be nudged only inside the session that opened it, which meant
// work owed to an AGENT died with the session it was given to: an assignment handed over in the
// morning kept nudging a session that was idle or gone, and the job that fired into a fresh one
// at noon was blind to it. The owner is the agent, and in this harness the agent slot IS the
// project code carried in the session key (`session:<projectCode>:<id>`), so the comparison is
// the place rather than the whole string.
//
// A SESSION WITH NO PROJECT FALLS BACK TO ITSELF. `session:<key>` from the terminal door has no
// project in it, and treating every such session as one agent would have them nudging each other
// about lists they never wrote — so an unplaceable session only ever hears about its own runs.
const placeOf = (session) => {
  const m = /^session:([^:]+):/.exec(String(session || ""));
  return m ? m[1] : "";
};
const sameAgent = (a, b) => {
  const pa = placeOf(a);
  const pb = placeOf(b);
  if (!pa || !pb) return String(a || "") === String(b || "");
  return pa === pb;
};

function pickNudge({ runs = [], session = "", now = Date.now(), quietMin = 0, ctxPct = null, settings } = {}) {
  const cfg = settings || readSettings();
  if (!cfg.on) return null;
  if (!cfg.giveUpAfter) return null; // 0 = no cycle length = the feature is off by that knob
  if (quietMin < cfg.idleMin) return null;
  // ctxPct is ABSENT until a usage report has arrived, and absent must not mean "full" — a session
  // that has not reported yet is early, which is the safest time to nudge.
  if (ctxPct != null && Number(ctxPct) > cfg.ctxCeilingPct) return null;

  const candidates = (runs || []).filter((r) => {
    if (!r || !sameAgent(r.session, session)) return false;
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
  return { run, text: nudgeText(run, cfg, { session }), ...cycleOf(run, cfg) };
}

// A QUIET SUBAGENT NUDGES THE AGENT THAT SPAWNED IT — his ask, 2026-11-09, and the gap it closes is
// the one `unseenSubagents` only half-closed. That selector made a running subagent VISIBLE; it
// still needed somebody to be looking at the window. A subagent that goes quiet while its owner has
// moved on is work spending tokens with nobody accountable for it, and "nothing runs invisibly" is
// not satisfied by a row that happens to be on a tab he is not on.
//
// IT IS A SEPARATE SELECTOR BECAUSE A SUBAGENT IS NOT A RUN. It has no run record — no source, no
// items, no owner file — which is exactly why `pickNudge` cannot see it: that function filters run
// records off disk, and a subagent is session state that dies with the session. So this takes the
// session's own liveness map and answers the same shape.
//
// SILENCE IS NOT DEATH AND THIS MUST NOT SAY IT IS. `laneLiveness` already settled the wording for
// the window — a subagent thinking for two minutes emits nothing, so elapsed is reported and the
// number speaks. The same discipline holds here: the text says how long it has been quiet and asks
// the agent to look. It never says stalled, stuck, hung or dead, because the host does not know.
function pickSubagentNudge({ subagents = [], session = "", now = Date.now(), ctxPct = null, settings } = {}) {
  const cfg = settings || readSettings();
  if (!cfg.on) return null;
  if (ctxPct != null && Number(ctxPct) > cfg.ctxCeilingPct) return null;

  const windowMs = cfg.subagentIdleMin * 60000;
  const candidates = (subagents || []).filter((u) => {
    if (!u || !u.parent) return false;
    // A FINISHED SUBAGENT IS NOT IDLE. It stopped because it was done, and nudging about it would
    // point the agent at work that has already landed.
    if (u.ended) return false;
    const last = Number(u.lastTs) || 0;
    // NEVER EMITTED ANYTHING AT ALL is not something this can time. With no first event there is no
    // clock to run, and inventing one from the spawn moment would nudge about a subagent that is
    // still starting up.
    if (!last) return false;
    if (now - last < windowMs) return false;
    const was = Number(u.nudgedAt) || 0;
    if (was && now - was < cfg.cooldownMin * 60000) return false;
    return true;
  });
  if (!candidates.length) return null;

  // THE QUIETEST ONE. Two silent subagents means the one that has been silent longest is the one
  // most likely to have been forgotten.
  candidates.sort((a, b) => (Number(a.lastTs) || 0) - (Number(b.lastTs) || 0));
  const u = candidates[0];
  const mins = Math.floor((now - (Number(u.lastTs) || 0)) / 60000);
  const named = String(u.brief || "").trim();
  const which = named ? `"${named}"` : `the one spawned by ${u.parent}`;
  const text =
    `⏰ A SUBAGENT HAS GONE QUIET — from the harness, not the human. ${which} has emitted nothing ` +
    `for ${mins} minute(s), past the ${cfg.subagentIdleMin}-minute threshold in your worklist settings. ` +
    `It has not finished: no result has come back for it.\n\n` +
    `THIS IS NOT A DIAGNOSIS, AND THE HARNESS IS NOT ABLE TO MAKE ONE. A subagent thinking for ` +
    `several minutes emits nothing and is perfectly alive, so all that has been measured is the ` +
    `silence — what it means is yours to find out by looking, and the answer is as likely to be ` +
    `"still working" as anything else. What IS true either way: work you spawned is spending ` +
    `tokens with nobody watching it. So check on it, or say in the chat what it was for and what ` +
    `you intend to do about it. Work pushed out to a subagent is brought back in by whoever sent ` +
    `it out.`;
  return { subagent: u, text, mins };
}

module.exports = { DEFAULTS, FILE, normalizeSettings, readSettings, writeSettings, sourceCounts, nudgeText, pickNudge, pickSubagentNudge, cycleOf, excusedOf, sameAgent };
