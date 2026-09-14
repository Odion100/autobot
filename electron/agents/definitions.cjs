// AGENT DEFINITIONS — RFC-003. An agent is a configured session: what it is for,
// what it may touch, where it runs, and how it is gated. One definition, many
// runs (a run is a conversation; the run store is sessions.cjs's).
//
// THE SCHEMA IS NOT OURS AND THAT IS THE POINT. The Agent SDK already exports
// `AgentDefinition` — { description, prompt, tools, disallowedTools, skills,
// mcpServers, model, maxTurns, background, memory, effort }. Four of Odion's five
// nouns are existing fields, so we ADOPT it and pass it through instead of
// maintaining a parallel shape that has to be translated at the SDK boundary
// forever. What the SDK type does NOT carry is exactly our half:
//
//   placement  { projectCode, cwd }   — "different places where they run"
//   gating     { permissionMode }     — whether a permission surface exists at all
//
// Both are already arguments to sessions.open(), so an agent is:
//     AgentDefinition + placement + gating
//
// It also settles his open question ("skills or tools or something"): the SDK
// treats tools, skills and mcpServers as THREE axes, not one merged list — so the
// surface shows three lists, decided for us by the type rather than by taste.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DIR = path.join(os.homedir(), ".autobot", "agents");

// Deliberately NOT ~/.autobot/agents.json — that file holds RUNS and was renamed
// to sessions.json in the same change. A directory of definitions beside a file
// of runs is legible; two files one word apart is a bug waiting for a tired hour.
function ensureDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
}

const idOf = (name) =>
  String(name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "agent";

const fileOf = (id) => path.join(DIR, `${id}.json`);

// Every field is optional except the name — a definition you can't save until it
// is complete is a form, and he asked for something you can shape by using it.
// The SDK half is kept in `def` verbatim so it can be spread into query options
// with no mapping step; ours sits beside it, never mixed in.
function normalize(input = {}) {
  const name = String(input.name || "").trim();
  const def = {};
  if (input.description != null) def.description = String(input.description);
  if (input.prompt != null) def.prompt = String(input.prompt);
  if (Array.isArray(input.tools)) def.tools = input.tools.map(String);
  if (Array.isArray(input.disallowedTools)) def.disallowedTools = input.disallowedTools.map(String);
  if (Array.isArray(input.skills)) def.skills = input.skills.map(String);
  // WHICH HOOKS THIS AGENT CARRIES. A hook exists for everyone the moment it is written; this is
  // the agent's opt-in, exactly like `skills` above it — and it has to be listed HERE or it does
  // not exist, because this whitelist IS the definition. Its absence is what made the profile's
  // enable switch a lie: the UI wrote `hooks`, save() reported success, and normalize() dropped
  // it, so every hook came back disabled after a re-init with nothing to explain why.
  if (Array.isArray(input.hooks)) def.hooks = input.hooks.map(String);
  if (Array.isArray(input.mcpServers)) def.mcpServers = input.mcpServers;
  if (input.model) def.model = String(input.model);
  if (input.maxTurns != null) def.maxTurns = Number(input.maxTurns) || undefined;
  if (input.background != null) def.background = !!input.background;
  if (input.memory) def.memory = input.memory;
  if (input.effort) def.effort = input.effort;
  return {
    id: input.id || idOf(name),
    name: name || input.id || "agent",
    def,
    // placement is a DEFAULT, not a pin (RFC-003 q1, my lean and his to overrule):
    // a reviewer you can point at any repo is worth more than one welded to it.
    // open() may override; if it doesn't, this is where the agent runs.
    projectCode: input.projectCode || null,
    cwd: input.cwd || null,
    // gating rides the definition so "this agent always asks" is expressible —
    // which is most of the reason to define an agent at all. Absent = the
    // shell's default at open, not a silent "bypass".
    permissionMode: input.permissionMode || null,
    createdAt: input.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function list() {
  ensureDir();
  let names = [];
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const n of names) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8"))); } catch {}
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function get(id) {
  try { return JSON.parse(fs.readFileSync(fileOf(id), "utf8")); } catch { return null; }
}

function save(input) {
  ensureDir();
  const prev = input.id ? get(input.id) : null;
  // BOTH SHAPES, ALWAYS (autobot-e1's find, measured): normalize() reads TOP-LEVEL SDK fields,
  // but a STORED record nests them under `def` — so `{...prev}` alone never surfaced them and
  // any save that didn't hand back a flattened record silently WIPED description/prompt/tools/
  // skills (a rename in the UI emptied the agent, no error, still ran). Spread the nested def
  // halves up after their records, input last so an explicit edit still wins.
  const rec = normalize({ ...(prev || {}), ...(prev?.def || {}), ...input, ...(input.def || {}), createdAt: prev?.createdAt });
  fs.writeFileSync(fileOf(rec.id), JSON.stringify(rec, null, 2));
  return rec;
}

// Removing a definition never touches the runs it started — those are
// conversations, and a conversation outliving the config that opened it is the
// same rule as a session outliving its view.
// DELETE MEANS GONE — his rule: the confirmation IS the safety, so a confirmed delete wipes the
// agent, not just its definition file. Def + the agent's context (vector collection AND the
// markdown notes behind it). Sessions are purged by the caller (host.cjs) because requiring
// sessions.cjs here would be circular. Nothing is kept "in case it's useful" — keeping is the
// thing he rejected.
function remove(id) {
  let ok = false;
  try { fs.unlinkSync(fileOf(id)); ok = true; } catch {}
  // the agent's learned memory: context.cjs is the ONE writer of ctx-agent-* (the writer map),
  // so the wipe is ITS function and this module only calls it — never touches the scope itself.
  try { require("./context.cjs").purgeAgent(id); } catch {}
  return ok;
}

// THE DOCS FEEDING AN AGENT — RFC-055, "one window." What actually loads into a session at this
// agent's placement is more than the def prompt: Claude Code reads the CLAUDE.md stack for the
// cwd too. Those files were invisible from the profile — you had to know they exist. This lists
// every doc in the stack WITH its content so the surface can show them as chips that open and
// edit in place. Only files that exist are listed (an absent file is not part of the stack).
function docPaths(rec) {
  const map = {};
  if (rec.cwd) {
    map["claude-md"] = { label: "CLAUDE.md", path: path.join(rec.cwd, "CLAUDE.md") };
    map["claude-local-md"] = { label: "CLAUDE.local.md", path: path.join(rec.cwd, "CLAUDE.local.md") };
  }
  map["global-claude-md"] = { label: "~/.claude/CLAUDE.md", path: path.join(os.homedir(), ".claude", "CLAUDE.md") };
  return map;
}

// PAGE-LEVEL DOCS — scoped to NO single agent, so they live by the agent list, not inside one
// agent's doc stack (his catch: a thing that applies to everybody must not wear one agent's
// clothes). Two SIDES:
//   agent — context that LOADS INTO every agent (the system context, injected beside presence)
//   human — help for whoever DESIGNS agents (the defining-agents walkthrough), read by us, never
//           sent to an agent
// A file each; add or drop one without touching code beyond this map.
const PAGE_DOCS = {
  presence: { label: "Presence", side: "agent", path: path.join(os.homedir(), ".autobot", "presence.md") },
  "system-context": { label: "System context", side: "agent", path: path.join(os.homedir(), ".autobot", "system-context.md") },
  "defining-agents": { label: "Defining agents", side: "human", path: path.join(os.homedir(), ".autobot", "defining-agents.md") },
};
// `help` is the historical channel name; it now carries every page-level doc, tagged by side so
// the surface renders the agent-side and human-side chips distinctly.
function help() {
  return Object.entries(PAGE_DOCS).map(([key, s]) => {
    let text = "";
    try { text = fs.readFileSync(s.path, "utf8"); } catch {}
    return { key, label: s.label, side: s.side, where: s.path, text };
  });
}
function saveHelp(key, text) {
  const s = PAGE_DOCS[key];
  if (!s) return { ok: false, error: `unknown page doc: ${key}` };
  try { fs.writeFileSync(s.path, String(text)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function docs(id) {
  const rec = get(id);
  if (!rec) return [];
  // ONLY THIS AGENT'S OWN DOCS here — the shared system context is NOT one of them (it applies to
  // everybody, so it lives page-level, not inside one agent's stack). The def prompt leads: it is
  // a doc like the others, stored in the definition rather than on disk.
  const out = [
    { key: "prompt", label: "agent doc", where: "agent definition", text: (rec.def && rec.def.prompt) || "" },
  ];
  const paths = docPaths(rec);
  for (const key of Object.keys(paths)) {
    try {
      out.push({ key, label: paths[key].label, where: paths[key].path, text: fs.readFileSync(paths[key].path, "utf8") });
    } catch {}
  }
  return out;
}

// Writes go only to keys docPaths knows — the renderer names a doc, never a path.
function saveDoc(id, key, text) {
  const rec = get(id);
  if (!rec) return { ok: false, error: "unknown agent" };
  if (key === "prompt") {
    // save() takes the FLATTENED shape (normalize reads top-level SDK fields), so hand every def
    // field back or a prompt edit would silently drop tools/skills/description.
    save({ id: rec.id, name: rec.name, ...(rec.def || {}), prompt: String(text), projectCode: rec.projectCode, cwd: rec.cwd, permissionMode: rec.permissionMode });
    return { ok: true };
  }
  const target = docPaths(rec)[key];
  if (!target) return { ok: false, error: `unknown doc: ${key}` };
  try {
    fs.writeFileSync(target.path, String(text));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// SKILLS ARE DOCUMENTS TOO (his point: a skill is a doc that loads ON DEMAND — the only thing
// separating it from CLAUDE.md is when it loads). They are SHARED files — user-level or the
// project's .claude/skills — not per-agent state; an agent only chooses to carry them. Listed
// with content so the profile can open and edit them like any other doc.
function skillDirs(rec) {
  const dirs = [{ where: "user", dir: path.join(os.homedir(), ".claude", "skills") }];
  if (rec && rec.cwd) dirs.push({ where: "project", dir: path.join(rec.cwd, ".claude", "skills") });
  return dirs;
}

function skills(id) {
  const rec = get(id);
  const out = [];
  for (const { where, dir } of skillDirs(rec)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      // the standard shape is <name>/SKILL.md; a flat <name>.md counts too
      const p = n.endsWith(".md") ? path.join(dir, n) : path.join(dir, n, "SKILL.md");
      try {
        const text = fs.readFileSync(p, "utf8");
        const desc = (text.match(/^description:\s*(.+)$/m) || [])[1] || "";
        out.push({ name: n.replace(/\.md$/, ""), where, path: p, description: desc.slice(0, 300), text });
      } catch {}
    }
  }
  return out;
}

// Writes go only to a skill the scan already knows — the renderer names a skill, never a path,
// and editing is not creating (a typo must not mint a file).
function saveSkill(id, name, where, text) {
  const target = skills(id).find((s) => s.name === name && s.where === where);
  if (!target) return { ok: false, error: `unknown skill: ${name} (${where})` };
  try {
    fs.writeFileSync(target.path, String(text));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// A project rename must carry its agents, or they point at a code that no longer
// resolves and fail at open with "unknown project" (files-host calls this).
function renameProject(code, next) {
  let touched = 0;
  for (const rec of list()) {
    if (rec.projectCode !== code) continue;
    rec.projectCode = next;
    rec.updatedAt = Date.now();
    try { fs.writeFileSync(fileOf(rec.id), JSON.stringify(rec, null, 2)); touched++; } catch {}
  }
  return touched;
}

// SAVE-AS-AGENT: the authoring path that isn't a blank form. A run that already
// works describes itself — take its placement and gating, and let him name it
// and write the assignment. Captured from a thing that ran, per RFC-003 §4.
function fromSession(s = {}, extra = {}) {
  return save({
    name: extra.name || s.projectCode || "agent",
    projectCode: s.projectCode || null,
    cwd: s.cwd || null,
    permissionMode: s.permissionMode || null,
    model: s.model || undefined,
    ...extra,
  });
}

// What open() needs: the SDK half spread straight into query options, with
// placement and gating handed back separately because they are not SDK agent
// fields — they are session fields. Returns null for an unknown id so the caller
// can say so rather than opening something subtly unconfigured.
function resolve(id) {
  const rec = get(id);
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    def: rec.def || {},
    projectCode: rec.projectCode,
    cwd: rec.cwd,
    permissionMode: rec.permissionMode,
  };
}

// ADOPTION — his call, 2026-08-25: "they need to be defined explicitly even
// though they were defined implicitly. We need to make sure these things are
// defined explicitly going forward, as the point."
//
// So an implicit agent is a MIGRATION STATE, not a species. Any run that opens
// without an agentId gets a definition written for it here, immediately, and the
// run is bound to it. After this there is no such thing as an undefined agent —
// only ones you haven't renamed yet.
//
// Keyed by PLACEMENT (projectCode + cwd), not by session: a project that opens
// five conversations is one agent that ran five times, not five agents. Without
// that, adoption would turn a busy day into fifty junk definitions — the "files
// become inefficient" failure he explicitly does not want.
function adopt({ projectCode, cwd, permissionMode, model } = {}) {
  if (!projectCode) return null;
  const existing = list().find(
    (d) => d.adopted && d.projectCode === projectCode && (d.cwd || null) === (cwd || null)
  );
  if (existing) return resolve(existing.id);
  // THE ID IS DERIVED FROM THE NAME, so two placements of the same project would
  // both slug to "buapi" and the second would OVERWRITE the first — losing the
  // first's directory silently. Caught by the test, not by reading. A taken id
  // belonging to a different placement gets a stable suffix from the path.
  let id = idOf(projectCode);
  const taken = get(id);
  if (taken && (taken.projectCode !== projectCode || (taken.cwd || null) !== (cwd || null))) {
    let n = 0;
    for (const ch of String(cwd || "")) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    id = `${id}-${n.toString(36).slice(0, 4)}`;
  }
  const rec = save({
    id,
    name: projectCode,
    projectCode,
    cwd: cwd || null,
    permissionMode: permissionMode || null,
    model: model || undefined,
    description: `adopted from a running session on ${new Date().toISOString().slice(0, 10)}`,
  });
  // marked so the panel can say "adopted, not yet configured" — visible, never
  // hidden, and the difference between "we wrote this for you" and "you meant it"
  try {
    const withFlag = { ...rec, adopted: true };
    fs.writeFileSync(fileOf(rec.id), JSON.stringify(withFlag, null, 2));
    return resolve(rec.id);
  } catch { return resolve(rec.id); }
}

// docPaths is exported for the STALENESS fingerprint (sessions.compositionOf): the CLAUDE.md
// stack is one of the things a session's context is composed from at open, so "has the
// composition changed" cannot be answered without asking the one place that knows the stack.
// RFC-057 follow-on — AN AGENT PROPOSES ITS OWN DOC, IT DOES NOT WRITE IT. The `agent-authoring`
// skill drafts into `<id>.proposed.md` beside the definition and stops. Approving is a human act,
// and it is the approval that writes `def.prompt` — an agent rewriting its own identity is the one
// edit that must never land quietly.
//
// The sidecar is markdown with front matter: `by`, `cut`, `added`. `cut` is required in spirit
// (the doc only ever grows; a pass that removes nothing did nothing) but not enforced here —
// refusing to show a proposal because its front matter is thin would hide the work, not improve it.
const proposalOf = (id) => path.join(DIR, `${String(id).replace(/[^a-zA-Z0-9._-]/g, "")}.proposed.md`);

function parseProposal(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const front = {};
  if (m)
    m[1].split("\n").forEach((line) => {
      const i = line.indexOf(":");
      if (i > 0) front[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
  return { ...front, text: (m ? raw.slice(m[0].length) : raw).trim() };
}

function proposals() {
  ensureDir();
  const out = [];
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith(".proposed.md")); } catch { return out; }
  for (const f of files) {
    const id = f.replace(/\.proposed\.md$/, "");
    try {
      const raw = fs.readFileSync(path.join(DIR, f), "utf8");
      const p = parseProposal(raw);
      const rec = get(id);
      out.push({
        id,
        name: (rec && rec.name) || id,
        by: p.by || id,
        cut: p.cut || "",
        added: p.added || "",
        text: p.text,
        // THE LIVE DOC RIDES ALONG. A proposal with nothing to compare against is a wall of prose;
        // the panel needs both sides to show what actually changed.
        current: (rec && rec.def && rec.def.prompt) || "",
        at: (() => { try { return fs.statSync(path.join(DIR, f)).mtime.toISOString(); } catch { return null; } })(),
      });
    } catch {}
  }
  return out;
}

// APPROVE IS THE WRITE. `text` is passed back from the panel so an edit he made while reading is
// what lands — reading a proposal and fixing a line in it is approving, not a separate act.
function applyProposal(id, text) {
  const rec = get(id);
  if (!rec) throw new Error(`no agent ${id}`);
  const prompt = String(text != null ? text : (parseProposal(fs.readFileSync(proposalOf(id), "utf8")).text || ""));
  if (!prompt.trim()) throw new Error("an empty agent doc is not an approval — reject it instead");
  const saved = save({ id, prompt });
  try { fs.unlinkSync(proposalOf(id)); } catch {}
  return saved;
}

function rejectProposal(id) {
  try { fs.unlinkSync(proposalOf(id)); return true; } catch { return false; }
}

module.exports = { list, get, save, remove, resolve, adopt, fromSession, renameProject, idOf, DIR, docs, docPaths, saveDoc, skills, saveSkill, help, saveHelp, proposals, applyProposal, rejectProposal };
