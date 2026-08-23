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

module.exports = { APPS, USER_APPS };
