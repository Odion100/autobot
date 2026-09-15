// Launches shell-owned local apps (RFC-001 lane 1). The traps this encodes, verified
// by systemview-test against SystemView's code: health-check BEFORE spawning (their
// `start` attaches to an occupied port and hangs as a child), stdout FILED not piped
// (an unread pipe blocks the child at ~64KB), and the process OUTLIVES the shell
// (Odion's q2 call) — detached + unref, never killed on quit.
const { spawn } = require("child_process");
const { app } = require("electron");
const path = require("path");
const os = require("os");
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

  // TWO SHAPES OF `start`, and the object one is the contract's (RFC-004 §2).
  //   array   ["/usr/local/bin/systemview", "start", "3000"]   — an absolute binary, no cwd
  //   object  { cwd: "~/Systemly/business", cmd: "npm run app" } — needs a working directory
  //
  // The object form exists because most apps are a repo with a script, and `npm run app` is
  // meaningless without somewhere to run it. Caught by systemview-21 before a cold launch ever
  // happened: `entry.start[0]` on an object is `undefined`, and the failure hides completely
  // while the app is already up, because isUp() returns "adopted" before `start` is read.
  let cmd, args, cwd;
  if (Array.isArray(entry.start)) {
    [cmd, ...args] = entry.start;
  } else if (entry.start && typeof entry.start === "object") {
    // `~` IS SHELL SYNTAX, and there is no shell here — spawn would look for a literal "~"
    // directory. Expand it ourselves rather than reaching for shell:true, which would turn a
    // manifest field into a command line.
    cwd = String(entry.start.cwd || "").replace(/^~(?=$|\/)/, os.homedir());
    [cmd, ...args] = String(entry.start.cmd || "").trim().split(/\s+/);
    if (cwd && !fs.existsSync(cwd)) {
      fs.writeSync(out, `[launcher] ${entry.id}: cwd does not exist: ${cwd}\n`);
      return "failed";
    }
  }
  if (!cmd) {
    fs.writeSync(out, `[launcher] ${entry.id}: unusable "start" — need ["bin",...] or {cwd,cmd}\n`);
    return "failed";
  }

  const child = spawn(cmd, args, {
    stdio: ["ignore", out, out],
    env,
    cwd: cwd || undefined,
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
