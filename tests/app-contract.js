// THE APP CONTRACT, AS ASSERTIONS — RFC-004 §1 and §3.3.
//
// Two halves of the contract are testable without a shell, and this is them: the capability map
// (what a grant list turns into) and the component registry (what a manifest's `components` array
// is allowed to become). The third half — whether the preload can identify itself at all, and
// whether a grant survives navigation — needs a live Electron and lives in `npm run smoke:caps`.
//
// WHY BOTH: smoke:caps proves the gate works end to end but is slow and needs the hub up. These
// assertions are the ones that must keep passing on every edit, and they run in a second.
//
// Run: npm run smoke:contract
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const { build } = require(path.join(here, "..", "electron", "apps", "capabilities.cjs"));

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}`); };

// ---- the capability map ---------------------------------------------------------------------
console.log("\nthe capability map — absent, not denied");
const FULL = {
  dictation: { listen: 1 }, terminal: { open: 1 }, projects: { list: 1 }, auth: { status: 1 },
  agent: { open: 1 }, components: { list: 1 },
  context: { notes: 1, save: 1, remove: 1 },
  vectors: { status: 1, search: 1, index: 1, upsert: 1, remove: 1, drop: 1, collections: 1, records: 1, embed: 1 },
  files: { readFile: 1, writeFile: 1, listFiles: 1, search: 1, gitState: 1, changedFiles: 1, getDiff: 1, stageFiles: 1, stageHunk: 1 },
};

t("no capabilities exposes NOTHING (absent = none)", Object.keys(build(FULL, [])).length === 0);

const ro = build(FULL, ["files:read"]);
t("files:read exposes readFile", typeof ro.files?.readFile !== "undefined");
t("files:read leaves writeFile ABSENT, not denied", !("writeFile" in (ro.files || {})));
t("an ungranted namespace is absent entirely, not an empty object", !("agent" in ro) && !("context" in ro));

const rw = build(FULL, ["files:read", "files:write"]);
t("two capabilities merge into one namespace", !!rw.files.readFile && !!rw.files.writeFile);
t("...and the merge loses nothing", Object.keys(rw.files).length === 9);

const cr = build(FULL, ["context:read"]);
t("context:read gives notes", !!cr.context.notes);
t("context:read does NOT give save — the poisoning surface stays shut", !("save" in cr.context));
t("context:read does NOT give vectors.index", !("index" in cr.vectors));

// The bug this guards: a "*" grant followed by a member-list grant on the same namespace used to
// REPLACE the full surface with the shorter list, silently removing granted methods.
const widen = build(FULL, ["agents", "files:read", "files:write"]);
t("a '*' grant is never narrowed by a later member grant", widen.agent === FULL.agent);

t("an unknown capability is ignored, not thrown (forward-compatible manifests)",
  Object.keys(build(FULL, ["files:read", "jobs:v99"])).length === 1);

// ---- the component registry -----------------------------------------------------------------
console.log("\nthe component registry — namespaced, own-origin, declared");
const USER_APPS = path.join(os.homedir(), ".autobot", "apps.json");
const before = (() => { try { return fs.readFileSync(USER_APPS, "utf8"); } catch { return null; } })();

try {
  fs.mkdirSync(path.dirname(USER_APPS), { recursive: true });
  fs.writeFileSync(USER_APPS, JSON.stringify([{
    id: "biz", title: "Biz", url: "http://localhost:3200", capabilities: [],
    components: [
      { name: "sheet", mode: "element", tag: "autobot-sheet", src: "/c/sheet.js", kind: "leaf", surfaces: ["markdown", "app"] },
      { name: "invoice", mode: "frame", src: "/c/invoice", surfaces: ["overlay"] },
      // must be dropped, each for its own reason:
      { name: "evil", mode: "element", tag: "x-evil", src: "http://evil.example/x.js", surfaces: ["markdown"] },
      { name: "nowhere", mode: "element", tag: "x-n", src: "/c/n.js", surfaces: [] },
      { name: "untagged", mode: "element", src: "/c/u.js", surfaces: ["markdown"] },
      { name: "bogus", mode: "wasm", src: "/c/b.js", surfaces: ["markdown"] },
    ],
  }], null, 2));

  // required fresh: registry caches, and this file just changed underneath it
  const regPath = path.join(here, "..", "electron", "apps", "registry.cjs");
  delete require.cache[require.resolve(regPath)];
  const registry = require(regPath);

  const all = registry.components();
  const ids = all.map((c) => c.id).sort();

  t("a published component is NAMESPACED by its app", ids.includes("biz:sheet"));
  t("only the two valid components survive", ids.join() === "biz:invoice,biz:sheet");
  t("an off-origin src is DROPPED (a config value cannot redirect where code is fetched from)", !ids.includes("biz:evil"));
  t("a component declaring no surface renders nowhere", !ids.includes("biz:nowhere"));
  t("an element with no tag has nothing to mount, so it is dropped", !ids.includes("biz:untagged"));
  t("an unknown mode is dropped, not guessed at", !ids.includes("biz:bogus"));

  const sheet = all.find((c) => c.id === "biz:sheet");
  t("src is resolved against the app's OWN url", sheet.src === "http://localhost:3200/c/sheet.js");
  t("kind defaults to leaf when unstated", all.find((c) => c.id === "biz:invoice").kind === "leaf");

  // The host is passed here because `mode` is a scope declaration — see the element rule below.
  t("componentsFor('markdown') returns only what declared markdown",
    registry.componentsFor("markdown", "biz").map((c) => c.id).join() === "biz:sheet");
  t("componentsFor('overlay') returns only what declared overlay",
    registry.componentsFor("overlay", "biz").map((c) => c.id).join() === "biz:invoice");
  t("a surface nobody declared returns empty", registry.componentsFor("app", "biz").length === 1);

  // ---- element = same-app only ----------------------------------------------------------------
  // The escalation this prevents: a custom element mounts into the HOST's page and closes over the
  // HOST's window.systemview. An app granted files:read, mounted in SystemView, would be holding
  // SystemView's files:write. The gate resolves grants correctly and then MOUNTING widens them.
  console.log("\nelement = same-app only — no capability escalation by rendering");
  t("an app CAN mount its own element", registry.componentsFor("markdown", "biz").some((c) => c.id === "biz:sheet"));
  t("another app CANNOT — the cross-app element is dropped", !registry.componentsFor("markdown", "systemview").some((c) => c.id === "biz:sheet"));
  t("...and no host at all cannot either (a web tab, an overlay with no app)",
    !registry.componentsFor("markdown", null).some((c) => c.id === "biz:sheet"));
  t("a FRAME still travels across apps — that is the whole point",
    registry.componentsFor("overlay", "systemview").some((c) => c.id === "biz:invoice"));
  t("a frame travels to a host with no app identity too",
    registry.componentsFor("overlay", null).some((c) => c.id === "biz:invoice"));
  t("components() itself is unfiltered — enforcement is at the ASKING, not the listing",
    registry.components().some((c) => c.id === "biz:sheet"));
  t("every row carries its publisher's origin", registry.components().every((c) => c.origin === "http://localhost:3200"));
} finally {
  // Never leave a test entry in his apps.json, including when an assertion throws.
  try { before === null ? fs.unlinkSync(USER_APPS) : fs.writeFileSync(USER_APPS, before); } catch {}
}

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0, "the app contract regressed");
console.log("✓ app contract passed");
