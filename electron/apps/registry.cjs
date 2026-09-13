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
    start: ["/usr/local/bin/systemview", "start", "3000"],
    // available-not-running by default, "unless configured that way" (his t1 reply):
    // autostart: true makes the shell open + launch this app at boot
    autostart: false,
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
function addApp({ title, url }) {
  const name = String(title || "").trim();
  const addr = String(url || "").trim();
  if (!name) return { error: "an app needs a name" };
  if (!/^https?:\/\//i.test(addr)) return { error: "an app needs an http(s) address" };
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
  if (BUILTINS.some((b) => b.id === id)) return { error: `"${id}" is a built-in app` };
  const list = userApps();
  const i = list.findIndex((a) => a.id === id);
  const entry = { id, title: name, url: addr, autostart: false };
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

module.exports = { APPS, USER_APPS, addApp, current };
