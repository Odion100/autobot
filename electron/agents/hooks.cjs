// CONTEXT HOOKS — an event that points an agent at a procedure, at the moment it matters.
//
// The stack had two modes for getting context to an agent: LOADED (presence, the system context,
// the agent's own doc — paid every turn, forever) and RETRIEVED (the store, docs, skills — paid
// only when the agent thinks to ask). Hooks are a third, for the procedure that is needed rarely
// and urgently: compaction prep is four steps every agent would carry all session to use almost
// never, and the agent will not think to ask for it because the moment arrives from OUTSIDE. It
// has to be pushed.
//
// A HOOK HOLDS NO CONTENT. It says "this moment happened, and this skill applies" and hands over a
// POINTER; the agent still decides whether to pull it. That keeps the intended-not-enforced
// property skills already have, it costs a line instead of a procedure, and — the part that
// matters most here — a hook can never drift from the skill, because a hook has nothing to drift
// with. Skills stay the single home of every procedure. The hook is pure wiring.
//
// WHICH IS WHY THIS LIVES BESIDE SKILLS. A skill is procedural context whose body loads on use.
// The only difference is who pulls the trigger: a skill fires when the model judges it relevant, a
// hook fires when an event does. Same body, two doors.
const fs = require("fs");
const os = require("os");
const path = require("path");

// One home, and the scope is declared INSIDE the file rather than by which folder it sits in —
// so moving a hook from "mine" to "everyone's" is an edit, not a file move, and the answer to
// "who does this apply to" is in the thing you are reading.
const DIR = path.join(os.homedir(), ".autobot", "hooks");

// A `when` condition is only as good as the vocabulary the event declares (his rule). Fields
// with a FIXED set of values carry them in `values` — machine-readable, so a surface can OFFER
// them (the jobs pattern: offer a trigger, don't ask someone to type one) and an agent authoring
// a hook copies instead of guessing.
const EVENTS = [
  { name: "session.started", what: "a session opened — `origin` is cold | reinit | resumed", fields: ["origin", "model"], values: { origin: ["cold", "reinit", "resumed"] } },
  { name: "session.reinit", what: "the session was re-initialized on current docs", fields: ["resumedFrom", "agentId"] },
  { name: "session.ended", what: "the session finished or was interrupted", fields: ["reason"], values: { reason: ["finished", "interrupted", "error"] } },
  { name: "user.prompt", what: "a turn arrived from the human (or a visiting agent)", fields: ["text"] },
  { name: "assistant.text", what: "the agent spoke", fields: ["text", "done"] },
  { name: "assistant.thinking", what: "the agent thought out loud", fields: ["text", "done"] },
  { name: "tool.call", what: "the agent called a tool", fields: ["tool", "summary", "input.command", "input.file_path"] },
  { name: "tool.result", what: "a tool answered", fields: ["tool", "ok", "output"], values: { ok: [true, false] } },
  { name: "file.changed", what: "a file under the session's cwd changed", fields: ["path"] },
  { name: "permission.request", what: "the agent asked before acting", fields: ["title", "detail"] },
  // THIS ENTRY USED TO READ "fires at the END of a turn, a safe place to hook", AND IT WAS WRONG
  // BY HALF — which is how the context-maintenance hook came to fire beside the human's message
  // for weeks while looking perfectly armed. `usage` is emitted twice with two meanings: a
  // `snapshot` per assistant message (the ruler, mid-turn — and the FIRST one lands right after
  // the prompt, before the turn has spent anything) and the receipt at the yield. A hook does not
  // have to choose between them any more (RFC-012 holds session-level pointers for the boundary
  // and takes the freshest match), but the description must not claim a precision it never had.
  { name: "usage", what: "token usage was reported — per assistant message (`snapshot: true`, mid-turn) and once at the yield with the turn's cost; a hook on it is delivered at the turn's end either way", fields: ["pct", "contextTokens", "contextWindow", "inputTokens", "outputTokens", "snapshot"] },
  // IDLE IS NOT END-OF-TURN, AND THE DIFFERENCE IS THE HUMAN (his catch). A turn ending means he
  // has just been answered and may be mid-sentence; `idle` means nobody has come back. That is the
  // only moment a LONG procedure — doc maintenance, an audit — competes with nothing at all. The
  // signal costs nothing new: RFC-012 already made the harness watch for the SDK's yield, so idle
  // is that same boundary plus a longer quiet, cancelled by any activity.
  { name: "idle", what: "the session has been quiet since it last handed the turn back — nobody came back. The moment for work that should never compete with the human; `quietMin` is how long it has been", fields: ["quietMin"] },
  { name: "compaction.after", what: "a compaction finished — the summary is in place and the reasoning behind it is gone", fields: ["trigger", "preTokens", "postTokens"], values: { trigger: ["auto", "manual"] } },
  { name: "todo.updated", what: "the worklist changed — `source` says which skill or job these steps are the execution of, `run` which execution", fields: ["source", "run"] },
  { name: "run.started", what: "a procedure's execution opened its own worklist — a skill fired with steps, or a job began", fields: ["source", "id"] },
  { name: "run.finished", what: "an execution's list went all-done — the only thing that marks a procedure complete", fields: ["source", "id"] },
  { name: "message.landed", what: "a cross-session message arrived", fields: ["from", "text"] },
  { name: "status", what: "the session narrated its own state", fields: ["status"] },
  // PAGE EVENTS (RFC-005 §7.1) — the browser already SEES these, so making them triggers is
  // emitting what we already observe rather than building a second mechanism. They are AMBIENT:
  // they belong to no session, they fan out to hooks and not to feeds (sessions.emitAmbient).
  //
  // THE HOST EMITS, NEVER THE PAGE. A registered app has no door that reaches emit() — if it did,
  // an app could forge the trigger for a hook it was never granted. So the shell observes the page
  // and announces what it saw; the page is watched, not trusted.
  { name: "page.navigated", what: "a tab went somewhere — fires on every tab, watched or not", fields: ["url", "title", "from", "tabId"] },
  { name: "page.value-changed", what: "a value someone asked us to watch is no longer what it was", fields: ["watch", "label", "from", "to", "url", "selector"] },
  // NOT LISTED: `hook.fired`. It is emitted (the receipt every hook writes to the feed) but it is
  // deliberately not hookable — a hook on it would deliver a pointer, which writes a receipt,
  // which fires the hook, at input-queue speed. hooks.fire() refuses the kind; leaving it out of
  // the picker means nobody is offered the loop in the first place.
];

// AMBIENT FIELDS — stamped onto EVERY session event at the fire choke point (sessions.fireHooks),
// so any hook's `when` can mix "what happened" with "what the world can afford" (his design): a
// study hook on a cold start can add {"ctxPct": {"lte": 40}}; a quota-aware one can back off when
// the account is throttled. Absent means honestly unknown — the quota fields exist only after the
// API has reported a limit event; nothing here is invented.
const AMBIENT = [
  { name: "ctxPct", what: "context window fill % of the session the event belongs to" },
  { name: "quotaStatus", what: "last account quota status the API reported (e.g. rejected) — absent until one arrives" },
  { name: "quotaType", what: "which limit that report named — five_hour | weekly — absent until one arrives" },
  { name: "quotaResetsInMin", what: "minutes until that limit resets, at fire time — absent until one arrives" },
];

// ---------------------------------------------------------------------------------------------
// Front matter. Deliberately a small parser and not a YAML dependency: the fields are a fixed,
// documented set, and a value that looks like JSON is parsed as JSON so `when` can be an object
// without inventing nested-YAML support we would then have to keep correct.
// ---------------------------------------------------------------------------------------------
function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text || ""));
  if (!m) return { meta: {}, body: String(text || "") };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1];
    let raw = kv[2].trim();
    if (raw.startsWith("#") || raw === "") {
      meta[key] = "";
      continue;
    }
    raw = raw.replace(/\s+#.*$/, "").trim(); // trailing comment
    if (/^[[{]/.test(raw)) {
      try {
        meta[key] = JSON.parse(raw);
        continue;
      } catch {}
    }
    if (/^(true|false)$/i.test(raw)) meta[key] = /^true$/i.test(raw);
    else meta[key] = raw.replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

// ---------------------------------------------------------------------------------------------
// The condition.
//
// THIS RUNS ON EVERY EVENT, SO IT HAS TO BE CHEAP — and the argument is a day we already paid for:
// a main process that read and parsed one JSON file per browser event sat at 154% CPU, jammed its
// own IPC, and left a microphone recording with nowhere to send the stop. A hook predicate sits in
// exactly that position. So: declarative matching on fields of the payload, microseconds, no
// scripts, no filesystem, no allocation beyond the compare. `tool.call` is a nightmare as a
// blanket hook and perfectly reasonable as "tool.call where the tool is Bash and the command
// touches git push" — the `when` clause is the whole difference between a firehose and a trigger.
// ---------------------------------------------------------------------------------------------
const at = (obj, dotted) => String(dotted).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

function testOne(value, cond) {
  if (cond === null || typeof cond !== "object" || Array.isArray(cond)) {
    if (Array.isArray(cond)) return cond.some((c) => testOne(value, c));
    return value === cond || String(value) === String(cond);
  }
  const s = value == null ? "" : String(value);
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case "equals": if (s !== String(arg)) return false; break;
      case "not": if (s === String(arg)) return false; break;
      // SUBSTRING MATCHING IS CASE-INSENSITIVE, and that is a decision, not a shortcut. These
      // operators are overwhelmingly pointed at HUMAN text — a trigger word in a message, a
      // fragment of a command — and a human typing "hookTest" means the same thing they meant when
      // they wrote "hooktest". Caught the first time the feature was tried, by exactly that typo.
      // Anyone who needs exactness still has it: `equals` is exact, and `matches` takes a regex
      // where the caller decides the flags.
      case "contains": if (!s.toLowerCase().includes(String(arg).toLowerCase())) return false; break;
      case "startsWith": if (!s.toLowerCase().startsWith(String(arg).toLowerCase())) return false; break;
      case "endsWith": if (!s.toLowerCase().endsWith(String(arg).toLowerCase())) return false; break;
      // A regex from a hook FILE is still declarative — it is data, not code, it cannot reach the
      // filesystem or the session, and it is bounded by the string it runs on.
      // Case-insensitive like the other string operators, and for the same reason: these point at
      // human text. JS has no inline (?i), so the flag goes here. Anyone needing case to matter
      // uses `equals`, or writes the classes explicitly.
      case "matches": try { if (!new RegExp(String(arg), "i").test(s)) return false; } catch { return false; } break;
      case "in": if (!(Array.isArray(arg) ? arg : [arg]).map(String).includes(s)) return false; break;
      case "gt": if (!(Number(value) > Number(arg))) return false; break;
      case "gte": if (!(Number(value) >= Number(arg))) return false; break;
      case "lt": if (!(Number(value) < Number(arg))) return false; break;
      case "lte": if (!(Number(value) <= Number(arg))) return false; break;
      case "exists": if ((value != null && s !== "") !== !!arg) return false; break;
      default: return false; // an operator we do not know must NEVER silently pass
    }
  }
  return true;
}

// `when: {}` means "always, for this event" — the common case, and it reads right.
function matchesWhen(when, event) {
  if (!when || typeof when !== "object") return true;
  return Object.entries(when).every(([field, cond]) => testOne(at(event, field), cond));
}

// ---------------------------------------------------------------------------------------------
// WHEN THE POINTER IS HANDED OVER — RFC-012.
//
// A pointer used to be pushed the instant its event matched, which put it on the input queue
// beside whatever the human had just asked for. It competes with that request and it correctly
// loses: the agent answers the person, and the longer the turn runs the more certain the pointer
// is forgotten. The hook text itself conceded the problem ("finish what you are doing first"),
// which is the tell that the timing was wrong rather than the wording.
//
// So a session-level pointer is held and handed over when the agent YIELDS THE TURN — the real
// boundary, where there is nothing to compete with and nothing to interrupt. The UI already shows
// the session cooking, so a pointer that lands there reads as one continuous run rather than a
// second bubble.
//
// AN IN-TURN HOOK DOES NOT MOVE, and that is the whole reason this is a classification and not a
// blanket change. A hook armed on `tool.call` — something watching for `git push` — exists to land
// NEAR the action. Deferring it to the end of the turn would deliver it after the thing it was
// watching for already happened, which is worse than not having it. Those events are named here
// explicitly, and `deliver:` in the front matter overrides the default in either direction for the
// author who knows better than the table.
const IN_TURN_EVENTS = new Set(["tool.call", "tool.result", "permission.request", "file.changed"]);

// "now" | "turn-end"
function deliverAt(hook = {}) {
  const d = String(hook.deliver || "").trim();
  if (d === "now" || d === "turn-end") return d;
  return IN_TURN_EVENTS.has(String(hook.on || "")) ? "now" : "turn-end";
}

// ---------------------------------------------------------------------------------------------
// FIRE UNTIL CLEARED — `until:`, a key beside `guard:` and deliberately NOT a second kind of hook.
//
// The failure it ends: a pointer arrives once, the agent is busy, the moment passes, and the
// procedure never runs — the guard has already burned the one shot. A persisting hook comes back
// every turn until the procedure ACTUALLY RAN.
//
// AND THE PROOF IS THE RUN RECORD, NEVER THE AGENT'S WORD. An agent's testimony is the weakest
// evidence in this system, and it can wipe its own worklist at will — it routinely does. So being
// cleared means the system OBSERVED a run carrying this hook's own source go all-done
// (worklist.allDone on the persisted items, which is what emits `run.finished`). There is no flag
// an agent can set.
//
//   until: run                  · cleared by a finished run whose source is this hook's `do`
//   until: run:skill:<name>     · cleared by a finished run with that exact source
//
// It stays ONE vocabulary with `guard` on purpose (his rule): the moment fire-until-cleared
// becomes a second kind of hook there are two grammars for one thing, one of them gets a feature
// the other does not, and a hook behaves differently depending on which shelf it was filed on.
// While uncleared, `until` SUSPENDS the guard — at most once per turn, forever. Once cleared the
// ordinary guard applies again, which for `once-per-session` means it is done for good.
function clearedBy(hook = {}) {
  const u = String(hook.until || "").trim();
  if (!u) return "";
  if (u === "run") return String(hook.do || "").trim();
  const m = /^run:(.+)$/.exec(u);
  return m ? m[1].trim() : "";
}

const persists = (hook) => !!clearedBy(hook);

// `cleared` is the session's own record of finished runs: source -> when it went all-done.
// THE TIMESTAMP IS NOT DECORATION. A pass that finished BEFORE the pointer went out is not an
// answer to it — without the compare, a run completed an hour ago would silence a hook that has
// not yet been read once.
function isCleared(hook, ctx = {}) {
  const want = clearedBy(hook);
  if (!want) return false;
  const at = ctx.cleared instanceof Map ? ctx.cleared.get(want) : undefined;
  if (at === undefined) return false;
  const seen = ctx.fired instanceof Map ? ctx.fired.get(hook.name) : undefined;
  return !seen || at >= (seen.firstTs || seen.ts || 0);
}

// ---------------------------------------------------------------------------------------------
// WHO CARRIES IT. A hook is a LIBRARY ENTRY: writing one makes it exist for everybody, and each
// agent switches on the ones that apply to it — exactly how a skill already works, and the same
// reason. You write the procedure once and hand it to whoever needs it, instead of re-creating it
// per agent and then owning six copies that drift.
//
// THE LIST LIVES ON THE AGENT, not on the hook. Both were possible; this one matches the act. You
// enable a hook while standing on an agent's profile, so the press should write to the thing you
// are standing on — one file, one write. ("Which agents carry this hook?" is still answerable; it
// is a scan of a handful of definition files, not a reason to invert the ownership.)
//
// This replaces an earlier `scope:` field that tried to do the same job by TARGETING —
// `agent:<id>` / `project:<code>` / `every-agent`. It had two mechanisms fighting: a targeted hook
// fired whether or not anyone opted in, while `every-agent` required carrying and therefore fired
// for NOBODY, since no definition listed any. A hook that looks correct, appears in the list, and
// silently never runs is the worst failure this system can have. One mechanism now: carried, or
// not. `scope` survives only as the suggestion the editor pre-fills.
function inScope(hook, ctx = {}) {
  return (ctx.carries || []).includes(hook.name);
}

// ---------------------------------------------------------------------------------------------
// Reading. Nothing is cached across calls on purpose right now — the directory is small and the
// only caller is an event emitter that already has an mtime-shaped cache pattern available if this
// ever shows up in a profile. Premature caching here is how an edited hook stops taking effect and
// nobody can work out why.
// ---------------------------------------------------------------------------------------------
function list() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  for (const n of names.filter((f) => f.endsWith(".md"))) {
    const p = path.join(DIR, n);
    let text = "";
    try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
    const { meta, body } = parseFrontMatter(text);
    const name = String(meta.name || n.replace(/\.md$/, "")).trim();
    if (!name || !meta.on) continue; // a hook with no event is not a hook
    out.push({
      name,
      file: p,
      on: String(meta.on).trim(),
      when: meta.when && typeof meta.when === "object" ? meta.when : {},
      scope: String(meta.scope || "every-agent").trim(),
      // `do` is a POINTER — "skill:<name>" today. The value is carried verbatim so a future kind
      // (doc:, hook:, run:) needs no change here, only a resolver that understands it.
      do: String(meta.do || "").trim(),
      // context = a pointer arrives and the agent decides. work = something RUNS. The branch is
      // where the trust level changes, so it is recorded explicitly and defaults to the quiet one.
      kind: String(meta.kind || "context").trim(),
      // THE FIRE RATE. `rate` is the name for what this holds — how often the hook may fire at
      // all, which is a different axis from `when`'s condition. `guard` is the old spelling and is
      // still read, so the hooks already on disk keep working.
      rate: String(meta.rate || meta.guard || "").trim(),
      guard: String(meta.rate || meta.guard || "").trim(),
      // RFC-012, both of them configuration beside `guard` rather than new species of hook.
      // `until` — keep firing until the system observes the procedure ran.
      // `deliver` — "now" or "turn-end"; empty means the default for this event (see deliverAt).
      until: String(meta.until || "").trim(),
      deliver: String(meta.deliver || "").trim(),
      enabled: meta.enabled === false ? false : true,
      // WHO WROTE IT. Added when the authoring tool was built, and deliberately BEFORE it, because
      // every hook already on disk when a writer starts is a hook nobody can attribute afterwards.
      // "user" = the operator, through the window. "agent:<slot>" = an agent, through its tool.
      // An empty author means hand-written before attribution existed, and is treated as the
      // operator's: an agent may not overwrite one, which is the conservative reading.
      author: String(meta.author || "").trim(),
      note: body.trim(),
    });
  }
  return out;
}

const forAgent = (ctx = {}) => list().filter((h) => h.enabled && inScope(h, ctx));

// ---------------------------------------------------------------------------------------------
// FIRING.
//
// This is called from `emit()` — from EVERY emitted event — which is the design working as
// intended: observability and hookability are the same surface, so anything the feed can draw is
// something a hook can attach to, with no per-moment integration anywhere.
//
// It also means this sits on the hottest path in the harness, so the shape matters more than the
// cleverness. An INDEX keyed by event name, rebuilt only when the directory's mtime moves:
//   - no hooks wired at all  -> one Map lookup on an empty Map, and out
//   - hooks wired elsewhere  -> one Map lookup that misses, and out
//   - a hook on this event   -> the declarative `when` runs, which is a handful of string compares
// The thing we are refusing to do is `list()` per event — readdir + readFile + parse per emit is
// precisely the read-a-file-per-event shape that cost a day of CPU and a jammed main process.
// ---------------------------------------------------------------------------------------------
let INDEX = null;
let INDEX_AT = 0;

const dirStamp = () => {
  try { return fs.statSync(DIR).mtimeMs; } catch { return 0; }
};

function index() {
  const st = dirStamp();
  if (INDEX && st === INDEX_AT) return INDEX;
  const byEvent = new Map();
  for (const h of list()) {
    if (!h.enabled) continue;
    if (!byEvent.has(h.on)) byEvent.set(h.on, []);
    byEvent.get(h.on).push(h);
  }
  INDEX = byEvent;
  INDEX_AT = st;
  return INDEX;
}

// A hook that fires forever is a context leak, so a guard is checked before anything is delivered.
// `fired` is the caller's own state — one per session — so a guard can never leak across sessions.
//   once-per-session  · fires once, then never again for this session
//   cooldown:<sec>    · at most once every N seconds
//
// `until` (RFC-012) sits in FRONT of the guard rather than beside it. While a persisting hook is
// uncleared the guard is suspended and the only limit is one per turn — a hook that matched three
// events inside one turn is one pointer, not three. The turn number is the caller's (the session
// counts its own yields); without it "one per turn" would silently mean "no limit".
// ── THE FIRE RATE ───────────────────────────────────────────────────────────────────────────
// His decomposition, and it was one field doing two jobs. `when` is a CONDITION — what must be
// true right now. The rate is a fact about this hook and this agent OVER TIME — how often it may
// fire at all — and the two are orthogonal: "past 60%" and "at most once a day" compose without
// interfering, which is the test that they were ever separate axes. `guard` is the old name and
// still reads; `rate` is what it is.
//
// TWO FAMILIES, because people mean both and only one existed:
//   cooldown:<duration>  sliding — "no sooner than N since the last fire". How you say twice-weekly.
//   once-per-day|week|month  CALENDAR — once within each period, however the periods fall. Fire at
//                            11pm Monday and a sliding day blocks all Tuesday daytime; "once per
//                            day" does not, and the calendar one is what the words mean.
//
// AND IT IS PERSISTED, which is the bug the rest of this fixes. Fire history lived in a Map created
// per session, so every rate longer than one session's life silently degraded to once-per-session —
// a 3.5-day cadence in a session restarted daily fired daily. `once-per-session` was the only one
// that ever worked, because it is the only one whose scope IS the thing it was stored in.
const STATE_FILE = path.join(os.homedir(), ".autobot", "hooks-fired.json");
const RATE_FORMS = /^(once-per-session|once-per-day|once-per-week|once-per-month|cooldown:.+)$/;

// Durations people write: 30m, 24h, 3d12h, 2w — and bare digits, which `cooldown:` has always
// meant as SECONDS, so old hooks keep their meaning.
function parseDur(s) {
  const t = String(s || "").trim().toLowerCase();
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t) * 1000; // legacy: bare seconds
  if (!/^(\d+(ms|s|m|h|d|w))+$/.test(t)) return NaN; // NaN is "malformed", never "no limit"
  const U = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  let ms = 0;
  for (const [, n, u] of t.matchAll(/(\d+)(ms|s|m|h|d|w)/g)) ms += Number(n) * U[u];
  return ms;
}

const rateOf = (hook) => String((hook && (hook.rate || hook.guard)) || "").trim();

function readFiredState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || {}; } catch { return {}; }
}
function writeFiredState(st) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
  } catch {}
}
// The key is the AGENT and the hook: a shared hook carried by three agents has three cadences,
// not one, or the first agent to fire would silence the other two for a week.
const firedKey = (hook, ctx) => `${ctx.agentId || ctx.projectCode || "anon"}|${hook.name}`;

// Which calendar bucket a moment falls in — local time, because "once per day" means his day.
function periodKey(form, ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  if (form === "once-per-month") return `${y}-${d.getMonth() + 1}`;
  if (form === "once-per-week") {
    // ISO-ish week number is overkill; days-since-epoch over 7 is stable and monotonic
    const days = Math.floor((ts - d.getTimezoneOffset() * 60000) / 86400000);
    return `w${Math.floor(days / 7)}`;
  }
  return `${y}-${d.getMonth() + 1}-${d.getDate()}`; // once-per-day
}

function rateAllows(hook, fired, ctx = {}) {
  const seen = fired instanceof Map ? fired.get(hook.name) : undefined;
  if (persists(hook) && !isCleared(hook, { ...ctx, fired })) {
    return !seen || seen.turn !== ctx.turn;
  }
  const g = rateOf(hook);
  if (!g) return true;
  // SESSION-SCOPED, so the session's own map is exactly the right store.
  if (g === "once-per-session") return !seen;

  const st = readFiredState();
  const last = st[firedKey(hook, ctx)];
  if (g.startsWith("once-per-")) {
    if (!last || !last.ts) return true;
    return periodKey(g, last.ts) !== periodKey(g, Date.now());
  }
  const ms = parseDur(g.slice("cooldown:".length));
  // A MALFORMED RATE BLOCKS, IT DOES NOT OPEN. The old default was "an unknown guard is a typo,
  // not a lock" — sane for a `when`, backwards for a rate: `cooldown:2w` parsed as nothing and
  // meant no limit at all, so the hook you slowed down fired every time instead. Loudest possible
  // failure is refusal at the writing door (see the save gate); this is the belt for anything
  // already on disk.
  if (!Number.isFinite(ms) || ms <= 0) return false;
  if (!last || !last.ts) return true;
  return Date.now() - last.ts >= ms;
}

// Stamped when a pointer is actually HANDED OVER, not when it matched — same reason the receipt is
// written at delivery. Called by the session; a match that is held and then dropped has not spent
// the agent's daily allowance.
function recordFired(hook, ctx = {}) {
  const g = rateOf(hook);
  if (!g || g === "once-per-session") return; // nothing durable to remember
  const st = readFiredState();
  st[firedKey(hook, ctx)] = { ts: Date.now(), hook: hook.name };
  writeFiredState(st);
}

// the old name, kept so nothing that calls it has to care which axis it was asking about
const guardAllows = rateAllows;

// Which hooks apply to this event, for this agent, right now. Returns [] fast and often.
// `ctx`: { agentId, projectCode, carries: [names opted into], fired: Map, cleared: Map, turn: n }
function fire(event = {}, ctx = {}) {
  const kind = String(event.kind || "");
  // A hook's own receipt is not a hook point. Without this a hook on `hook.fired` would deliver a
  // pointer, which emits a receipt, which fires the hook — an injection loop, at input-queue speed.
  if (!kind || kind === "hook.fired") return [];
  const hooks = index().get(kind);
  if (!hooks || !hooks.length) return [];
  const fired = ctx.fired instanceof Map ? ctx.fired : new Map();
  const out = [];
  for (const h of hooks) {
    if (!inScope(h, ctx)) continue;
    if (!matchesWhen(h.when, event)) continue;
    if (!guardAllows(h, fired, ctx)) continue;
    const prev = fired.get(h.name);
    const now = Date.now();
    // `firstTs` is what isCleared() compares a finished run against, so it must survive every
    // later fire — a persisting hook rewrites this record every turn, and overwriting the first
    // sighting would make "the run finished after the pointer went out" unanswerable.
    fired.set(h.name, { ts: now, firstTs: prev ? prev.firstTs || prev.ts : now, turn: ctx.turn, count: ((prev || {}).count || 0) + 1 });
    out.push(h);
  }
  return out;
}

// THE POINTER, AS TEXT. A hook delivers a pointer and never a payload — this is the whole of what
// reaches the model, and it is deliberately small enough to read in one breath. It rides the same
// wrapper convention as a cross-session message (`<context-hook …>`), so the pump can recognise it
// and the feed can draw it as a thing that HAPPENED rather than as words the human typed.
function pointerText(hook, event = {}) {
  const what = hook.do ? `The \`${String(hook.do).replace(/^skill:/, "")}\` skill applies here.` : "";
  const note = hook.note ? `\n${hook.note}` : "";
  // THE TEXT FOLLOWS THE TIMING, and the old text is the evidence that the timing was wrong. It
  // read "finish what you are doing first — anything the human asked for comes before this",
  // because a pointer used to land beside a message the human had just sent and an agent that took
  // it as the next instruction did housekeeping instead of answering them. That deferral is now
  // structural: a turn-end pointer arrives when there is nothing left to defer to, so repeating the
  // apology would be telling the agent to postpone a moment that has already waited for it.
  //
  // An in-turn pointer still gets the old sentence, and still needs it, for the old reason.
  const atEnd = deliverAt(hook) === "turn-end";
  // TWO DOORS, NOT THREE — and the words that say so are HIS FILE, not this code. His question,
  // and it had no good answer: *"why is the wrapper text requiring me to refresh and not something
  // I can see and easily change?"* Every other layer that reaches every agent is already a file he
  // owns — presence.md says where you are, system-context.md says how to be, both read at session
  // open so an edit needs no rebuild. This text reaches every agent on every hook fire and was the
  // one such layer buried in a source file behind a shell relaunch. Same mold now, one step
  // further: read at FIRE time, so an edit lands on the very next pointer instead of the next boot.
  // The built-in below is the fallback, not the definition.
  //
  // TWO DOORS, NOT THREE. "A pointer, not an instruction — ignore it if it does not apply" was
  // read by an agent (buAPI, 2026-09-30) as licence for a THIRD option: do a proportionate
  // version, the spirit without the ceremony. It hand-rolled context-maintenance — two notes and
  // a tidy worklist — and skipped the stale-ordered `list` pass, which is the only step that
  // finds notes nobody would think to search for. Running the real procedure afterwards turned up
  // a note in `system` scope, read by every agent, describing a world that no longer exists.
  // That is the whole case for naming the third door and shutting it: the value of a procedure is
  // the steps you would not have thought of, so a subset is not a smaller version of it.
  const orNot =
    `There is no third option: if it applies, INVOKE the skill — do not hand-roll a subset, ` +
    `because what you would leave out is exactly what you do not know is in there. If it does ` +
    `not apply, say so in one line and carry on.`;
  // `when` is TIMING ONLY — `orNot` is a separate paragraph the template places itself, or the
  // fallback appends. Having it in both is how it printed twice the first time this ran.
  const when = atEnd
    ? `You have just handed the turn back, so nothing is waiting on you — this is the moment to ` +
      `act on it if it applies. It is still a pointer, not an instruction: ignore it if it does not.`
    : `Finish what you are doing first — anything the human asked for comes before this. ` +
      `This is a pointer, not an instruction: pull the skill when you reach a natural stopping ` +
      `point if it applies, and ignore it if it does not.`;
  // A PERSISTING HOOK SAYS SO. Otherwise the agent reads the same pointer three turns running as a
  // malfunction, when it is the mechanism: it comes back because the procedure has not run yet.
  const again = persists(hook)
    ? `\nThis one persists: it returns every turn until a run with \`source: "${clearedBy(hook)}"\` ` +
      `has every item done. The run record is what clears it — saying it is handled does not.`
    : "";
  const kind = event.kind || hook.on;
  const body = pointerTemplate()
    ? pointerTemplate()
        .replace(/\{\{event\}\}/g, kind)
        .replace(/\{\{what\}\}/g, what)
        .replace(/\{\{note\}\}/g, hook.note ? String(hook.note) : "")
        .replace(/\{\{when\}\}/g, when)
        .replace(/\{\{again\}\}/g, again.replace(/^\n/, ""))
        // a placeholder that resolved to nothing must not leave a blank line behind
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : `A context hook fired: **${kind}**. ${what}${note}\n${when}\n\n${orNot}${again}`;
  return `<context-hook name="${hook.name}" on="${kind}">\n${body}\n</context-hook>`;
}

// HIS FILE, READ AT FIRE TIME (see the note in pointerText). The comment block at the top is for
// him, not for the agent — it is how the placeholders are documented where they are edited, so it
// is stripped on the way out. No caching on purpose: a hook fires rarely and an edit that needs a
// restart to take effect is the thing this replaced.
const POINTER_FILE = path.join(os.homedir(), ".autobot", "hook-pointer.md");
function pointerTemplate() {
  try {
    return fs.readFileSync(POINTER_FILE, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch {
    return ""; // no file, or unreadable — the built-in text stands
  }
}

// ---------------------------------------------------------------------------------------------
// Writing. A hook is a FILE, same as a skill or a doc — so it can be edited in the window, read in
// a terminal, diffed, and copied between machines without a database in the middle. The front
// matter is regenerated from the record rather than patched, so the file always reflects the
// fields we actually support; the body (the human note) is preserved verbatim.
// ---------------------------------------------------------------------------------------------
const slug = (n) => String(n || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

function save(rec = {}) {
  const name = slug(rec.name);
  if (!name) throw new Error("a hook needs a name");
  if (!String(rec.on || "").trim()) throw new Error("a hook needs an event to fire on");
  // A MALFORMED RATE IS REFUSED HERE, where somebody is watching. `cooldown:2w` used to save
  // cleanly, read back cleanly, and fire every single time — a hook you slowed down becoming the
  // noisiest thing in the system, silently. The vocabulary is checked at the writing door for the
  // same reason the event name is.
  const rateIn = String(rec.rate || rec.guard || "").trim();
  if (rateIn) {
    if (!RATE_FORMS.test(rateIn))
      throw new Error(
        `rate must be once-per-session, once-per-day, once-per-week, once-per-month, or ` +
          `cooldown:<duration> — got "${rateIn}"`
      );
    if (rateIn.startsWith("cooldown:")) {
      const ms = parseDur(rateIn.slice("cooldown:".length));
      if (!Number.isFinite(ms) || ms <= 0)
        throw new Error(
          `"${rateIn}" is not a duration I can read. Write it like 30m, 24h, 3d12h, 2w ` +
            `(bare digits still mean seconds). A rate that cannot be parsed would either block ` +
            `forever or not at all, and both are worse than this refusal.`
        );
    }
  }
  fs.mkdirSync(DIR, { recursive: true });
  const when = rec.when && typeof rec.when === "object" ? rec.when : {};
  const lines = [
    "---",
    `name: ${name}`,
    `on: ${String(rec.on).trim()}`,
    `when: ${JSON.stringify(when)}`,
    `scope: ${String(rec.scope || "every-agent").trim()}`,
    `do: ${String(rec.do || "").trim()}`,
    `kind: ${String(rec.kind || "context").trim()}`,
  ];
  if (rec.author) lines.push(`author: ${String(rec.author).trim()}`);
  // written under its real name; `guard` is read on the way in but never written on the way out,
  // so a hook edited once migrates itself and there is only ever one spelling on disk
  const rateWritten = String(rec.rate || rec.guard || "").trim();
  if (rateWritten) lines.push(`rate: ${rateWritten}`);
  // Written only when set, so a file says what was CHOSEN — an explicit `deliver: turn-end` on
  // every hook would make the default invisible and the two indistinguishable in a diff.
  if (rec.until) lines.push(`until: ${String(rec.until).trim()}`);
  if (rec.deliver) lines.push(`deliver: ${String(rec.deliver).trim()}`);
  if (rec.enabled === false) lines.push("enabled: false");
  lines.push("---", "", String(rec.note || "").trim(), "");
  const file = path.join(DIR, `${name}.md`);
  fs.writeFileSync(file, lines.join("\n"));
  // A RENAME IS A MOVE, NOT A COPY. Without this an edited name leaves the old file in place and
  // the hook silently fires twice under two names — the kind of duplicate that is invisible until
  // it is injecting context you never wired.
  const was = slug(rec.wasName);
  if (was && was !== name) { try { fs.unlinkSync(path.join(DIR, `${was}.md`)); } catch {} }
  return list().find((h) => h.name === name) || null;
}

// A hook can only attach to a moment the system really emits — checked at the WRITING door
// rather than the firing one, because a hook on an event that never happens is silent, appears
// correct in every list, and is the worst failure this mechanism has.
// WHO MAY OVERWRITE WHAT. This lives here and not in the tool, because there is already more than
// one writing door — the window and an agent's tool today, an app through the bridge later — and a
// rule that lives in one door is a rule the other doors do not have. The operator owns everything,
// because they are the operator. Everyone else may edit only what they wrote, which is the whole
// reason `author` exists: it makes the check evidence rather than good manners. An unattributed
// hook was hand-written before authors were recorded and reads as the operator's — the
// conservative side of the ambiguity, and the side that cannot lose someone's work.
function mayWrite(existing, author) {
  if (!existing) return true;
  if (author === "user") return true;
  return !!author && existing.author === author;
}

const isEvent = (name) => EVENTS.some((e) => e.name === String(name || "").trim());

function remove(name) {
  const n = slug(name);
  let gone = false;
  try { fs.unlinkSync(path.join(DIR, `${n}.md`)); gone = true; } catch {}
  // THE RATE RECORD DIES WITH THE HOOK. Found by cleaning up after a probe (2026-10-02): deleting a
  // hook left its entries in hooks-fired.json forever — one line of orphan state per hook anyone
  // ever tried, which nothing swept. His constraint is that nothing accumulates in the background,
  // and the only way to honour that is for the record to be unable to outlive what it describes.
  // Keyed `<agent>|<hook>`, so every agent's record for this hook goes, not just one.
  try {
    const st = readFiredState();
    let touched = false;
    for (const k of Object.keys(st)) if (k.endsWith(`|${n}`)) { delete st[k]; touched = true; }
    if (touched) writeFiredState(st);
  } catch {}
  return gone;
}

module.exports = {
  DIR,
  EVENTS,
  AMBIENT,
  isEvent,
  mayWrite,
  list,
  fire,
  pointerText,
  save,
  remove,
  forAgent,
  // RFC-012 — the session asks these two: when to hand a matched pointer over, and what would
  // clear a persisting one. Both are policy, and policy about hooks lives with the hooks.
  deliverAt,
  clearedBy,
  persists,
  isCleared,
  IN_TURN_EVENTS,
  // exported for tests and for the UI's "would this have fired?" preview
  parseFrontMatter,
  matchesWhen,
  inScope,
  guardAllows,
  rateAllows,
  recordFired,
  parseDur,
  RATE_FORMS,
};
