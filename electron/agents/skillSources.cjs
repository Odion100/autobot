// WHERE SKILLS COME FROM — a LIST, not two paths in a function.
//
// HIS POINT, AND IT LANDS ON US FIRST (2026-10-02): `skillDirs()` returned `~/.claude/skills` and
// `<repo>/.claude/skills`, hardcoded. That is the vendor's layout baked into our code — the same
// mistake one level up from the one we were complaining about. And it made a whole provenance
// INVISIBLE: skills Anthropic ships extract to `/private/tmp/claude-<uid>/bundled-skills/<cli
// version>/<content hash>/<name>`, so the window could not show what its own agents could invoke.
// BUApp reached for a shipped `code-review` nobody knew existed. It was fine; nobody CHOSE it.
//
// So: sources are configuration, every provenance is one entry, and ours is just the entry that
// happens to be writable. That is also what makes a skill set TRANSFERABLE — open the harness with
// nothing, point at a folder (or one you downloaded), and you have its skills. No special case for
// "built in", in either direction.
//
// TWO TRUTHS PER SOURCE, AND THEY ARE NOT THE SAME TRUTH.
//   writable      — can an agent (or he) edit a skill here? A shipped skill is readable and NOT
//                   editable: an edit would work, then evaporate on the next CLI upgrade, which is
//                   worse than a refusal because it teaches that editing works.
//   discoverable  — will a skill here actually FIRE? The Skill tool discovers from the CLI's own
//                   directories. A folder we merely point at is visible and readable TODAY, and its
//                   skills cannot fire until they live where the CLI looks (or RFC-010's local
//                   plugin door lands). A source that is visible-but-inert must SAY so; looking
//                   armed while being inert is the failure this field exists to prevent.
//
// A SOURCE IS A PATTERN, NOT A PATH. The bundled directory is keyed by CLI version and content
// hash, so it moves on every upgrade — a fixed path would quietly contribute zero skills and look
// perfectly healthy. Patterns glob, and a source that resolves to nothing is REPORTED as unresolved
// rather than counted as empty.
const fs = require("fs");
const os = require("os");
const path = require("path");

const FILE = path.join(os.homedir(), ".autobot", "skill-sources.json");

// The defaults describe this machine as it actually is — every location verified to exist (or to be
// a real pattern) on 2026-10-02. They are DEFAULTS: the file wins, and he can add a folder.
const DEFAULTS = [
  {
    name: "ours",
    // Where the CLI looks today, which is why our own skills still live here and fire. RFC-010
    // moves this to ~/.autobot/skills through the SDK's plugin door; until then, relocating them
    // would make them stop firing, so this is honest rather than ideal.
    pattern: path.join(os.homedir(), ".claude", "skills"),
    writable: true,
    discoverable: true,
    // `synced` lives INSIDE this folder, so without excluding it `ours` lists a skill called
    // "synced" and claims every account skill as locally authored.
    exclude: ["synced", "plugins"],
    note: "authored here — yours to edit",
  },
  {
    name: "project",
    pattern: "<cwd>/.claude/skills",
    writable: true,
    discoverable: true,
    note: "this repo's own, for a procedure that cannot apply anywhere else",
  },
  {
    name: "synced",
    pattern: path.join(os.homedir(), ".claude", "skills", "synced", "*"),
    writable: false,
    discoverable: true,
    note: "pulled from the account — an edit here is overwritten by the next sync",
  },
  {
    name: "shipped",
    // the ephemeral one: version + content hash, recreated on upgrade
    pattern: path.join("/private/tmp", "claude-*", "bundled-skills", "*", "*", "*"),
    writable: false,
    discoverable: true,
    note: "ships with the CLI — changes on upgrade, read it rather than edit it",
  },
];

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch {}
  return DEFAULTS;
}

function write(list) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// A tiny glob — only `*` within one path segment, which is every pattern this needs. Written here
// rather than taken as a dependency because the shell's main process is the wrong place to grow a
// package for four lines of matching.
function expand(pattern) {
  if (!pattern.includes("*")) return fs.existsSync(pattern) ? [pattern] : [];
  const parts = pattern.split(path.sep);
  let heads = [parts[0] === "" ? path.sep : parts[0]];
  for (const seg of parts.slice(1)) {
    const next = [];
    for (const head of heads) {
      if (!seg.includes("*")) {
        const p = path.join(head, seg);
        if (fs.existsSync(p)) next.push(p);
        continue;
      }
      const re = new RegExp(`^${seg.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      let names = [];
      try { names = fs.readdirSync(head); } catch { continue; }
      for (const n of names) {
        // a `*` never matches a dotfile — the synced folder keeps a `.bucket-<uuid>` sibling beside
        // the real one, and matching both would list every synced skill twice
        if (n.startsWith(".") && !seg.startsWith(".")) continue;
        if (re.test(n)) next.push(path.join(head, n));
      }
    }
    heads = next;
    if (!heads.length) break;
  }
  return heads;
}

// Every source, resolved against disk. `dirs` is what it actually found; an empty `dirs` with a
// pattern that contains a `*` is UNRESOLVED — stated, never silently counted as "no skills here".
function resolved(cwd) {
  return read().map((s) => {
    const pattern = String(s.pattern || "").replace("<cwd>", cwd || "");
    const dirs = !cwd && String(s.pattern || "").includes("<cwd>") ? [] : expand(pattern);
    return {
      name: s.name,
      pattern,
      writable: s.writable !== false,
      discoverable: s.discoverable !== false,
      exclude: Array.isArray(s.exclude) ? s.exclude : [],
      note: s.note || "",
      dirs,
      // the honest absence: we looked, and the folder this names is not there right now
      unresolved: !dirs.length,
    };
  });
}

const writableNames = () => read().filter((s) => s.writable !== false).map((s) => s.name);

module.exports = { FILE, DEFAULTS, read, write, expand, resolved, writableNames };
