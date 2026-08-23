// The dev runner: vite (hot-reload chrome) + nodemon (relaunch the shell on main-process
// changes), started together and — the part the old `a & b` script got wrong — killed
// together. Also clears stale squatters from a previous run first: an orphaned vite on
// 5173 or a shell holding the CDP port is exactly the "Address already in use" pileup.
import { spawn, execSync } from "child_process";

const CDP_PORT = process.env.AUTOBOT_CDP_PORT || "9223";
const VITE_PORT = "5173";

const freePort = (port) => {
  try { execSync(`lsof -ti tcp:${port} | xargs kill 2>/dev/null`, { stdio: "ignore" }); } catch {}
};
freePort(VITE_PORT);
freePort(CDP_PORT);

const env = { ...process.env, AUTOBOT_UI_URL: `http://localhost:${VITE_PORT}` };

const children = [
  spawn("npx", ["vite", "electron/ui"], { stdio: "inherit", detached: true }),
  spawn("npx", ["nodemon", "--watch", "electron", "--ext", "cjs,html,js", "--ignore", "electron/ui", "--exec", "node electron/launch.js"], { stdio: "inherit", env, detached: true }),
];

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { process.kill(-c.pid, "SIGTERM"); } catch {} // negative pid = the whole group
  }
  setTimeout(() => process.exit(0), 300);
};

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, shutdown);
for (const c of children) c.on("exit", () => { if (!shuttingDown) shutdown(); });
