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
]);

// THE BUILT-IN LINES — what arrives while `message` stays empty (c1). The chaser composes its own
// words in nudge.cjs, so its built-in here is deliberately none.
const BUILT_IN = Object.freeze({
  "behavioural-claim-cmd-only":
    "a behavioural claim owes a ::test or :::run in its own fold — a cmd is evidence, never the spec",
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
  return {
    name,
    on: typeof raw.on === "boolean" ? raw.on : true,
    scope,
    severity: raw.severity === "refuse" ? "refuse" : "steer",
    message: typeof raw.message === "string" ? raw.message : "",
    clock,
    ...(debounceMin || (seed && seed.debounceMin) ? { debounceMin: debounceMin || seed.debounceMin } : {}),
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
function inDebounce(name, { doc = "", session = "", now = Date.now() } = {}, list) {
  const e = entryOf(name, list);
  const min = Math.max(0, Number(e && e.debounceMin) || 0);
  if (!min) return false;
  const last = Number(lastFired.get(fireKey(name, doc, session))) || 0;
  return !!last && now - last < min * 60000;
}
const markFired = (name, { doc = "", session = "", now = Date.now() } = {}) =>
  lastFired.set(fireKey(name, doc, session), now);
const __resetFired = () => lastFired.clear();

// ── THE WRITE-TIME DIAL ─────────────────────────────────────────────────────────────────────────
// `file.changed` landed in a session; is there anything to steer it with? Returns the gated
// steering messages — the caller (sessions.cjs) owns the delivery. Every failure path returns [].
async function judgeWrite({ path: p = "", project = "", slot = "", session = "", now = Date.now(), hub = "" } = {}) {
  // Only a markdown file can be a registered document — anything else never costs a dial.
  if (!/\.(md|markdown)$/i.test(String(p || ""))) return [];
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

module.exports = { FILE, SEED, BUILT_IN, entries, enabledFor, messageOf, inDebounce, markFired, __resetFired, judgeWrite };
