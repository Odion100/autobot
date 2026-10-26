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
const { registrationOf, deriveState } = require("./blocks.cjs");

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
  for (const k of FIELDS) if (row[k] != null && row[k] !== "") clean[k] = row[k];
  if (!clean.id || !clean.kind || !clean.path) {
    return { ok: false, error: "a registration needs an id, a kind and a path", dropped };
  }
  clean.at = Date.now();
  const rows = read();
  const i = rows.findIndex((r) => r.id === clean.id);
  if (i >= 0) rows[i] = { ...rows[i], ...clean };
  else rows.push(clean);
  write(rows);
  return { ok: true, row: i >= 0 ? rows[i] : clean, updated: i >= 0, dropped };
}

/** Parse a file, and if it carries a registration leaf, register it. The one door the triggers call. */
async function register(absPath, source) {
  const text = source != null ? String(source) : readFile(absPath);
  if (text == null) return { ok: false, error: `cannot read ${absPath}` };
  const blocks = await parse(text);
  return registerParsed(absPath, registrationOf(blocks), blocks, text);
}

/** The same registration off a parse somebody else already did — the fire scan's door (one parse). */
function registerParsed(absPath, reg, blocks, text) {
  if (!reg) return { ok: true, registered: false };
  const { project, rel } = locate(absPath);
  const r = upsert({ id: reg.id, kind: reg.kind, path: rel, project, arc: reg.arc });
  if (!r.ok) return r;
  // RFC-073 §1.4 — ONE FILE, TWO KINDS OF FIELD, and the boundary is the field: identity above is
  // written only by registration (upsert's whitelist drops anything else, `state` included); this
  // `state` is derived ONLY here, by the parse that just happened, and says when (`parsed`). It may
  // lag, it may be wiped (`state: null`), and nothing reads it as truth — only as what the last
  // parse saw.
  const row = setState(reg.id, deriveState(blocks, reg.kind, text)) || r.row;
  return { ok: true, registered: true, row, updated: r.updated };
}

/** Where a row's body is on disk — the project root plus the pointer, or the pointer when absolute. */
function absPathOf(row) {
  const rel = String((row && row.path) || "");
  if (!rel) return "";
  if (path.isAbsolute(rel)) return rel;
  const root = readProjects()[String(row.project || "")];
  return root ? path.join(path.resolve(String(root)), rel) : "";
}

/** Write the derived state onto a row. The parse is the only caller that should ever hold one. */
function setState(id, state) {
  const rows = read();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  rows[i] = { ...rows[i], state: state || null };
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

module.exports = { FIELDS, read, upsert, register, registerParsed, setState, noteFile, list, get, byPath, remove, locate, absPathOf, file: FILE };
