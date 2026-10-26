// RFC-073 §3.1 — WRITE.CJS: set this attribute on this line of this file. The third file of the
// markdown capability, beside parse.cjs (read) and blocks.cjs (what the grammar means).
//
// This is the write that puts `verdict=`, `state=`, `sha=`, `told=` and a claim's
// `state= by= at= note=` into a document, and it must not have two implementations. It is ported
// from SystemView's `setDirectiveAttr` (Markdown.js) VERBATIM in behaviour — same null-removes,
// same empty-value-quoting, same no-op answers — and `tests/markdown-write.js` holds both to the
// same fixture answers until the package seam (RFC-053 §4) lets the renderer import this file and
// retire its copy. Until that seam exists there are, honestly, two copies; the test is what keeps
// them one in behaviour.
//
// IT IS ALSO THE AGENT'S DOOR: an agent marks a claim or moves an objective through a verb over
// this function, not by hand-editing the line — one writer, so a mark written by an agent is the
// same write a press makes. The verb enforces what the block cannot (a claim mark from an agent
// without `note=` is refused); this file only writes.
const fs = require("fs");

/**
 * Rewrite one or several attributes inside a directive's `{…}` on a given source LINE (1-based).
 * `pairs` is `{ key: value }` — a null value REMOVES the attribute (un-answering a question has to
 * leave the document looking unanswered), an empty or whitespace-carrying value is QUOTED
 * (`members=""` parses as present-and-empty; `members=` is not a directive at all).
 * Returns the new source, or null when nothing changed.
 */
function setAttr(source, line, pairs) {
  const entries = Object.entries(pairs || {});
  if (!entries.length) return null;
  let next = String(source == null ? "" : source);
  let changed = false;
  for (const [key, value] of entries) {
    const n = setOne(next, line, key, value);
    if (n != null) {
      next = n;
      changed = true;
    }
  }
  return changed ? next : null;
}

// THE BAG IS TOKENIZED, NEVER REGEXED THROUGH. A naive `(^|\s)key=` scan matches inside a QUOTED
// VALUE — measured 2026-10-25: five claims whose `note="…told= is the baseline…"` had the told=
// stamp written INTO THE NOTE'S PROSE, no real attribute landed, and the blocks re-fired forever.
// So the inner bag is split into real pairs (quotes respected) and rebuilt.
function parseBag(inner) {
  const pairs = [];
  const re = /([A-Za-z_][\w-]*)=("[^"]*"|'[^']*'|[^\s}]*)|(\S+)/g;
  let m;
  while ((m = re.exec(inner))) {
    if (m[1]) pairs.push({ key: m[1], val: m[2] });
    else pairs.push({ key: null, val: m[3] }); // a bare word (a class shorthand) — kept verbatim
  }
  return pairs;
}
const bagToString = (pairs) => pairs.map((p) => (p.key ? `${p.key}=${p.val}` : p.val)).join(" ");

// One attribute on one line — the ported body.
function setOne(source, line, key, value) {
  const lines = String(source).split("\n");
  const i = line - 1;
  if (i < 0 || i >= lines.length) return null;
  const row = lines[i];
  // THE ATTR BAG IS THE BRACES AT THE END OF THE LINE — never the first on it. A claim's label may
  // quote a block (`::claim[Write \`::rfc{id=…}\` …]{id=c8}`), and matching the first braces wrote
  // the told= stamp INTO THE EXAMPLE (measured 2026-10-25, RFC-073 c8/c9). A directive's own
  // attributes always close the line.
  const braces = row.match(/\{([^}]*)\}\s*$/);
  if (value == null) {
    if (!braces) return null;
    const pairs = parseBag(braces[1]);
    const kept = pairs.filter((p) => p.key !== key);
    if (kept.length === pairs.length) return null;
    const rebuilt = kept.length ? `{${bagToString(kept)}}` : "";
    const next = row.slice(0, braces.index) + rebuilt + row.slice(braces.index + braces[0].length).replace(/\s+$/, "");
    if (next === row) return null;
    lines[i] = next;
    return lines.join("\n");
  }
  const encoded = value === "" || /[\s"']/.test(String(value)) ? JSON.stringify(String(value)) : String(value);
  let next;
  if (!braces) {
    next = `${row}{${key}=${encoded}}`;
  } else {
    const pairs = parseBag(braces[1]);
    const hit = pairs.find((p) => p.key === key);
    if (hit) hit.val = encoded;
    else pairs.push({ key, val: encoded });
    next = row.slice(0, braces.index) + `{${bagToString(pairs)}}` + row.slice(braces.index + braces[0].length);
  }
  if (next === row) return null;
  lines[i] = next;
  return lines.join("\n");
}

/**
 * The FILE door — read, setAttr, write back. `{ ok, changed }`, and `changed: false` is a real
 * answer (stamping `told=` that is already there must not rewrite the file and fire the watcher).
 * Never throws into a caller's emit: a path that cannot be read answers with an error.
 */
function writeAttr(absPath, line, pairs) {
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    return { ok: false, error: `cannot read ${absPath}` };
  }
  const next = setAttr(text, line, pairs);
  if (next == null) return { ok: true, changed: false };
  try {
    fs.writeFileSync(absPath, next);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  return { ok: true, changed: true };
}

module.exports = { setAttr, writeAttr };
