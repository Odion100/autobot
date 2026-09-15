// PAGE EVENTS AND WATCHES — RFC-005 §7.1. His ask, in his words: *right click on the web page and
// be able to say listen to this event, listen for this change.*
//
// The unlock is that the browser ALREADY SEES this. Navigation, the DOM, the text in a cell — we
// are looking at all of it. So making it a trigger is emitting what we already observe, not
// building a second mechanism beside the one that works. "Watch this table" stops being a feature
// and becomes a hook authored from a right-click.
//
// THE HOST OBSERVES; THE PAGE IS NEVER TRUSTED TO ANNOUNCE. This is the load-bearing decision and
// it came out of his own question — can page events come from an app he registered, rendering
// somewhere else? If a page could emit, an app could forge `page.value-changed` and pull the
// trigger on a `work` hook it was never granted. So there is no emit door in the capability table
// and there will not be one: the shell READS the page and announces what it saw. The page is
// watched, not believed. It is the same rule the component catalogue already uses one layer up —
// nothing renders that is not in a closed map; nothing fires that we did not see ourselves.
//
// WHY POLLING AND NOT LISTENERS. A plain web tab gets no preload — deliberately, it is the whole
// of its sandboxing — so there is no channel for a page to call back on. `executeJavaScript`
// reads, returns, and leaves nothing behind. That buys the trust property above for free, and it
// costs us clicks: a click is an instant, and an instant cannot be read after the fact. Value
// changes and navigation are state, and state is exactly what a poll can see. `page.clicked` is
// therefore NOT in the vocabulary — it needs an injected channel, which is a different decision
// with a different security argument, and claiming it works when it does not is worse than the gap.
//
// AND THE POLL IS NARROW ON PURPOSE. A main process that read one file per browser event once sat
// at 154% CPU and jammed its own IPC. So: only tabs that have a watch, only watches whose origin
// matches the tab, one script per tab per tick reading every selector at once, and an emit only
// when the value actually MOVED.
const fs = require("fs");
const os = require("os");
const path = require("path");

const FILE = path.join(os.homedir(), ".autobot", "watches.json");

// How often a watched tab is read. Slow on purpose: this is "did the number change", not an
// animation loop, and every tick is a script evaluation inside somebody's page.
const TICK_MS = 5000;

// CACHED BY MTIME, the same shape hooks.cjs uses for its index, and for the same reason: this is
// read once per watched tab per tick, forever. `readFileSync` + `JSON.parse` on a timer is how a
// main process ends up at 154% CPU jamming its own IPC — we have paid for that lesson once.
let CACHE = null;
let CACHE_AT = -1;
const stamp = () => { try { return fs.statSync(FILE).mtimeMs; } catch { return 0; } };

const read = () => {
  const st = stamp();
  if (CACHE && st === CACHE_AT) return CACHE;
  try { CACHE = JSON.parse(fs.readFileSync(FILE, "utf8")).watches || []; } catch { CACHE = []; }
  CACHE_AT = st;
  return CACHE;
};

const writeAll = (watches) => {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ watches }, null, 2));
  } catch {}
  CACHE = watches;
  CACHE_AT = stamp();
  return watches;
};

// WHEN EACH WATCH WAS LAST READ. In memory, never on disk: it changes every tick by definition, so
// persisting it is persisting a clock. A surface that wants to say "still being read" gets it from
// here; a restart forgets it, which is honest — nothing has been read since the restart.
const SEEN = new Map();

const list = () =>
  read().map((w) => (SEEN.has(w.id) ? { ...w, lastSeenAt: Math.max(w.lastSeenAt || 0, SEEN.get(w.id)) } : w));

const originOf = (url) => { try { return new URL(String(url)).origin; } catch { return ""; } };

function save(rec = {}) {
  const watches = read();
  const id = String(rec.id || `w${Date.now().toString(36)}`);
  const i = watches.findIndex((w) => w.id === id);
  const next = {
    id,
    label: String(rec.label || rec.selector || id).slice(0, 80),
    url: String(rec.url || ""),
    // ORIGIN, NOT THE FULL URL. A watch is on a place, and a place survives a query string, a
    // fragment, and the same dashboard being reached two ways. Matching the whole URL would make
    // a watch that silently stops working the first time the page adds `?tab=2`.
    origin: rec.origin || originOf(rec.url),
    selector: String(rec.selector || ""),
    lastValue: rec.lastValue == null ? null : String(rec.lastValue),
    // `null` and `""` are different answers and must stay different: null means we have not read it
    // yet, "" means we read it and the node was empty. Collapsing them makes the first read after a
    // restart look like a change.
    lastSeenAt: rec.lastSeenAt || 0,
    createdAt: (i >= 0 && watches[i].createdAt) || Date.now(),
    enabled: rec.enabled === false ? false : true,
  };
  if (i >= 0) watches[i] = next;
  else watches.push(next);
  writeAll(watches);
  return next;
}

function remove(id) {
  const watches = read();
  const next = watches.filter((w) => w.id !== String(id));
  writeAll(next);
  return next.length !== watches.length;
}

const forUrl = (url) => {
  const o = originOf(url);
  return o ? read().filter((w) => w.enabled && w.origin === o && w.selector) : [];
};

// ---------------------------------------------------------------------------------------------
// The scripts. Both are strings evaluated inside the page, and both are written to be TOTAL — any
// throw inside `executeJavaScript` rejects, and a rejected probe would look identical to a value
// that vanished. So every path returns a value, including the failures.
// ---------------------------------------------------------------------------------------------

// A STABLE LOCATOR FOR THE NODE UNDER THE POINTER. An id wins outright. Otherwise a path of
// tag + :nth-of-type up to <body>, which survives siblings changing text but not the page being
// restructured — and that is the honest limit of a selector recorded by pointing at something.
const locatorScript = (x, y) => `(() => {
  try {
    const el = document.elementFromPoint(${Number(x) || 0}, ${Number(y) || 0});
    if (!el) return null;
    const sel = (node) => {
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1)
        return '#' + CSS.escape(node.id);
      const parts = [];
      let n = node;
      while (n && n.nodeType === 1 && n.tagName.toLowerCase() !== 'html') {
        if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) {
          parts.unshift('#' + CSS.escape(n.id));
          break;
        }
        const tag = n.tagName.toLowerCase();
        const sibs = n.parentNode ? Array.from(n.parentNode.children).filter((c) => c.tagName === n.tagName) : [];
        parts.unshift(sibs.length > 1 ? tag + ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')' : tag);
        n = n.parentElement;
      }
      return parts.join(' > ');
    };
    const selector = sel(el);
    const text = (el.textContent || '').trim().slice(0, 300);
    return {
      selector,
      text,
      tag: el.tagName.toLowerCase(),
      // What the human will recognise in a menu six hours from now. Its own text if it has any,
      // otherwise the nearest thing that reads like a name.
      label: (text || el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName.toLowerCase()).slice(0, 60),
      url: location.href,
      title: document.title,
    };
  } catch (e) { return null; }
})()`;

// READ EVERY WATCHED SELECTOR IN ONE EVALUATION. One script per tab per tick, not one per watch:
// the cost of crossing into a page is per call, not per selector.
const readScript = (selectors) => `(() => {
  const out = {};
  for (const s of ${JSON.stringify(selectors)}) {
    try {
      const el = document.querySelector(s);
      // MISSING IS NOT EMPTY. A node that is gone returns null so the differ can tell "the value
      // changed to nothing" from "the page has not rendered it yet" — and stay quiet about the
      // second, which is every single-page app for the first second after a navigation.
      out[s] = el ? (el.textContent || '').trim().slice(0, 300) : null;
    } catch (e) { out[s] = null; }
  }
  return out;
})()`;

// Did this watch move? Returns null for "no", or the change for "yes".
//
// THREE QUIET CASES, and each one is a false alarm we would otherwise fire at 3am:
//   · the node is missing        — the page has not rendered it, or the selector broke. Either way
//                                  it is not evidence that a VALUE changed.
//   · nothing recorded yet       — the first read after a watch is created, or after a restart.
//                                  That is us catching up, not the world moving.
//   · identical text             — the ordinary case, and the one that must cost nothing.
function diff(watch, value) {
  if (value == null) return null;
  const v = String(value);
  if (watch.lastValue == null) return null;
  if (watch.lastValue === v) return null;
  return { from: watch.lastValue, to: v };
}

// ---------------------------------------------------------------------------------------------
// The loop. `getTabs()` hands back live tab records; `emit(event)` is the ambient emitter. Neither
// is imported — this module knows nothing about main.cjs or about sessions, so the shell can be
// rearranged without touching it and the tests can drive it with plain objects.
// ---------------------------------------------------------------------------------------------
function watchTabs(getTabs, emit, { tickMs = TICK_MS } = {}) {
  let stopped = false;

  async function tick() {
    if (stopped) return;
    let tabs = [];
    try { tabs = getTabs() || []; } catch { tabs = []; }
    for (const t of tabs) {
      const wc = t && t.view && t.view.webContents;
      if (!wc || wc.isDestroyed() || wc.isLoading()) continue;
      let url = "";
      try { url = wc.getURL(); } catch { continue; }
      const mine = forUrl(url);
      if (!mine.length) continue;
      let values = {};
      try { values = await wc.executeJavaScript(readScript(mine.map((w) => w.selector)), true); } catch { continue; }
      for (const w of mine) {
        const v = values[w.selector];
        const moved = diff(w, v);
        // A WRITE ONLY WHEN SOMETHING ACTUALLY CHANGED. This used to persist on every tick so that
        // `lastSeenAt` stayed fresh — which meant a full JSON write per watch, every five seconds,
        // forever, for a field nobody was reading. The freshness now lives in memory (SEEN below)
        // and only a real first-read or a real move touches the disk.
        //
        // That is the whole fix for "the app got slow again", and it is the third time this exact
        // shape has cost us: a per-event file write looks free until it is on a timer.
        if (v != null && (w.lastValue == null || moved)) save({ ...w, lastValue: String(v), lastSeenAt: Date.now() });
        else if (v != null) SEEN.set(w.id, Date.now());
        if (!moved) continue;
        emit({
          kind: "page.value-changed",
          watch: w.id,
          label: w.label,
          from: moved.from,
          to: moved.to,
          url,
          selector: w.selector,
          tabId: t.id,
        });
      }
    }
  }

  const timer = setInterval(() => { tick().catch(() => {}); }, tickMs);
  // Never hold the process open for a poll. A watcher that keeps the shell alive after the window
  // closes is a background job nobody asked for.
  if (timer.unref) timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { FILE, TICK_MS, list, save, remove, forUrl, originOf, locatorScript, readScript, diff, watchTabs };
