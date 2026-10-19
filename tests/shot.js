// smoke:shot — PHOTOGRAPHING THE WINDOW, as the decisions it is.
//
// WHY THIS FILE EXISTS. `capturePage()` needs a live window and nothing here can stand one up, so
// the capture itself is proved by one press of his. Everything AROUND it can be wrong silently and
// is exactly the sort of wrong that looks like evidence: the wrong window photographed, a path
// handed back for a file that is empty, a prune that eats the shot it just took. Those are claims.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const shot = require("../electron/agents/shot.cjs");
const { pickWindow, pickByTitle, shotName, toPrune, slug, capture } = shot;

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

// A stand-in for Electron's BrowserWindow: only the four methods shot.cjs actually asks for.
const win = (title, { focused = false, dead = false, size = { width: 1440, height: 900 }, bytes = 11, throws = false } = {}) => ({
  isDestroyed: () => dead,
  isFocused: () => focused,
  getTitle: () => title,
  webContents: {
    capturePage: async () => {
      if (throws) throw new Error("render process gone");
      return { getSize: () => size, toPNG: () => Buffer.alloc(bytes, 7) };
    },
  },
});

// ── 1 · WHICH WINDOW ──────────────────────────────────────────────────────────────────────────
{
  const a = win("SystemView — board", { focused: true });
  const b = win("autobot");
  assert.strictEqual(pickWindow([b, a]).win, a, "the focused one is the one he is looking at");
  assert.strictEqual(pickWindow([b]).win, b, "the only window is the window, focus or not");
  ok("the focused window wins, and a lone unfocused window is still the window");
}

{
  // Focus often sits in a terminal rather than the browser; with two candidates that is ambiguous,
  // and a guess here photographs the wrong screen and calls it proof.
  const r = pickWindow([win("SystemView"), win("autobot")]);
  assert.ok(/none has focus/.test(r.error));
  assert.deepStrictEqual(r.titles, ["SystemView", "autobot"]);
  assert.strictEqual(r.win, undefined);
  ok("two windows and no focus is refused BY NAME, never resolved to the first one");
}

{
  assert.match(pickWindow([]).error, /no window is open/);
  assert.match(pickWindow([win("gone", { dead: true })]).error, /no window is open/);
  assert.match(pickWindow().error, /no window is open/);
  ok("no window, or only a destroyed one, says so instead of throwing");
}

// ── 2 · NAMING ONE ────────────────────────────────────────────────────────────────────────────
{
  const sv = win("SystemView — board");
  const ab = win("autobot — home");
  assert.strictEqual(pickByTitle([sv, ab], "systemview").win, sv, "case-insensitive substring");
  assert.match(pickByTitle([sv, ab], "nope").error, /no open window's title contains/);
  assert.match(pickByTitle([sv, ab], "—").error, /matches 2 windows/);
  assert.strictEqual(pickByTitle([sv, ab], "   ").win, undefined, "an empty title falls back to focus, which is ambiguous here");
  ok("a named window matches on substring, and an ambiguous name is refused rather than picked");
}

// ── 3 · THE FILENAME CARRIES THE TIME AND THE SUBJECT ─────────────────────────────────────────
{
  const at = new Date(2026, 9, 19, 7, 5, 3).getTime();
  assert.strictEqual(shotName({ now: at, label: "Board after the chip landed" }), "20261019-070503-board-after-the-chip-landed.png");
  // No label: the window's own title says what he was looking at.
  assert.strictEqual(shotName({ now: at, title: "SystemView — board" }), "20261019-070503-systemview-board.png");
  // Neither: still a name, never an empty one.
  assert.strictEqual(shotName({ now: at }), "20261019-070503-window.png");
  assert.strictEqual(slug("Ωmega?? **status** chip"), "mega-status-chip");
  assert.ok(shotName({ now: at, label: "x".repeat(90) }).length < 70, "a long label is cut, not carried whole");
  ok("the name sorts by time and says what it was — label, else the window's title, else `window`");
}

// ── 4 · THE PRUNE CANNOT EAT THE SHOT IT JUST TOOK ────────────────────────────────────────────
{
  const files = Array.from({ length: 45 }, (_, i) => `2026101${String(i).padStart(2, "0")}-x.png`);
  const dropped = toPrune(files, 40);
  assert.strictEqual(dropped.length, 5);
  assert.deepStrictEqual(dropped, files.slice(0, 5), "the OLDEST go — the name sorts by time, which is why it carries one");
  assert.ok(!dropped.includes(files[files.length - 1]), "never the newest");
  assert.deepStrictEqual(toPrune(files.slice(0, 40), 40), [], "exactly at the limit drops nothing");
  assert.deepStrictEqual(toPrune(["notes.md", "a.png"], 0), ["a.png"], "non-png files are not ours to delete");
  ok("the prune takes the oldest png only, never the newest, and never a file that is not a shot");
}

// ── 5 · AN EMPTY CAPTURE IS A FAILURE, NOT A PATH ─────────────────────────────────────────────
// capturePage resolves with an empty image for a minimised or occluded window on some platforms.
// Writing that out hands back a real path to a 0×0 png — evidence-shaped and worthless.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
  try {
    const empty = await capture({ windows: [win("hidden", { focused: true, size: { width: 0, height: 0 } })], dir });
    assert.match(empty.error, /came back empty/);
    assert.deepStrictEqual(fs.readdirSync(dir), [], "and nothing was written");

    const noBytes = await capture({ windows: [win("odd", { focused: true, bytes: 0 })], dir });
    assert.match(noBytes.error, /no png bytes/);

    const threw = await capture({ windows: [win("dying", { focused: true, throws: true })], dir });
    assert.match(threw.error, /the capture failed: render process gone/);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
    ok("an empty image, zero bytes, or a throwing capture all answer an error and leave no file behind");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── 6 · A GOOD CAPTURE: THE FILE, THE PIXELS, AND WHAT IT CHOSE ───────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
  try {
    const at = new Date(2026, 9, 19, 8, 30, 0).getTime();
    const r = await capture({ windows: [win("SystemView — board", { focused: true })], label: "the chip", dir, now: at });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(path.basename(r.path), "20261019-083000-the-chip.png");
    assert.strictEqual(fs.readFileSync(r.path).length, 11, "the png on disk is the png that was captured");
    assert.strictEqual(r.width, 1440);
    assert.strictEqual(r.window, "SystemView — board");
    assert.strictEqual(r.why, "focused");
    assert.ok(Buffer.isBuffer(r.png), "the bytes come back too — the tool answers with the picture, not a path to it");
    ok("a capture writes the png, and reports its size, its window and why that window");

    // The folder is capped: 44 older shots plus this one leaves exactly the limit.
    for (let i = 0; i < 44; i += 1) fs.writeFileSync(path.join(dir, `20260101-0000${String(i).padStart(2, "0")}-old.png`), "x");
    const again = await capture({ windows: [win("SystemView", { focused: true })], dir, now: at + 1000 });
    assert.strictEqual(again.ok, true);
    assert.ok(again.pruned > 0, "and it SAYS how many it dropped");
    assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".png")).length, 40);
    assert.ok(fs.existsSync(again.path), "the shot just taken survived its own prune");
    ok("the folder stays capped at 40, the prune is reported, and the newest shot survives it");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}


// ── THE PAGE, NOT THE CHROME ──────────────────────────────────────────────────────────────────
// The bug the tool's own first capture caught: `win.webContents` is the SHELL's page (tab strip,
// address bar). Every page he looks at is a WebContentsView child of `win.contentView`, so the
// first shot came back as perfect chrome around a blank white rectangle.
{
  const view = (visible, w, h, id) => ({
    webContents: { id, getURL: () => `http://x/${id}` },
    getVisible: () => visible,
    getBounds: () => ({ width: w, height: h }),
  });
  const winWith = (...kids) => ({ webContents: { id: "chrome" }, contentView: { children: kids } });

  let r = shot.pickView(winWith(view(false, 1200, 800, "hidden"), view(true, 1200, 800, "shown")));
  assert.strictEqual(r.wc.id, "shown", "the visible child is the page he is looking at");
  assert.match(r.surface, /page/);
  ok("photographs the visible tab, never the hidden ones");

  r = shot.pickView(winWith(view(true, 600, 800, "pane-b"), view(true, 900, 800, "pane-a")));
  assert.strictEqual(r.wc.id, "pane-a", "in a split, the bigger pane");
  ok("a split takes the bigger pane — one picture has to choose, and that is the one he is working in");

  r = shot.pickView(winWith());
  assert.strictEqual(r.wc.id, "chrome");
  assert.match(r.surface, /window itself/);
  ok("a window with no page view photographs itself, and SAYS that is what it did");

  // A child with no bounds is not on screen; counting it would hand back a 0×0 capture.
  r = shot.pickView(winWith(view(true, 0, 0, "collapsed")));
  assert.strictEqual(r.wc.id, "chrome");
  ok("a zero-area child is not a page — it falls back rather than photographing nothing");
}

console.log(`\n  ${n} claims, all green — the harness can photograph its own window\n`);
