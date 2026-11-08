// THE NUDGE RECORD — RFC-078 §2.1 (systemview). One file, a list, one entry per nudge: the
// run-chaser rides it as the FIRST entry (identity, on/off, scope — nothing more; its real knobs
// stay in nudge.json, which this module never reads and never writes), and every judge-backed
// nudge after it. The record is the setting: the machinery obeys the file, never a panel.
//
// AND THE WRITE-TIME CLOCK — RFC-078 §2.3. The shell already sees `file.changed` per session;
// when the path looks like a registered document (markdown under the session's own worktree) this
// module dials the hub's judges door and gates what came back: on, in scope, write-clock, outside
// its debounce window. What survives the gates is a steering message for THE SESSION THAT WROTE
// IT — sessions.cjs delivers it on the same input-queue ride the run-chaser uses.
//
// AND THE SWEEP CLOCK — RFC-078 §2.3, slice 3.3. The standing judges ride the chaser's own idle
// tick (sessions.cjs), under the chaser's cooldownMin:
//   - `judgeRuns` — the shell-local standing judge `run-untouched-for-days`: a SOURCED run that is
//     still open and has not MOVED for `afterDays` days (default 7) is a standing violation.
//     Movement is any write to the run record EXCEPT the chaser's own nudge stamp — an item
//     change, a status write, an attachment, a whiteboard edit all move it; being nudged does not
//     (worklist.markNudged preserves `updatedAt` for exactly this reason). `afterDays` is the
//     entry's one numeric knob, editable in the record like any other field.
//   - `judgeProject` — the project-wide judges door, dialled once per CONNECTED project
//     (~/.autobot/projects.json) per cooldown window, for registry-wide violations no single
//     write triggers. Delivery is capped per sweep (SWEEP_MAX_STEERS) so a first pass over years
//     of historical debt steers instead of burying; the rest are re-derived next window, because
//     violations are never stored.
//
// THE BOUNDARY (§1, the cost paragraph that arbitrated the design): the hub judges, because the
// parsed state already lives there; the shell asks, because the sessions live here. THIS FILE
// NEVER LEARNS WHAT A BLOCK IS — a violation arrives named, pointed, and already judged. The hub
// is only ever DIALLED: no listener, no push channel, no connection opened toward the shell (c12).
//
// DEGRADATION IS LAW. A hub that is down, older (no judges route — 404), or answering a shape
// this shell has never heard of means NOTHING fires and nothing crashes: an absent answer reads
// as nothing to report, exactly the skew rule tests/hub-skew.js holds the renderers to.
const fs = require("fs");
const os = require("os");
const path = require("path");

// Overridable for tests, same pattern as AUTOBOT_NUDGE_FILE in nudge.cjs — a suite must never get
// the keys to the real house.
const FILE = () =>
  process.env.AUTOBOT_NUDGES_FILE || path.join(os.homedir(), ".autobot", "nudges.json");

// ONE DERIVATION OF THE HUB'S ADDRESS — systemview.cjs owns it ("pointed at, never copied").
// Required lazily so a test driving the gates alone never pays for the SDK that file loads.
const HUB = () => require("./systemview.cjs").HUB();

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
  // violation. Judged in the shell (judgeRuns) because run state lives here, never by the hub.
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

// JUDGED IN THE SHELL, NEVER DELIVERED OFF A HUB ANSWER. The hub knows documents; these two know
// runs and sessions. A hub answer claiming one of these names is skipped — whichever half judged
// a violation is the half that delivers it, or one violation arrives twice.
const SHELL_LOCAL = new Set(["run-chaser", "run-untouched-for-days"]);

// THE BUILT-IN LINES — what arrives while `message` stays empty (c1). The chaser composes its own
// words in nudge.cjs, so its built-in here is deliberately none.
const BUILT_IN = Object.freeze({
  "behavioural-claim-cmd-only":
    "a behavioural claim owes a ::test or :::run in its own fold — a cmd is evidence, never the spec",
  // The facts (which run, how many days) ride the header judgeRuns composes; this is the law in
  // one breath that follows them, his to replace by editing the entry's message (c1).
  "run-untouched-for-days":
    "read `worklist get`, then either drive the run to done or end it honestly — a status starting \"abandoned\" with the account attached. Sitting still is the one thing a sourced run may not do.",
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
//   1. no entry in the record → OFF — the record is the authority, not the hub's opinion;
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

// ── THE WRITE-TIME DIAL ─────────────────────────────────────────────────────────────────────────
// `file.changed` landed in a session; is there anything to steer it with? Returns the gated
// steering messages — the caller (sessions.cjs) owns the delivery. Every failure path returns [].
async function judgeWrite({ path: p = "", project = "", slot = "", session = "", now = Date.now(), hub = "" } = {}) {
  // Only a markdown file can be a registered document — anything else never costs a dial.
  if (!isRegisteredDocumentWrite(p)) return [];
  const list = entries();
  // No write-clock nudge is on and in scope for this session → the hub is not even dialled.
  const armed = list.some((e) => e.clock === "write" && enabledFor(e.name, { project, slot }, list));
  if (!armed) return [];
  let violations;
  try {
    const res = await fetch(`${hub || HUB()}/judges?path=${encodeURIComponent(p)}`);
    if (!res || !res.ok) return []; // down, or an older hub with no judges route — nothing to report
    const body = await res.json();
    violations = Array.isArray(body) ? body : body && Array.isArray(body.violations) ? body.violations : [];
  } catch {
    return []; // a hub that cannot answer is a hub with nothing to report
  }
  const out = [];
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
    markFired(name, { doc, session, now });
    out.push({
      nudge: name,
      path: doc,
      ...(line ? { line } : {}),
      text:
        `⚖️ Steering nudge — from the harness, not the human. A judge reported a violation in a ` +
        `document this session just wrote: ${message}\n\n→ ${doc}${line ? `:${line}` : ""}` +
        (detail ? ` — ${detail}` : ""),
    });
  }
  return out;
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

// TOLERANT LIKE EVERY FILE HERE: missing is empty, junk is empty, and junk ROWS are dropped one
// by one — a half-broken queue never crashes the write path that feeds it.
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
    .map((e) => ({ project: String(e.project || ""), path: String(e.path || ""), at: Number(e.at) || 0 }))
    .filter((e) => e.project && e.path && e.at);
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
  if (!writeAuditQueue([...queue, entry])) return null;
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
// nobody needed yet. The stamp is written BEFORE the fetch so a hub that is down is retried next
// window, never hammered every tick.
const lastDialled = new Map(); // project → ts of the last dial
const __resetSweep = () => lastDialled.clear();
async function judgeProject({ project = "", slot = "", session = "", now = Date.now(), cooldownMin = 30, hub = "" } = {}) {
  if (!project) return [];
  const list = entries();
  // No sweep-clock, hub-backed nudge is on and in scope → the hub is not even dialled. Shell-local
  // names never arm the dial: their judging lives here, the door has nothing to say about them.
  const armed = list.some(
    (e) => e.clock === "sweep" && !SHELL_LOCAL.has(e.name) && enabledFor(e.name, { project, slot }, list),
  );
  if (!armed) return [];
  const last = Number(lastDialled.get(project)) || 0;
  if (last && now - last < Math.max(1, Number(cooldownMin) || 30) * 60000) return [];
  lastDialled.set(project, now);
  let violations;
  try {
    const res = await fetch(`${hub || HUB()}/judges?project=${encodeURIComponent(project)}`);
    if (!res || !res.ok) return []; // down, or an older hub with no judges route — nothing to report
    const body = await res.json();
    violations = Array.isArray(body) ? body : body && Array.isArray(body.violations) ? body.violations : [];
  } catch {
    return []; // a hub that cannot answer is a hub with nothing to report
  }
  // LEAST-RECENTLY-STEERED FIRST, never the hub's order. With more standing violations than the
  // cap, the hub's first three would re-deliver every window (their cooldown is the same length as
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
  inDebounce, firedWithin, markFired, __resetFired, judgeWrite,
  judgeRuns, connectedProjects, judgeProject, __resetSweep,
  QUEUE_FILE, AUDIT_DEBOUNCE_MIN, readAuditQueue, writeAuditQueue, enqueueAudit,
  isRegisteredDocumentWrite,
};
