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
  { name: "usage", what: "token usage was reported — fires at the END of a turn, a safe place to hook", fields: ["pct", "contextTokens", "contextWindow", "inputTokens", "outputTokens"] },
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
      guard: String(meta.guard || "").trim(),
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
// The guard. A badly-scoped hook is a context leak that fires forever — so every hook may declare
// one, and the fired-state lives with the SESSION (passed in), never in this module: a module-level
// Map would leak across sessions and make "once per session" quietly mean "once per shell".
//   once-per-session  · fires once, then never again for this session
//   cooldown:<sec>    · at most once every N seconds
// ---------------------------------------------------------------------------------------------
function guardAllows(hook, fired) {
  if (!hook.guard) return true;
  const last = fired instanceof Map ? fired.get(hook.name) : undefined;
  if (hook.guard === "once-per-session") return last === undefined;
  const cool = /^cooldown:(\d+)$/.exec(hook.guard);
  if (cool) return last === undefined || Date.now() - last >= Number(cool[1]) * 1000;
  return true; // an unknown guard does not silently block the hook; it just does not restrict it
}

const noteFired = (hook, fired) => { if (fired instanceof Map) fired.set(hook.name, Date.now()); };

// Every hook that should fire for this event, in file order. `ctx` carries identity and the
// session's own fired-state: { agentId, projectCode, carries: [names], fired: Map }.
function match(eventName, event = {}, ctx = {}) {
  return forAgent(ctx).filter(
    (h) => h.on === eventName && matchesWhen(h.when, event) && guardAllows(h, ctx.fired),
  );
}

// ---------------------------------------------------------------------------------------------
// The pointer. THE WRAPPER IS THE POINT: this rides the same path cross-session messages already
// use — the harness wraps, the pump recognises the wrapper and emits an event, and the feed draws
// a proper row instead of pretending the human typed it. Reusing that plumbing is what makes a
// hook visible by construction rather than by remembering to add logging.
//
// And it says only what applies, never the procedure. The skill's body stays in the skill.
// ---------------------------------------------------------------------------------------------
function pointerText(hook, eventName) {
  const target = hook.do || "";
  const skill = target.startsWith("skill:") ? target.slice(6) : "";
  const lines = [
    `<context-hook name="${hook.name}" on="${eventName}">`,
    skill
      ? `This moment just happened: ${eventName}. The \`${skill}\` skill applies here — load it and follow it if you agree it fits.`
      : `This moment just happened: ${eventName}.`,
  ];
  if (hook.note) lines.push("", hook.note);
  lines.push("</context-hook>");
  return lines.join("\n");
}

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
function guardAllows(hook, fired) {
  const g = String(hook.guard || "");
  if (!g) return true;
  const seen = fired.get(hook.name);
  if (g === "once-per-session") return !seen;
  const cd = /^cooldown:(\d+)$/.exec(g);
  if (cd) return !seen || Date.now() - seen.ts >= Number(cd[1]) * 1000;
  return true; // an unknown guard does not silently block — it is a typo, not a lock
}

// Which hooks apply to this event, for this agent, right now. Returns [] fast and often.
// `ctx`: { agentId, projectCode, carries: [hook names this agent opted into], fired: Map }
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
    if (!guardAllows(h, fired)) continue;
    fired.set(h.name, { ts: Date.now(), count: ((fired.get(h.name) || {}).count || 0) + 1 });
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
  // IT MUST NOT READ AS "DROP WHAT YOU ARE DOING". A pointer rides the input queue, so it can land
  // beside a message the human just sent — and an agent that reads it as the next instruction does
  // housekeeping instead of answering them. His concern, and it is the right one: the hook says a
  // moment happened, it does not get to reorder the work. So the deferral is stated in the text
  // rather than assumed from good manners.
  return (
    `<context-hook name="${hook.name}" on="${event.kind || hook.on}">\n` +
    `A context hook fired: **${event.kind || hook.on}**. ${what}${note}\n` +
    `Finish what you are doing first — anything the human asked for comes before this. ` +
    `This is a pointer, not an instruction: pull the skill when you reach a natural stopping ` +
    `point if it applies, and ignore it if it does not.\n` +
    `</context-hook>`
  );
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
  if (rec.guard) lines.push(`guard: ${String(rec.guard).trim()}`);
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
  try { fs.unlinkSync(path.join(DIR, `${slug(name)}.md`)); return true; } catch { return false; }
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
  match,
  noteFired,
  pointerText,
  // exported for tests and for the UI's "would this have fired?" preview
  parseFrontMatter,
  matchesWhen,
  inScope,
  guardAllows,
};
