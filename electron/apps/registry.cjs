// The local-app registry (RFC-001 lane 1). An entry with `start` is shell-owned:
// opening the app is what launches its process (apps are AVAILABLE, not running —
// Odion's rule), health says when it's up, and the process outlives the shell.
//
// Two layers: BUILT-INS ship with the browser (SystemView comes with it), and
// ADDED apps live in ~/.autobot/apps.json — same entry shape, user-visible and
// user-editable on disk. Installing a local app = installing a package; that file
// is where an install lands. Everything the shell saves lives under ~/.autobot/.
const fs = require("fs");
const path = require("path");
const os = require("os");

const USER_APPS = path.join(os.homedir(), ".autobot", "apps.json");

const BUILTINS = [
  {
    id: "systemview",
    title: "SystemView",
    url: "http://localhost:3000",
    health: "http://localhost:3000/systemview/api",
    icon: "http://localhost:3000/icon.png",
    start: ["/usr/local/bin/systemview", "start", "3000"],
    // available-not-running by default, "unless configured that way" (his t1 reply):
    // autostart: true makes the shell open + launch this app at boot
    autostart: false,
    // SYSTEMVIEW TAKES ITS GRANTS LIKE EVERYONE ELSE (RFC-004 §1). If the native app is exempt
    // the gate is decorative — the first app to need something gets handed the exemption rather
    // than a grant, and the exemption is where the contract quietly dies. This list is what
    // SystemView actually uses today; it is the IDE, so it is broad, and that is a stated
    // position rather than an accident.
    capabilities: [
      "context:read", "context:write",
      "files:read", "files:write",
      "projects", "auth", "agents", "dictation", "terminal", "components",
    ],
  },
];

function userApps() {
  try {
    const list = JSON.parse(fs.readFileSync(USER_APPS, "utf8"));
    return Array.isArray(list) ? list.filter((a) => a?.id && a?.url) : [];
  } catch {
    return [];
  }
}

const APPS = [...BUILTINS, ...userApps().filter((u) => !BUILTINS.some((b) => b.id === u.id))];

// ADDING AN APP is writing a line to ~/.autobot/apps.json — the same file an install would
// land in, so the door in the dock and a future installer are the SAME mechanism rather than
// two. Returns the list so the caller can rebuild without re-reading. `url` is required: an
// app with no address is not an app, and a registry of nameless entries is the "files become
// inefficient" failure he named.
// THE MANIFEST (RFC-004 §2). `title` and `url` are still the only required fields — an app is
// still a name and an address — but the entry now carries what the contract needs: what it may
// do (`capabilities`, §1), what it publishes (`components`, §3), how it starts, and which agent
// it brings. UNKNOWN FIELDS ARE IGNORED, NOT REJECTED: a manifest written against a later version
// of this contract must still register, or every capability we add breaks every installed app.
//
// A MISSING `capabilities` IS NOT AN UNKNOWN FIELD — it is a security decision with a default,
// and the default is NONE (§2.1). Absent = all would preserve the total-grant hole forever and
// nobody would notice, because everything would keep working.
function addApp({ title, url, capabilities, components, start, agent, autostart, icon }) {
  const name = String(title || "").trim();
  const addr = String(url || "").trim();
  if (!name) return { error: "an app needs a name" };
  if (!/^https?:\/\//i.test(addr)) return { error: "an app needs an http(s) address" };
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
  if (BUILTINS.some((b) => b.id === id)) return { error: `"${id}" is a built-in app` };
  const list = userApps();
  const i = list.findIndex((a) => a.id === id);
  const entry = { id, title: name, url: addr, autostart: autostart === true };
  entry.capabilities = Array.isArray(capabilities) ? capabilities.map(String) : [];
  if (Array.isArray(components)) entry.components = components;
  if (start && typeof start === "object") entry.start = start;
  if (agent && typeof agent === "object") entry.agent = agent;
  // AN APP GETS A FACE. Served by the app itself like its components are (§3.3) — resolved
  // against its own url, so the browser never holds a copy that can go stale.
  if (icon) { try { entry.icon = new URL(String(icon), addr).href; } catch {} }
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  try {
    fs.mkdirSync(path.dirname(USER_APPS), { recursive: true });
    fs.writeFileSync(USER_APPS, JSON.stringify(list, null, 2) + "\n");
  } catch (e) {
    return { error: `could not write ${USER_APPS}: ${e.message}` };
  }
  cache = null; checkedAt = 0; // the write just changed the answer — show it now, not in a second
  return { app: entry };
}

// APPS is read at require time, so a freshly added app needs the live list, not the snapshot.
//
// CACHED, because state() calls this and broadcast() fires on EVERY page-title-updated,
// did-navigate, did-start-loading, did-stop-loading and favicon event, for every tab. The
// first cut read and JSON-parsed ~/.autobot/apps.json synchronously on each one — a loading
// page turned the main process into a disk-read loop and took the whole shell with it
// (measured: Electron at 145% CPU, a 70ms build became 17s). My regression, same afternoon.
//
// Invalidated by addApp, and by the file's own mtime so an edit on disk is still picked up
// without a restart — an fs.statSync is cheap where a read+parse was not.
let cache = null;
let cacheStamp = 0;
let checkedAt = 0;
function current() {
  // Even statSync is a syscall, and this runs on every broadcast. Within a second, the
  // cached answer is simply returned — an app added on disk shows up a beat later, which
  // is the right trade for a function on the paint path.
  const now = Date.now();
  if (cache && now - checkedAt < 1000) return cache;
  checkedAt = now;
  let stamp = 0;
  try { stamp = fs.statSync(USER_APPS).mtimeMs; } catch {}
  if (cache && stamp === cacheStamp) return cache;
  cacheStamp = stamp;
  cache = [...BUILTINS, ...userApps().filter((u) => !BUILTINS.some((b) => b.id === u.id))];
  return cache;
}

// THE CROSS-APP COMPONENT REGISTRY — RFC-004 §3.3.
//
// SystemView's markdown registry (src/atoms/Markdown/registry.js) is a CLOSED ALLOWLIST: nothing
// renders that isn't in the map, and that property is the security story, not a convenience. This
// is the second map, and it is closed the same way — a host renders a travelling component only if
// it is listed here and only on a surface the component itself declared.
//
// Three rules, all enforced here rather than trusted from the manifest:
//   NAMESPACED  — a component is always addressed `<appId>:<name>`, so one app can never publish
//                 under another's name, and a name collision between two apps is impossible
//                 rather than last-one-wins.
//   OWN-ORIGIN  — `src` is resolved against the publishing app's own `url`. The app serves its own
//                 components; nothing is copied into the browser, so a component is never a stale
//                 fork of itself. A `src` that tries to leave that origin is dropped.
//   DECLARED    — `surfaces` is the allowlist for WHERE. A component that only makes sense inside
//                 its own app says ["app"] and cannot be summoned over a web page.
const SURFACES = new Set(["markdown", "app", "overlay"]);
const MODES = new Set(["element", "frame"]);
const KINDS = new Set(["inline", "leaf", "container"]);

function components() {
  const out = [];
  for (const app of current()) {
    if (!Array.isArray(app.components) || !app.url) continue;
    let base;
    try { base = new URL(app.url); } catch { continue; }
    for (const c of app.components) {
      const name = String(c?.name || "").trim();
      const mode = String(c?.mode || "").trim();
      if (!name || !MODES.has(mode)) continue;
      // An element needs a tag to mount; a frame needs a page to load. Neither is optional,
      // and a half-declared component is dropped rather than rendered as something else.
      if (mode === "element" && !String(c.tag || "").trim()) continue;
      if (!String(c.src || "").trim()) continue;

      // OWN-ORIGIN, enforced. `src` may refine the app's address but may not leave its origin —
      // the same rule the SSRF guard applies to services (tests/same-origin.js): a value out of a
      // config file does not get to redirect where the browser fetches code from.
      let src;
      try { src = new URL(c.src, base); } catch { continue; }
      if (src.origin !== base.origin) continue;

      const surfaces = (Array.isArray(c.surfaces) ? c.surfaces : []).filter((x) => SURFACES.has(x));
      if (!surfaces.length) continue; // declared nowhere means rendered nowhere

      out.push({
        id: `${app.id}:${name}`,
        appId: app.id,
        // The publishing app's ORIGIN, on the row (systemview-21's ask). A host mounting the frame
        // path needs it to set `sandbox`/`allow`, and re-deriving it from `src` means every host
        // re-implements the same parse — and gets to disagree about the answer.
        origin: base.origin,
        name,
        mode,
        tag: mode === "element" ? String(c.tag).trim() : null,
        src: src.href,
        kind: KINDS.has(String(c.kind)) ? String(c.kind) : "leaf",
        props: c.props && typeof c.props === "object" ? c.props : {},
        surfaces,
      });
    }
  }
  return out;
}

// What a host may render RIGHT HERE. The surface is the caller's question, never the component's
// claim about itself — a page asking "what can I mount" must not be able to widen its own answer.
//
// AND `mode` IS A SCOPE DECLARATION, NOT A RENDERING PREFERENCE. This is the fix for a capability
// escalation systemview-21 and I found before anything was built on it:
//
//   A custom element mounts into the HOST's page and therefore closes over the HOST's
//   `window.systemview`. A component published by an app granted only `files:read`, mounted in
//   SystemView's markdown, would be holding SystemView's `files:write`, `terminal`, `agents` and
//   `context:write`. The gate resolves grants correctly at the preload, and then the act of
//   MOUNTING hands the publisher a strictly larger set. Escalation by rendering.
//
// So: an element may be mounted only when the publishing app IS the hosting app. Same-app is not an
// exception, it is the identity case — the component closes over the bridge of the app that
// published it, which is exactly the grants it already had, so nothing is gained. Anything crossing
// an app boundary must be a frame, where a subframe gets no preload at all
// (`nodeIntegrationInSubFrames` is unset) and the traveller reaches its own app over HTTP as its own
// origin. Safe by construction rather than by a check someone has to remember.
//
// A cross-app element is DROPPED rather than quietly resolved to a frame: an element's `src` is a
// JS module, not a page, so loading it in an iframe would render nothing and look like a bug in the
// component. If a component is meant to travel, it must be published as a frame and say so.
function componentsFor(surface, hostAppId = null) {
  return components().filter((c) => {
    if (!c.surfaces.includes(surface)) return false;
    if (c.mode === "element" && c.appId !== hostAppId) return false;
    return true;
  });
}

module.exports = { APPS, USER_APPS, addApp, current, components, componentsFor };
