// The codebase surface the host serves to SystemView — RFC-047's line drawn in code:
// a project is a folder + a code, and these are the fileProviders-shaped methods
// (same names the plugin exposes) bound to that folder. Pure node here — the IPC
// wiring lives in files-host.cjs so this half is testable without electron.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const IGNORE = new Set([".git", "node_modules", ".DS_Store", "dist", "build", "vectorStore"]);

// Every path from the renderer is treated as hostile until proven inside the root.
function within(root, rel) {
  const abs = path.resolve(root, rel || ".");
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path escapes project root: ${rel}`);
  return abs;
}

const git = (root, args) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout);
    });
  });

async function readFile(root, rel) {
  return fs.promises.readFile(within(root, rel), "utf8");
}

async function writeFile(root, rel, content) {
  const abs = within(root, rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, content);
  return true;
}

async function listFiles(root, rel = ".") {
  const base = within(root, rel);
  const out = [];
  const walk = async (dir) => {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else out.push(path.relative(root, abs));
    }
  };
  await walk(base);
  return out;
}

async function search(root, pattern, { limit = 200 } = {}) {
  // git grep respects the repo's own ignore rules and is fast; fall back to nothing
  // rather than scanning node_modules by hand.
  try {
    const stdout = await git(root, ["grep", "-n", "-I", "--max-count", "50", "-e", pattern, "--", "."]);
    return stdout.split("\n").filter(Boolean).slice(0, limit).map((line) => {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      return m ? { path: m[1], line: +m[2], text: m[3] } : null;
    }).filter(Boolean);
  } catch (e) {
    if (/exit code 1|^$/.test(e.message) || e.message === "") return []; // no matches
    throw e;
  }
}

// Git porcelain was CUT 2026-08-24 (the plugin was to serve it) and RESTORED the
// same day: the plugin stopped asking, nothing answered, and every project read
// as clean. It lives here now. Reads only — COMMITTING is never ours: the message
// is offered as a ::commit block in the conversation and he presses it.

// git: read + staging. Two rules — never an empty list for a failure (every verb
// can return { ok:false, error }, so a caller can tell a clean tree from a git
// that didn't run), and one runner underneath, so a generic passthrough is a
// one-line addition rather than a rewrite.
const runGit = (root, args) =>
  new Promise((resolve) => {
    execFile("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve(err
        ? { ok: false, error: (stderr || "").trim() || err.message, code: err.code ?? 1, stdout: stdout || "" }
        : { ok: true, stdout: stdout || "", stderr: (stderr || "").trim(), code: 0 });
    });
  });

async function gitState(root) {
  const branch = await runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ok) return { ok: false, repo: false, error: branch.error };
  const state = { ok: true, repo: true, branch: branch.stdout.trim(), upstream: "", ahead: 0, behind: 0 };
  const up = await runGit(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  if (up.ok) {
    state.upstream = up.stdout.trim();
    const counts = await runGit(root, ["rev-list", "--left-right", "--count", `${state.upstream}...HEAD`]);
    if (counts.ok) {
      const [b, a] = counts.stdout.trim().split(/\s+/);
      state.behind = +b || 0; state.ahead = +a || 0;
    }
  } // no upstream is normal, not an error
  return state;
}

async function changedFiles(root) {
  const r = await runGit(root, ["status", "--porcelain", "--untracked-files=all", "--"]);
  if (!r.ok) return { ok: false, error: r.error, files: [] };
  const files = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    const x = line[0], y = line[1];
    let rel = line.slice(3).trim();
    const arrow = rel.indexOf(" -> ");           // "R  old -> new": the new name is on disk
    if (arrow !== -1) rel = rel.slice(arrow + 4).trim();
    rel = rel.replace(/^"|"$/g, "");
    // git already honours .gitignore; only .git and node_modules stay out
    if (!rel || rel.split("/").some((seg) => seg === ".git" || seg === "node_modules")) continue;
    const untracked = x === "?" || y === "?";
    const staged = !untracked && x !== " " && x !== "";
    const dirty = !untracked && y !== " " && y !== "";
    const code = staged ? x : y;
    files.push({
      path: rel, x, y, staged, partial: staged && dirty,
      status: untracked ? "untracked"
        : code === "D" ? "deleted" : code === "A" ? "added"
        : code === "R" ? "renamed" : "modified",
    });
  }
  return { ok: true, files };
}

async function getDiff(root, relPath, { staged = false } = {}) {
  if (!relPath) return { ok: false, error: "getDiff: relPath is required" };
  within(root, relPath); // hostile until proven inside
  const args = ["diff", "--no-color"];
  if (staged) args.push("--cached");
  args.push("--", relPath);
  const r = await runGit(root, args);
  if (!r.ok) return { ok: false, error: r.error };
  // untracked has no diff against HEAD — show it as an addition, not an empty panel
  if (!r.stdout.trim() && !staged) {
    const un = await runGit(root, ["diff", "--no-color", "--no-index", "/dev/null", relPath]);
    if (un.stdout) return { ok: true, diff: un.stdout, untracked: true };
  }
  return { ok: true, diff: r.stdout };
}

async function stageFiles(root, paths, unstage = false) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return { ok: false, error: "stageFiles: no paths given" };
  for (const rel of list) within(root, rel);
  const r = unstage
    ? await runGit(root, ["restore", "--staged", "--", ...list])
    : await runGit(root, ["add", "--", ...list]);
  return r.ok ? { ok: true, changed: list.length } : { ok: false, error: r.error };
}

// Apply one hunk to the index (--reverse peels it back out). The hunk must be a
// complete patch for relPath; git validates it and its complaint passes through.
async function stageHunk(root, relPath, hunk, unstage = false) {
  if (!relPath || !hunk) return { ok: false, error: "stageHunk: relPath and hunk are required" };
  within(root, relPath);
  const args = ["apply", "--cached", "--unidiff-zero"];
  if (unstage) args.push("--reverse");
  const patch = hunk.endsWith("\n") ? hunk : hunk + "\n";
  return await new Promise((resolve) => {
    const child = execFile("git", args, { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      resolve(err ? { ok: false, error: (stderr || "").trim() || err.message } : { ok: true });
    });
    child.stdin.end(patch);
  });
}

module.exports = {
  readFile, writeFile, listFiles, search, within,
  gitState, changedFiles, getDiff, stageFiles, stageHunk,
};
