// RFC-073 §1.1 — THE REGISTRY: an arc, an RFC or a report is an IDENTITY and a POINTER, and the
// document is its body. `~/.autobot/documents.json` holds `{ id, kind, path, project, at }` per
// document and NOTHING ELSE — no title, no count, no copy of any prose. The moment it holds
// something the document also holds there are two answers and a sync problem; this file enforces
// that with a whitelist rather than a convention.
//
// It is a LOOKUP, never an authority. Delete the file and nothing is lost — it rebuilds on the next
// parse of any registered document. Same split hooks already use: `hooks/<name>.md` is the
// definition, `hooks-fired.json` beside it is derived state you can throw away.
//
// READ UNCACHED, EVERY TIME — the rule `hooks.cjs` gives for its own directory: premature caching is
// how an edited file stops taking effect and nobody can work out why. The file is small.
//
// FOLDERS DO NOT EXIST HERE. A document is an RFC because it says `::rfc{id=…}` at the top, wherever
// it lives. The path is a pointer the registry keeps so the body can be found; it is never the
// reason the document is a kind.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parse } = require("./parse.cjs");
const { registrationsOf, refusalsOf, deriveState, deriveArc, arcOfAddress, specsOf } = require("./blocks.cjs");

const FILE = () => process.env.AUTOBOT_DOCUMENTS || path.join(os.homedir(), ".autobot", "documents.json");
const PROJECTS = () => process.env.AUTOBOT_PROJECTS || path.join(os.homedir(), ".autobot", "projects.json");

// The only fields a row may carry. `arc` is the one relation (an RFC's `arc=`), and it is an id, not
// content. Anything else handed to `upsert` is dropped on the floor, loudly, in the returned row.
const FIELDS = ["id", "kind", "path", "project", "arc", "at"];

function read() {
  try {
    const rows = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function write(rows) {
  const file = FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + "\n");
}

function readProjects() {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS(), "utf8")) || {};
  } catch {
    return {};
  }
}

/**
 * WHICH PROJECT A FILE BELONGS TO — the longest project root that contains it. Longest, because a
 * project can live inside another's folder (a lane worktree under `~/Systemly/lanes/<project>/…`)
 * and the shorter prefix would claim everything beneath it. Returns `{ project, rel }` with `rel`
 * relative to that root, or `{ project: "", rel: abs }` when no project contains the file — which is
 * still registered, because a document outside every project is a document, not an error.
 */
function locate(absPath) {
  const abs = path.resolve(absPath);
  let best = { project: "", root: "" };
  for (const [code, dir] of Object.entries(readProjects())) {
    const root = path.resolve(String(dir || ""));
    if (!root) continue;
    const inside = abs === root || abs.startsWith(root + path.sep);
    if (inside && root.length > best.root.length) best = { project: code, root };
  }
  return best.root ? { project: best.project, rel: path.relative(best.root, abs) } : { project: "", rel: abs };
}

/**
 * Add or update one row. THE ID IS THE IDENTITY: a document that moved updates its row's `path`; it
 * is never a second row. Two different documents claiming one id is a collision and the later one
 * wins by path — the number is what everything attaches to, so it cannot be allowed to split.
 * Returns the row as written, with `dropped` naming any field that was refused.
 */
function upsert(row = {}) {
  const dropped = Object.keys(row).filter((k) => !FIELDS.includes(k));
  const clean = {};
  // `undefined` means "not saying"; explicit `null` means "this is GONE". The distinction exists
  // because a merge cannot otherwise express a removal: a field absent from the new registration
  // was kept by the spread below, so an attribute DELETED from a document never left its row.
  // Detaching a plan from an objective was therefore invisible — the file lost its `arc=`, the row
  // kept it, and the arc went on counting that objective as planned forever. The row has to be
  // able to say a relation ended, and only the parse knows that it did.
  const gone = [];
  for (const k of FIELDS) {
    if (row[k] === null) gone.push(k);
    else if (row[k] != null && row[k] !== "") clean[k] = row[k];
  }
  if (!clean.id || !clean.kind || !clean.path) {
    return { ok: false, error: "a registration needs an id, a kind and a path", dropped };
  }
  clean.at = Date.now();
  const rows = read();
  const i = rows.findIndex((r) => r.id === clean.id);
  if (i >= 0) {
    rows[i] = { ...rows[i], ...clean };
    gone.forEach((k) => delete rows[i][k]);
  } else rows.push(clean);
  write(rows);
  return { ok: true, row: i >= 0 ? rows[i] : clean, updated: i >= 0, dropped };
}

/**
 * EVERY ROW THIS FILE OWNS — a document may carry several leaves, so a path is not one row.
 * `byPath` answers the first; teardown needs all of them.
 */
function rowsAtPath(absPath) {
  const { project, rel } = locate(absPath);
  const abs = path.resolve(absPath);
  return read().filter((r) => (r.project === project && r.path === rel) || r.path === abs);
}

/**
 * A FILE THAT IS GONE IS NOT REGISTERED — reap its rows, and say what was reaped.
 *
 * This is the one file event the registry had no answer for. A leaf TORN DOWN was handled (the
 * parse finds no registration and the row is dropped), and a leaf CHANGED was handled, but a
 * document DELETED hit `cannot read` and returned a refusal — which left its rows standing with
 * their lifecycles still running. Measured 2026-10-30: four report rows outlived their files,
 * silently dropped by every reader at read time rather than removed, so nothing retired them and
 * nothing could. A row is a claim that a document exists; when it does not, the claim goes.
 */
function reapMissing(absPath) {
  const rows = rowsAtPath(absPath);
  if (!rows.length) return { ok: true, registered: false, reaped: [] };
  rows.forEach((r) => remove(r.id));
  return { ok: true, registered: false, reaped: rows.map((r) => r.id) };
}

/** Parse a file, and if it carries a registration leaf, register it. The one door the triggers call. */
async function register(absPath, source) {
  const text = source != null ? String(source) : readFile(absPath);
  if (text == null) return reapMissing(absPath);
  const blocks = await parse(text);
  return registerParsed(absPath, registrationsOf(blocks), blocks, text);
}

/** The same registration off a parse somebody else already did — the fire scan's door (one parse).
 * Takes ONE registration or the whole list: a document may carry several leaves now (his design,
 * 2026-10-29 — the spec fixture holding the mock leaf it exercises), and each leaf gets its own
 * row, deriving state by its own kind out of the one file. */
function registerParsed(absPath, reg, blocks, text) {
  // A MALFORMED LEAF IS A FAULT, NOT AN ABSENCE. The parse already computed why it could not be
  // registered; saying nothing made it indistinguishable from a document that claimed nothing, so
  // the author never learned and no row ever appeared. The refusal rides the answer.
  const refused = refusalsOf(blocks);
  const regs = (Array.isArray(reg) ? reg : reg ? [reg] : []).filter(Boolean);
  const { project, rel } = locate(absPath);
  // A DOCUMENT THAT STOPS SAYING WHAT IT IS STOPS BEING IT. The leaf is the identity (RFC-073),
  // and with several leaves the rule is per-row: a leaf REMOVED from the file takes its row with
  // it and leaves the others standing; a file with no leaves left loses every row it had. Removing
  // the leaf is the honest teardown (his mock-document design needs exactly that), and the rows
  // have to follow the fact.
  const abs = path.resolve(absPath);
  const standing = read().filter((r) => (r.project === project && r.path === rel) || r.path === abs);
  const keep = new Set(regs.map((g) => g.id));
  const dropped = standing.filter((r) => !keep.has(r.id));
  dropped.forEach((r) => remove(r.id));
  if (!regs.length) {
    // NOTHING REGISTERED — and `refused` is what separates "this document claims nothing" from
    // "this document tried and got it wrong". Only the second deserves to reach whoever wrote it.
    return dropped.length
      ? { ok: true, registered: false, removed: dropped.map((r) => r.id).join("|"), refused }
      : { ok: true, registered: false, refused };
  }
  let first = null;
  for (const g of regs) {
    // WHAT IT SERVED BEFORE THIS PARSE, read before the row is overwritten — because a DETACH has
    // to move the arc it just left, and after the upsert there is nothing left to say which arc
    // that was.
    const served = String(((get(g.id) || {}).arc) || "").trim();
    // `arc: g.arc || null` — NULL, not undefined, when the leaf no longer carries one. The parse
    // is the only thing that knows a relation was removed, so it has to be able to say so.
    const r = upsert({ id: g.id, kind: g.kind, path: rel, project, arc: g.arc || null });
    if (!r.ok) return r;
    // RFC-073 §1.4 — identity above is written only by registration; this `state` is derived ONLY
    // here, by the parse that just happened, BY THIS ROW'S OWN KIND — the spec row reads the
    // report leaf, the mock RFC row reads the rfc leaf, one file either way.
    const state = deriveState(blocks, g.kind, text);
    // RFC-076 §4.4 slice 4 — `planned` NEEDS THE REGISTRY, folded in here where both the blocks
    // and the rows are in hand.
    if (g.kind === "arc" && state && state.objectives) {
      state.objectives = { ...state.objectives, ...deriveArc(blocks, g.id, read()) };
    }
    // THE SPEC INVENTORY, recorded by the parse that is already in hand — so that nothing
    // downstream has to parse markdown to find out what a document can run. Per FILE, not per
    // leaf: a two-leaf document's rows carry the same list, and a collector walking rows dedupes
    // by path (api/proofs.js) rather than running one document twice.
    const row = setState(g.id, state, specsOf(blocks)) || r.row;
    if (!first) first = { row, updated: r.updated };
    // AND A PLAN'S OWN PARSE MOVES ITS ARC (§4.4 point 3) — both ends of a move, per leaf.
    if (g.kind !== "arc") {
      new Set([String(g.arc || "").trim(), served].filter(Boolean)).forEach(reparseArcOf);
    }
  }
  return { ok: true, registered: true, row: first.row, updated: first.updated, rows: regs.length, refused };
}

/**
 * Re-derive the arc an address belongs to, by re-reading its file.
 *
 * It re-READS rather than trusting anything cached, because `planned` is counted against the arc's
 * own `::objective` blocks and those live only in that file. Silent on every failure: a missing or
 * unreadable arc is not a reason to fail the plan's registration, and a stale `planned` is a
 * smaller wrong than a document that would not register.
 */
function reparseArcOf(address) {
  const arcId = arcOfAddress(address);
  if (!arcId) return;
  const arcRow = get(arcId);
  if (!arcRow || arcRow.kind !== "arc") return;
  const abs = absPathOf(arcRow);
  if (!abs) return;
  const text = readFile(abs);
  if (text == null) return;
  Promise.resolve(parse(text))
    .then((blocks) => {
      const st = deriveState(blocks, "arc", text);
      if (st && st.objectives) st.objectives = { ...st.objectives, ...deriveArc(blocks, arcId, read()) };
      setState(arcId, st);
      return null;
    })
    .catch(() => null);
}

/** Where a row's body is on disk — the project root plus the pointer, or the pointer when absolute. */
function absPathOf(row) {
  const rel = String((row && row.path) || "");
  if (!rel) return "";
  if (path.isAbsolute(rel)) return rel;
  const root = readProjects()[String(row.project || "")];
  return root ? path.join(path.resolve(String(root)), rel) : "";
}

/**
 * Write the DERIVED fields onto a row. The parse is the only caller that should ever hold these.
 *
 * `specs` is the document's runnable-spec inventory (blocks.cjs `specsOf`) and it rides along here
 * rather than in a write of its own, because both come out of the same parse and two writes would
 * mean a row that briefly carries one and not the other.
 *
 * `undefined` specs means "not saying" and leaves whatever stands — `registerParsed` always passes
 * the list (empty included, which is how a document that LOST its last run block stops claiming
 * one), while `reparseArcOf` re-derives only state and must not blank the inventory.
 */
function setState(id, state, specs) {
  const rows = read();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  rows[i] = { ...rows[i], state: state || null };
  if (specs !== undefined) {
    if (Array.isArray(specs) && specs.length) rows[i].specs = specs;
    else delete rows[i].specs;
  }
  write(rows);
  return rows[i];
}

function readFile(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function list({ kind, project, arc } = {}) {
  return read().filter(
    (r) => (!kind || r.kind === kind) && (!project || r.project === project) && (!arc || r.arc === arc),
  );
}

const get = (id) => read().find((r) => r.id === id) || null;

/** The row whose pointer is this file — how a `file.changed` finds out whether it cares. */
function byPath(absPath) {
  const { project, rel } = locate(absPath);
  const abs = path.resolve(absPath);
  return read().find((r) => (r.project === project && r.path === rel) || r.path === abs) || null;
}

function remove(id) {
  const rows = read();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  write(next);
  return true;
}

/**
 * THE DOOR THE TRIGGERS CALL. A file changed — by the watcher, by a tool's schema, by the window's
 * own write — and this decides whether the registry cares. Fire-and-forget on purpose: registration
 * is derived state and must never make a write or an emit fail. Only markdown can carry a leaf, so
 * everything else returns without reading. RFC-073 §3: the write is one cause of a parse.
 */
function noteFile(absPath) {
  const abs = String(absPath || "");
  if (!/\.(md|markdown)$/i.test(abs)) return Promise.resolve({ ok: true, registered: false, skipped: true });
  return register(abs).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
}

module.exports = { FIELDS, read, upsert, register, registerParsed, setState, noteFile, list, get, byPath, rowsAtPath, reapMissing, remove, locate, absPathOf, file: FILE };
