// Lane 3 v1 (RFC-001): supervised agent sessions. A hosted agent is a claude session
// in the same pty substrate as the terminal, one per project, cwd = project root.
// The supervision IS the feature: a dead session restarts with backoff, which deletes
// the re-arm ceremony and the gone-deaf failure class — and because claude sessions
// resume per directory, the SAME agent comes back with its context (sticky, his call).
//
// Activation is config, not code: ~/.autobot/hosted.json
//   [{ "projectCode": "autobot", "cwd": "/Users/odionedwards/autobot", "command": ["claude", "--continue"] }]
// No file, no hosted sessions — which projects get one is still Odion's open q3.
const fs = require("fs");
const path = require("path");
const os = require("os");
const sessions = require("../terminal/sessions.cjs");

const CONFIG = path.join(os.homedir(), ".autobot", "hosted.json");
const state = new Map(); // projectCode -> { entry, restarts, stopped }

async function start(entry) {
  const st = state.get(entry.projectCode) ?? { entry, restarts: 0, stopped: false };
  state.set(entry.projectCode, st);
  if (st.stopped) return;

  const s = await sessions.open({
    projectCode: entry.projectCode,
    sessionId: "agent",
    cwd: entry.cwd,
    command: entry.command ?? ["claude"],
  });

  sessions.subscribe(s.key, {
    onExit: () => {
      if (st.stopped) return;
      st.restarts += 1;
      if (st.restarts > 5) return; // runaway guard; resets on shell restart
      const backoff = Math.min(60_000, 2 ** st.restarts * 1000);
      setTimeout(() => start(entry).catch(() => {}), backoff);
    },
  });
  return s;
}

function boot() {
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return; }
  for (const entry of entries) start(entry).catch(() => {});
}

function stop(projectCode) {
  const st = state.get(projectCode);
  if (st) st.stopped = true;
  return sessions.kill(sessions.keyOf(projectCode, "agent"));
}

module.exports = { boot, start, stop };
