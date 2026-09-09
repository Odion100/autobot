// The dev runner: vite (hot-reload chrome) + nodemon (relaunch the shell on main-process
// changes), started together and — the part the old `a & b` script got wrong — killed
// together. Also clears stale squatters from a previous run first: an orphaned vite on
// 5173 or a shell holding the CDP port is exactly the "Address already in use" pileup.
import { spawn, execSync } from "child_process";

// THE GUARD `npm start` HAS AND `npm run dev` DID NOT. prestart only runs for
// `start`, so dev went straight to vite and died inside rolldown's native-binding
// loader — a 60-line nested stack about @rolldown/binding-darwin-x64 that names
// npm's optional-dependency bug and never mentions the actual cause.
//
// The cause, measured 2026-08-31: /usr/local/bin/node is v23.6.0 built for x64
// and runs under Rosetta, while node_modules has only binding-darwin-arm64. An
// x64 node asks for an x64 binding that is not installed and should not be. The
// old check tested `major < 22` alone, so a 23-x64 node sailed straight past it.
// ARCH IS THE HALF THAT WAS MISSING — the version was never the problem.
const major = +process.versions.node.split(".")[0];
if (major < 22 || process.arch !== "arm64") {
  const why = process.arch !== "arm64"
    ? `this node is ${process.arch} (${process.execPath}), but the installed native
     modules are arm64 — an x64 node under Rosetta cannot load them`
    : `autobot needs node >= 22, this is ${process.version}`;
  // TWO fixes, because `nvm use` is useless advice in a shell where nvm was never
  // sourced — which is exactly the shell this fires in (his .zshrc defines nvm as
  // a function; a terminal that skips .zshrc has no nvm at all, and PATH falls
  // through to Homebrew's x64 node). The PATH form needs nothing loaded.
  console.error(
    `\n  ✖  wrong node: ${why}\n\n` +
    `     fix:   source ~/.nvm/nvm.sh && nvm use && npm run dev\n` +
    `     or:    export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" && npm run dev\n\n` +
    `     (.nvmrc says 22; the second works even when \`nvm\` is not a command here)\n`
  );
  process.exit(1);
}

const CDP_PORT = process.env.AUTOBOT_CDP_PORT || "9223";
const VITE_PORT = "5173";

const freePort = (port) => {
  try { execSync(`lsof -ti tcp:${port} | xargs kill 2>/dev/null`, { stdio: "ignore" }); } catch {}
};
freePort(VITE_PORT);
freePort(CDP_PORT);

const env = { ...process.env, AUTOBOT_UI_URL: `http://localhost:${VITE_PORT}` };

// --no-watch (or AUTOBOT_NO_WATCH=1): vite still hot-reloads the chrome, but the
// shell is launched ONCE instead of under nodemon. Odion's ask, and the reason is
// real: main-process edits restart the shell, and a restart kills every hosted
// agent session mid-sentence. While someone is working IN the browser, a watcher
// that relaunches on every .cjs save is actively hostile. UI work loses nothing —
// that half is vite's, and vite is still here.
const noWatch = process.argv.includes("--no-watch") || process.env.AUTOBOT_NO_WATCH === "1";

const children = [
  spawn("npx", ["vite", "electron/ui"], { stdio: "inherit", detached: true }),
  noWatch
    ? spawn("node", ["electron/launch.js"], { stdio: "inherit", env, detached: true })
    : spawn("npx", ["nodemon", "--watch", "electron", "--ext", "cjs,html,js", "--ignore", "electron/ui", "--exec", "node electron/launch.js"], { stdio: "inherit", env, detached: true }),
];
if (noWatch) console.log("  ℹ  no-watch: the shell will NOT restart on main-process edits — relaunch by hand when you want them\n");

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
