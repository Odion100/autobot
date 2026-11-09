// THE NUDGE RECORD — RFC-078 §2.1 (systemview). One file, a list, one entry per nudge: the
// run-chaser rides it as the FIRST entry (identity, on/off, scope — nothing more; its real knobs
// stay in nudge.json, which this module never reads and never writes), and every judge-backed
// nudge after it. The record is the setting: the machinery obeys the file, never a panel.
//
// AND THE WRITE-TIME CLOCK — RFC-078 §2.3. The shell already sees `file.changed` per session;
// when the path looks like a registered document (markdown under the session's own worktree) this
// module asks the DOCUMENT JUDGES (markdown/judges.cjs, in this process) and gates what came back:
// on, in scope, write-clock, outside its debounce window. What survives the gates is a steering
// message for THE SESSION THAT WROTE IT — sessions.cjs delivers it on the same input-queue ride
// the run-chaser uses.
//
// AND THE SWEEP CLOCK — RFC-078 §2.3, slice 3.3. The standing judges ride the chaser's own idle
// tick (sessions.cjs), under the chaser's cooldownMin:
//   - `judgeRuns` — the shell-local standing judge `run-untouched-for-days`: a SOURCED run that is
//     still open and has not MOVED for `afterDays` days (default 7) is a standing violation.
//     Movement is any write to the run record EXCEPT the chaser's own nudge stamp — an item
//     change, a status write, an attachment, a whiteboard edit all move it; being nudged does not
//     (worklist.markNudged preserves `updatedAt` for exactly this reason). `afterDays` is the
//     entry's one numeric knob, editable in the record like any other field.
//   - `judgeProject` — the DOCUMENT judges over one CONNECTED project's whole registry
//     (~/.autobot/projects.json), swept once per project per cooldown window, for registry-wide
//     violations no single write triggers. Delivery is capped per sweep (SWEEP_MAX_STEERS) so a
//     first pass over years of historical debt steers instead of burying; the rest are re-derived
//     next window, because violations are never stored.
//
// THE BOUNDARY (§1): THE JUDGING AND THE SESSIONS ARE BOTH THIS PROCESS'S, and the split inside it
// is by SUBJECT — document judges are pure functions over the parse (markdown/judges.cjs), while
// this file owns the record, the gates, the clocks and the run-state judges. Nothing crosses a
// wire: the first cut dialled the hub's `GET /judges`, on the premise that the parsed state lived
// there, and it does not — the shell owns `~/.autobot/documents.json` and its parse writes the
// derived state. Asking an app this process HOSTS for state this process produced is the dependency
// inverted, and the proof it was wrong is the ladder that crossing needed. The harness runs with
// SystemView closed; the hub may rely on the shell, never the reverse.
const fs = require("fs");
const os = require("os");
const path = require("path");

// Overridable for tests, same pattern as AUTOBOT_NUDGE_FILE in nudge.cjs — a suite must never get
// the keys to the real house.
const FILE = () =>
  process.env.AUTOBOT_NUDGES_FILE || path.join(os.homedir(), ".autobot", "nudges.json");

// THE DOCUMENT JUDGES — markdown/judges.cjs, pure functions over the parse this process already
// runs. Required lazily so a suite driving only the record's gates never pays for the parser.
// Overridable for tests, which is how a suite declares a document's violations without writing a
// file: the seam is the JUDGE, not a faked transport, so what a test asserts is the gating.
let JUDGES = null;
const __setJudges = (j) => {
  JUDGES = j || null;
};
const judges = () => JUDGES || require("../markdown/judges.cjs");

// Judge one document, by the path a `file.changed` carried. Silent on anything unreadable — a
// document that cannot be parsed has nothing to report, never a throw into a clock.
async function judgeDocument(p, { project = "" } = {}) {
  try {
    const out = await judges().forFile(p, { path: p, project });
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

// THE SEED — RFC-078 §2.1 verbatim, written on first read so a fresh machine has the record the
// moment anything asks. The chaser's entry carries identity, on/off and scope ONLY (c4): its
// idle/cooldown/give-up knobs live in nudge.json untouched.
const SEED = Object.freeze([
  Object.freeze({
    name: "run-chaser",
    on: true,
    scope: "global",
    severity: "steer",
    message: "",
    clock: "sweep",
  }),
  Object.freeze({
    name: "behavioural-claim-cmd-only",
    on: true,
    scope: "global",
    severity: "steer",
    message:
      "a behavioural claim owes a ::test or :::run in its own fold — a cmd is evidence, never the spec",
    clock: "write",
    debounceMin: 10,
  }),
  // THE SHELL-LOCAL STANDING JUDGE — RFC-078 §2.3, slice 3.3. `afterDays` is its one numeric knob:
  // how many days a sourced, still-open run may sit with no movement (no item change, no status
  // write — no write of any kind except the chaser's own nudge stamp) before it is a standing
  // violation. Judged by judgeRuns because its subject is run state, not a document's blocks.
  // THE CORRECTIONS NUDGE — RFC-078 §2.8, slice 3.12. Not a judge: nothing here is derived from a
  // document. It fires while the writing agent has an open correction standing against it in the
  // audit queue, which is what makes the queue a queue — "the queue is gonna evoke the agents" —
  // and it is a setting like every other one, so off is silence and a scope is honoured.
  Object.freeze({
    name: "open-corrections",
    on: true,
    scope: "global",
    severity: "steer",
    message: "",
    clock: "write",
    debounceMin: 60,
  }),
  Object.freeze({
    name: "run-untouched-for-days",
    on: true,
    scope: "global",
    severity: "steer",
    message: "",
    clock: "sweep",
    afterDays: 7,
  }),
]);

// RUN-STATE JUDGES, NEVER DOCUMENT JUDGES. The document judges know blocks; these two know runs
// and sessions. A document-judge answer claiming one of these names is skipped — whichever judge
// found a violation is the one that delivers it, or one violation arrives twice.
const SHELL_LOCAL = new Set(["run-chaser", "run-untouched-for-days"]);

// Named once — judgeWrite composes it and confirmSteer re-derives it, and a second spelling is how
// the two halves of one nudge stop being one nudge.
const OPEN_CORRECTIONS = "open-corrections";

// THE BUILT-IN LINES — what arrives while `message` stays empty (c1). The chaser composes its own
// words in nudge.cjs, so its built-in here is deliberately none.
const BUILT_IN = Object.freeze({
  "behavioural-claim-cmd-only":
    "a behavioural claim owes a ::test or :::run in its own fold — a cmd is evidence, never the spec",
  // The facts (which run, how many days) ride the header judgeRuns composes; this is the law in
  // one breath that follows them, his to replace by editing the entry's message (c1).
  "run-untouched-for-days":
    "read `worklist get`, then either drive the run to done or end it honestly — a status starting \"abandoned\" with the account attached. Sitting still is the one thing a sourced run may not do.",
  // WITHOUT THIS LINE THE NUDGE WOULD NEVER FIRE AND NOTHING WOULD SAY SO: messageOf returns ""
  // for a name with no authored message and no built-in, and judgeWrite then drops the steer
  // outright — "nothing to say is not a delivery". A row in the record with no words here is a
  // nudge that is on, in scope, undebounced, and silent.
  "open-corrections":
    "read `mcp__corrections__mine` — somebody audited your work and wrote down what to fix. It stays in the queue until a party that is not you has seen the fix, so answering it is how it goes away.",
});

const seedByName = (name) => SEED.find((e) => e.name === name) || null;

// JUNK IS IGNORED FIELD BY FIELD, never by throwing the entry away — the same discipline
// nudge.cjs applies to its settings file. An entry with no name is not an entry at all.
function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  const seed = seedByName(name);
  const scope = Array.isArray(raw.scope)
    ? raw.scope.map((s) => String(s || "").trim()).filter(Boolean)
    : typeof raw.scope === "string" && raw.scope.trim()
    ? raw.scope.trim()
    : "global";
  const clock =
    raw.clock === "write" || raw.clock === "sweep" ? raw.clock : (seed && seed.clock) || "write";
  const debounceMin = Math.max(0, Math.round(Number(raw.debounceMin)) || 0);
  // `afterDays` — the standing judge's one knob, carried the same way: a junk value falls back to
  // the seed's, and a nudge that never declared one carries none.
  const afterDays = Math.max(0, Math.round(Number(raw.afterDays)) || 0);
  return {
    name,
    on: typeof raw.on === "boolean" ? raw.on : true,
    scope,
    severity: raw.severity === "refuse" ? "refuse" : "steer",
    message: typeof raw.message === "string" ? raw.message : "",
    clock,
    ...(debounceMin || (seed && seed.debounceMin) ? { debounceMin: debounceMin || seed.debounceMin } : {}),
    ...(afterDays || (seed && seed.afterDays) ? { afterDays: afterDays || seed.afterDays } : {}),
  };
}

// The record, read fresh on every ask — a flipped switch is honored on the machinery's next read
// (c41), no cache to go stale. ABSENT FILE → SEEDED: the two §2.1 entries are written and
// returned. A file that EXISTS but will not parse is returned as the seed IN MEMORY ONLY — a
// half-edited settings file must never be overwritten by the thing that failed to read it.
function entries() {
  const f = FILE();
  let raw;
  try {
    raw = fs.readFileSync(f, "utf8");
  } catch {
    const seeded = SEED.map((e) => ({ ...e }));
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, `${JSON.stringify(seeded, null, 2)}\n`);
    } catch {}
    return seeded;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return SEED.map((e) => ({ ...e }));
  }
  if (!Array.isArray(parsed)) return SEED.map((e) => ({ ...e }));
  return parsed.map(normalizeEntry).filter(Boolean);
}

const entryOf = (name, list) => (list || entries()).find((e) => e.name === name) || null;

// THE GATE, in its exact precedence:
//   1. no entry in the record → OFF — the record is the authority, not any judge's opinion;
//   2. the switch → `on` must be literally true (c41: off means the moment passes in silence);
//   3. the scope — "global" hits everyone; a list of agent slots hits those slots alone (c34);
//      any other string is a project code and hits that project's sessions alone (c2).
function enabledFor(name, { project = "", slot = "" } = {}, list) {
  const e = entryOf(name, list);
  if (!e) return false;
  if (e.on !== true) return false;
  if (e.scope === "global") return true;
  if (Array.isArray(e.scope)) return !!slot && e.scope.includes(slot);
  return !!project && e.scope === project;
}

// His words when he wrote any (c1), the nudge's built-in line while the field stays empty.
function messageOf(name, list) {
  const e = entryOf(name, list);
  const authored = e && typeof e.message === "string" ? e.message.trim() : "";
  if (authored) return authored;
  return BUILT_IN[name] || "";
}

// DEBOUNCE BOOKKEEPING — lastFired per nudge × document × session (c10), the same shape the hook
// cooldowns keep. In memory on purpose: the window is minutes and the sessions live in this
// process; a burst that survives a shell restart is a new burst.
const lastFired = new Map();
const fireKey = (name, doc, session) => `${name}\u0000${doc}\u0000${session}`;
// One bookkeeping shape, two windows: the write dial reads the entry's debounceMin; the sweep
// reads the chaser's cooldownMin (c35). Same keys, same map — a nudge delivered by either clock
// is a nudge delivered, whichever clock asks next.
function firedWithin(name, { doc = "", session = "", now = Date.now(), min = 0 } = {}) {
  const m = Math.max(0, Number(min) || 0);
  if (!m) return false;
  const last = Number(lastFired.get(fireKey(name, doc, session))) || 0;
  return !!last && now - last < m * 60000;
}
function inDebounce(name, { doc = "", session = "", now = Date.now() } = {}, list) {
  const e = entryOf(name, list);
  return firedWithin(name, { doc, session, now, min: Number(e && e.debounceMin) || 0 });
}
const markFired = (name, { doc = "", session = "", now = Date.now() } = {}) =>
  lastFired.set(fireKey(name, doc, session), now);
const __resetFired = () => lastFired.clear();

// ONE GATE FOR "THIS WRITE COULD BE A REGISTERED DOCUMENT" — the shell-side approximation
// (markdown under a project's session) that the judges dial has always used, factored out because
// the audit enqueue (§2.7, slice 3.4) rides the exact same condition. One predicate, two riders:
// if they shared only a copy of the regex, the day one copy moved the dial and the queue would
// disagree about what a document is, and nothing would say so.
const isRegisteredDocumentWrite = (p) => /\.(md|markdown)$/i.test(String(p || ""));

// ── THE WRITE-TIME CLOCK ────────────────────────────────────────────────────────────────────────
// `file.changed` landed in a session; is there anything to steer it with? Returns the gated
// steering messages — the caller (sessions.cjs) owns the delivery. Every failure path returns [].
//
// JUDGED IN THIS PROCESS, over the parse this process already runs (markdown/judges.cjs). Nothing
// crosses a wire, so there is no transport to degrade — an unreadable file is the only absence, and
// it reads as nothing to report.
async function judgeWrite({ path: p = "", project = "", slot = "", session = "", now = Date.now() } = {}) {
  // Only a markdown file can be a registered document — anything else never costs a parse.
  if (!isRegisteredDocumentWrite(p)) return [];
  const list = entries();
  const out = [];

  // NO WRITE-CLOCK JUDGE IS ON AND IN SCOPE → THE FILE IS NOT EVEN READ (c41). `open-corrections`
  // is explicitly not counted here: it rides this clock for its MOMENT and derives nothing from
  // the document, so letting it arm the dial would parse a file for a nudge that never looks at
  // one — and would quietly break the guarantee that switching the judges off costs nothing.
  const armed = list.some(
    (e) => e.clock === "write" && e.name !== OPEN_CORRECTIONS && enabledFor(e.name, { project, slot }, list)
  );
  const violations = armed ? await judgeDocument(p, { project }) : [];
  for (const v of violations) {
    if (!v || typeof v !== "object") continue;
    const name = String(v.nudge || "").trim();
    if (!name) continue;
    const e = entryOf(name, list);
    if (!e || e.clock !== "write") continue; // a sweep nudge waits for its own clock
    if (!enabledFor(name, { project, slot }, list)) continue;
    const doc = String(v.path || p);
    if (inDebounce(name, { doc, session, now }, list)) continue; // a burst earns one message (c10)
    const message = messageOf(name, list);
    if (!message) continue; // nothing to say is not a delivery
    const line = Number(v.line) || 0;
    const detail = String(v.detail || "").trim();
    // NO STAMP HERE — see confirmSteer below. This clock's steer is QUEUED as a turn and delivered
    // whenever the session next takes one, so the stamp belongs at delivery: stamping now would
    // spend the window on a message that may be dropped for being stale, silencing the next
    // GENUINE violation on this document. The two sweep clocks still stamp at derivation because
    // they derive and deliver inside one tick.
    out.push({
      nudge: name,
      path: doc,
      abs: p, // what delivery re-reads — `path` may be the violation's relative one
      project,
      ...(line ? { line } : {}),
      text:
        `⚖️ Steering nudge — from the harness, not the human. A judge reported a violation in a ` +
        `document this session just wrote: ${message}\n\n→ ${doc}${line ? `:${line}` : ""}` +
        (detail ? ` — ${detail}` : ""),
    });
  }

  // AND WHAT THIS AGENT OWES — RFC-078 §2.8, slice 3.12. Nothing about the document just written;
  // the write is only the MOMENT. This clock reaches the session that wrote and no other, which
  // was exactly wrong for delivering somebody else's finding and is exactly right here: the agent
  // being told what it owes IS the session in the room. So delivery rides the agent's own next
  // piece of work rather than a schedule — an agent that writes no registered document is not
  // steered, and `mcp__corrections__mine` is how it finds out instead.
  const owed = correctionsFor(slot || project);
  if (owed.length && enabledFor(OPEN_CORRECTIONS, { project, slot }, list)) {
    const doc = String(p);
    if (!inDebounce(OPEN_CORRECTIONS, { doc, session, now }, list)) {
      const message = messageOf(OPEN_CORRECTIONS, list);
      if (message) {
        const first = owed[0];
        out.push({
          nudge: OPEN_CORRECTIONS,
          path: doc,
          abs: p,
          project,
          // THE SLOT RIDES WITH IT, because confirmSteer re-derives "does this agent still owe
          // anything" and the session key is not the agent's name. Without it the re-derivation
          // asks about the project code and an agent whose slot differs is never confirmed.
          slot: slot || project,
          owed: owed.length,
          text:
            `⚖️ Steering nudge — from the harness, not the human. You have ` +
            `${owed.length} open correction${owed.length > 1 ? "s" : ""} in the audit queue: ${message}` +
            `\n\n→ ${first.by ? `${first.by}: ` : ""}${first.text}` +
            (first.target ? `\n→ about ${first.target}` : "") +
            (owed.length > 1 ? `\n→ and ${owed.length - 1} more` : ""),
        });
      }
    }
  }
  return out;
}

// DERIVED ON EVERY ASK INCLUDES THE ASK AT DELIVERY — the write clock's one honest gap, closed.
//
// `judgeWrite` derives when the file changes; `deliverSteers` pushes a TURN, which the session
// takes whenever it next yields. Between those two moments the agent is usually still working on
// the very document that was judged — so the fix often lands first and the steer then reports a
// violation that no longer exists. Measured 2026-11-08: a claim was marked met with no fold, the
// fold went in, the mark then came off entirely, and the steer still arrived describing the
// original state. RFC-078's own principle is that a violation is not removed but STOPS EXISTING
// (the derived-on-every-ask claim); a queued message was the one place that stopped being true.
//
// So the steer is re-derived here, and only now is the debounce stamped. Three outcomes:
//   · the violation is gone      → dropped, and the caller says so in the feed (nothing is invisible)
//   · another steer already went  → dropped by the window, which is what the window is for
//   · it still stands             → stamped and delivered
//
// A re-read that THROWS delivers anyway: a judge that cannot answer must never swallow a standing
// violation, which is the same direction every other failure in this module falls.
async function confirmSteer(st, { session = "", now = Date.now() } = {}) {
  if (!st || typeof st !== "object") return false;
  if (!st.abs) return true; // a sweep or run steer — derived and delivered in one tick, nothing to re-read
  const name = String(st.nudge || "").trim();
  if (!name) return false;
  const doc = String(st.path || st.abs);
  const list = entries();
  if (inDebounce(name, { doc, session, now }, list)) return false;

  // A CORRECTION STEER RE-DERIVES WHAT IT IS ABOUT, which is not a document violation — asking the
  // judges about it would find nothing and drop it every single time. What it re-reads is whether
  // the agent still owes anything: a correction cleared between derivation and delivery must not
  // be announced, for the same reason a fixed violation must not be.
  if (name === OPEN_CORRECTIONS) {
    if (!correctionsFor(st.slot || st.project || "").length) return false;
    markFired(name, { doc, session, now });
    return true;
  }

  let violations;
  try {
    // THE JUDGES DIRECTLY, not judgeDocument — that wrapper returns [] on a throw, which would
    // make "the judge could not read it" indistinguishable from "there is no violation" and so
    // drop a STANDING violation silently. The distinction is the whole point of this branch, and
    // the suite's unreadable-re-check case is what caught it.
    const out = await judges().forFile(st.abs, { path: st.abs, project: st.project || "" });
    violations = Array.isArray(out) ? out : [];
  } catch {
    markFired(name, { doc, session, now });
    return true;
  }
  if (!(violations || []).some((v) => v && String(v.nudge || "").trim() === name)) return false;
  markFired(name, { doc, session, now });
  return true;
}

// ── THE AUDIT QUEUE — RFC-078 §2.7, slice 3.4 ──────────────────────────────────────────────────
// The system reaches out to the manager: no agent ever asks for an audit. When a registered-
// document write lands in a session, an entry {project, path, at} is appended here for the
// manager's drain (the work-audit job, slice 3.5) to read.
//
// A DELIBERATE NARROWING, stated: §2.7 says the dial "sees met-marks and report filings" — but
// the shell NEVER LEARNS WHAT A BLOCK IS (the boundary at the top of this file), so it cannot
// tell a met-mark from a typo fix. The enqueue condition is therefore "a write to a registered
// document" — the exact gate the judges dial rides (isRegisteredDocumentWrite, one predicate for
// both) — and the met-mark/report-filing specificity moves to the DRAIN, which reads the document
// and decides what, if anything, needs auditing. A few spurious entries cost the drain one read
// each; a shell that parses blocks costs the boundary.
//
// THE ENTRY LEAVES ONLY WHEN THE DRAIN REMOVES IT (3.5). This half only appends, debounced per
// document by the same debounceMin discipline the write dial keeps: one entry per document per
// window, and a later write inside the window refreshes NOTHING — not even `at`, because the
// drain reads the document fresh and a refreshed stamp would only push the audit further away.
// Debounced against the QUEUE ITSELF, not the in-memory map, so a burst spanning a shell restart
// is still one entry.
const QUEUE_FILE = () =>
  process.env.AUTOBOT_AUDIT_QUEUE_FILE || path.join(os.homedir(), ".autobot", "audit-queue.json");

// The default window, matching the seed's write-dial debounceMin. When the manager's own entry
// lands in the record (3.5), this knob can move there with the rest of its settings.
const AUDIT_DEBOUNCE_MIN = 10;

// A CORRECTION — RFC-078 §2.8. Words with an address: `by` judged it, `for` owes it, `target` is
// what it is about (a claim address, a file, a repo, a practice — deliberately unconstrained), and
// `text` is the correction. Normalized by the same tolerance as the entry around it: a row missing
// the three fields that make it addressable is dropped rather than carried as a half-thing.
function normalizeCorrection(c) {
  if (!c || typeof c !== "object") return null;
  const out = {
    id: String(c.id || ""),
    at: Number(c.at) || 0,
    by: String(c.by || ""),
    for: String(c.for || ""),
    target: String(c.target || ""),
    text: String(c.text || ""),
  };
  // `id` is the address clearCorrection works by and `for` is the whole point of the field; a
  // correction missing either cannot be delivered or discharged, so it is not one.
  if (!out.id || !out.for || !out.text) return null;
  return out;
}

// TOLERANT LIKE EVERY FILE HERE: missing is empty, junk is empty, and junk ROWS are dropped one
// by one — a half-broken queue never crashes the write path that feeds it.
//
// AND IT PARSES THE ENTRY RATHER THAN REBUILDING IT (§2.8, c43). This function used to map every
// row to exactly `{project, path, at}` and drop whatever else was on it, which `writeAuditQueue`
// then persisted — so any field added to an entry was destroyed by the next read-write cycle,
// silently and with no error anywhere. `corrections` is the field that made that fatal: it is the
// amendment's whole mechanism, and the reader is where it lives or dies.
//
// A PATHLESS ENTRY IS LEGITIMATE NOW, and only when it carries a correction (§2.8, c46). A
// correction about a practice, a repo or an agent's conduct has no document write behind it and no
// path to name; the submission creates the entry itself. With nothing owed on it, though, a row
// with no path is still junk — there is no document for the drain to read and nothing for anyone
// to do, which is the silt the old filter was written against.
function readAuditQueue() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(QUEUE_FILE(), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const corrections = (Array.isArray(e.corrections) ? e.corrections : [])
        .map(normalizeCorrection)
        .filter(Boolean);
      const entry = { project: String(e.project || ""), path: String(e.path || ""), at: Number(e.at) || 0 };
      return corrections.length ? { ...entry, corrections } : entry;
    })
    .filter((e) => e.project && e.at && (e.path || (e.corrections && e.corrections.length)));
}

// ── THE RECORD'S WRITE SIDE (RFC-078 §2.5) ──────────────────────────────────────────────────────
// The panel flips a switch and THIS is what changes — the file the machinery reads on every ask, so
// there is no second copy of the state and no cache to go stale (c17, c41). Read is `entries()`
// above; nothing else in this module writes.
//
// MERGE BY NAME, NEVER REPLACE THE LIST. The panel sends one entry's one changed field, the way
// nudge.writeSettings takes a patch, because a surface that has to hold the whole record to change
// one switch is a surface that overwrites whatever a concurrent edit just wrote. A name that is not
// in the file yet is APPENDED, which is how a nudge the seed grew later gets its row.
//
// WHAT IT WILL NOT DO: invent entries, reorder them, or write a field normalizeEntry would reject.
// Every patch goes through the same normalizer the read side uses, so the panel cannot put the
// machinery into a state the machinery would not have read.
function writeEntry(name, patch = {}) {
  const key = String(name || "").trim();
  if (!key) return { ok: false, error: "a nudge is addressed by name" };
  const list = entries();
  const at = list.findIndex((e) => e.name === key);
  const merged = normalizeEntry({ ...(at >= 0 ? list[at] : { name: key }), ...patch, name: key });
  if (!merged) return { ok: false, error: `could not read a nudge out of that patch for "${key}"` };
  const next = at >= 0 ? list.map((e, i) => (i === at ? merged : e)) : [...list, merged];
  if (!writeRecord(next)) return { ok: false, error: "the record could not be written" };
  return { ok: true, entry: merged, entries: next };
}

// ATOMIC, same discipline as the queue below: tmp in the same directory then rename, so a clock
// reading mid-write sees the old record or the new one and never half a JSON file. A record that
// cannot be written is a refusal the caller reports, never a half-applied flip.
function writeRecord(list) {
  const f = FILE();
  const tmp = `${f}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
    fs.renameSync(tmp, f);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}

// ATOMIC: tmp in the same directory, then rename — a drain that reads mid-write must see the old
// queue or the new one, never half a JSON file.
function writeAuditQueue(list) {
  const f = QUEUE_FILE();
  const tmp = `${f}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
    fs.renameSync(tmp, f);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return false; // a queue that cannot be written must never break the write that fed it
  }
}

// EVERY WRITE RE-READS — RFC-078 §2.8, c44. The old shape was read, modify the list you read, write
// it all back; the tmp-then-rename under it buys a READER a whole file and buys a second WRITER
// nothing at all, because two writers that both read the same queue and both rename is
// last-writer-wins and the first one's correction is gone with no error. The queue had one writer
// when that was written; corrections give it as many writers as there are agents.
//
// So no door here computes from a list it read earlier: `mutate` reads immediately before the
// write and hands the mutator what is on disk NOW. The window is not zero — nothing short of a
// lock makes it zero — but it is the width of this function rather than the width of an agent's
// turn, which is the difference between rare and routine.
function mutateQueue(fn) {
  const fresh = readAuditQueue();
  const next = fn(fresh);
  if (next === null || next === undefined) return null; // the mutator declined; nothing is written
  return writeAuditQueue(next) ? next : null;
}

// A refusal is a SENTENCE, not a false. Every door here hands back { ok, reason } because the
// caller's job is to say it out loud: sessions.cjs emits it into the asking session's own feed,
// the way a dropped steer already does — "a thing that vanishes silently is indistinguishable
// from a thing that never happened."
const refuse = (reason) => ({ ok: false, reason });

// ids are short, sortable and unique within a queue — the address clearCorrection works by.
function correctionId(now, taken) {
  const base = Number(now || 0).toString(36);
  let id = base;
  for (let n = 1; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// SUBMIT — RFC-078 §2.8, slices 3.9/3.10. The feature the section exists for. Joins the entry
// already standing for this document (the write dial refuses a document enqueued inside its
// window, so the entry a correction wants may be the only one it will get), and creates one where
// no document write produced anything at all.
function submitCorrection({ project = "", path: p = "", by = "", for: owes = "", target = "", text = "", now = Date.now() } = {}) {
  if (!String(project).trim()) return refuse("a correction needs a project to belong to");
  if (!String(owes).trim()) return refuse("a correction has to name the agent who owes it — `for` is the whole point of the field");
  if (!String(text).trim()) return refuse("a correction with no words is nothing to act on");

  let written = null;
  const applied = mutateQueue((queue) => {
    const taken = new Set(queue.flatMap((e) => (e.corrections || []).map((c) => c.id)));
    const correction = {
      id: correctionId(now, taken),
      at: Number(now) || 0,
      by: String(by || ""),
      for: String(owes).trim(),
      target: String(target || ""),
      text: String(text).trim(),
    };
    written = correction;
    const doc = String(p || "");
    const i = doc ? queue.findIndex((e) => e.path === doc && e.project === project) : -1;
    if (i >= 0) {
      const e = queue[i];
      const next = [...queue];
      next[i] = { ...e, corrections: [...(e.corrections || []), correction] };
      return next;
    }
    return [...queue, { project: String(project), path: doc, at: Number(now) || 0, corrections: [correction] }];
  });
  if (!applied) return refuse("the queue could not be written");
  return { ok: true, correction: written, joined: !!String(p || "") };
}

// CLEAR — and it refuses the agent the correction is FOR. An agent cannot clear its own
// correction; that is the same principle every other judgment in this system rests on, and it is
// here rather than in a job document precisely so it is a refusal and not a rule somebody honours.
function clearCorrection({ id = "", by = "" } = {}) {
  const wanted = String(id).trim();
  if (!wanted) return refuse("clearing needs the correction's id — nothing else addresses one");
  if (!String(by).trim()) return refuse("clearing is signed work: it needs the name of whoever is clearing it");

  let found = null;
  const applied = mutateQueue((queue) => {
    for (const e of queue) found = (e.corrections || []).find((c) => c.id === wanted) || found;
    if (!found) return null;
    if (found.for === String(by).trim()) return null; // the refusal below says which it was
    return queue.map((e) => {
      if (!e.corrections || !e.corrections.some((c) => c.id === wanted)) return e;
      const rest = e.corrections.filter((c) => c.id !== wanted);
      const { corrections, ...bare } = e;
      return rest.length ? { ...bare, corrections: rest } : bare;
    });
  });
  if (!found) return refuse(`no correction here has the id ${wanted}`);
  if (found.for === String(by).trim())
    return refuse(`a correction is not cleared by the agent it is for — ${found.for} owes this one, so somebody else closes it`);
  if (!applied) return refuse("the queue could not be written");
  return { ok: true, cleared: found };
}

// READ — the other side of the same file. A pure read: it never writes, so the two doors above can
// depend on a correction still being there after anybody looks at it.
function correctionsFor(slot) {
  const who = String(slot || "").trim();
  if (!who) return [];
  return readAuditQueue().flatMap((e) =>
    (e.corrections || [])
      .filter((c) => c.for === who)
      .map((c) => ({ ...c, project: e.project, path: e.path }))
  );
}

// REMOVE — the drain's door, and the inversion this amendment is for. An entry holding an open
// correction STAYS: the queue stops measuring recent attention and starts measuring outstanding
// repair. An entry holding none leaves exactly as it does today, so a clean pass still empties.
function removeEntry({ project = "", path: p = "", at = 0 } = {}) {
  const match = (e) => e.project === String(project) && e.path === String(p || "") && e.at === (Number(at) || 0);
  const standing = readAuditQueue().find(match);
  if (!standing) return refuse("no entry here matches that project, path and stamp");
  if (standing.corrections && standing.corrections.length)
    return refuse(
      `this entry holds ${standing.corrections.length} open correction${standing.corrections.length > 1 ? "s" : ""} — ` +
        "clear them and it leaves on its own; checked is no longer out"
    );
  const applied = mutateQueue((queue) => queue.filter((e) => !match(e)));
  if (!applied) return refuse("the queue could not be written");
  return { ok: true, removed: standing };
}

// The append — called from the same seam as the judges dial (sessions.cjs maybeSteerWrite, on
// `file.changed`). Returns the entry it wrote, or null when the gate or the window said no.
function enqueueAudit({ path: p = "", project = "", now = Date.now(), debounceMin = AUDIT_DEBOUNCE_MIN } = {}) {
  if (!project) return null; // no project, no scope for the drain to read — not an auditable write
  if (!isRegisteredDocumentWrite(p)) return null; // the one gate, shared with the judges dial
  const doc = String(p);
  const queue = readAuditQueue();
  const windowMs = Math.max(0, Number(debounceMin) || 0) * 60000;
  if (windowMs && queue.some((e) => e.path === doc && now - e.at < windowMs)) return null;
  const entry = { project: String(project), path: doc, at: now };
  // THROUGH THE SAME RE-READING WRITE as every door above (c44) — the debounce decision is made on
  // the list read a line ago, and the append lands on whatever is on disk at write time.
  if (!mutateQueue((fresh) => [...fresh, entry])) return null;
  return entry;
}

// ── THE SWEEP CLOCK — RFC-078 §2.3, slice 3.3 ──────────────────────────────────────────────────
//
// Both halves ride the chaser's existing idle tick (sessions.cjs calls them from the same
// setInterval that runs maybeNudge), which IS the turn-end discipline: the tick returns early
// while a turn or a tool is in flight, so a standing violation only ever meets a quiet session
// (c35). Both are bookkept per nudge × document × session under the chaser's cooldownMin.

// THE SHELL-LOCAL STANDING JUDGE: `run-untouched-for-days`. Pure over the run rows the caller
// hands in (the caller filters to the ticking agent's own runs — ownership is the chaser's rule,
// not re-derived here).
//
// WHAT COUNTS AS MOVEMENT: `updatedAt`. Every write to a run record bumps it — an item change, a
// status write, an attachment, a whiteboard edit — EXCEPT the chaser's own nudge stamp, which
// worklist.markNudged deliberately leaves off the clock: a run that is only ever nudged is the
// exact run this judge exists to name, and a stamp that reset the clock would silence it forever.
//
// WHAT COUNTS AS OPEN: items exist and not all are done, and the run is not excused — `excused`
// is passed in by the caller (nudge.cjs's excusedOf, the §2.4 rule: status starting "abandoned"
// AND at least one attachment), so the one definition stays in the chaser's module. The fallback
// here implements the same rule for a caller that passes nothing.
function judgeRuns({ runs = [], project = "", slot = "", session = "", now = Date.now(), cooldownMin = 30, excused } = {}) {
  const name = "run-untouched-for-days";
  const list = entries();
  const e = entryOf(name, list);
  if (!e || e.clock !== "sweep") return []; // its own clock, symmetric with the write dial
  if (!enabledFor(name, { project, slot }, list)) return [];
  const afterDays = Math.max(1, Number(e.afterDays) || 7);
  const isExcused =
    typeof excused === "function"
      ? excused
      : (r) =>
          /^\s*abandoned/i.test(String((r && r.status && r.status.text) || "")) &&
          Array.isArray(r && r.attachments) &&
          r.attachments.some(Boolean);
  const out = [];
  for (const r of runs || []) {
    if (!r || !String(r.source || "")) continue; // a session's own plan is never judged
    const total = Number(r.total) || 0;
    const done = Number(r.done) || 0;
    if (!total || done >= total) continue; // closed: every item done
    if (isExcused(r)) continue; // ended honestly: abandoned with its account attached
    const moved = Number(r.updatedAt) || 0;
    if (!moved) continue; // a record with no clock cannot be aged honestly
    const days = Math.floor((now - moved) / 86400000);
    if (days < afterDays) continue;
    const doc = String(r.owner || "");
    if (firedWithin(name, { doc, session, now, min: cooldownMin })) continue;
    const message = messageOf(name, list);
    if (!message) continue; // nothing to say is not a delivery
    markFired(name, { doc, session, now });
    out.push({
      nudge: name,
      run: doc,
      source: String(r.source || ""),
      days,
      text:
        `⏰ Standing nudge — from the harness, not the human. A sourced run has sat untouched for ` +
        `${days} day${days === 1 ? "" : "s"} — no item changed, no status written: \`${r.source}\` ` +
        `stands at ${done}/${total}. ${message}`,
    });
  }
  return out;
}

// WHICH PROJECTS ARE CONNECTED — ~/.autobot/projects.json, the same map every other reader here
// uses. Env-pointed for tests, same law as the record file: a suite never gets the real keys.
const PROJECTS_FILE = () =>
  process.env.AUTOBOT_PROJECTS_FILE || path.join(os.homedir(), ".autobot", "projects.json");
function connectedProjects() {
  try {
    const map = JSON.parse(fs.readFileSync(PROJECTS_FILE(), "utf8"));
    return map && typeof map === "object" && !Array.isArray(map) ? Object.keys(map) : [];
  } catch {
    return []; // no map is no projects — the sweep simply has nowhere to ask about
  }
}

// HOW MANY STEERS ONE PROJECT SWEEP MAY DELIVER. The first sweep over a registry carrying years of
// historical debt can answer dozens of violations at once (the live count the RFC's own c6 found
// was 82); delivering them all would bury the session in steering turns at a single moment.
// Three per window steers without burying — and because violations are DERIVED on every ask and
// never stored, the rest simply arrive in later windows, nothing lost.
const SWEEP_MAX_STEERS = 3;

// THE PROJECT-WIDE DIAL — once per project per cooldown window, and that ceiling is the point:
// the idle tick can fire as often as every minute, per session, and a project can hold several
// sessions, so dialling on every tick would multiply one question by sessions × ticks. Nothing is
// gained by asking more often than the chaser's cooldownMin, because delivery itself is capped at
// that window per nudge × document × session — an answer that cannot be delivered is an answer
// nobody needed yet. The stamp is written BEFORE the walk so a registry that cannot be read is
// retried next window, never re-walked every tick.
const lastSwept = new Map(); // project → ts of the last sweep
const __resetSweep = () => lastSwept.clear();
async function judgeProject({ project = "", slot = "", session = "", now = Date.now(), cooldownMin = 30 } = {}) {
  if (!project) return [];
  const list = entries();
  // No sweep-clock DOCUMENT nudge is on and in scope → the registry is not even walked. Shell-local
  // names never arm this pass: their judging is runs and sessions, which document judges never see.
  const armed = list.some(
    (e) => e.clock === "sweep" && !SHELL_LOCAL.has(e.name) && enabledFor(e.name, { project, slot }, list),
  );
  if (!armed) return [];
  const last = Number(lastSwept.get(project)) || 0;
  if (last && now - last < Math.max(1, Number(cooldownMin) || 30) * 60000) return [];
  lastSwept.set(project, now);
  let violations;
  try {
    const out = await judges().forProject(project);
    violations = Array.isArray(out) ? out : [];
  } catch {
    return []; // a registry that cannot be walked has nothing to report
  }
  // LEAST-RECENTLY-STEERED FIRST, never the registry's order. With more standing violations than
  // the cap, the first three would re-deliver every window (their cooldown is the same length as
  // the dial window) and the rest would starve forever; ranking by last-fired rotates the whole
  // debt through the cap, so "the rest arrive in later windows" is true rather than hopeful.
  const lastOf = (v) =>
    Number(lastFired.get(fireKey(String((v && v.nudge) || ""), String((v && v.path) || ""), session))) || 0;
  const ranked = violations.slice().sort((a, b) => lastOf(a) - lastOf(b));
  const out = [];
  for (const v of ranked) {
    if (out.length >= SWEEP_MAX_STEERS) break; // the rest re-derive next window — never marked, never lost
    if (!v || typeof v !== "object") continue;
    const name = String(v.nudge || "").trim();
    if (!name || SHELL_LOCAL.has(name)) continue;
    const e = entryOf(name, list);
    if (!e || e.clock !== "sweep") continue; // a write nudge waits for its own clock, symmetrically
    if (!enabledFor(name, { project, slot }, list)) continue;
    const doc = String(v.path || "");
    if (!doc) continue;
    if (firedWithin(name, { doc, session, now, min: cooldownMin })) continue;
    const message = messageOf(name, list);
    if (!message) continue; // nothing to say is not a delivery
    const line = Number(v.line) || 0;
    const detail = String(v.detail || "").trim();
    markFired(name, { doc, session, now });
    out.push({
      nudge: name,
      path: doc,
      ...(line ? { line } : {}),
      text:
        `⚖️ Standing nudge — from the harness, not the human. The sweep found a standing ` +
        `violation in this project's registry: ${message}\n\n→ ${doc}${line ? `:${line}` : ""}` +
        (detail ? ` — ${detail}` : ""),
    });
  }
  return out;
}

module.exports = {
  FILE, SEED, BUILT_IN, SHELL_LOCAL, SWEEP_MAX_STEERS, entries, enabledFor, messageOf,
  inDebounce, firedWithin, markFired, __resetFired, judgeWrite, judgeDocument, __setJudges,
  writeEntry, writeRecord,
  judgeRuns, connectedProjects, judgeProject, __resetSweep,
  QUEUE_FILE, AUDIT_DEBOUNCE_MIN, readAuditQueue, writeAuditQueue, enqueueAudit,
  submitCorrection, clearCorrection, correctionsFor, removeEntry, OPEN_CORRECTIONS,
  isRegisteredDocumentWrite, confirmSteer,
};
