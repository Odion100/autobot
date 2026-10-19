// A PICTURE OF THE WINDOW — the harness's own capability, because the harness is the only thing
// that holds the window.
//
// WHY IT EXISTS. An agent working on this desktop is blind to it: every claim it makes about what
// the user is looking at is inferred from source and from tests. Measured tonight, on one small
// feature (a status on a board card), that blindness cost three rounds — the field rendered and I
// could not see that it was invisible, the state rendered as prose and I could not see that it read
// as prose, and a button hid itself when its count went to zero and I could not see that it was
// gone. He caught all three by looking. One capture would have caught all three.
//
// HIS RULING, 2026-10-19: *"we build that into Autobot, into our harness… you never know what page
// I'm on."* So it captures the FOCUSED window, whatever is in it — not a surface a tool was told
// about. An agent that chooses what to photograph can only photograph what it already believes.
//
// THE DECISIONS LIVE HERE, PURE. `capturePage()` needs a live window and nothing can stand one up
// in a test; which window, where the file lands, and what gets pruned do not need one, and those
// are the parts that can be wrong silently. They take their world as arguments.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".autobot", "shots");
// How many to keep. A capture is cheap and an agent that can take one will take many; a folder of
// png nobody prunes is a disk leak with a feature on top.
const KEEP = 40;

// WHICH WINDOW. Focused first, because that is the one he is looking at. Then the only one, when
// there is exactly one — a window that is not focused is still the window if it is the only window
// (his shell often has focus in a terminal, not in the browser, and refusing there would make the
// tool useless exactly when it is most wanted). More than one and none focused is genuinely
// ambiguous, so it names them instead of guessing.
function pickWindow(windows = []) {
  const live = (windows || []).filter((w) => w && !w.isDestroyed?.());
  if (!live.length) return { error: "no window is open — there is nothing to photograph" };
  const focused = live.find((w) => w.isFocused?.());
  if (focused) return { win: focused, why: "focused" };
  if (live.length === 1) return { win: live[0], why: "the only window" };
  return {
    error: `${live.length} windows are open and none has focus — click the one you mean, or pass its title`,
    titles: live.map((w) => titleOf(w)),
  };
}

const titleOf = (w) => {
  try {
    return String(w.getTitle?.() || "").trim();
  } catch {
    return "";
  }
};

// Matching by title when he names one: substring, case-insensitive, and AMBIGUITY IS REFUSED rather
// than resolved to the first hit — photographing the wrong window answers a question nobody asked.
function pickByTitle(windows = [], want) {
  const live = (windows || []).filter((w) => w && !w.isDestroyed?.());
  const q = String(want || "").trim().toLowerCase();
  if (!q) return pickWindow(live);
  const hits = live.filter((w) => titleOf(w).toLowerCase().includes(q));
  if (!hits.length)
    return { error: `no open window's title contains "${want}"`, titles: live.map(titleOf) };
  if (hits.length > 1)
    return { error: `"${want}" matches ${hits.length} windows`, titles: hits.map(titleOf) };
  return { win: hits[0], why: `title contains "${want}"` };
}

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

// THE NAME CARRIES THE TIME AND WHAT IT WAS. A folder of `shot-1.png` is a folder nobody can read;
// the stamp sorts, and the label (or the window's title) says what he was looking at. `now` is a
// parameter because a name that cannot be reproduced cannot be claimed.
function shotName({ now, label, title }) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const tail = slug(label) || slug(title) || "window";
  return `${stamp}-${tail}.png`;
}

// WHAT TO DROP, SAID OUT LOUD. Returns the paths to delete, newest kept — the caller reports them,
// because a prune nobody hears about is a deletion nobody can audit, and this folder is the only
// record that a capture ever happened.
function toPrune(files = [], keep = KEEP) {
  const pngs = (files || []).filter((f) => /\.png$/i.test(f)).sort();
  return pngs.length <= keep ? [] : pngs.slice(0, pngs.length - keep);
}

// WHICH SURFACE INSIDE THE WINDOW — and this is the bug the tool's FIRST capture caught, which is
// the best argument for the tool there is. `win.webContents` is the SHELL's own page: the tab strip
// and the address bar. Every page he actually looks at is a WebContentsView added as a child of
// `win.contentView` (main.cjs addTab), so a capture of the window answered with perfect chrome
// around a blank white rectangle — a real png, a real path, and nothing in it. I was one restart
// away from reporting on a board I had never seen.
//
// `layout()` keeps exactly the on-screen tabs visible (`t.view.setVisible(!!pane)`), so the visible
// child with the largest area IS the page he is looking at — and in a split, the bigger pane, which
// is the right default when a tool takes one picture.
function pickView(win) {
  const kids = (win && win.contentView && win.contentView.children) || [];
  const shown = kids
    .filter((v) => v && v.webContents)
    .filter((v) => (typeof v.getVisible === "function" ? v.getVisible() : true))
    .map((v) => {
      let b = { width: 0, height: 0 };
      try { b = v.getBounds?.() || b; } catch {}
      return { v, area: (b.width || 0) * (b.height || 0) };
    })
    .filter((x) => x.area > 0)
    .sort((a, b) => b.area - a.area);
  // No child view is a real answer, not a failure: the landing page and any window that is pure
  // chrome have none, and photographing the window itself is then exactly right.
  if (!shown.length) return { wc: win && win.webContents, surface: "the window itself (no page view is showing)" };
  return { wc: shown[0].v.webContents, surface: "the page" };
}

// ── THE ONE IMPURE PART ───────────────────────────────────────────────────────────────────────
// `capturePage()` resolves a NativeImage of whatever the window is showing. Everything around it is
// decided above; this does the deed and reports honestly when it cannot.
async function capture({ windows, label, title, dir = DIR, now = Date.now() } = {}) {
  const picked = title ? pickByTitle(windows, title) : pickWindow(windows);
  if (picked.error) return picked;
  const win = picked.win;
  const { wc, surface } = pickView(win);
  if (!wc) return { error: "that window has nothing to photograph" };
  let img;
  try {
    img = await wc.capturePage();
  } catch (e) {
    return { error: `the capture failed: ${(e && e.message) || e}` };
  }
  // AN EMPTY IMAGE IS A FAILURE WEARING A SUCCESS. capturePage resolves with an empty NativeImage
  // when the window is hidden or occluded on some platforms, and writing that out would hand back
  // a real path to a 0×0 png — the most expensive kind of wrong answer, because it looks like
  // evidence.
  const size = img && img.getSize ? img.getSize() : { width: 0, height: 0 };
  if (!size.width || !size.height)
    return { error: "the capture came back empty — the window is probably minimised or hidden" };
  const png = img.toPNG();
  if (!png || !png.length) return { error: "the capture produced no png bytes" };

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, shotName({ now, label, title: titleOf(win) }));
  fs.writeFileSync(file, png);

  let pruned = [];
  try {
    pruned = toPrune(fs.readdirSync(dir)).map((f) => path.join(dir, f));
    pruned.forEach((f) => {
      try {
        fs.unlinkSync(f);
      } catch {}
    });
  } catch {}

  return {
    ok: true,
    path: file,
    width: size.width,
    height: size.height,
    bytes: png.length,
    window: titleOf(win),
    why: picked.why,
    surface,
    // WHAT PAGE IT ACTUALLY WAS. The window's title is the shell's; the url is the page's, and a
    // picture whose subject cannot be named is evidence of nothing.
    url: (() => { try { return wc.getURL?.() || ""; } catch { return ""; } })(),
    png,
    ...(pruned.length ? { pruned: pruned.length } : {}),
  };
}

module.exports = { capture, pickWindow, pickByTitle, pickView, shotName, toPrune, slug, DIR, KEEP };
