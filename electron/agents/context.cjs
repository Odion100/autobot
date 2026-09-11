// THE CONTEXT MCP — RFC-055's retrieval half, the system around the vector store.
//
// Designed from two facts about the consumer (2026-09-09, planning with Odion):
// an agent will not pay more than ONE cheap call to write mid-work, and an agent
// does not reach for tools it was never told exist. So: remember() is one motion,
// and the Level-0 stamp (autobot's half) names these tools at session start.
//
// MARKDOWN IS THE TRUTH, THE STORE IS DERIVED. A note is a small .md file under
// ~/.autobot/context/<scope>/; the embedding is rebuildable from it, always. The
// moment the vectors ARE the memory, knowledge lives in a blob nobody can read,
// edit, or delete — and his surface edits NOTES, never vectors.
//
// THREE SCOPES, THREE OWNERS (the compartments are ownership, not taxonomy):
//   system            harness + SystemView conventions — every agent, forever
//   project:<pc>      per-repo architecture and conventions
//   agent:<slot>      learned lessons — SURVIVES re-clones, inherited by the slot
//
// Separate collections (different write/prune rhythms — and the day the discovery
// and services tiers shared one file, one writer's full-replace silently deleted
// the other's records; never again by construction). ONE search merges at query
// time: same model, same dims, comparable scores.
//
// IDENTITY BY CONSTRUCTION, NOT BY CLAIM — the reason this is an in-process SDK
// server rather than a SystemLynx service: serverFor() closes over the session's
// own slot and project, so an agent-scope note cannot file under the wrong agent
// even if the model invents a name. Same rule the worklist proved. The seam for
// serving context outward later (cross-machine, via the hub) is that this module
// stays pure-node behind the tool layer.
const fs = require("fs");
const path = require("path");
const os = require("os");
const vectors = require("../apps/vectors.cjs");
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const SERVER = "context";
const TOOL_NAMES = ["remember", "context", "forget"].map((t) => `mcp__${SERVER}__${t}`);
const ROOT = path.join(os.homedir(), ".autobot", "context");

// Near-duplicate threshold for similarity-on-write, and the search floor. The write
// threshold is HIGHER than the search floor on purpose: "related" is a good search
// result but a bad reason to block a write.
const FLOOR = 0.45;
const NEAR_DUP = 0.8;

// scope string -> { collection, dir }. Collections are namespaced ctx-* so they can
// never collide with mcp-tools in the same store.
function place(scope) {
  const s = String(scope || "").trim();
  if (s === "system") return { scope: s, collection: "ctx-system", dir: path.join(ROOT, "system") };
  // The name must contain a real character — `[a-zA-Z0-9._-]+` alone admits "..", and
  // place("project:..") resolved dir to the context ROOT itself. Nothing wrote through it
  // (writes are allowed-checked) but place() is exported and the next caller wouldn't know.
  // Autobot's find, 2026-09-09.
  let m = /^project:([a-zA-Z0-9._-]+)$/.exec(s);
  if (m && !/^[.]+$/.test(m[1]) && !m[1].includes(".."))
    return { scope: s, collection: `ctx-project-${m[1]}`, dir: path.join(ROOT, "projects", m[1]) };
  m = /^agent:([a-zA-Z0-9._-]+)$/.exec(s);
  if (m && !/^[.]+$/.test(m[1]) && !m[1].includes(".."))
    return { scope: s, collection: `ctx-agent-${m[1]}`, dir: path.join(ROOT, "agents", m[1]) };
  return null;
}

const slug = (t) =>
  String(t || "note").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "note";

// A note file: tiny frontmatter + body. The frontmatter is the machine's half
// (id, dates, pointer); the body is the knowledge. Both survive any store rebuild.
// FRONTMATTER VALUES CANNOT CARRY LINES (autobot-e1's find): title is model-supplied and was
// interpolated raw, so a title containing "\nid: HIJACKED" rewrote which note a save targets —
// and could forge `by:` if field order ever changed. An input value silently deciding an
// identity, same class as the serviceUrl bug. One line per value, no leading ---, at WRITE.
const fmv = (v) => String(v).replace(/\r?\n/g, " ").replace(/^---\s*/, "").trim();

function writeNote(dir, { id, title, body, pointer, supersedes, by }) {
  fs.mkdirSync(dir, { recursive: true });
  const front = [
    "---",
    `id: ${fmv(id)}`,
    `title: ${fmv(title)}`,
    `created: ${new Date().toISOString()}`,
    // WHO WROTE IT — stamped by the harness, never sent by the agent (his rule: "it should just
    // be automatically known"). Matters most on the shared scopes, where the scope itself says
    // nothing about the author.
    by ? `by: ${fmv(by)}` : null,
    pointer ? `pointer: ${fmv(pointer)}` : null,
    supersedes ? `supersedes: ${fmv(supersedes)}` : null,
    "---",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(path.join(dir, id + ".md"), front + "\n\n" + body.trim() + "\n");
}

// USAGE IS STATE, NOT TRUTH — hits/lastHit live in a sidecar, never in the note
// (truth) and never requiring a re-embed. This is what feeds aging: decay ranks on
// it, and the LINT agent reads it to find the sunken. Losing the sidecar loses
// nothing but tuning.
const usageFile = path.join(ROOT, "usage.jsonl");
// APPEND-ONLY — autobot's find: read-modify-write on one JSON file loses concurrent
// increments, and the loss is not uniform noise: busy agents collide most, so the MOST
// used notes undercount and decay sinks exactly the wrong ones. O_APPEND writes don't
// interleave at these sizes; readers aggregate; LINT compacts the log when it runs.
function bumpUsage(ids) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.appendFileSync(usageFile, ids.map((id) => JSON.stringify({ id, ts: now }) + "\n").join(""));
  } catch {}
}
function readUsage() {
  const u = {};
  try {
    for (const line of fs.readFileSync(usageFile, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const { id, ts } = JSON.parse(line);
        u[id] = { hits: ((u[id] && u[id].hits) || 0) + 1, last: ts };
      } catch {}
    }
  } catch {}
  return u;
}

async function indexNote(collection, scope, { id, title, body, pointer }) {
  await vectors.upsert(collection, [{
    id,
    text: `${title}\n${body}`.slice(0, 4000),
    meta: { kind: "note", scope, title, file: id + ".md", created: new Date().toISOString(), ...(pointer ? { pointer } : {}) },
  }]);
}

function parseNote(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const front = {};
  if (m) m[1].split("\n").forEach((line) => {
    const i = line.indexOf(":");
    if (i > 0) front[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return { ...front, body: (m ? raw.slice(m[0].length) : raw).trim() };
}

function readNoteFile(dir, id) {
  try {
    return parseNote(fs.readFileSync(path.join(dir, String(id).replace(/[^a-zA-Z0-9._-]/g, "") + ".md"), "utf8"));
  } catch {
    return null;
  }
}

// HIS SURFACE — list/save/delete, the management half. The note is TRUTH; save rewrites the
// markdown THEN re-embeds, so an edited note and its vector never disagree (the whole reason
// vectors are derived). Delete removes both file and record. The agent writes with remember();
// the human curates with these.
function listNotes(scope) {
  const p = place(scope);
  if (!p) return [];
  let files = [];
  try { files = fs.readdirSync(p.dir).filter((f) => f.endsWith(".md")); } catch { return []; }
  const usage = readUsage();
  return files
    .map((f) => {
      const id = f.replace(/\.md$/, "");
      const n = readNoteFile(p.dir, id) || {};
      return { id, scope: p.scope, title: n.title || id, body: n.body || "", created: n.created || null, by: n.by || null, pointer: n.pointer || null, hits: (usage[id] && usage[id].hits) || 0, lastHit: (usage[id] && usage[id].last) || null };
    })
    .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
}

async function saveNote(scope, id, { title, body, pointer } = {}) {
  const p = place(scope);
  if (!p) throw new Error(`bad scope "${scope}"`);
  const existing = readNoteFile(p.dir, id);
  if (!existing) throw new Error(`no note ${id} in ${scope}`);
  const t = String(title || existing.title || id).slice(0, 120);
  const b = String(body != null ? body : existing.body).trim();
  if (!b) throw new Error("a note cannot be emptied — delete it instead");
  // TRUTH FIRST: rewrite the file, then re-derive the record. If the embed fails the file still
  // holds the edit — a stale vector over lost prose is the safe direction. Authorship survives
  // the rewrite: the original `by` rides along.
  writeNote(p.dir, { id, title: t, body: b, pointer: pointer != null ? pointer : existing.pointer, by: existing.by });
  await indexNote(p.collection, p.scope, { id, title: t, body: b, pointer: pointer != null ? pointer : existing.pointer });
  return { id, scope: p.scope, title: t };
}

// EDIT IN PLACE — the agent correcting its own note. Validates the scope the same way remember
// does, then rewrites the existing note (title/body/pointer) and re-derives its embedding.
async function editNote(scopes, { id, scope, text, title, pointer }) {
  const p = place(scope || scopes.default);
  if (!p || !scopes.allowed.includes(p.scope)) throw new Error(`scope not available to this session`);
  return saveNote(p.scope, id, { title, body: text, pointer });
}

// DELETE MEANS GONE, OWNED HERE (writer-map fix, autobot-e1's flag): ctx-agent-* has ONE writer
// — this module. The full wipe of an agent's memory (vector collection + notes dir) therefore
// lives here, and definitions.remove() CALLS it instead of writing the scope itself. Two writers
// on one scope is the exact shape the map exists to prevent.
async function purgeAgent(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9._-]/g, "");
  try { await vectors.drop(`ctx-agent-${safe}`); } catch {}
  try { fs.rmSync(path.join(ROOT, "agents", safe), { recursive: true, force: true }); } catch {}
  return { id: safe };
}

async function deleteNote(scope, id) {
  const p = place(scope);
  if (!p) throw new Error(`bad scope "${scope}"`);
  await vectors.remove(p.collection, [id]);
  try { fs.unlinkSync(path.join(p.dir, String(id).replace(/[^a-zA-Z0-9._-]/g, "") + ".md")); } catch {}
  return { id, scope: p.scope };
}

// remember() — one motion: near-dup check, markdown write, embed. Returns the
// near-neighbor WITH the result when one exists — "a note about this exists,
// update it instead" — the wiki's grep-before-INGEST rule enforced by the machine.
async function remember(scopes, { text, title, scope, pointer, supersedes }) {
  const p = place(scope || scopes.default);
  if (!p) throw new Error(`bad scope "${scope}" — use system, project:<code>, or agent:<slot>`);
  if (!scopes.allowed.includes(p.scope)) throw new Error(`scope ${p.scope} not available to this session`);
  const body = String(text || "").trim();
  if (!body) throw new Error("nothing to remember");
  const t = String(title || body.split("\n")[0]).slice(0, 120);

  const near = (await vectors.search(p.collection, `${t}\n${body}`, { k: 1, min: NEAR_DUP })).filter(
    (h) => h.id !== supersedes
  );
  const id = `${slug(t)}-${Math.random().toString(36).slice(2, 6)}`;
  writeNote(p.dir, { id, title: t, body, pointer, supersedes, by: scopes.by });
  await indexNote(p.collection, p.scope, { id, title: t, body, pointer });
  if (supersedes) {
    // Supersede = replace by id: the old note's record leaves the index; the file
    // stays on disk with nothing pointing at it (his surface can still show history).
    await vectors.remove(p.collection, [supersedes]);
  }
  return { id, scope: p.scope, near: near[0] || null };
}

// context() — merged search across every scope this session can see, or one scope
// when aimed. Hits carry pointers; usage is bumped so aging has a signal.
async function search(scopes, { question, scope, k = 5 }) {
  // IDENTITY ON READ, NOT JUST WRITE — autobot's find, and the third instance of the same
  // shape in two days (RunBlock's namespace, serviceUrl, now this): the guard was written
  // where the risk FELT located — writes mutate, so writes got checked — while the read
  // path resolved the same value unchecked, letting any session read any agent's lessons
  // by naming the slot. The standing question, theirs, worth keeping: WHICH OTHER PATH
  // RESOLVES THIS SAME VALUE, AND DOES IT AGREE?
  const targets = scope
    ? [place(scope)].filter(Boolean).filter((t) => scopes.allowed.includes(t.scope))
    : scopes.allowed.map(place).filter(Boolean);
  if (!targets.length) throw new Error(`scope "${scope}" is not available to this session`);
  // "COULD NOT SEARCH" IS NOT "NO HITS" — autobot's pre-relaunch catch. Swallowing a dead
  // embedder to [] hands the agent "nothing matches", whose tool description says PROCEED AND
  // remember() — a confident zero instructing the model to re-derive things we already know.
  // A failed collection is counted, not hidden: all failed → the tool says the store is down;
  // some failed → hits carry a warning naming the blind spot.
  let failed = 0;
  const per = await Promise.all(
    targets.map((t) =>
      vectors.search(t.collection, question, { k, min: FLOOR }).then(
        (hits) => hits.map((h) => ({ ...h, scope: t.scope })),
        () => { failed++; return null; }
      )
    )
  );
  if (failed === targets.length) throw new Error("the context store is unavailable (embedder not responding) — this is NOT an empty result; do not treat it as nothing recorded");
  // DECAY — aging is machinery, not his janitorial duty. rank = similarity × freshness,
  // where freshness only starts dropping after a QUIET QUARTER (no write, no retrieval),
  // then ×0.95 per quiet month, FLOOR 0.7. The floor is the rare-but-vital guarantee: the
  // port-conflict note asked twice a year still surfaces on a strong match (0.75 × 0.7
  // clears the search floor); decay sinks the never-asked, it never buries the true.
  const usage = readUsage();
  const now = Date.now();
  const freshness = (h) => {
    const touched = Math.max(
      Date.parse((usage[h.id] && usage[h.id].last) || 0) || 0,
      Date.parse(h.meta.created || 0) || 0
    );
    if (!touched) return 1;
    const quietMonths = (now - touched) / (30 * 24 * 3600 * 1000) - 3;
    return quietMonths <= 0 ? 1 : Math.max(0.7, Math.pow(0.95, quietMonths));
  };
  const hits = per
    .filter(Boolean)
    .flat()
    .map((h) => ({ ...h, score: h.score * freshness(h) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((h) => h.score >= FLOOR);
  bumpUsage(hits.map((h) => h.id));
  if (failed) hits.failed = failed;
  return hits;
}

// The per-session server. `identity` is CLOSED OVER: { projectCode, slot } come from
// the harness's own knowledge of the session, never from tool arguments.
function serverFor(identity = {}) {
  const allowed = [
    "system",
    identity.projectCode ? `project:${identity.projectCode}` : null,
    identity.slot ? `agent:${identity.slot}` : null,
  ].filter(Boolean);
  const scopes = {
    allowed,
    default: identity.slot ? `agent:${identity.slot}` : "system",
    // the writer's identity — stamped into every note automatically, never sent by the agent
    by: identity.slot || identity.projectCode || null,
  };

  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
      tool(
        "remember",
        "Write one small piece of knowledge to the shared context store so every future session " +
          "can find it. Use it the moment you learn something a future agent would otherwise " +
          "rediscover: a correction from the user, a convention, a gotcha, what a command really " +
          "does. One concept per note. If the response says a similar note already exists, update " +
          "that one (pass supersedes) instead of piling on near-duplicates.",
        {
          text: z.string().describe("the knowledge itself — a few sentences, one concept"),
          title: z.string().optional().describe("short title; defaults to the first line"),
          scope: z
            .string()
            .optional()
            .describe(
              `where it belongs: "system" (harness/SystemView conventions, every agent), ` +
                `"project:<code>" (this repo's facts), "agent:<slot>" (lessons for whoever holds this slot). ` +
                `Default: your agent scope.`
            ),
          pointer: z.string().optional().describe("optional pointer to the source: a file path, namespace, or report"),
          supersedes: z.string().optional().describe("id of the note this replaces"),
          id: z.string().optional().describe("id of an existing note to EDIT in place — use when you got a note wrong and want to correct it, not add a duplicate"),
        },
        async (args) => {
          try {
            if (args.id) {
              const e = await editNote(scopes, args);
              return { content: [{ type: "text", text: `Updated ${e.id} in ${e.scope}.` }] };
            }
            const r = await remember(scopes, args);
            const dup = r.near
              ? `\nNOTE: a similar note already exists — "${r.near.meta.title}" (id ${r.near.id}, ${r.near.score.toFixed(2)}). ` +
                `If yours restates it, supersede it next time instead.`
              : "";
            return { content: [{ type: "text", text: `Remembered as ${r.id} in ${r.scope}.${dup}` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "context",
        "Search the shared context store — conventions, corrections, project facts, lessons — " +
          "before guessing or re-deriving. Searches every scope you can see (system, this project, " +
          "your agent slot) and returns ranked notes with pointers. An empty answer means nothing " +
          "recorded matches: proceed, and remember() what you learn.",
        {
          question: z.string().describe("what you want to know, in plain language"),
          scope: z.string().optional().describe("narrow to one scope; omit to search all"),
          limit: z.number().optional().describe("max notes (default 5)"),
        },
        async ({ question, scope, limit }) => {
          try {
            const hits = await search(scopes, { question, scope, k: Math.min(Math.max(limit || 5, 1), 12) });
            const blind = hits.failed ? `\n(warning: ${hits.failed} scope(s) could not be searched — this answer may be incomplete)` : "";
            if (!hits.length)
              return {
                content: [{ type: "text", text: `Nothing recorded scores above ${FLOOR} for that. If you learn the answer, remember() it.` }],
              };
            // WRITTEN FOR A READER — his rule: these are OUR logs, and they come out human. The
            // same words serve the model and the chat; nothing downstream reformats them.
            const lines = hits.map((h) => {
              const body = h.text.split("\n").slice(1).join(" ").slice(0, 300);
              const where = h.scope.startsWith("agent:") ? "your own lessons" : h.scope.startsWith("project:") ? `the ${h.scope.slice(8)} project` : "system conventions";
              // THE ID RIDES EVERY HIT (his rule: "there's no reason anyone can not update the
              // system") — it is what remember(id=) and forget() take, so any agent can point at
              // the exact note it just read, not only its own recent writes.
              return `• ${h.meta.title} — from ${where}, match ${h.score.toFixed(2)} [${h.id}]\n  ${body}${h.meta.pointer ? `\n  see: ${h.meta.pointer}` : ""}`;
            });
            const head = `${hits.length === 1 ? "One note matches" : hits.length + " notes match"}:`;
            return { content: [{ type: "text", text: head + "\n\n" + lines.join("\n\n") + blind }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "forget",
        "Delete a note from the context store by id — use when a note is wrong or stale and should " +
          "not just be superseded but removed. It's your store to keep clean.",
        {
          id: z.string().describe("the note id, as shown by context()"),
          scope: z.string().optional().describe("the note's scope; defaults to your agent scope"),
        },
        async ({ id, scope }) => {
          try {
            const p = place(scope || scopes.default);
            if (!p || !scopes.allowed.includes(p.scope)) throw new Error(`scope not available to this session`);
            await deleteNote(p.scope, id);
            return { content: [{ type: "text", text: `Forgot ${id} from ${p.scope}.` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
    ],
  });
}

module.exports = { SERVER, TOOL_NAMES, ROOT, serverFor, remember, search, place, listNotes, saveNote, deleteNote, editNote, purgeAgent };
