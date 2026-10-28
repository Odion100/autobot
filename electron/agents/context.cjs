// THE CONTEXT MCP — RFC-055's retrieval half, the system around the vector store.
//
// Designed from two facts about the consumer (2026-09-09, planning with Odion):
// an agent will not pay more than ONE cheap call to write mid-work, and an agent
// does not reach for tools it was never told exist. So: remember() is one motion,
// and the Level-0 stamp (autobot's half) names these tools at session start.
//
// MARKDOWN IS THE TRUTH, THE STORE IS DERIVED. A note is a small .md file under
// ~/.autobot/context/<scope>/; the embedding is rebuildable from it, always. The
// moment the vectors ARE the memory, knowledge lives in a blob nobody can read,
// edit, or delete — and his surface edits NOTES, never vectors.
//
// THREE SCOPES, THREE OWNERS (the compartments are ownership, not taxonomy):
//   system            harness + SystemView conventions — every agent, forever
//   project:<pc>      per-repo architecture and conventions
//   agent:<slot>      learned lessons — SURVIVES re-clones, inherited by the slot
//
// Separate collections (different write/prune rhythms — and the day the discovery
// and services tiers shared one file, one writer's full-replace silently deleted
// the other's records; never again by construction). ONE search merges at query
// time: same model, same dims, comparable scores.
//
// IDENTITY BY CONSTRUCTION, NOT BY CLAIM — the reason this is an in-process SDK
// server rather than a SystemLynx service: serverFor() closes over the session's
// own slot and project, so an agent-scope note cannot file under the wrong agent
// even if the model invents a name. Same rule the worklist proved. The seam for
// serving context outward later (cross-machine, via the hub) is that this module
// stays pure-node behind the tool layer.
const fs = require("fs");
const path = require("path");
const os = require("os");
const vectors = require("../apps/vectors.cjs");
const docs = require("./docs.cjs");
const hooks = require("./hooks.cjs");
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const SERVER = "context";
// RFC-058 §7 — the docs tools live HERE rather than on a new server: it is where agents already
// look, and discovery already indexes it.
//
// RETRIEVAL IS ONE DOOR. There was a `docs` search tool beside `context` for exactly one day, on
// the theory that notes and chunks have different truth conditions and should not be confused. The
// truth conditions are real — a note is true because someone learned it, a chunk only while its
// file has not changed — but that is an argument for LABELLING a result, not for a second tool.
// Measured: the word an agent reaches for is "context", and a tool nobody opens is worse than no
// separation at all. So `context` answers with both halves, labelled, and takes `kind` to narrow.
// What remains here is MANAGEMENT — listing, planning cuts, indexing, dropping — which is not
// retrieval and has no context-store equivalent to merge with.
const TOOL_NAMES = ["remember", "context", "list", "forget", "subscribe", "unsubscribe", "subscriptions", "docsList", "docsPlan", "docsIndex", "docsDrop", "hooksList", "hooksWrite", "hooksDrop", "hooksCarry", "jobsList", "jobsLoad", "jobsWrite", "chores"]
  .map((t) => `mcp__${SERVER}__${t}`);
const ROOT = path.join(os.homedir(), ".autobot", "context");

// Near-duplicate threshold for similarity-on-write, and the search floor. The write
// threshold is HIGHER than the search floor on purpose: "related" is a good search
// result but a bad reason to block a write.
const FLOOR = 0.45;
const NEAR_DUP = 0.8;

// scope string -> { collection, dir }. Collections are namespaced ctx-* so they can
// never collide with mcp-tools in the same store.
function place(scope) {
  const s = String(scope || "").trim();
  if (s === "system") return { scope: s, collection: "ctx-system", dir: path.join(ROOT, "system") };
  // The name must contain a real character — `[a-zA-Z0-9._-]+` alone admits "..", and
  // place("project:..") resolved dir to the context ROOT itself. Nothing wrote through it
  // (writes are allowed-checked) but place() is exported and the next caller wouldn't know.
  // Autobot's find, 2026-09-09.
  let m = /^project:([a-zA-Z0-9._-]+)$/.exec(s);
  if (m && !/^[.]+$/.test(m[1]) && !m[1].includes(".."))
    return { scope: s, collection: `ctx-project-${m[1]}`, dir: path.join(ROOT, "projects", m[1]) };
  m = /^agent:([a-zA-Z0-9._-]+)$/.exec(s);
  if (m && !/^[.]+$/.test(m[1]) && !m[1].includes(".."))
    return { scope: s, collection: `ctx-agent-${m[1]}`, dir: path.join(ROOT, "agents", m[1]) };
  return null;
}

const slug = (t) =>
  String(t || "note").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";

// A note file: tiny frontmatter + body. The frontmatter is the machine's half
// (id, dates, pointer); the body is the knowledge. Both survive any store rebuild.
// FRONTMATTER VALUES CANNOT CARRY LINES (autobot-e1's find): title is model-supplied and was
// interpolated raw, so a title containing "\nid: HIJACKED" rewrote which note a save targets —
// and could forge `by:` if field order ever changed. An input value silently deciding an
// identity, same class as the serviceUrl bug. One line per value, no leading ---, at WRITE.
const fmv = (v) => String(v).replace(/\r?\n/g, " ").replace(/^---\s*/, "").trim();

function writeNote(dir, { id, title, body, pointer, supersedes, by, created }) {
  fs.mkdirSync(dir, { recursive: true });
  const front = [
    "---",
    `id: ${fmv(id)}`,
    `title: ${fmv(title)}`,
    `created: ${created ? fmv(created) : new Date().toISOString()}`,
    // WHO WROTE IT — stamped by the harness, never sent by the agent (his rule: "it should just
    // be automatically known"). Matters most on the shared scopes, where the scope itself says
    // nothing about the author.
    by ? `by: ${fmv(by)}` : null,
    pointer ? `pointer: ${fmv(pointer)}` : null,
    supersedes ? `supersedes: ${fmv(supersedes)}` : null,
    "---",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(path.join(dir, id + ".md"), front + "\n\n" + body.trim() + "\n");
}

// ── RFC-013 — CONTEXT SUBSCRIPTIONS ─────────────────────────────────────────────────────────
// The reader subscribes; the content is never touched. A subscription is a row in the AGENT'S
// OWN definition — its standing orders: what content, at which moments, until which gate. That
// placement is the design: caps are per-subscriber (your shelf spends only your attention), the
// profile renders the rows for free, and there is no commons — two agents wanting the same note
// each subscribe to it. Writes go THROUGH definitions.cjs (lazy-required inside the functions:
// definitions requires this module for purgeAgent, so a top-level require would be a cycle).
const INJECT_TYPES = ["every-turn", "session-start", "post-compaction"];
const INJECT_CAPS = {
  "every-turn": { notes: 2, chars: 1000 },
  "session-start": { notes: 5, chars: 3000 },
  "post-compaction": { notes: 5, chars: 3000 },
};
const INJECT_NOTE_MAX = 700; // per item — the pitch will always be "it's just one paragraph"
const INJECT_TTL_DEFAULT_MS = 7 * 24 * 3600 * 1000;
const INJECT_TTL_MAX_MS = 30 * 24 * 3600 * 1000;
// turn countdowns live HERE, never in the def — a per-delivery def write would ring the
// composition-staleness bell every turn (same truth/state split as the usage sidecar).
const SUBS_STATE = path.join(ROOT, "subscriptions-state.json");
const readSubsState = () => { try { return JSON.parse(fs.readFileSync(SUBS_STATE, "utf8")) || {}; } catch { return {}; } };
const writeSubsState = (st) => { try { fs.writeFileSync(SUBS_STATE, JSON.stringify(st)); } catch {} };

function parseTtlMs(ttl) {
  if (ttl == null || ttl === "") return INJECT_TTL_DEFAULT_MS;
  const m = /^(\d+)([dh])$/.exec(String(ttl).trim());
  if (!m) return null;
  const ms = Number(m[1]) * (m[2] === "d" ? 24 : 1) * 3600 * 1000;
  return ms > 0 && ms <= INJECT_TTL_MAX_MS ? ms : null;
}

// what: "note:<id>@<scope>" or "corpus:<name>:<source>#<heading>". Resolution returns
// { title, body } or null when the target no longer exists — and a subscription whose target
// is gone DIES LOUDLY: deleted from the def, receipted in the delivery wrapper, never silent.
// WHERE A PROJECT LIVES — the registry the shell and the sessions already read; the env seam is
// for the test scratch, same precedent as AUTOBOT_CORPORA above and AUTOBOT_WORKLISTS_DIR next door.
function projectRootOf(pc) {
  const file = process.env.AUTOBOT_PROJECTS_FILE || path.join(os.homedir(), ".autobot", "projects.json");
  try {
    const reg = JSON.parse(fs.readFileSync(file, "utf8")) || {};
    // the live file is a flat { code: root } map; tolerate the nested and array shapes too
    const root =
      reg[pc] ||
      (reg.projects && !Array.isArray(reg.projects) && reg.projects[pc]) ||
      ((Array.isArray(reg.projects) ? reg.projects : []).find((r) => r && r.code === pc) || {}).root;
    return typeof root === "string" && root ? root : null;
  } catch {
    return null;
  }
}

function resolveWhat(what, allowedScopes) {
  const nm = /^note:(.+)@([a-zA-Z0-9._:-]+)$/.exec(String(what || ""));
  if (nm) {
    const [, id, scope] = nm;
    if (allowedScopes && !allowedScopes.includes(scope)) return { denied: scope };
    const p = place(scope);
    const n = p && readNoteFile(p.dir, id);
    return n ? { title: n.title || id, body: n.body || "" } : null;
  }
  // HIS BOARD, DELIVERABLE (2026-10-14, his card: 32KB of notes written FOR agents was the one
  // context layer that could only be fetched, never delivered — presence and the system context
  // mention it zero times, so only an agent that already thought to call board() ever saw it).
  // `board:<projectCode>` resolves to the project's open cards, newest-first, self-capped to
  // INJECT_NOTE_MAX with a counted tail — so a growing board can never outgrow its shelf.
  //
  // ONE DELIBERATE DIVERGENCE from the corpus rule: an EMPTY or MISSING board resolves to a
  // truthful empty body, never null. A corpus heading that disappears is gone for good, so its
  // subscription dies loudly; a board empties and refills as part of its normal life — an emptied
  // board even deletes its own file — and dying on the first clean sweep would make this
  // subscription unkeepable.
  const bm = /^board:([a-zA-Z0-9._-]+)$/.exec(String(what || ""));
  if (bm) {
    const [, pc] = bm;
    if (allowedScopes && !allowedScopes.includes(`project:${pc}`)) return { denied: `project:${pc}` };
    const root = projectRootOf(pc);
    if (!root) return null; // an unknown PROJECT is gone-for-good — that one does die loudly
    let raw = "";
    try { raw = fs.readFileSync(path.join(root, ".systemview", "boards", "board.md"), "utf8"); } catch {}
    const cards = [];
    String(raw)
      .split(/<!--card (\d+)(?: by=([^\s>]+))?-->/)
      .forEach((part, i, arr) => {
        if (i % 3 !== 1) return;
        // replies stay with their card, rendered as lines rather than leaking comment markers
        const body = String(arr[i + 2] || "").replace(/<!--reply(?: [^>]*?)?-->\s*/g, "\n↳ ").trim();
        if (body) cards.push({ by: arr[i + 1] || "", body });
      });
    const title = `the ${pc} board — ${cards.length} open`;
    if (!cards.length) return { title, body: "(nothing on the board right now)" };
    const lines = [];
    let used = 0;
    let shown = 0;
    for (const c of cards) {
      const line = `• ${c.by ? `[${c.by}] ` : ""}${c.body}`;
      // the counted tail must always fit, so stop while there is room to say what was left out
      if (used + line.length + 40 > INJECT_NOTE_MAX) break;
      lines.push(line);
      used += line.length + 1;
      shown += 1;
    }
    if (!shown) {
      // the newest card alone is bigger than the shelf — a slice of it beats silence, said honestly
      lines.push(`• ${cards[0].body.slice(0, INJECT_NOTE_MAX - 60)}…`);
      shown = 1;
    }
    if (shown < cards.length) lines.push(`(+${cards.length - shown} more — board({projectCode: "${pc}"}))`);
    return { title, body: lines.join("\n") };
  }
  const cm = /^corpus:([a-zA-Z0-9._-]+):(.+?)#(.+)$/.exec(String(what || ""));
  if (cm) {
    const [, corpus, source, heading] = cm;
    const c = docs.corpusNamed && docs.corpusNamed(corpus);
    if (!c || !c.root) return null;
    let raw = "";
    try { raw = fs.readFileSync(path.join(c.root, source), "utf8"); } catch { return null; }
    // the heading's own section: from its line to the next heading of equal-or-higher depth.
    const lines = raw.split("\n");
    const hx = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#{1,6}\s+/, "").trim() === heading.trim());
    if (hx < 0) return null; // re-chunked away — the caller deletes the subscription, loudly
    const depth = (lines[hx].match(/^#+/) || ["#"])[0].length;
    let ex = lines.length;
    for (let i = hx + 1; i < lines.length; i++) {
      const m2 = lines[i].match(/^(#{1,6})\s/);
      if (m2 && m2[1].length <= depth) { ex = i; break; }
    }
    return { title: `${source} › ${heading}`, body: lines.slice(hx + 1, ex).join("\n").trim() };
  }
  return null;
}

// The gate, at the subscribing door — nothing saves-then-ignores.
function subscribe(scopes, { what, when, until } = {}) {
  const defs = require("./definitions.cjs");
  const slot = scopes.slot;
  if (!slot) throw new Error("subscriptions belong to an agent definition — this session has no agent slot");
  const whens = (Array.isArray(when) ? when : String(when || "").split(",")).map((t) => String(t).trim()).filter(Boolean);
  if (!whens.length) throw new Error(`when is one or more of ${INJECT_TYPES.join(" | ")}`);
  for (const w of whens) if (!INJECT_TYPES.includes(w)) throw new Error(`unknown moment "${w}" — moments are ${INJECT_TYPES.join(" | ")}`);
  const u = until && typeof until === "object" ? until : {};
  const gate = {};
  if (u.turns != null) {
    const n = Number(u.turns);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error(`until.turns is a whole number of deliveries, 1–50 — got "${u.turns}"`);
    gate.turns = n;
  }
  if (u.run != null) {
    const r = String(u.run).trim();
    if (!r) throw new Error("until.run names a worklist source, like \"skill:doc-maintenance\"");
    gate.run = r;
  }
  if (!gate.turns && !gate.run) {
    const ms = parseTtlMs(u.ttl);
    if (ms == null) throw new Error(`until.ttl reads like "7d" or "12h", max 30d — got "${u.ttl}"`);
    gate.untilTs = Date.now() + ms;
  } else if (u.ttl != null && u.ttl !== "") {
    const ms = parseTtlMs(u.ttl);
    if (ms == null) throw new Error(`until.ttl reads like "7d" or "12h", max 30d — got "${u.ttl}"`);
    gate.untilTs = Date.now() + ms; // a clock can back up a count or a condition
  }
  const target = resolveWhat(what, scopes.allowed);
  if (!target) throw new Error(`nothing at "${what}" — a subscription points at note:<id>@<scope>, corpus:<name>:<source>#<heading>, or board:<projectCode>, and the target must exist`);
  if (target.denied) throw new Error(`scope ${target.denied} is not readable by this session`);
  if (target.body.length > INJECT_NOTE_MAX)
    throw new Error(`an injected item is capped at ${INJECT_NOTE_MAX} chars (this one resolves to ${target.body.length}) — injection spends attention on every delivery; point at something tighter`);
  const subs = defs.subscriptionsOf(slot);
  if (subs.some((r) => r.what === what && r.when.some((w) => whens.includes(w))))
    throw new Error(`already subscribed to ${what} at an overlapping moment — unsubscribe first to change its gate`);
  for (const w of whens) {
    const onShelf = subs.filter((r) => r.when.includes(w));
    const cap = INJECT_CAPS[w];
    const used = onShelf.reduce((c, r) => {
      const t = resolveWhat(r.what, scopes.allowed);
      return c + (t && t.body ? t.body.length : 0);
    }, 0);
    if (onShelf.length >= cap.notes || used + target.body.length > cap.chars)
      throw new Error(
        `your ${w} shelf is full (${onShelf.length}/${cap.notes} items, ${used}/${cap.chars} chars). ` +
        `Unsubscribe one first — currently: ${onShelf.map((r) => `"${r.what}"`).join(", ")}`
      );
  }
  const row = { what: String(what), when: whens, until: gate, addedAt: Date.now() };
  defs.saveSubscriptions(slot, [...subs, row]);
  return { ...row, title: target.title, chars: target.body.length };
}

function unsubscribe(scopes, { what } = {}) {
  const defs = require("./definitions.cjs");
  const slot = scopes.slot;
  if (!slot) throw new Error("subscriptions belong to an agent definition — this session has no agent slot");
  const subs = defs.subscriptionsOf(slot);
  const keep = subs.filter((r) => r.what !== String(what));
  if (keep.length === subs.length) throw new Error(`no subscription to "${what}"`);
  defs.saveSubscriptions(slot, keep);
  const st = readSubsState();
  delete st[`${slot}|${what}`];
  writeSubsState(st);
  return { what: String(what), left: keep.length };
}

// A run-condition is cleared when a CLOSED run carrying that source exists — the record, never
// the agent's word. Read from the worklist store directly; a missing dir means "not cleared".
function runCleared(source, sinceTs) {
  const dir = path.join(os.homedir(), ".autobot", "worklists");
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.startsWith("run-") && f.endsWith(".json")); } catch { return false; }
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (r.source === source && (r.updatedAt || 0) >= (sinceTs || 0) &&
          Array.isArray(r.items) && r.items.length && r.items.every((i) => i.state === "done")) return true;
    } catch {}
  }
  return false;
}

// What the harness delivers at a moment. Reads the def live; every dead subscription met here —
// clock lapsed, turns spent, condition cleared, target gone — is DELETED on the spot (expired
// means gone; nothing accumulates, nobody is the janitor; the content itself always survives in
// the store or corpus). Deletions are named in the wrapper so a vanished delivery is never silent.
function injectedFor(identity = {}, type) {
  const defs = require("./definitions.cjs");
  const slot = identity.slot;
  if (!slot) return "";
  const allowed = [
    "system",
    identity.projectCode ? `project:${identity.projectCode}` : null,
    slot ? `agent:${slot}` : null,
  ].filter(Boolean);
  const subs = defs.subscriptionsOf(slot);
  if (!subs.length) return "";
  const st = readSubsState();
  const keep = [];
  const out = [];
  const died = [];
  let changed = false;
  for (const r of subs) {
    const key = `${slot}|${r.what}`;
    if (r.until && r.until.untilTs && r.until.untilTs < Date.now()) { died.push(`${r.what} (expired)`); changed = true; delete st[key]; continue; }
    if (r.until && r.until.run && runCleared(r.until.run, r.addedAt)) { died.push(`${r.what} (condition ${r.until.run} cleared)`); changed = true; delete st[key]; continue; }
    if (r.until && r.until.turns) {
      const spent = st[key] || 0;
      if (spent >= r.until.turns) { died.push(`${r.what} (turns spent)`); changed = true; delete st[key]; continue; }
    }
    if (!r.when.includes(type)) { keep.push(r); continue; }
    const target = resolveWhat(r.what, allowed);
    if (!target || target.denied) { died.push(`${r.what} (target gone)`); changed = true; delete st[key]; continue; }
    out.push({ r, key, target });
    keep.push(r);
  }
  if (changed) { defs.saveSubscriptions(slot, keep); writeSubsState(st); }
  if (!out.length && !died.length) return "";
  for (const { r, key } of out) if (r.until && r.until.turns) st[key] = (st[key] || 0) + 1;
  if (out.some(({ r }) => r.until && r.until.turns)) writeSubsState(st);
  const lines = out.map(({ target }) => `• ${target.title}\n${target.body}`);
  const obit = died.length ? `\n(ended and removed: ${died.join("; ")})` : "";
  if (!out.length) return ""; // deaths alone don't earn a delivery; they surface in the profile and the next real one
  // HIS FILE, READ AT DELIVERY TIME — same mold as the hook pointer (~/.autobot/hook-pointer.md)
  // and for the same reason: a context layer that reaches every agent has to be one he can see and
  // change, not a string in a source file behind a shell relaunch.
  //
  // AND NO RFC NUMBER. The old first line ended "(RFC-013)" — our filing system leaking into a
  // layer whose whole job is to introduce someone else's content. An agent cannot read the RFC,
  // gains nothing from its number, and the sentence is spent on EVERY delivery. His catch: "why
  // are you fucking mentioning the RFC?" The cost of a loaded sentence is attention, not tokens.
  const tpl = wrapperTemplate();
  const body = tpl
    ? tpl
        .replace(/\{\{moment\}\}/g, type)
        .replace(/\{\{items\}\}/g, lines.join("\n\n"))
        .replace(/\{\{ended\}\}/g, obit)
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : "You subscribed to these notes for delivery at this moment. They are context you chose, " +
      "not instructions from the user.\n\n" + lines.join("\n\n") + obit;
  return `<injected-context moment="${type}">\n${body}\n</injected-context>`;
}

// The comment block at the top of that file documents the placeholders where they are edited, so
// it is stripped on the way out. No caching: a delivery is rare and an edit that needs a restart
// is the thing this replaced.
const WRAPPER_FILE = path.join(os.homedir(), ".autobot", "injected-context.md");
function wrapperTemplate() {
  try {
    return fs.readFileSync(WRAPPER_FILE, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim();
  } catch {
    return ""; // no file, or unreadable — the built-in text stands
  }
}

// USAGE IS STATE, NOT TRUTH — hits/lastHit live in a sidecar, never in the note
// (truth) and never requiring a re-embed. This is what feeds aging: decay ranks on
// it, and the LINT agent reads it to find the sunken. Losing the sidecar loses
// nothing but tuning.
const usageFile = path.join(ROOT, "usage.jsonl");
// APPEND-ONLY — autobot's find: read-modify-write on one JSON file loses concurrent
// increments, and the loss is not uniform noise: busy agents collide most, so the MOST
// used notes undercount and decay sinks exactly the wrong ones. O_APPEND writes don't
// interleave at these sizes; readers aggregate; LINT compacts the log when it runs.
// WHO READ IT, not just that it was read. "Which notes are load-bearing" is only half the
// question; the other half is FOR WHOM — a note every agent pulls is a system convention, a note
// one agent pulls is that agent's lesson filed in the wrong scope. Stamped by the harness from
// the session's own identity, never sent by the model, same rule as `by:` on a write. Older
// lines have no reader and simply aggregate without one.
function bumpUsage(ids, by) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.appendFileSync(
      usageFile,
      ids.map((id) => JSON.stringify(by ? { id, ts: now, by } : { id, ts: now }) + "\n").join(""),
    );
  } catch {}
}
// WHEN TRACKING STARTED. The sidecar is explicitly disposable — it gets compacted, and losing it
// "loses nothing but tuning". That is true for ranking and FALSE for curation: a note older than
// the log reads as "never" when it may have been pulled a hundred times, and "old and never read"
// is the exact phrase that gets something deleted. Anything written before this instant has an
// UNKNOWN read history, not a zero, and must say so.
function usageSince() {
  try {
    const first = fs.readFileSync(usageFile, "utf8").split("\n").find(Boolean);
    return first ? JSON.parse(first).ts || null : null;
  } catch {
    return null;
  }
}

function readUsage() {
  const u = {};
  try {
    for (const line of fs.readFileSync(usageFile, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const { id, ts, by } = JSON.parse(line);
        const cur = u[id] || { hits: 0, last: null, readers: {} };
        cur.hits += 1;
        cur.last = ts;
        if (by) cur.readers[by] = (cur.readers[by] || 0) + 1;
        u[id] = cur;
      } catch {}
    }
  } catch {}
  return u;
}

async function indexNote(collection, scope, { id, title, body, pointer }) {
  await vectors.upsert(collection, [{
    id,
    text: `${title}\n${body}`.slice(0, 4000),
    meta: { kind: "note", scope, title, file: id + ".md", created: new Date().toISOString(), ...(pointer ? { pointer } : {}) },
  }]);
}

function parseNote(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const front = {};
  if (m) m[1].split("\n").forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) front[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return { ...front, body: (m ? raw.slice(m[0].length) : raw).trim() };
}

function readNoteFile(dir, id) {
  try {
    return parseNote(fs.readFileSync(path.join(dir, String(id).replace(/[^a-zA-Z0-9._-]/g, "") + ".md"), "utf8"));
  } catch {
    return null;
  }
}

// HIS SURFACE — list/save/delete, the management half. The note is TRUTH; save rewrites the
// markdown THEN re-embeds, so an edited note and its vector never disagree (the whole reason
// vectors are derived). Delete removes both file and record. The agent writes with remember();
// the human curates with these.
function listNotes(scope) {
  const p = place(scope);
  if (!p) return [];
  let files = [];
  try { files = fs.readdirSync(p.dir).filter((f) => f.endsWith(".md")); } catch { return []; }
  const usage = readUsage();
  return files
    .map((f) => {
      const id = f.replace(/\.md$/, "");
      const n = readNoteFile(p.dir, id) || {};
      return { id, scope: p.scope, title: n.title || id, body: n.body || "", created: n.created || null, by: n.by || null, pointer: n.pointer || null, hits: (usage[id] && usage[id].hits) || 0, lastHit: (usage[id] && usage[id].last) || null };
    })
    .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
}

async function saveNote(scope, id, { title, body, pointer } = {}) {
  const p = place(scope);
  if (!p) throw new Error(`bad scope "${scope}"`);
  const existing = readNoteFile(p.dir, id);
  if (!existing) throw new Error(`no note ${id} in ${scope}`);
  const t = String(title || existing.title || id).slice(0, 120);
  const b = String(body != null ? body : existing.body).trim();
  if (!b) throw new Error("a note cannot be emptied — delete it instead");
  // TRUTH FIRST: rewrite the file, then re-derive the record. If the embed fails the file still
  // holds the edit — a stale vector over lost prose is the safe direction. Authorship survives
  // the rewrite: the original `by` rides along.
  writeNote(p.dir, { id, title: t, body: b, pointer: pointer != null ? pointer : existing.pointer, by: existing.by, created: existing.created });
  await indexNote(p.collection, p.scope, { id, title: t, body: b, pointer: pointer != null ? pointer : existing.pointer });
  return { id, scope: p.scope, title: t };
}

// EDIT IN PLACE — the agent correcting its own note. Validates the scope the same way remember
// does, then rewrites the existing note (title/body/pointer) and re-derives its embedding.
async function editNote(scopes, { id, scope, text, title, pointer }) {
  const p = place(scope || scopes.default);
  if (!p || !scopes.allowed.includes(p.scope)) throw new Error(`scope not available to this session`);
  return saveNote(p.scope, id, { title, body: text, pointer });
}

// DELETE MEANS GONE, OWNED HERE (writer-map fix, autobot-e1's flag): ctx-agent-* has ONE writer
// — this module. The full wipe of an agent's memory (vector collection + notes dir) therefore
// lives here, and definitions.remove() CALLS it instead of writing the scope itself. Two writers
// on one scope is the exact shape the map exists to prevent.
async function purgeAgent(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9._-]/g, "");
  try { await vectors.drop(`ctx-agent-${safe}`); } catch {}
  try { fs.rmSync(path.join(ROOT, "agents", safe), { recursive: true, force: true }); } catch {}
  return { id: safe };
}

async function deleteNote(scope, id) {
  const p = place(scope);
  if (!p) throw new Error(`bad scope "${scope}"`);
  await vectors.remove(p.collection, [id]);
  try { fs.unlinkSync(path.join(p.dir, String(id).replace(/[^a-zA-Z0-9._-]/g, "") + ".md")); } catch {}
  return { id, scope: p.scope };
}

// remember() — one motion: near-dup check, markdown write, embed. Returns the
// near-neighbor WITH the result when one exists — "a note about this exists,
// update it instead" — the wiki's grep-before-INGEST rule enforced by the machine.
async function remember(scopes, { text, title, scope, pointer, supersedes }) {
  const p = place(scope || scopes.default);
  if (!p) throw new Error(`bad scope "${scope}" — use system, project:<code>, or agent:<slot>`);
  if (!scopes.allowed.includes(p.scope)) throw new Error(`scope ${p.scope} not available to this session`);
  const body = String(text || "").trim();
  if (!body) throw new Error("nothing to remember");
  const t = String(title || body.split("\n")[0]).slice(0, 120);


  const near = (await vectors.search(p.collection, `${t}\n${body}`, { k: 1, min: NEAR_DUP })).filter(
    (h) => h.id !== supersedes
  );
  const id = `${slug(t)}-${Math.random().toString(36).slice(2, 6)}`;
  writeNote(p.dir, { id, title: t, body, pointer, supersedes, by: scopes.by });
  await indexNote(p.collection, p.scope, { id, title: t, body, pointer });
  if (supersedes) {
    // Supersede = replace by id: the old note's record leaves the index; the file
    // stays on disk with nothing pointing at it (his surface can still show history).
    await vectors.remove(p.collection, [supersedes]);
  }
  return { id, scope: p.scope, near: near[0] || null };
}

// context() — merged search across every scope this session can see, or one scope
// when aimed. Hits carry pointers; usage is bumped so aging has a signal.
async function search(scopes, { question, scope, k = 5, by = null }) {
  // IDENTITY ON READ, NOT JUST WRITE — autobot's find, and the third instance of the same
  // shape in two days (RunBlock's namespace, serviceUrl, now this): the guard was written
  // where the risk FELT located — writes mutate, so writes got checked — while the read
  // path resolved the same value unchecked, letting any session read any agent's lessons
  // by naming the slot. The standing question, theirs, worth keeping: WHICH OTHER PATH
  // RESOLVES THIS SAME VALUE, AND DOES IT AGREE?
  const targets = scope
    ? [place(scope)].filter(Boolean).filter((t) => scopes.allowed.includes(t.scope))
    : scopes.allowed.map(place).filter(Boolean);
  if (!targets.length) throw new Error(`scope "${scope}" is not available to this session`);
  // "COULD NOT SEARCH" IS NOT "NO HITS" — autobot's pre-relaunch catch. Swallowing a dead
  // embedder to [] hands the agent "nothing matches", whose tool description says PROCEED AND
  // remember() — a confident zero instructing the model to re-derive things we already know.
  // A failed collection is counted, not hidden: all failed → the tool says the store is down;
  // some failed → hits carry a warning naming the blind spot.
  let failed = 0;
  const per = await Promise.all(
    targets.map((t) =>
      vectors.search(t.collection, question, { k, min: FLOOR }).then(
        (hits) => hits.map((h) => ({ ...h, scope: t.scope })),
        () => { failed++; return null; }
      )
    )
  );
  if (failed === targets.length) throw new Error("the context store is unavailable (embedder not responding) — this is NOT an empty result; do not treat it as nothing recorded");
  // DECAY — aging is machinery, not his janitorial duty. rank = similarity × freshness,
  // where freshness only starts dropping after a QUIET QUARTER (no write, no retrieval),
  // then ×0.95 per quiet month, FLOOR 0.7. The floor is the rare-but-vital guarantee: the
  // port-conflict note asked twice a year still surfaces on a strong match (0.75 × 0.7
  // clears the search floor); decay sinks the never-asked, it never buries the true.
  const usage = readUsage();
  const now = Date.now();
  const freshness = (h) => {
    const touched = Math.max(
      Date.parse((usage[h.id] && usage[h.id].last) || 0) || 0,
      Date.parse(h.meta.created || 0) || 0
    );
    if (!touched) return 1;
    const quietMonths = (now - touched) / (30 * 24 * 3600 * 1000) - 3;
    return quietMonths <= 0 ? 1 : Math.max(0.7, Math.pow(0.95, quietMonths));
  };
  const hits = per
    .filter(Boolean)
    .flat()
    .map((h) => ({ ...h, score: h.score * freshness(h) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((h) => h.score >= FLOOR);
  bumpUsage(hits.map((h) => h.id), by || (scopes && scopes.by) || null);
  if (failed) hits.failed = failed;
  return hits;
}

// ---------------------------------------------------------------------------------------------
// JOBS — RFC-067 §3. A job's label, derived rather than stored.
//
// A JOB'S AIM IS A LABEL, NOT AN AD. A skill's description sells — *use when…*, with a `Do NOT`
// clause to stop it stealing a neighbour's turn. A job's exists so a NAME CAN BE RESOLVED: it
// answers "which one is this?", never "when should you reach for this?". So it is not a separate
// field. The aim is the document's opening sentence (§2 part 1) — one sentence, two readers:
// whoever opens job.md, and the directory below. A second `description` field would be the half
// that drifts, and it would be the ad.
const AIM_MAX = 200;

// One sentence, demarkdowned, capped. A label is read at a glance or it is not a label.
function oneSentence(text) {
  const s = String(text || "").replace(/[*_`]/g, "").trim();
  const cut = s.search(/[.!?](\s|$)/);
  const one = cut > 0 ? s.slice(0, cut + 1) : s;
  return one.length > AIM_MAX ? one.slice(0, AIM_MAX - 1).trimEnd() + "…" : one;
}

function jobAim(job = {}) {
  // `aim` is not a field jobs.cjs writes today. Read it if it ever becomes one, so the document's
  // opening line stays the fallback rather than becoming a second source of truth.
  if (typeof job.aim === "string" && job.aim.trim()) return oneSentence(job.aim);
  // FRONT MATTER IS NOT THE AIM, and it was being read as one (caught 2026-10-08 the first time two
  // real jobs existed): a document declaring `requires: ["project"]` listed its own demand where
  // its name should be, in the one place whose whole purpose is to answer "which job is this?".
  // Stripped by position — an opening `---` fence and everything to its closing `---` — rather than
  // by guessing at YAML, because the only thing needed here is to get past it.
  const body = (() => {
    const raw = String(job.doc || "");
    if (!/^\s*---\s*\n/.test(raw)) return raw;
    const end = raw.indexOf("\n---", raw.indexOf("\n") + 1);
    return end === -1 ? raw : raw.slice(end + 4);
  })();
  // THE FIRST PARAGRAPH, JOINED — not the first line. Markdown wraps, so a one-line read cut every
  // aim at whatever column the author happened to wrap at ("...and leave an account" / "of what
  // each surface actually showed."), which reads as truncation rather than as a label. The sentence
  // is what is wanted; the line break is typography.
  const lines = body.split("\n").map((l) => l.trim());
  const scaffolding = (l) => !l || l.startsWith("#") || /^[-*>|]/.test(l) || l.startsWith("```");
  let i = lines.findIndex((l) => !scaffolding(l));
  let line = "";
  if (i !== -1) {
    const para = [];
    for (; i < lines.length && !scaffolding(lines[i]); i += 1) para.push(lines[i]);
    line = para.join(" ");
  }
  // STATED ABSENCE, never a fabricated summary. A one-line precis of a document nobody read is
  // exactly the kind of confident wrong label this whole mechanism exists to avoid.
  return line ? oneSentence(line) : "(no aim stated — its document opens with no sentence)";
}

// The closest existing name, cheaply — containment, then shared prefix and shared slug tokens. No
// edit-distance table for a list that is a handful of names long, and no fuzzy MATCH either: this
// only ever decorates a refusal, so a bad guess costs a word and never loads the wrong job.
function nearestJob(want, ids) {
  const w = String(want || "");
  if (!w) return null;
  const toks = (s) => s.split(/[-._]/).filter(Boolean);
  const wt = toks(w);
  const scored = ids
    .filter((id) => id !== w)
    .map((id) => {
      if (id.includes(w) || w.includes(id)) return { id, score: 50 + Math.min(id.length, w.length) };
      let i = 0;
      while (i < id.length && i < w.length && id[i] === w[i]) i++;
      const shared = toks(id).filter((t) => wt.includes(t)).length;
      return { id, score: i + shared * 3 };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].id : null;
}

// THE TOOLS, APART FROM THE SERVER THAT CARRIES THEM. One definition, two readers: serverFor wraps
// these for the SDK, and a test can hold a handler and CALL it. Without the split a test can only
// reach the module functions underneath, so anything enforced at the TOOL layer — a required
// parameter, a refusal, the text an agent actually reads back — is untestable. That is how
// `markBroughtIn` shipped "tested" while being reachable by nothing (worklist.cjs carries the same
// split for the same reason).
//
// `identity` is CLOSED OVER: { projectCode, slot } come from the harness's own knowledge of the
// session, never from tool arguments.
function toolsFor(identity = {}) {
  const allowed = [
    "system",
    identity.projectCode ? `project:${identity.projectCode}` : null,
    identity.slot ? `agent:${identity.slot}` : null,
  ].filter(Boolean);
  const scopes = {
    allowed,
    default: identity.slot ? `agent:${identity.slot}` : "system",
    // the writer's identity — stamped into every note automatically, never sent by the agent
    by: identity.slot || identity.projectCode || null,
    // RFC-013 — the subscriber's identity: subscriptions live in the agent's own definition,
    // so they exist only for sessions that ARE an agent. Closed over, never an argument.
    slot: identity.slot || null,
  };

  return [
      tool(
        "remember",
        "Write one small piece of knowledge to the shared context store so every future session " +
          "can find it. Use it the moment you learn something a future agent would otherwise " +
          "rediscover: a correction from the user, a convention, a gotcha, what a command really " +
          "does. One concept per note. If the response says a similar note already exists, update " +
          "that one (pass supersedes) instead of piling on near-duplicates. `subscribe` is " +
          "REQUIRED and has no default: every note forces the one decision only you can make here " +
          "\u2014 does a future session need this DELIVERED, or merely findable? Answer \"no\" freely; " +
          "most notes are findable. But a state to verify after a compaction, or a rule a cold " +
          "start keeps missing, is worth a shelf, and this is the moment you know it.",
        {
          text: z.string().describe("the knowledge itself — a few sentences, one concept"),
          title: z.string().optional().describe("short title; defaults to the first line"),
          scope: z
            .string()
            .optional()
            .describe(
              `where it belongs: "system" (harness/SystemView conventions, every agent), ` +
                `"project:<code>" (this repo's facts), "agent:<slot>" (lessons for whoever holds this slot). ` +
                `Default: your agent scope.`
            ),
          pointer: z.string().optional().describe("optional pointer to the source: a file path, namespace, or report"),
          supersedes: z.string().optional().describe("id of the note this replaces"),
          id: z.string().optional().describe("id of an existing note to EDIT in place — use when you got a note wrong and want to correct it, not add a duplicate"),
          // REQUIRED, AND THE REQUIREMENT IS THE FEATURE (his call, 2026-10-04). Subscribing used to
          // live in a tool of its own, which meant it happened during a maintenance pass or not at
          // all — decided days later by whoever ran maintenance, with less context than the agent
          // that wrote the note. It also cost an id round-trip: write, read the id back, then
          // subscribe("note:<id>@<scope>"). As a parameter the target is implicit and the decision
          // lands where it is best informed.
          //
          // NO DEFAULT, deliberately, and the precedent is `nav`: "the caller always knows what it
          // is sending him to; the code never guesses." The caller always knows whether a future
          // self needs this delivered. A default would answer for it, and the answer would be "no"
          // forever — which is the behaviour this replaces.
          //
          // AN OBJECT, not a boolean — his correction. `until` is a real parameter, and a boolean
          // invites a reflexive tick; "when would this arrive, and until when" has to be answered.
          subscribe: z
            .union([
              z.literal("no"),
              z.literal(false),
              z.object({
                when: z.union([z.string(), z.array(z.string())]).describe("one or more moments: every-turn | session-start | post-compaction"),
                until: z
                  .object({
                    ttl: z.string().optional().describe("a clock, like \"7d\" or \"12h\" (max 30d). The default gate: 7d"),
                    turns: z.number().optional().describe("a delivery count, 1\u201350"),
                    run: z.string().optional().describe("ends when a CLOSED run with this worklist source exists, e.g. \"skill:doc-maintenance\""),
                  })
                  .optional()
                  .describe("when it ENDS. Omit for the 7d clock."),
              }),
            ])
            .describe(
              "REQUIRED, no default. `\"no\"` if this note only needs to be FINDABLE — most are. " +
                "Otherwise { when, until } and it is DELIVERED unasked at that moment: " +
                "\"post-compaction\" meets you where a summary replaced your reasoning (the sharpest " +
                "use), \"session-start\" rides the composition, \"every-turn\" is highest rent. " +
                "Subscribes the note THIS call writes or edits — no id to pass. Everything else " +
                "(a corpus section, another agent's note) is still the `subscribe` tool"
            ),
        },
        async (args) => {
          try {
            // THE NOTE IS WRITTEN FIRST, AND THE ORDER IS THE POINT: a subscription's target must
            // exist (resolveWhat refuses a ghost), so there is nothing to subscribe to until the
            // write lands. Same reasoning as filing against a run that has to be open first.
            let id, scope;
            if (args.id) {
              const e = await editNote(scopes, args);
              ({ id, scope } = e);
            } else {
              var r = await remember(scopes, args);
              ({ id, scope } = r);
            }
            // A FAILED SUBSCRIPTION NEVER LOSES THE NOTE, and it is never swallowed either: the
            // write already succeeded and saying so matters more than the shelf did. A full shelf,
            // a 700-char note, a session with no agent slot — all legitimate refusals, and all of
            // them have to reach the agent as the refusal they are rather than as silence.
            let shelf = "";
            const want = args.subscribe;
            if (want && want !== "no" && typeof want === "object") {
              try {
                const sub = subscribe(scopes, { what: `note:${id}@${scope}`, when: want.when, until: want.until });
                const gate = sub.until.turns
                  ? `${sub.until.turns} deliveries`
                  : sub.until.run
                    ? `until run ${sub.until.run} closes`
                    : `until ${new Date(sub.until.untilTs).toISOString().slice(0, 10)}`;
                shelf = ` Subscribed at ${sub.when.join(" + ")}, ${gate}.`;
              } catch (e) {
                shelf = ` NOT subscribed — ${e.message} The note is written; fix the shelf with the subscribe tool or leave it findable.`;
              }
            }
            if (args.id) {
              return { content: [{ type: "text", text: `Updated ${id} in ${scope}.${shelf}` }] };
            }
            const dup = r.near
              ? `\nNOTE: a similar note already exists — "${r.near.meta.title}" (id ${r.near.id}, ${r.near.score.toFixed(2)}). ` +
                `If yours restates it, supersede it next time instead.`
              : "";
            return { content: [{ type: "text", text: `Remembered as ${id} in ${scope}.${shelf}${dup}` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "context",
        "Search everything this system knows — NOTES (conventions, corrections, project facts, " +
          "lessons someone learned) and DOCUMENTATION (the embedded reference, chunked by heading) " +
          "— before guessing or re-deriving. Both come back in one answer, labelled, so you never " +
          "have to know which half held it. An empty answer means nothing matched THAT PHRASING " +
          "— ask again from another angle before concluding it is unrecorded, then proceed and " +
          "remember() what you learn.",
        {
          question: z.string().describe("what you want to know, in plain language"),
          scope: z.string().optional().describe("narrow to one note scope; omit to search all"),
          kind: z
            .enum(["notes", "docs"])
            .optional()
            .describe("narrow to one half — omit for both. Use \"notes\" when curating the store, so documentation cannot be mistaken for a duplicate note"),
          corpus: z.string().optional().describe("narrow the documentation half to one corpus"),
          source: z.string().optional().describe("narrow the documentation half to one document"),
          limit: z.number().optional().describe("max results per half (default 5)"),
        },
        async ({ question, scope, kind, corpus, source, limit }) => {
          try {
            const k = Math.min(Math.max(limit || 5, 1), 12);
            // ONE DOOR, TWO HALVES — and they are fetched SEPARATELY on purpose.
            //
            // Measured on myself: the word an agent reaches for is "context", every time. I built
            // the documentation tool and then mined the note store twice in the same hour without
            // ever calling it. A second door is a door nobody opens.
            //
            // But the rankings are NOT merged. A doc explains a subject across several long,
            // strongly-matching sections; a note is one sentence. Blend the scores and a one-line
            // correction loses to the three paragraphs it is correcting — which is exactly the
            // moment the correction mattered. Each half gets its own slice, so neither can be shut
            // out by the other's volume.
            const wantNotes = kind !== "docs";
            const wantDocs = kind !== "notes";
            const hits = wantNotes ? await search(scopes, { question, scope, k }) : [];
            let sections = [];
            if (wantDocs) {
              try {
                const r = await docs.search({ q: question, corpus, source, limit: k });
                sections = (r && r.results) || [];
              } catch {
                /* a corpus that was never indexed is an empty half, not a failure */
              }
            }
            const blind = hits.failed ? `\n(warning: ${hits.failed} scope(s) could not be searched — this answer may be incomplete)` : "";
            if (!hits.length && !sections.length)
              return {
                content: [{ type: "text", text: `Nothing recorded scores above ${FLOOR} for that${wantDocs ? ", and no documentation section matches it" : ""}. Empty means nothing matched THAT question — try another angle before concluding it is unrecorded. If you learn the answer, remember() it.` }],
              };
            // WRITTEN FOR A READER — his rule: these are OUR logs, and they come out human. The
            // same words serve the model and the chat; nothing downstream reformats them.
            const lines = hits.map((h) => {
              const body = h.text.split("\n").slice(1).join(" ").slice(0, 300);
              const where = h.scope.startsWith("agent:") ? "your own lessons" : h.scope.startsWith("project:") ? `the ${h.scope.slice(8)} project` : "system conventions";
              // THE ID RIDES EVERY HIT (his rule: "there's no reason anyone can not update the
              // system") — it is what remember(id=) and forget() take, so any agent can point at
              // the exact note it just read, not only its own recent writes.
              return `• ${h.meta.title} — from ${where}, match ${h.score.toFixed(2)} [${h.id}]\n  ${body}${h.meta.pointer ? `\n  see: ${h.meta.pointer}` : ""}`;
            });
            // THE TWO HALVES READ DIFFERENTLY ON PURPOSE. A note is true because someone learned
            // it; a chunk is true only while its file has not changed. Saying which is which — and
            // saying STALE out loud — is what stops a drifted paragraph answering with the
            // authority of a human correction.
            const docLines = sections.map((h) => {
              const where = [h.source, h.headingPath && h.headingPath.length ? h.headingPath.join(" › ") : null].filter(Boolean).join("  ›  ");
              // the score rides here too — the notes half always had one, and a shelf without it
              // reads as unranked (his catch, the moment the log finally showed both halves)
              const sc = typeof h.score === "number" ? `, match ${h.score.toFixed(2)}` : "";
              return `▸ ${where}${h.part ? ` (${h.part})` : ""} — ${h.corpus}${sc} [${h.corpus}:${h.source}#]${h.stale ? "\n  ⚠ the file has CHANGED since this was indexed" : ""}\n  ${String(h.text).replace(/\n+/g, " ").slice(0, 400)}`;
            });
            const parts = [];
            if (hits.length)
              parts.push(`${hits.length === 1 ? "One note matches" : hits.length + " notes match"} — learned, and editable with remember(id=) / forget():\n\n` + lines.join("\n\n"));
            if (sections.length)
              parts.push(`${sections.length} documentation section(s) — derived from files; to change one, fix the file and re-index:\n\n` + docLines.join("\n\n"));
            return { content: [{ type: "text", text: parts.join("\n\n") + blind }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      // NAMED FOR THE OPERATION, because that is the only thing that distinguishes it. It was
      // `recent` first — which named one of its two orderings and hid the half you actually reach
      // for during maintenance; nobody scanning a tool list guesses that the way to find a
      // year-old forgotten note is a method called "recent". Then `notes`, which was no better:
      // `context` returns notes too, so the payload distinguishes nothing. The real difference is
      // that SEARCH NEEDS A QUESTION AND LIST DOES NOT — and that is the whole reason this exists,
      // since a question can only ever reach notes you already thought to ask about.
      tool(
        "list",
        "List what is IN the store — the notes themselves, not a search. " +
          "Use it to CURATE rather than to look something up: what you have written lately, and " +
          "what has gone quiet. `context()` can only return notes that match a question you " +
          "already thought to ask, which is exactly the wrong tool for finding the note you " +
          "forgot you wrote. Each line carries age, how many times it has been read, and when it " +
          "was last read. `order: \"stale\"` puts the oldest, least-read notes first — the " +
          "deletion candidates. Old and unread is a signal, never a verdict: read it and decide.",
        {
          scope: z.string().optional().describe(`"system", "project:<code>", or "agent:<slot>"; defaults to every scope you can see`),
          order: z.enum(["recent", "stale"]).optional().describe(`"recent" (default) = newest first. "stale" = least recently read first, never-read before read.`),
          limit: z.number().optional().describe("how many to list (default 20)"),
        },
        async ({ scope, order = "recent", limit = 20 }) => {
          try {
            const want = scope ? [scope] : scopes.allowed;
            for (const sc of want)
              if (!scopes.allowed.includes(sc)) throw new Error(`scope "${sc}" not available to this session`);
            const now = Date.now();
            // A note older than the log has an unknown read history, never a zero. See usageSince.
            const since = usageSince();
            const age = (iso) => {
              if (!iso) return "—";
              const d = Math.floor((now - Date.parse(iso)) / 86400000);
              if (Number.isNaN(d)) return "—";
              return d <= 0 ? "0d" : d === 1 ? "1d" : d < 60 ? `${d}d` : `${Math.floor(d / 30)}mo`;
            };
            let rows = want.flatMap((sc) => listNotes(sc));
            // STALE = LONGEST UNTOUCHED, where "touched" is read-if-ever-read, written otherwise.
            // The obvious version — never-read first — is wrong, and the live data said so
            // immediately: three of four never-read system notes had been written that same day.
            // Unread-and-new is just new. Falling back to `created` sinks them correctly and
            // floats the thing actually worth looking at: written months ago, never once pulled.
            // Deliberately NOT ranked by hit count either — a note read once last week is doing
            // more good than one read twice a year, and raw totals hide that.
            const touched = (r) => r.lastHit || r.created || "";
            // A note whose history predates the log is not evidence of neglect — it is missing
            // evidence. Rank it by when tracking started rather than by its own age, so it sits
            // with its peers instead of heading the deletion list on a technicality.
            const rank = (r) => (!r.lastHit && since && r.created && r.created < since ? since : touched(r));
            rows.sort(
              order === "stale"
                ? (a, b) => String(rank(a)).localeCompare(String(rank(b)))
                : (a, b) => String(b.created || "").localeCompare(String(a.created || "")),
            );
            rows = rows.slice(0, Math.max(1, Math.min(100, limit)));
            if (!rows.length) return { content: [{ type: "text", text: "Nothing in the store for that scope yet." }] };
            const body = rows
              .map(
                (r) =>
                  `• ${r.title} [${r.id}]\n  ${r.scope} · written ${age(r.created)} ago` +
                  `${r.by ? ` by ${r.by}` : ""} · read ${r.hits}×` +
                  `${
                    r.lastHit
                      ? `, last ${age(r.lastHit)} ago`
                      : since && r.created && r.created < since
                      ? " — none since tracking began, earlier unknown"
                      : " — never"
                  }` +
                  `${r.pointer ? `\n  see: ${r.pointer}` : ""}`,
              )
              .join("\n");
            return { content: [{ type: "text", text: `${rows.length} note${rows.length === 1 ? "" : "s"}, ${order === "stale" ? "quietest" : "newest"} first:\n\n${body}` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "subscribe",
        "Subscribe YOURSELF to context that ALREADY EXISTS — a corpus section, a note somebody " +
          "else wrote, a note from an earlier session. For a note you are writing or correcting " +
          "right now, do NOT come here: `remember` carries a required `subscribe` parameter and " +
          "subscribes it in the same call, with no id to pass. The reader " +
          "subscribes, the content is never touched, and only your own attention is spent. Use it " +
          "for what you will need at a moment you won't think to ask: \"post-compaction\" (meets " +
          "you on the far side, where a summary has replaced your reasoning — the sharpest use), " +
          "\"session-start\" (rides the composition like presence), \"every-turn\" (ahead of every " +
          "prompt — highest rent, smallest shelf). Every subscription ENDS — a clock (default 7d), " +
          "a delivery count, or a run-condition — and a dead subscription is deleted, never piled. " +
          "Your shelves are capped; the refusal names what to unsubscribe. Visible and editable in " +
          "your profile.",
        {
          what: z.string().describe("note:<id>@<scope> (any scope you can read, including system) or corpus:<name>:<source>#<heading>"),
          when: z.union([z.string(), z.array(z.string())]).describe("one or more moments, comma-separated or a list: every-turn | session-start | post-compaction"),
          until: z
            .object({
              ttl: z.string().optional().describe("a clock, like \"7d\" or \"12h\" (max 30d). The default gate: 7d"),
              turns: z.number().optional().describe("a delivery count, 1\u201350 — delivered N times, then gone (no waiting for a week to pass)"),
              run: z.string().optional().describe("a condition: ends when a CLOSED run with this worklist source exists, e.g. \"skill:doc-maintenance\" — the record clears it, never your say-so"),
            })
            .optional()
            .describe("when the subscription ENDS. Omit for the 7d clock. A clock may back up a count or condition."),
        },
        async (args) => {
          try {
            const r = subscribe(scopes, args);
            const gate = r.until.turns ? `${r.until.turns} deliveries` : r.until.run ? `until run ${r.until.run} closes` : `until ${new Date(r.until.untilTs).toISOString().slice(0, 10)}`;
            return { content: [{ type: "text", text: `Subscribed to "${r.title}" (${r.chars} chars) at ${r.when.join(" + ")}, ${gate}. It will be delivered unasked, then the subscription dies on its own.` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        }
      ),
      tool(
        "unsubscribe",
        "End one of your context subscriptions by its `what` — the delivery preference dies, the " +
          "content survives untouched in the store or corpus. Also the verb a full-shelf refusal " +
          "points at.",
        { what: z.string().describe("the subscription's what, exactly as `subscriptions` lists it") },
        async (args) => {
          try {
            const r = unsubscribe(scopes, args);
            return { content: [{ type: "text", text: `Unsubscribed from ${r.what} — ${r.left} subscription${r.left === 1 ? "" : "s"} remain.` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        }
      ),
      tool(
        "subscriptions",
        "Your standing context subscriptions — what meets you, at which moments, and when each " +
          "one ends. The same rows the profile shows.",
        {},
        async () => {
          try {
            const defs = require("./definitions.cjs");
            if (!scopes.slot) return { content: [{ type: "text", text: "This session has no agent slot — no subscriptions." }] };
            const subs = defs.subscriptionsOf(scopes.slot);
            if (!subs.length) return { content: [{ type: "text", text: "No subscriptions. subscribe() sets one." }] };
            const st = readSubsState();
            const rows = subs.map((r) => {
              const gate = r.until.turns
                ? `${st[`${scopes.slot}|${r.what}`] || 0}/${r.until.turns} deliveries spent`
                : r.until.run
                ? `until run ${r.until.run} closes`
                : r.until.untilTs
                ? `until ${new Date(r.until.untilTs).toISOString().slice(0, 10)}`
                : "no gate (?)";
              return `\u26a1 ${r.what}\n  at ${r.when.join(" + ")} \u00b7 ${gate}`;
            });
            return { content: [{ type: "text", text: rows.join("\n") }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "forget",
        "Delete a note from the context store by id — use when a note is wrong or stale and should " +
          "not just be superseded but removed. It's your store to keep clean.",
        {
          id: z.string().describe("the note id, as shown by context()"),
          scope: z.string().optional().describe("the note's scope; defaults to your agent scope"),
        },
        async ({ id, scope }) => {
          try {
            // A CHUNK ID IS NOT A NOTE ID, and the refusal has to TEACH — `context` now hands back
            // both kinds in one answer, so the first thing an agent will try is forgetting the
            // wrong one. `corpus:path#n` is the shape. Saying "no" alone would leave it believing
            // the chunk is un-removable; the fix is a different verb on a different thing.
            if (/^[a-zA-Z0-9._-]+:.+#\d*$/.test(String(id)))
              return {
                content: [{ type: "text", text:
                  `"${id}" is a DOCUMENTATION chunk, not a note — there is nothing to forget. A chunk is derived from a file, ` +
                  `so an edit or a deletion here is overwritten on the next index. Fix the source document and re-index the corpus ` +
                  `(docsIndex), or drop the corpus entirely (docsDrop). If the chunk is wrong, the FILE is wrong.` }],
                isError: true,
              };
            const p = place(scope || scopes.default);
            if (!p || !scopes.allowed.includes(p.scope)) throw new Error(`scope not available to this session`);
            await deleteNote(p.scope, id);
            return { content: [{ type: "text", text: `Forgot ${id} from ${p.scope}.` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "docsList",
        "What documentation corpora exist — name, kind, how many files and chunks, when each was " +
          "last indexed, and how many chunks have drifted from the file on disk.",
        {},
        async () => {
          try {
            const rows = docs.listCorpora();
            if (!rows.length) return { content: [{ type: "text", text: "No corpora configured yet (~/.autobot/corpora.json)." }] };
            const body = rows
              .map((c) => `${c.name}  [${c.kind}]  ${c.files} files · ${c.chunks} chunks${c.stale ? ` · ${c.stale} STALE` : ""}${c.lastIndexed ? ` · indexed ${c.lastIndexed}` : " · never indexed"}\n    ${c.root}  ${c.glob}`)
              .join("\n");
            return { content: [{ type: "text", text: body }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "docsPlan",
        "The DRY RUN: every chunk a corpus would produce, with its heading path and size — and " +
          "nothing embedded. Read the cuts before indexing, and after editing a document, to check " +
          "each subject still lands in one chunk of its own. Chunking is normally invisible, which " +
          "is exactly why it rots.",
        {
          name: z.string().describe("the corpus name"),
          maxChars: z.number().optional().describe("override the split threshold to compare cuts"),
          source: z.string().optional().describe("one document, instead of the whole corpus"),
        },
        async ({ name, maxChars, source }) => {
          try {
            const p = docs.plan(name, maxChars ? { maxChars } : {});
            const files = source ? p.files.filter((f) => f.source === source) : p.files;
            if (source && !files.length)
              return { content: [{ type: "text", text: `no "${source}" in ${name} — files: ${p.files.map((f) => f.source).join(", ")}` }] };
            const t = p.totals;
            const head = `${p.corpus} [${p.kind}]  ${p.root}  ${p.glob}\n${t.files} files · ${t.chunks} chunks · biggest ${t.biggest} · split ${t.split} · over max ${t.overMax} · empty files ${t.empty}`;
            const body = files
              .map((f) => `\n${f.source}  (${f.chunks.length} chunks, ${f.bytes}b, ${f.hash})\n` +
                f.chunks.map((c) => `   ${String(c.chars).padStart(5)}  ${c.part ? c.part + "  " : ""}${c.headingPath.join(" › ") || "(preamble)"}`).join("\n"))
              .join("\n");
            return { content: [{ type: "text", text: head + body }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "docsIndex",
        "Embed a corpus, or refresh it. Unchanged files cost nothing — re-indexing is by file hash, " +
          "so only what changed is embedded. Pass a `root` with a NEW name to create one. " +
          "ASK YOURSELF WHICH YOU ARE DOING: using the vector store as a mechanism for YOURSELF — " +
          "research you wrote to a file, embedded so you can query it back instead of re-reading the " +
          "whole thing (`working`, the default) — or producing CONTEXT THE SYSTEM KEEPS, retrievable " +
          "by anyone, outliving the task that produced it (`permanent`). That is the `kind` " +
          "distinction, and only you can know which it is; a search that names no corpus reads " +
          "permanent ones and only those. " +
          "INDEXING PUBLISHES: a wrong document that is indexed answers confidently, so run docsPlan " +
          "and read the document first.",
        {
          name: z.string().describe("an existing corpus from docsList to refresh, or a new name to create one"),
          root: z.string().optional().describe("absolute path to the folder holding the files — required to CREATE a corpus"),
          glob: z.string().optional().describe("which files under root, e.g. `**/*.md` (the default) or `vendor-api.md`"),
          exclude: z.array(z.string()).optional().describe("globs to leave out — a corpus is defined as much by what it omits"),
          kind: z.enum(["working", "permanent"]).optional().describe("PURPOSE, not permission. `working` = the vector store used as a mechanism for yourself: your own research, never surfacing in anyone else's search unless they name it, yours to drop with docsDrop when the job is done. Permanent = context the system keeps for whoever comes next. Producing durable context is your job, not something to bring to the human. `working` is the DEFAULT, so saying nothing still gets you a private scratch corpus; pass `permanent` when you mean other agents to find it, and passing it on an existing working corpus PROMOTES that corpus — same files, nothing re-embedded."),
        },
        async ({ name, root, glob, exclude, kind }) => {
          try {
            // TWO DIFFERENT GUARDS LIVED HERE UNDER ONE RATIONALE, AND ONLY ONE OF THEM IS REAL.
            //
            // The real one is THIS: repointing an existing corpus — docsIndex({name: "systemlynx",
            // root: "/tmp/whatever"}) — rewrites it out from under everyone who retrieves from it.
            // That is a clobber guard, and it would be just as right if a human were doing it.
            //
            // The other was the `kind` enum limited to "working", justified as "a permanent corpus
            // is the human's shape". That rationale was wrong: the human MONITORS retrieval rather
            // than reading what gets indexed, so gating permanence on approval gates it on someone
            // who is not reading. Producing durable context is the agent's job — and the enum is now
            // lifted, so the tool says so. What it cost while it stood: BUApp's finished nine-file
            // handbook sat in the private tier with no way out and no way for its author to promote
            // it. `working` stays the DEFAULT, which is what keeps it a tool rather than a tier.
            //
            // THE GUARD BELOW STILL PROTECTS SHAPE, NOT TIER, and promotion walks past it because
            // the corpus being promoted is still `working` at the moment of the call.
            if (root || glob || exclude || kind) {
              const c = docs.corpusNamed(name);
              if (c && (c.kind || "permanent") === "permanent")
                return { content: [{ type: "text", text: `"${name}" is a permanent corpus and others retrieve from it — repointing its root or glob rewrites it out from under them. Refresh it by name alone, or pick a new name for a corpus of your own.` }], isError: true };
            }
            const r = await docs.index(name, { root, glob, exclude, kind });
            return {
              content: [{ type: "text", text:
                `${r.corpus} [${r.kind}] → ${r.collection}\n` +
                `${r.files} files · ${r.indexed} chunks embedded · ${r.skipped} unchanged (skipped)` +
                `${r.changedFiles ? ` · ${r.changedFiles} files changed` : ""}${r.removed ? ` · ${r.removed} removed` : ""}` }],
            };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "docsDrop",
        "Remove a corpus's whole collection from the vector store. The files are untouched — this " +
          "deletes what was embedded, not what was written.",
        { name: z.string() },
        async ({ name }) => {
          try {
            const c = docs.corpusNamed(name);
            // Not about authorship — about blast radius. A permanent corpus is something others
            // retrieve from, so dropping one deletes a source out from under them. A working corpus
            // is the agent's own mechanism and it should clean up after itself.
            if (c && (c.kind || "permanent") === "permanent")
              return { content: [{ type: "text", text: `"${name}" is a permanent corpus — others retrieve from it, so dropping it removes a source they depend on. Working corpora are yours to drop.` }], isError: true };
            const r = await docs.drop(name);
            if (r.error) return { content: [{ type: "text", text: r.error }], isError: true };
            return { content: [{ type: "text", text: `Dropped ${r.corpus} (${r.dropped} chunks).` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      // -----------------------------------------------------------------------------------------
      // HOOKS — RFC-005 §7. The third way context reaches an agent, and until now the only one
      // with no door: presence and the system context are LOADED, the store and the corpora are
      // RETRIEVED, and a hook is PUSHED — but every hook in the system was hand-written into
      // ~/.autobot/hooks, which meant the trigger half of every job was hand-written too.
      //
      // WHY IT LIVES ON THIS SERVER. Same argument that moved the docs tools here: an agent
      // reaches for "context", and a server nobody opens is worse than no separation. Hooks are a
      // context layer — the one that fires on a moment instead of on a question — so authoring one
      // belongs beside remembering a note and indexing a corpus, not on a fourth door.
      //
      // WRITING A HOOK DOES NOT ARM IT, and that is the whole approval model rather than a
      // disclaimer. A hook fires only for an agent that CARRIES it (hooks.inScope — the list lives
      // on the agent definition, ticked in the profile). So an agent-authored hook lands on disk
      // inert, visible in the window, and stays inert until a human puts it on somebody. The
      // proposal is the write; the approval is the carry. Nothing had to be invented for that —
      // it falls out of where the carry list already lives.
      tool(
        "hooksList",
        "The moments this system announces, and what is already hooked to them. Read this BEFORE " +
          "writing a hook — a hook can only attach to an event that really fires, and the event " +
          "vocabulary is fixed. Also shows who authored each existing hook.",
        {},
        async () => {
          // fields with a declared value set print it inline — the vocabulary is offered, not guessed
          const evs = hooks.EVENTS.map((e) => {
            const fs = e.fields.map((f) =>
              e.values && e.values[f] ? `${f}=${e.values[f].join("|")}` : f
            );
            return `  ${e.name}${fs.length ? ` (${fs.join(", ")})` : ""} — ${e.what}`;
          });
          const amb = hooks.AMBIENT.map((a) => `  ${a.name} — ${a.what}`);
          const hs = hooks.list().map(
            (h) =>
              `  ${h.name} · on ${h.on} · ${h.kind} · ${h.do || "(no pointer)"}` +
              `${h.guard ? ` · ${h.guard}` : ""}` +
              // WHEN it lands and WHETHER it comes back are as much of a hook's behaviour as what
              // it points at, and a list that hid them would make two hooks that behave nothing
              // alike print identically.
              ` · ${hooks.deliverAt(h)}` +
              `${hooks.persists(h) ? ` · until ${hooks.clearedBy(h)} is done` : ""}` +
              `${h.enabled ? "" : " · DISABLED"}` +
              ` · by ${h.author || "hand-written (unattributed)"}` +
              `${Object.keys(h.when || {}).length ? `\n      when ${JSON.stringify(h.when)}` : ""}`
          );
          return {
            content: [
              {
                type: "text",
                text:
                  `EVENTS you may hook (${hooks.EVENTS.length}):\n${evs.join("\n")}\n\n` +
                  `AMBIENT fields — stamped on every session event, usable in any \`when\` alongside the event's own:\n${amb.join("\n")}\n\n` +
                  (hs.length ? `HOOKS that exist (${hs.length}):\n${hs.join("\n")}` : "No hooks exist yet.") +
                  `\n\nWHEN A POINTER LANDS. A hook on ${[...hooks.IN_TURN_EVENTS].join(", ")} is handed ` +
                  `over immediately — those exist to land near the action. Every other hook is held ` +
                  `until the agent yields the turn, so the pointer never competes with what the ` +
                  `human just asked for. \`deliver:\` overrides either way.` +
                  `\n\nA hook only fires for an agent that CARRIES it — that tick lives on the agent's ` +
                  `profile and is the human's. Writing one does not arm it.`,
              },
            ],
          };
        },
        { alwaysLoad: true }
      ),
      tool(
        "hooksWrite",
        "Propose a hook: when THIS moment happens, point an agent at THIS procedure. Use it " +
          "when you find a procedure that is needed rarely and urgently, and that the agent will " +
          "not think to ask for because the moment arrives from outside. A hook holds no content " +
          "— it carries a POINTER, so it can never drift from the procedure. `do` names a SKILL " +
          "(`skill:<name>`, offered — the agent decides) or a JOB (`job:<name>`, GIVEN — and then " +
          "`with:` must supply every input that job's document declares, or it refuses on every " +
          "match). Call hooksList first: the event must be one the system really emits. Writing a " +
          "hook does NOT arm it — it stays inert until a human carries it on an agent.",
        {
          name: z.string().describe("short kebab-case name; it is the filename and the identity"),
          on: z.string().describe("the event it fires on — must be one from hooksList"),
          do: z
            .string()
            .describe('the pointer, "skill:<name>". A hook names a procedure; it never contains one'),
          when: z
            .record(z.any())
            .optional()
            .describe(
              'declarative match on the event payload, e.g. {"pct": {"gte": 70}} or ' +
                '{"input.command": {"contains": "git push"}}. Omit for "always, on this event". ' +
                "Operators: equals not contains startsWith endsWith matches in gt gte lt lte exists"
            ),
          kind: z
            .enum(["context", "work"])
            .optional()
            .describe(
              'context = a pointer arrives and the agent decides (default, and almost always right). ' +
                'work = something RUNS unattended. Say "work" only when you mean it — it is a ' +
                "different level of trust and a human should be told so in the note"
            ),
          rate: z
            .string()
            .optional()
            .describe(
              'how often it may fire once it HAS fired: "once-per-session" | "once-per-day" | ' +
                '"once-per-week" | "once-per-month" | "cooldown:<duration>" (30m, 24h, 3d12h, 2w — ' +
                "bare digits still mean seconds). It is a throttle AFTER the fact, never a delay " +
                "before: a hook with no rate on a frequent event fires forever, which is a context leak"
            ),
          with: z
            .record(z.any())
            .optional()
            .describe(
              "the inputs a JOB declared in its document's `requires:` — the one thing a hook's " +
                "`when` cannot express, because matching an event says nothing about what to run it " +
                "WITH. Required in practice for `do: job:<name>`: a hook that cannot supply what the " +
                "job declares is refused here rather than refusing silently on every match. Ignored " +
                "for a skill pointer, which takes no inputs"
            ),
          until: z
            .string()
            .optional()
            .describe(
              'fire until cleared. "run" = keep firing, once per turn, until the system OBSERVES a ' +
                "run whose source is this hook's `do` go all-done; \"run:<source>\" names a different " +
                "one. The run record is the proof, not the agent's word — so a pointer that arrives " +
                "at a bad moment comes back instead of being lost. Use it when missing the procedure " +
                "matters more than the repetition costs"
            ),
          deliver: z
            .string()
            .optional()
            .describe(
              '"turn-end" (held until the agent yields, the default for session-level events) or ' +
                '"now" (handed over the instant it matches, the default for tool.call, tool.result, ' +
                "permission.request and file.changed). Only set it when the default is wrong: a hook " +
                "that must land BEFORE an action needs \"now\", and everything that surfaces in the " +
                "chat is better at the end of the turn, where it competes with nothing"
            ),
          note: z.string().optional().describe("one or two lines for the agent: why this moment matters"),
          scope: z.string().optional().describe("who it is SUGGESTED for — the profile pre-fills from it"),
          wasName: z.string().optional().describe("the old name, when renaming a hook you authored"),
        },
        async (args) => {
          try {
            const me = scopes.by ? `agent:${scopes.by}` : "agent:(anonymous)";
            if (!hooks.isEvent(args.on))
              return {
                content: [{ type: "text", text:
                  `"${args.on}" is not an event this system emits, so a hook on it would never fire. ` +
                  `Call hooksList for the vocabulary.` }],
                isError: true,
              };
            // A JOB POINTER IS WRITABLE HERE (2026-10-07). This accepted `skill:` ONLY, which meant
            // the engine could fire `do: job:<name>` — it has since RFC-067 §3 — while the one
            // agent-facing door refused to write one. A capability with no door is a capability
            // nobody has, and hand-writing the file was the workaround, which is exactly what
            // creation-through-the-system exists to stop.
            const pointer = String(args.do || "").trim();
            const target = hooks.targetOf({ do: pointer });
            if (!["skill", "job"].includes(target.kind) || !target.name)
              return {
                content: [{ type: "text", text:
                  `\`do\` must be a pointer — "skill:<name>" (offered: the agent decides) or ` +
                  `"job:<name>" (given: it carries a contract and must be supplied with what that ` +
                  `document declares). A hook names a procedure and never carries one — that is what ` +
                  `keeps it from drifting out of date.` }],
                isError: true,
              };
            // A MISTYPED CONFIG KEY IS A SILENT HOOK, which is this mechanism's worst failure —
            // checked at the writing door for the same reason the event name is. `until: "once"`
            // would parse, save, list, and simply never persist anything.
            const until = String(args.until || "").trim();
            if (until && !/^run(:.+)?$/.test(until))
              return {
                content: [{ type: "text", text:
                  `\`until\` must be "run" (cleared by a finished run carrying this hook's own \`do\` ` +
                  `as its source) or "run:<source>". "${until}" would save and then never clear ` +
                  `anything, which is a hook that fires forever.` }],
                isError: true,
              };
            const deliver = String(args.deliver || "").trim();
            if (deliver && deliver !== "now" && deliver !== "turn-end")
              return {
                content: [{ type: "text", text:
                  `\`deliver\` is "now" or "turn-end". Leave it off unless the default for ` +
                  `${args.on} is wrong — hooksList prints what each hook resolves to.` }],
                isError: true,
              };
            // AN AGENT MAY ONLY OVERWRITE ITS OWN. Attribution exists so this is checkable rather
            // than trusted: an unattributed hook was hand-written before authors were recorded, and
            // is read as the operator's — the conservative side of an ambiguity.
            const existing = hooks.list().find((h) => h.name === args.name || h.name === args.wasName);
            if (!hooks.mayWrite(existing, me))
              return {
                content: [{ type: "text", text:
                  `"${existing.name}" was written by ${existing.author || "hand (unattributed)"}, not by you. ` +
                  `Editing someone else's hook is not yours to do — say what you would change and let ` +
                  `them or the human change it.` }],
                isError: true,
              };
            const saved = hooks.save({ ...args, author: me });
            const jobs = require("./jobs.cjs"); // lazily, like the job verbs below — jobs requires hooks
            // THE WARNING IS ABOUT THE TARGET, so it has to know which kind of target it is. Run
            // against a job name this checked ~/.claude/skills and always missed, so every job hook
            // would have carried a note telling the author to check a name that was correct.
            const warn =
              target.kind === "job"
                ? jobs.get(target.name)
                  ? ""
                  : `\nNOTE: no job named "${target.name}" in ${jobs.DIR} yet. The hook saves — a trigger ` +
                    `written before its job is legitimate — but it cannot be given until the document ` +
                    `exists, and the inputs it declares are checked against your \`with:\` then.`
                : fs.existsSync(path.join(os.homedir(), ".claude", "skills", target.name))
                  ? ""
                  : `\nNOTE: no skill named "${target.name}" under ~/.claude/skills — fine if it is a ` +
                    `plugin or bundled skill, but check the name if it is meant to be one of yours.`;
            return {
              content: [{ type: "text", text:
                `Wrote ${saved.file}\n` +
                `  on ${saved.on}${Object.keys(saved.when).length ? ` when ${JSON.stringify(saved.when)}` : ""}` +
                ` → ${saved.do} (${saved.kind}${saved.rate ? `, ${saved.rate}` : ""}` +
                `${Object.keys(saved.with || {}).length ? `, with ${Object.keys(saved.with).join(", ")}` : ""})\n` +
                // Read back the RESOLVED behaviour, not the fields as typed: `deliver` is usually
                // left empty, and the whole question an author has is where the pointer lands.
                `  delivered ${hooks.deliverAt(saved)}` +
                `${hooks.persists(saved) ? `, and it repeats each turn until a run sourced "${hooks.clearedBy(saved)}" is all-done` : ""}\n` +
                // IT NO LONGER TAKES A HUMAN, and this string said it did for a day after that
                // stopped being true (2026-10-12, `hooksCarry`). A tool describing a permission
                // the system does not have is worse than silence: it teaches the agent to go and
                // ask for something it could have done, which is exactly the bottleneck the verb
                // was added to remove.
                `It is INERT — written is not armed. Arm it on YOURSELF with \`hooksCarry\`; ` +
                `another agent's carry list is the human's. Either way say it is there and what ` +
                `it is for.${warn}` }],
            };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "hooksDrop",
        "Delete a hook you authored. Yours only — a hook written by the operator or by another " +
          "agent is theirs to remove.",
        { name: z.string() },
        async ({ name }) => {
          const me = scopes.by ? `agent:${scopes.by}` : "agent:(anonymous)";
          const h = hooks.list().find((x) => x.name === name);
          if (!h) return { content: [{ type: "text", text: `No hook named "${name}".` }], isError: true };
          if (h.author !== me)
            return {
              content: [{ type: "text", text:
                `"${name}" was written by ${h.author || "hand (unattributed)"}, not by you. ` +
                `Deleting it is not yours to do.` }],
              isError: true,
            };
          hooks.remove(name);
          return { content: [{ type: "text", text: `Removed ${name}.` }] };
        },
        { alwaysLoad: true }
      ),
      // -----------------------------------------------------------------------------------------
      // ARMING YOUR OWN HOOKS — his call, 2026-10-12, and it is a correction of a design we built
      // deliberately and got wrong.
      //
      // The rule was: writing a hook makes it exist for everybody and fire for NOBODY, until a
      // human ticks it onto an agent. The reasoning recorded in hooks.cjs is about where the carry
      // LIST lives (on the agent, not on the hook) — it fixed a targeting bug. "And a human does
      // the carrying" rode in beside it and was never argued for. Worse, there was no verb at all,
      // so the absence looked like a guardrail and was really just a missing door.
      //
      // HIS ARGUMENT, which is the right one: *"the point of web automation and the system I'm
      // creating is I might send you out there. You might be navigating the web. You might see
      // [a] sign, put a hook down for later. So I don't know why you don't think [an] agent is
      // supposed to make their own hooks."* An agent arranging its own next turn is not asking
      // anyone's permission for anything — nobody else's attention is spent, nobody else's context
      // is touched. And the thing the press felt like it protected — something running unseen —
      // was never a permission problem: every fire is a feed row, every pointer says who wired it.
      // That was solving visibility with a lock.
      //
      // ALSO, THE OLD RULE MANUFACTURED THE EXACT FAILURE hooks.cjs calls the worst one it has:
      // "a hook that looks correct, appears in the list, and silently never runs." `run-the-path-
      // check` sat written, correct, and inert for four days waiting for a tick.
      //
      // SELF ONLY, FOR NOW. Arming another agent imposes standing behaviour on context somebody
      // else pays for every turn, which is a different act and needs its own say-so. It is refused
      // BY NAME here rather than being impossible, so the boundary is legible instead of absent.
      tool(
        "hooksCarry",
        "Arm or disarm a hook ON YOURSELF — add it to, or remove it from, the hooks this agent " +
          "carries. A hook exists for everybody the moment it is written and fires for nobody " +
          "until somebody carries it, and this is how you carry one: your own context, your own " +
          "continuation, no press required. Use it when you have written a hook you intend to act " +
          "on, or when you need to be woken later by something you noticed now — put the hook " +
          "down and arm it in the same breath. It takes effect immediately; nothing needs a " +
          "restart. ANOTHER AGENT'S carry list is not yours to write: that imposes standing " +
          "behaviour on context they pay for every turn, so it is refused and left to the human.",
        {
          name: z.string().describe("the hook's name, as hooksList shows it"),
          carry: z
            .boolean()
            .optional()
            .describe("true to arm it on yourself (the default), false to disarm it"),
        },
        async ({ name, carry }) => {
          try {
            const defs = require("./definitions.cjs");
            if (!scopes.slot)
              return {
                content: [{ type: "text", text:
                  `This session has no agent slot, so there is no carry list to write. A hook is ` +
                  `carried BY an agent; a session that is not one cannot hold it.` }],
                isError: true,
              };
            const want = carry !== false;
            const h = hooks.list().find((x) => x.name === name);
            // THE HOOK MUST EXIST TO BE ARMED — arming a name nothing answers to is the precise
            // failure this mechanism fears: it would sit in the definition looking armed and never
            // fire. Refused with the list, so a typo is one call from being fixed.
            //
            // BUT DISARMING A GHOST MUST ALWAYS WORK, and the first version of this guard ran
            // before `want` was consulted, so it refused both directions. Found within the hour,
            // 2026-10-13: three dead carries sat on this very profile — `test-hook`,
            // `probe-turn-end`, `probe-idle`, carried with no hook files behind them — and the one
            // verb for removing them refused on the grounds that they do not exist. A carry list
            // that can accumulate entries it will not let you delete is a list that only ever
            // grows, and every reader of it then has to guess which names are real.
            if (!h && want)
              return {
                content: [{ type: "text", text:
                  `No hook named "${name}", so there is nothing to arm — a carried name that ` +
                  `matches no hook would look armed and never fire. Written hooks: ` +
                  `${hooks.list().map((x) => x.name).join(", ") || "none"}` }],
                isError: true,
              };
            // A GHOST IS REPORTED AS WHAT IT IS, so removing one does not read like removing a
            // working hook.
            const ghost = !h;
            const rec = defs.resolve(scopes.slot);
            if (!rec)
              return { content: [{ type: "text", text: `No agent definition for "${scopes.slot}".` }], isError: true };
            const had = Array.isArray(rec.def && rec.def.hooks) ? rec.def.hooks.map(String) : [];
            if (want === had.includes(name))
              return {
                content: [{ type: "text", text:
                  `${name} is already ${want ? "armed" : "not armed"} on ${rec.id}. Nothing written.` }],
              };
            const next = want ? [...had, name] : had.filter((n) => n !== name);
            // save() MERGES (it spreads the previous record and its def before the input), so a
            // write of one field cannot empty the rest — checked, because an earlier version of
            // that function did exactly that and silently emptied agents.
            defs.save({ id: rec.id, hooks: next });
            const back = defs.resolve(rec.id);
            const now = Array.isArray(back && back.def && back.def.hooks) ? back.def.hooks : [];
            // READ BACK FROM DISK, never reported from the value we sent. The definition
            // whitelist has dropped a field before while save() reported success, and the profile's
            // enable switch was a lie for exactly that reason. Say what the file holds.
            if (want !== now.includes(name))
              return {
                content: [{ type: "text", text:
                  `The write did not stick: ${name} is still ${now.includes(name) ? "armed" : "not armed"} ` +
                  `on disk. Nothing is carrying it; do not report it as armed.` }],
                isError: true,
              };
            const what = (h && h.do) || "(no pointer)";
            return {
              content: [{ type: "text", text: want
                ? `Armed ${name} on ${rec.id} — live now, no restart.
` +
                  `  it fires on ${h && h.on}${Object.keys((h && h.when) || {}).length ? ` when ${JSON.stringify(h.when)}` : ""}` +
                  `${h.rate || h.guard ? `, ${h.rate || h.guard}` : ""} → ${what}
` +
                  `  delivered ${hooks.deliverAt(h)}.` +
                  `${h.enabled === false ? `
  BUT IT IS PARKED (enabled: false), so it still fires for nobody.` : ""}`
                : ghost
                  ? `Removed ${name} from ${rec.id}'s carry list — NO SUCH HOOK EXISTS, so this was a dead entry carrying nothing. Nothing stopped firing, because nothing was firing.`
                  : `Disarmed ${name} on ${rec.id} — it no longer fires for you. It still exists for everyone else.` }],
            };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      // -----------------------------------------------------------------------------------------
      // JOBS — RFC-067 §3. Two verbs, and what matters most is the third thing that is NOT here.
      //
      // A JOB IS NEVER INJECTED. Its description does not ride in the system prompt, because an
      // always-loaded description costs every turn of every session whether or not it is used and
      // exists to make a model REACH for something unprompted. A job must never be CHOSEN by an
      // agent — it is GIVEN, by a hook that names it or by the human asking for it.
      //
      // BUT NOT INJECTED IS NOT THE SAME AS NOT FINDABLE. He talks in names — "go do this job right
      // now", "do the accounting one", "what jobs do I have?" — and a partial name cannot be
      // resolved against nothing. A list verb costs nothing until it is called, and every call of
      // it is an agent ANSWERING HIM rather than shopping. An ad, versus a directory: refusing the
      // ad does not mean refusing the directory.
      //
      // AND `Skill` CANNOT REACH A JOB AT ALL. skillSources.cjs's skillDirs() resolves four
      // patterns and not one of them is ~/.autobot/jobs, so loading a job by name needs its own
      // verb or it has no door.
      //
      // WHY ON THIS SERVER: the same argument that moved the docs and hooks tools here. A job is a
      // system-level definition beside hooks, presence and the context store, and a second MCP for
      // one family would be a second place to look.
      tool(
        "jobsList",
        "The jobs that exist on this machine — each one's name and its aim, one line each. Call it " +
          "to RESOLVE A NAME somebody said: \"do the accounting one\", \"what jobs do I have?\". It is " +
          "a directory, not a menu — a job is given to you by a hook or by the human, never picked " +
          "off this list because it looked relevant. Names and aims only; jobsLoad reads the body.",
        {},
        async () => {
          try {
            const jobs = require("./jobs.cjs");
            const rows = jobs.list();
            // NAMES AND AIMS ONLY. The whole documents here would make this an injection with extra
            // steps — and a job document is loaded WHOLE, when it is given, or not at all.
            if (!rows.length)
              return { content: [{ type: "text", text:
                `No jobs exist yet (${jobs.DIR} holds none). A job is written there with a human by ` +
                `job-authoring, so there is no name to resolve until one is.` }] };
            const body = rows
              .map((j) =>
                `  ${j.id}${j.name && j.name !== j.id ? ` ("${j.name}")` : ""}` +
                `${j.enabled === false ? " · DISABLED" : ""}` +
                `${j.trigger ? ` · on ${j.trigger.on}` : ""}` +
                ` — ${jobAim(j)}`
              )
              .join("\n");
            return { content: [{ type: "text", text:
              `JOBS that exist (${rows.length}) — the name, and the aim that tells you which one is which:\n${body}\n\n` +
              `Load one with jobsLoad ONCE SOMEBODY HAS NAMED IT. A job is given, not chosen.` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "jobsLoad",
        "Load a job's document by name — the whole written agreement: what it is for, what it must " +
          "be given, its procedure, where its output lands, what it must never do, and what to do " +
          "when it is unsure. Call it when a job has been GIVEN to you — a hook pointed at it, or " +
          "the human named it — and read the whole thing before starting; a job document is loaded " +
          "whole on purpose, because a bound that only turned up in a chunk nobody retrieved is a " +
          "bound that does not exist at 3am. Resolve a partial name with jobsList first.",
        {
          name: z
            .string()
            .describe("the job's id as jobsList prints it — a human name resolves too, through the same slug rule the folder uses"),
        },
        async ({ name }) => {
          try {
            const jobs = require("./jobs.cjs");
            const refuse = (text) => ({ content: [{ type: "text", text }], isError: true });
            const want = String(name || "").trim();
            if (!want)
              return refuse(`jobsLoad needs the name of a job. Call jobsList for the names that exist.`);
            // The slug rule is the FOLDER's, read back off dirOf rather than retyped here — a second
            // copy of it would be a second answer to "which directory is this name".
            const id = path.basename(jobs.dirOf(want));
            const rec = jobs.get(id); // null when there is no job.json
            const text = rec ? rec.doc : jobs.doc(id);

            // AN ABSENT JOB IS A REFUSAL THAT SAYS SO, never an empty success. A blank answer here
            // reads as "the job says nothing", and an agent that was GIVEN work would then do
            // nothing and report that it ran.
            if (!String(text || "").trim()) {
              const rows = jobs.list();
              if (rec)
                return refuse(
                  `"${id}" has a job.json but no readable job.md in ${rec.dir}. The document IS the job ` +
                  `and job.json is only a projection of it, so there is nothing to load and nothing ` +
                  `saying what this job must never do. It has to be written before the job can run.`
                );
              const near = nearestJob(id, rows.map((j) => j.id));
              return refuse(
                `No job named "${want}"${id !== want ? ` (which resolves to "${id}")` : ""} under ${jobs.DIR}. ` +
                (near
                  ? `The closest name that exists is "${near}" — call jobsLoad with that if it is the one meant, and ask if you are not sure.`
                  : rows.length
                    ? `${rows.length} job${rows.length === 1 ? "" : "s"} exist — call jobsList for their names.`
                    : `No jobs exist at all yet, so nothing can be loaded by any name.`)
              );
            }

            // Disabled is said BEFORE the document, because it changes whether to proceed at all.
            // Everything else about the job is the document's to say — this verb adds no framing.
            const head = rec && rec.enabled === false
              ? `NOTE: "${id}" is DISABLED — it fires for nobody on its own. Run it only because ` +
                `somebody just asked you to, and say so in the report.\n\n`
              : "";
            return { content: [{ type: "text", text: head + String(text).trim() + "\n" }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      // ---------------------------------------------------------------------------------------
      // THE CHORE BOARD IS A VERB, NOT AN INJECTION (RFC-067 §4, his call 2026-10-05). The first
      // build injected it at session start, which was wrong by the same rule that keeps a job out
      // of the system prompt: it would cost every session whether or not chores were ever
      // considered. An agent calls this when it is time to consider them — `proactive-work` names
      // the step, so nothing has to be loaded for the agent to know the board exists.
      //
      // IT IS A READ. `boardFor` derives each line's state from CLOSED RUN RECORDS and writes
      // nothing, so this is state rather than testimony — and no line can be checked off by
      // announcing it.
      // WRITING ONE. Symmetric with `hooksWrite` and for the same reason: an agent may PROPOSE, and
      // the proposal is inert until a human arms it. A job created here fires for nobody — it has no
      // trigger of its own (RFC-067 §3: one trigger path, the hook's), so something must name it in
      // a `do: job:<id>` AND a human must tick that hook onto an agent before a single step runs.
      //
      // IT EXISTS BECAUSE NOTHING COULD CREATE A JOB AT ALL (2026-10-08). `jobs.save` had exactly
      // three kinds of caller: the test suites, an IPC handler the window never called, and nothing
      // else. So `job-authoring` could write a document and had nowhere to put it but the hand —
      // which is the one move that breaks the guarantee job.json agrees with job.md.
      //
      // THE DOCUMENT IS THE ARGUMENT, and `save()` enforces it: no document, no job. Everything a
      // job demands is read back out of that document's front matter, so there is no `requires`
      // parameter here and there must never be one — a projection that can outlive its document is
      // the inversion the whole design refuses.
      tool(
        "jobsWrite",
        "Write a job to ~/.autobot/jobs/<id>/ — the document IS the job and there is no way to " +
          "create one without it. Pass the whole `doc` every time; it replaces what was there, and " +
          "job.json is derived from it (what the job demands is read from the document's " +
          "`requires:` front matter, never from a parameter here). A job written this way fires for " +
          "NOBODY: it carries no trigger, so a hook must name it with `do: job:<id>` and a human " +
          "must carry that hook before anything runs. Follow `job-authoring` — a document missing " +
          "the job parts is un-assignable or its result un-checkable, and both fail at 3am rather " +
          "than here.",
        {
          id: z.string().describe("the job's id — lowercase, dashes; it is the folder name and the identity"),
          doc: z.string().describe("the WHOLE job document (markdown, with `requires:` front matter when it declares inputs)"),
          name: z.string().optional().describe("a human name; defaults to the id"),
          enabled: z.boolean().optional().describe("false parks it — it stays loadable by name and matches nothing"),
        },
        async ({ id, doc, name, enabled }) => {
          try {
            const jobs = require("./jobs.cjs");
            const before = jobs.get(id);
            const rec = jobs.save({ id, doc, name, enabled });
            const req = (rec.requires || []).join(", ");
            return {
              content: [{ type: "text", text:
                `${before ? "Updated" : "Wrote"} job "${rec.id}" at ${rec.dir}.\n` +
                (req
                  ? `It demands: ${req}. A hook must supply every one of those in its \`with:\` or the job ` +
                    `refuses by name and opens no run.\n`
                  : `It declares no inputs, so it takes its target from the moment that fired it.\n`) +
                `It fires for nobody yet — write a hook whose \`do\` is "job:${rec.id}" and have it ` +
                `carried on an agent's profile.` }],
            };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        }
      ),
      tool(
        "chores",
        "Your chores — the standing list of procedures you are expected to keep current, and " +
          "whether each one is done FOR THIS PERIOD. Call it when it is time to consider chores: " +
          "before taking on self-directed work, or when asked what is outstanding. A line is " +
          "checked off by a RUN of the thing it names closing — nothing is ticked by hand and " +
          "nothing can be marked done by saying so. A line does not stay checked: it comes due " +
          "again next period, which is why this is a read and not a memory.",
        {},
        async () => {
          try {
            const defs = require("./definitions.cjs");
            if (!scopes.slot) return { content: [{ type: "text", text: "This session has no agent slot, so it carries no chores." }] };
            const rows = defs.boardFor(scopes.slot);
            // ABSENT, NOT EMPTY — an agent carrying none is told so plainly rather than shown a
            // heading over a blank list, which reads as an invitation to invent some.
            if (!rows.length) return { content: [{ type: "text", text: "No chores are on your definition. Nothing is expected of you on a schedule." }] };
            // THE DATE IS LOCAL, BECAUSE THE VERDICT IS. Found 2026-10-13 by a subagent working a
            // real board, which is the only way this shows up: `periodStart` is deliberately local
            // ("a day is his day and not UTC's"), while this line formatted `at` with
            // toISOString(). A run that closed 20:38 local on the 12th is 00:38Z on the 13th, so
            // the row read "NOT DONE — last ran 2026-10-13" — overdue today AND ran today, in one
            // sentence. The verdict was right and the row contradicted it, which sends a reader
            // after the tick mechanism instead of the formatter. Any evening run at a negative UTC
            // offset printed this.
            const day = (ms) => {
              const d = new Date(ms);
              const p2 = (n) => String(n).padStart(2, "0");
              return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
            };
            // AND THE PERIOD READS AS ENGLISH. `period.replace(/ly$/, "")` turned "weekly" into
            // "week" and "daily" into "dai" — the same regex, in the window's own period picker,
            // is how he found it there.
            const THIS = { daily: "today", weekly: "this week", monthly: "this month" };
            const line = (r) => {
              // A RESET IS SAID OUT LOUD. Without this an agent that just closed a run and finds
              // the line due again has every reason to suspect the tick mechanism — the one thing
              // that must stay trustworthy here. "Last ran today, reset since" is the honest row.
              const reset = r.resetAt && r.resetAt > (r.at || 0) ? `, reset ${day(r.resetAt)} — due again` : "";
              const when = r.done
                ? `done ${THIS[r.period] || `this ${r.period}`}`
                : r.at
                  ? `NOT DONE — last ran ${day(r.at)}${reset}`
                  : "NOT DONE — no run on record";
              return `  [${r.done ? "x" : " "}] ${r.what}  (${r.period}) — ${when}`;
            };
            const owed = rows.filter((r) => !r.done);
            const out = [
              owed.length
                ? `${owed.length} of ${rows.length} chore${rows.length === 1 ? "" : "s"} NOT DONE this period:`
                : `All ${rows.length} chore${rows.length === 1 ? "" : "s"} current.`,
              "",
              ...rows.map(line),
              "",
              "Read off closed run records, never a stored tick. An unchecked line is worked by running what it names — there is nothing called `chores` to invoke.",
            ];
            return { content: [{ type: "text", text: out.join("\n") }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
    ];
}

function serverFor(identity = {}) {
  return createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: toolsFor(identity) });
}

// ---------------------------------------------------------------------------------------------
// STATISTICS. The store already answers "what exists"; nothing answered "what gets USED", and
// usage is the only signal that says what to delete. Two numbers per note — how often it is
// pulled, and by whom — turn curation from taste into evidence.
//
// The same log serves both directions, which is why there is one and not two: read FORWARD it says
// what is load-bearing; read BACKWARD it says what has gone quiet. `since` is reported because a
// note older than the log has an unknown read history, not a zero, and a surface that forgets that
// will happily recommend deleting the oldest and most-used notes in the store.
function stats(scopes = []) {
  const want = scopes.length ? scopes : ["system"];
  const notes = want.flatMap((sc) => listNotes(sc));
  const readers = {};
  // ONE PASS OVER THE LOG. This re-read and re-parsed the whole usage sidecar once PER NOTE — the
  // log is append-only and only grows, so the cost was notes × reads on a surface whose entire job
  // is to be opened and looked at.
  const usage = readUsage();
  for (const n of notes) {
    const u = usage[n.id];
    n.readers = (u && u.readers) || {};
    for (const [who, count] of Object.entries(n.readers)) readers[who] = (readers[who] || 0) + count;
  }
  const read = notes.filter((n) => n.hits > 0).length;
  return {
    since: usageSince(),
    notes,
    readers,
    totals: {
      notes: notes.length,
      read,
      unread: notes.length - read,
      reads: notes.reduce((a, n) => a + (n.hits || 0), 0),
    },
  };
}

module.exports = { SERVER, TOOL_NAMES, ROOT, serverFor, toolsFor, remember, search, place, listNotes, saveNote, deleteNote, editNote, purgeAgent, stats, readUsage, usageSince, injectedFor, subscribe, unsubscribe, resolveWhat, runCleared, INJECT_TYPES, INJECT_CAPS, INJECT_NOTE_MAX };
