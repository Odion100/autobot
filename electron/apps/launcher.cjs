// Launches shell-owned local apps (RFC-001 lane 1). The traps this encodes, verified
// by systemview-test against SystemView's code: health-check BEFORE spawning (their
// `start` attaches to an occupied port and hangs as a child), stdout FILED not piped
// (an unread pipe blocks the child at ~64KB), and the process OUTLIVES the shell
// (Odion's q2 call) — detached + unref, never killed on quit.
const { spawn } = require("child_process");
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const isUp = (health) => fetch(health).then((r) => r.ok).catch(() => false);

// -> "adopted" | "launched" | "failed" | "no-start"
async function ensureApp(entry) {
  if (await isUp(entry.health ?? entry.url)) return "adopted";
  if (!entry.start) return "no-start";

  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, `${entry.id}.log`), "a");
  const env = { ...process.env, PATH: `${process.env.PATH || ""}:/usr/local/bin` };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(entry.start[0], entry.start.slice(1), {
    stdio: ["ignore", out, out],
    env,
    detached: true,
  });
  child.unref();

  for (let i = 0; i < 60; i++) {
    if (await isUp(entry.health ?? entry.url)) return "launched";
    await new Promise((r) => setTimeout(r, 500));
  }
  return "failed";
}

module.exports = { ensureApp, isUp };
