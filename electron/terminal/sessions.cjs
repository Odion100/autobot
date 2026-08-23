// The pty substrate (RFC-001 lane 2, shell side) — sessions on the `screen` recipe
// systemview-test proved in their RFC-043: a detached screen owns the real pty, logs
// raw bytes to a file (that file IS the scrollback), and survives anything above it.
// Hard-won details carried over: `-p 0` on every `-X` (a detached session silently
// drops keystrokes without it), `logfile flush 1` (data arrives now, not on a buffer
// boundary), and text goes in as a bracketed PASTE (typing faster than zsh's line
// editor redraws corrupts the command otherwise) while control bytes go through raw.
//
// A session is keyed (projectCode, sessionId) and OUTLIVES any view of it — dispose
// detaches a viewer, kill() is a separate, deliberate act. (Frozen transport contract:
// RFC-001 §A.)
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(os.homedir(), ".autobot", "terminals");
const sessions = new Map(); // key -> session

const keyOf = (projectCode, sessionId) => `${projectCode}:${sessionId}`;
const nameOf = (key) => `autobot-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const screen = (args) =>
  new Promise((resolve, reject) =>
    execFile("screen", args, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  );

const listScreens = () =>
  new Promise((resolve) =>
    // `screen -ls` exits non-zero when no sessions exist — the listing is the answer
    execFile("screen", ["-ls"], (_e, stdout) => resolve(stdout || ""))
  );

async function pidsByName(name) {
  const out = await listScreens();
  return [...out.matchAll(/^\s*(\d+)\.(\S+)\s/gm)].filter((m) => m[2] === name).map((m) => m[1]);
}

const isAlive = async (name) => (await pidsByName(name)).length === 1;

function watchLog(s) {
  // incremental tail: emit only bytes appended since the last read
  const readNew = () => {
    fs.stat(s.logPath, (err, st) => {
      if (err || st.size <= s.offset) return;
      const stream = fs.createReadStream(s.logPath, { start: s.offset, end: st.size - 1 });
      s.offset = st.size;
      let chunk = "";
      stream.on("data", (d) => (chunk += d.toString("utf8")));
      stream.on("end", () => { if (chunk) for (const cb of s.dataSubs) cb(chunk); });
    });
  };
  s.watcher = fs.watch(path.dirname(s.logPath), (_ev, file) => {
    if (file === path.basename(s.logPath)) readNew();
  });
  s.poll = setInterval(readNew, 60); // fs.watch misses appends on some volumes; keep echo latency low
  s.liveness = setInterval(async () => {
    if (await isAlive(s.name)) return;
    stopWatching(s);
    sessions.delete(s.key);
    for (const cb of s.exitSubs) cb({ code: 0, signal: null });
  }, 3000);
}

function stopWatching(s) {
  s.watcher?.close();
  clearInterval(s.poll);
  clearInterval(s.liveness);
}

// command: argv to run INSTEAD of the login shell (lane 3's supervisor uses this)
async function open({ projectCode, sessionId = "main", cwd, command = null }) {
  const key = keyOf(projectCode, sessionId);
  const existing = sessions.get(key);
  if (existing && (await isAlive(existing.name))) return existing;

  fs.mkdirSync(ROOT, { recursive: true });
  const name = nameOf(key);
  const logPath = path.join(ROOT, `${name}.log`);
  const rcPath = path.join(ROOT, `${name}.rc`);

  // A screen session OUTLIVES this process (that's the contract) — so after a shell
  // restart the session may already exist. ADOPT a lone survivor instead of spawning
  // a name-twin: duplicate names make every `screen -S name -X` ambiguous, which
  // presents as "the terminal is broken". More than one twin = unrecoverable
  // ambiguity — quit them all and start clean.
  const survivors = await pidsByName(name);
  if (survivors.length === 1) {
    const s = {
      key, name, logPath,
      offset: fs.existsSync(logPath) ? fs.statSync(logPath).size : 0, // stream only NEW bytes
      dataSubs: new Set(),
      exitSubs: new Set(),
      watcher: null, poll: null, liveness: null,
    };
    sessions.set(key, s);
    watchLog(s);
    return s; // already booted — no readiness wait
  }
  for (const pid of survivors) {
    await new Promise((r) => execFile("screen", ["-S", `${pid}.${name}`, "-X", "quit"], () => r()));
  }

  // `logfile flush 0` = write bytes to the log as they happen — flush 1 (a full
  // second of buffering) was most of the "laggy" feel.
  fs.writeFileSync(rcPath, `logfile ${logPath}\nlogfile flush 0\ndeflog on\nterm xterm-256color\n`);
  fs.writeFileSync(logPath, ""); // fresh scrollback per session generation

  const env = { ...process.env, TERM: "xterm-256color" };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn("screen", ["-c", rcPath, "-dmS", name, ...(command ?? [])], {
      cwd: cwd || os.homedir(),
      env,
      stdio: "ignore",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`screen start exited ${code}`))));
    child.on("error", reject);
  });

  const s = {
    key, name, logPath,
    offset: 0,
    dataSubs: new Set(),
    exitSubs: new Set(),
    watcher: null, poll: null, liveness: null,
  };
  sessions.set(key, s);
  watchLog(s);

  // Wait out the shell's startup burst (nvm/conda banners, zle's first paint) —
  // a write that lands mid-boot loses keystrokes to the redraw. Ready = the log
  // has gone quiet for 600ms, capped at 8s so a silent command isn't a hang.
  await new Promise((resolve) => {
    let last = -1, quiet = 0, waited = 0;
    const t = setInterval(() => {
      const size = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
      quiet = size === last ? quiet + 1 : 0;
      last = size;
      waited += 200;
      if ((quiet >= 3 && size > 0) || waited >= 8000) { clearInterval(t); resolve(); }
    }, 200);
  });
  return s;
}

function get(key) {
  const s = sessions.get(key);
  if (!s) throw new Error(`no session ${key}`);
  return s;
}

// RAW bytes through, verbatim — never strip, trim, wrap, or append (contract rule 1).
// xterm upstream already sends real bracketed-paste markers when the user pastes;
// adding our own here was the exact "helpful normalisation" the rule forbids.
function write(key, data) {
  const s = get(key);
  return screen(["-S", s.name, "-p", "0", "-X", "stuff", data]);
}

function resize(key, cols, rows) {
  const s = get(key);
  return screen(["-S", s.name, "-p", "0", "-X", "width", "-w", String(cols), String(rows)]).catch(() => {});
}

function history(key) {
  const s = get(key);
  return fs.promises.readFile(s.logPath, "utf8").catch(() => "");
}

function subscribe(key, { onData, onExit }) {
  const s = get(key);
  if (onData) s.dataSubs.add(onData);
  if (onExit) s.exitSubs.add(onExit);
  return () => { s.dataSubs.delete(onData); s.exitSubs.delete(onExit); };
}

// clear = ⌘K, and it must FEEL like typing `clear` (Odion's correction: a blank void
// with no prompt is wrong). Truncate the scrollback file, then send ctrl-L — the
// shell's own clear-screen redraw — so a fresh prompt paints immediately and becomes
// the first line of the new scrollback. Running processes untouched.
async function clear(key) {
  const s = get(key);
  fs.truncateSync(s.logPath, 0);
  s.offset = 0;
  await write(key, "\x0c").catch(() => {});
}

// Every live session on the machine, including survivors from previous shell runs —
// his exact fear: a process running with nothing on screen naming it. The listing is
// what makes sessions-outlive-everything a feature instead of a hazard.
async function list() {
  const out = await listScreens();
  return [...out.matchAll(/^\s*(\d+)\.(autobot-\S+)\s/gm)].map(([, pid, name]) => {
    const m = name.match(/^autobot-(.+)_([^_]+)$/);
    const projectCode = m?.[1] ?? name.slice(8);
    const sessionId = m?.[2] ?? "main";
    return { pid, name, projectCode, sessionId, key: `${projectCode}:${sessionId}` };
  });
}

// dispose = a VIEW letting go (handled by unsubscribe). kill = ending the session —
// works on survivors from previous runs too (no in-process record required).
async function kill(key) {
  const s = sessions.get(key);
  const name = s ? s.name : nameOf(key);
  if (s) { stopWatching(s); sessions.delete(key); }
  for (const pid of await pidsByName(name)) {
    await screen(["-S", `${pid}.${name}`, "-X", "quit"]).catch(() => {});
  }
}

const alive = (key) => { const s = sessions.get(key); return s ? isAlive(s.name) : Promise.resolve(false); };

module.exports = { open, write, resize, history, subscribe, clear, kill, list, alive, keyOf };
