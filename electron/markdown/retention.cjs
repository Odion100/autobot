// RFC-076 §4.6 — THE ONE CLOCK-WRITTEN STATE. A report may declare `retain=<window>`, the hub
// stamps the reader's FIRST OPEN into its own ledger (~/.autobot/documents-opened.json — the
// hub's file, read here and never written: the fact is about the reader's attention, and this
// side only asks), and when openedAt + retain elapses the sweep writes
// `retired=<date> retiredAs=expired` INTO THE LEAF — the file stays the single state (RFC-073),
// the write re-fires the parse, and the row follows. Reversible like every report ending: the
// un-retire press clears it, and divert restarts the ledger clock.
//
// `permanent` and an undeclared/unparseable window both mean NO CLOCK — expiry is never guessed.
const fs = require("fs");
const os = require("os");
const path = require("path");

const OPENED = () =>
  process.env.AUTOBOT_DOCUMENTS_OPENED || path.join(os.homedir(), ".autobot", "documents-opened.json");

function openedMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(OPENED(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

const UNIT = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
function parseRetain(retain) {
  const r = String(retain || "").trim().toLowerCase();
  if (!r || r === "permanent") return null;
  const m = r.match(/^(\d+(?:\.\d+)?)([smhdw])$/);
  return m ? Number(m[1]) * UNIT[m[2]] : null;
}

/**
 * Walk report rows; write the expiry into each leaf whose declared window has run out since the
 * reader's first open. Returns the ids it retired. The leaf edit is surgical — the first
 * `::report{…}` whose attrs carry the row's id — so an example leaf later in a document is never
 * the one that gets stamped.
 */
function retireExpired(rows, { now = Date.now(), absPathOf, opened = openedMap() } = {}) {
  const out = [];
  for (const row of rows || []) {
    if (!row || row.kind !== "report") continue;
    const st = row.state || {};
    if (st.retired) continue;
    const win = parseRetain(st.retain);
    if (!win) continue; // permanent or undeclared — no clock, never guessed
    const at = opened[row.id];
    if (!at || at + win > now) continue; // unread never retires; unexpired waits
    const abs = absPathOf ? absPathOf(row) : null;
    if (!abs) continue;
    try {
      const text = fs.readFileSync(abs, "utf8");
      const day = new Date(now).toISOString().slice(0, 10);
      let hit = false;
      const next = text.replace(/::report\{([^}]*)\}/, (whole, attrs) => {
        if (!String(attrs).includes(String(row.id)) || /retired=/.test(attrs)) return whole;
        hit = true;
        return `::report{${attrs} retired=${day} retiredAs=expired}`;
      });
      if (hit && next !== text) {
        fs.writeFileSync(abs, next);
        out.push(row.id);
      }
    } catch {}
  }
  return out;
}

module.exports = { retireExpired, parseRetain, openedMap, openedFile: OPENED };
