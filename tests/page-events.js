// smoke:page-events — RFC-005 §7.1, the watch half.
//
// WHAT THIS IS REALLY GUARDING: false alarms. A watch exists so something can fire unattended, and
// the expensive failure mode is not "it missed a change" — it is "it announced one that did not
// happen" at 3am, repeatedly, until the human turns the whole mechanism off. So most of the claims
// below are about the cases that must stay QUIET: a node that has not rendered yet, the first read
// after a restart, a value that is the same.
//
// Runs against real files under ~/.autobot/watches.json, so it saves the file it finds and puts it
// back — the only watches this leaves behind are none.
import assert from "node:assert";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const pageEvents = require("../electron/apps/pageEvents.cjs");
const hooks = require("../electron/agents/hooks.cjs");

let pass = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };

// Keep whatever is really on this machine, and restore it whatever happens below.
let saved = null;
try { saved = fs.readFileSync(pageEvents.FILE, "utf8"); } catch {}
const restore = () => {
  try {
    if (saved == null) fs.rmSync(pageEvents.FILE, { force: true });
    else fs.writeFileSync(pageEvents.FILE, saved);
  } catch {}
};

try {
  fs.writeFileSync(pageEvents.FILE, JSON.stringify({ watches: [] }));

  // ---- the vocabulary ------------------------------------------------------------------------
  {
    assert.ok(hooks.isEvent("page.value-changed"), "page.value-changed is hookable");
    assert.ok(hooks.isEvent("page.navigated"), "page.navigated is hookable");
    // NOT page.clicked. A click is an instant and a plain web tab has no preload to report it from,
    // so it cannot be observed by reading — and offering a trigger that never fires is the worst
    // failure this system has.
    assert.ok(!hooks.isEvent("page.clicked"), "page.clicked is NOT offered — it cannot be observed by reading");
    ok("the page vocabulary is exactly what the shell can actually see");
  }

  // ---- the store -----------------------------------------------------------------------------
  {
    const w = pageEvents.save({ label: "total", url: "https://example.com/dash?tab=2#x", selector: "#total", lastValue: "41" });
    assert.equal(w.origin, "https://example.com", "the origin is kept, not the full URL");
    ok("a watch is on an ORIGIN — a query string or a fragment does not break it");

    assert.equal(pageEvents.forUrl("https://example.com/other").length, 1, "same origin, different path");
    assert.equal(pageEvents.forUrl("https://elsewhere.com/dash").length, 0, "different origin");
    ok("watches are found by origin, so the same dashboard reached two ways is one watch");

    pageEvents.save({ ...w, label: "renamed" });
    assert.equal(pageEvents.list().length, 1, "saving an existing id updates rather than appends");
    ok("a watch has an identity — re-saving it does not clone it");

    assert.ok(pageEvents.remove(w.id) && pageEvents.list().length === 0);
    ok("removing a watch removes it");
  }

  // ---- the differ: the three quiet cases -----------------------------------------------------
  {
    const w = { id: "x", lastValue: "41" };
    assert.equal(pageEvents.diff(w, null), null, "a missing node is not a change");
    ok("a node that has not rendered yet is silent — every SPA, for the first second after a nav");

    assert.equal(pageEvents.diff({ id: "x", lastValue: null }, "41"), null, "nothing recorded yet is not a change");
    ok("the first read after a watch is created, or after a restart, is silent");

    assert.equal(pageEvents.diff(w, "41"), null, "the same value is not a change");
    ok("an unchanged value costs nothing and says nothing");

    assert.deepEqual(pageEvents.diff(w, "42"), { from: "41", to: "42" }, "a real move reports both sides");
    ok("a real change carries what it was and what it is — §4: a trigger must be explainable");

    // "" and null are different answers and must stay different.
    assert.deepEqual(pageEvents.diff(w, ""), { from: "41", to: "" }, "emptied is a change");
    ok("a value that became empty IS a change; a value we could not read is not");
  }

  // ---- the locator script is a string we can at least reason about ---------------------------
  {
    const src = pageEvents.locatorScript(10, 20);
    assert.ok(src.includes("elementFromPoint(10, 20)"), "the pointer position is baked in");
    assert.ok(src.includes("CSS.escape"), "ids are escaped before being used as selectors");
    assert.ok(/return null/.test(src), "it returns rather than throws — a rejected probe looks like a vanished value");
    ok("the locator script is total: every path returns, including the failures");

    const rd = pageEvents.readScript(["#a", "#b"]);
    assert.ok(rd.includes('"#a"') && rd.includes('"#b"'), "every selector rides one evaluation");
    ok("one script per tab per tick, not one per watch — the cost is per crossing");
  }

  // ---- the loop, against a fake tab ----------------------------------------------------------
  {
    pageEvents.save({ id: "w1", label: "total", url: "https://example.com/d", selector: "#total", lastValue: "41" });
    const emitted = [];
    let value = "41";
    const tab = {
      id: 7,
      view: { webContents: {
        isDestroyed: () => false,
        isLoading: () => false,
        getURL: () => "https://example.com/d",
        executeJavaScript: async () => ({ "#total": value }),
      } },
    };
    const stop = pageEvents.watchTabs(() => [tab], (e) => emitted.push(e), { tickMs: 10 });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(emitted.length, 0, "an unchanged value ticks silently");
    ok("polling a value that does not move emits nothing, however many ticks run");

    value = "42";
    await new Promise((r) => setTimeout(r, 60));
    stop();
    assert.ok(emitted.length >= 1, "the change was announced");
    const e = emitted[0];
    assert.equal(e.kind, "page.value-changed");
    assert.equal(e.watch, "w1");
    assert.equal(e.from, "41");
    assert.equal(e.to, "42");
    assert.equal(e.url, "https://example.com/d");
    ok("a value that moves emits once, carrying the watch, both sides, and where it happened");

    const after = emitted.length;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(emitted.length, after, "and it does not keep announcing the same change");
    ok("the new value is recorded, so one change is one event — not one per tick forever");
  }

  // ---- a tab that is loading, destroyed, or unwatched is never touched ------------------------
  {
    const calls = [];
    const mk = (over) => ({ id: 1, view: { webContents: {
      isDestroyed: () => false, isLoading: () => false,
      getURL: () => "https://nowhere.com/x",
      executeJavaScript: async () => { calls.push(1); return {}; },
      ...over,
    } } });
    const stop = pageEvents.watchTabs(() => [mk({}), mk({ isLoading: () => true }), mk({ isDestroyed: () => true })],
      () => {}, { tickMs: 10 });
    await new Promise((r) => setTimeout(r, 40));
    stop();
    assert.equal(calls.length, 0, "no script ran in any of them");
    ok("a tab with no watch on its origin is never entered — the poll is narrow, not ambient");
  }

  console.log(`\n${pass} claims held — page events and watches\n`);
} finally {
  restore();
}
process.exit(0);
