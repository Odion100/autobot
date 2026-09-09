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
  const rec = normalize({ ...(prev || {}), ...input, createdAt: prev?.createdAt });
  fs.writeFileSync(fileOf(rec.id), JSON.stringify(rec, null, 2));
  return rec;
}

// Removing a definition never touches the runs it started — those are
// conversations, and a conversation outliving the config that opened it is the
// same rule as a session outliving its view.
function remove(id) {
  try { fs.unlinkSync(fileOf(id)); return true; } catch { return false; }
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

module.exports = { list, get, save, remove, resolve, adopt, fromSession, renameProject, idOf, DIR };
