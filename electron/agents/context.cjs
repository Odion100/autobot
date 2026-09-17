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
const docs = require("./docs.cjs");
const hooks = require("./hooks.cjs");
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const SERVER = "context";
// RFC-058 §7 — the docs tools live HERE rather than on a new server: it is where agents already
// look, and discovery already indexes it.
//
// RETRIEVAL IS ONE DOOR. There was a `docs` search tool beside `context` for exactly one day, on
// the theory that notes and chunks have different truth conditions and should not be confused. The
// truth conditions are real — a note is true because someone learned it, a chunk only while its
// file has not changed — but that is an argument for LABELLING a result, not for a second tool.
// Measured: the word an agent reaches for is "context", and a tool nobody opens is worse than no
// separation at all. So `context` answers with both halves, labelled, and takes `kind` to narrow.
// What remains here is MANAGEMENT — listing, planning cuts, indexing, dropping — which is not
// retrieval and has no context-store equivalent to merge with.
const TOOL_NAMES = ["remember", "context", "list", "forget", "docsList", "docsPlan", "docsIndex", "docsDrop", "hooksList", "hooksWrite", "hooksDrop"]
  .map((t) => `mcp__${SERVER}__${t}`);
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
// WHO READ IT, not just that it was read. "Which notes are load-bearing" is only half the
// question; the other half is FOR WHOM — a note every agent pulls is a system convention, a note
// one agent pulls is that agent's lesson filed in the wrong scope. Stamped by the harness from
// the session's own identity, never sent by the model, same rule as `by:` on a write. Older
// lines have no reader and simply aggregate without one.
function bumpUsage(ids, by) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.appendFileSync(
      usageFile,
      ids.map((id) => JSON.stringify(by ? { id, ts: now, by } : { id, ts: now }) + "\n").join(""),
    );
  } catch {}
}
// WHEN TRACKING STARTED. The sidecar is explicitly disposable — it gets compacted, and losing it
// "loses nothing but tuning". That is true for ranking and FALSE for curation: a note older than
// the log reads as "never" when it may have been pulled a hundred times, and "old and never read"
// is the exact phrase that gets something deleted. Anything written before this instant has an
// UNKNOWN read history, not a zero, and must say so.
function usageSince() {
  try {
    const first = fs.readFileSync(usageFile, "utf8").split("\n").find(Boolean);
    return first ? JSON.parse(first).ts || null : null;
  } catch {
    return null;
  }
}

function readUsage() {
  const u = {};
  try {
    for (const line of fs.readFileSync(usageFile, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const { id, ts, by } = JSON.parse(line);
        const cur = u[id] || { hits: 0, last: null, readers: {} };
        cur.hits += 1;
        cur.last = ts;
        if (by) cur.readers[by] = (cur.readers[by] || 0) + 1;
        u[id] = cur;
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
async function search(scopes, { question, scope, k = 5, by = null }) {
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
  bumpUsage(hits.map((h) => h.id), by || (scopes && scopes.by) || null);
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
        "Search everything this system knows — NOTES (conventions, corrections, project facts, " +
          "lessons someone learned) and DOCUMENTATION (the embedded reference, chunked by heading) " +
          "— before guessing or re-deriving. Both come back in one answer, labelled, so you never " +
          "have to know which half held it. An empty answer means nothing recorded matches: " +
          "proceed, and remember() what you learn.",
        {
          question: z.string().describe("what you want to know, in plain language"),
          scope: z.string().optional().describe("narrow to one note scope; omit to search all"),
          kind: z
            .enum(["notes", "docs"])
            .optional()
            .describe("narrow to one half — omit for both. Use \"notes\" when curating the store, so documentation cannot be mistaken for a duplicate note"),
          corpus: z.string().optional().describe("narrow the documentation half to one corpus"),
          source: z.string().optional().describe("narrow the documentation half to one document"),
          limit: z.number().optional().describe("max results per half (default 5)"),
        },
        async ({ question, scope, kind, corpus, source, limit }) => {
          try {
            const k = Math.min(Math.max(limit || 5, 1), 12);
            // ONE DOOR, TWO HALVES — and they are fetched SEPARATELY on purpose.
            //
            // Measured on myself: the word an agent reaches for is "context", every time. I built
            // the documentation tool and then mined the note store twice in the same hour without
            // ever calling it. A second door is a door nobody opens.
            //
            // But the rankings are NOT merged. A doc explains a subject across several long,
            // strongly-matching sections; a note is one sentence. Blend the scores and a one-line
            // correction loses to the three paragraphs it is correcting — which is exactly the
            // moment the correction mattered. Each half gets its own slice, so neither can be shut
            // out by the other's volume.
            const wantNotes = kind !== "docs";
            const wantDocs = kind !== "notes";
            const hits = wantNotes ? await search(scopes, { question, scope, k }) : [];
            let sections = [];
            if (wantDocs) {
              try {
                const r = await docs.search({ q: question, corpus, source, limit: k });
                sections = (r && r.results) || [];
              } catch {
                /* a corpus that was never indexed is an empty half, not a failure */
              }
            }
            const blind = hits.failed ? `\n(warning: ${hits.failed} scope(s) could not be searched — this answer may be incomplete)` : "";
            if (!hits.length && !sections.length)
              return {
                content: [{ type: "text", text: `Nothing recorded scores above ${FLOOR} for that${wantDocs ? ", and no documentation section matches it" : ""}. Empty means nothing matched THAT question — try another angle before concluding it is unrecorded. If you learn the answer, remember() it.` }],
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
            // THE TWO HALVES READ DIFFERENTLY ON PURPOSE. A note is true because someone learned
            // it; a chunk is true only while its file has not changed. Saying which is which — and
            // saying STALE out loud — is what stops a drifted paragraph answering with the
            // authority of a human correction.
            const docLines = sections.map((h) => {
              const where = [h.source, h.headingPath && h.headingPath.length ? h.headingPath.join(" › ") : null].filter(Boolean).join("  ›  ");
              // the score rides here too — the notes half always had one, and a shelf without it
              // reads as unranked (his catch, the moment the log finally showed both halves)
              const sc = typeof h.score === "number" ? `, match ${h.score.toFixed(2)}` : "";
              return `▸ ${where}${h.part ? ` (${h.part})` : ""} — ${h.corpus}${sc} [${h.corpus}:${h.source}#]${h.stale ? "\n  ⚠ the file has CHANGED since this was indexed" : ""}\n  ${String(h.text).replace(/\n+/g, " ").slice(0, 400)}`;
            });
            const parts = [];
            if (hits.length)
              parts.push(`${hits.length === 1 ? "One note matches" : hits.length + " notes match"} — learned, and editable with remember(id=) / forget():\n\n` + lines.join("\n\n"));
            if (sections.length)
              parts.push(`${sections.length} documentation section(s) — derived from files; to change one, fix the file and re-index:\n\n` + docLines.join("\n\n"));
            return { content: [{ type: "text", text: parts.join("\n\n") + blind }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      // NAMED FOR THE OPERATION, because that is the only thing that distinguishes it. It was
      // `recent` first — which named one of its two orderings and hid the half you actually reach
      // for during maintenance; nobody scanning a tool list guesses that the way to find a
      // year-old forgotten note is a method called "recent". Then `notes`, which was no better:
      // `context` returns notes too, so the payload distinguishes nothing. The real difference is
      // that SEARCH NEEDS A QUESTION AND LIST DOES NOT — and that is the whole reason this exists,
      // since a question can only ever reach notes you already thought to ask about.
      tool(
        "list",
        "List what is IN the store — the notes themselves, not a search. " +
          "Use it to CURATE rather than to look something up: what you have written lately, and " +
          "what has gone quiet. `context()` can only return notes that match a question you " +
          "already thought to ask, which is exactly the wrong tool for finding the note you " +
          "forgot you wrote. Each line carries age, how many times it has been read, and when it " +
          "was last read. `order: \"stale\"` puts the oldest, least-read notes first — the " +
          "deletion candidates. Old and unread is a signal, never a verdict: read it and decide.",
        {
          scope: z.string().optional().describe(`"system", "project:<code>", or "agent:<slot>"; defaults to every scope you can see`),
          order: z.enum(["recent", "stale"]).optional().describe(`"recent" (default) = newest first. "stale" = least recently read first, never-read before read.`),
          limit: z.number().optional().describe("how many to list (default 20)"),
        },
        async ({ scope, order = "recent", limit = 20 }) => {
          try {
            const want = scope ? [scope] : scopes.allowed;
            for (const sc of want)
              if (!scopes.allowed.includes(sc)) throw new Error(`scope "${sc}" not available to this session`);
            const now = Date.now();
            // A note older than the log has an unknown read history, never a zero. See usageSince.
            const since = usageSince();
            const age = (iso) => {
              if (!iso) return "—";
              const d = Math.floor((now - Date.parse(iso)) / 86400000);
              if (Number.isNaN(d)) return "—";
              return d <= 0 ? "0d" : d === 1 ? "1d" : d < 60 ? `${d}d` : `${Math.floor(d / 30)}mo`;
            };
            let rows = want.flatMap((sc) => listNotes(sc));
            // STALE = LONGEST UNTOUCHED, where "touched" is read-if-ever-read, written otherwise.
            // The obvious version — never-read first — is wrong, and the live data said so
            // immediately: three of four never-read system notes had been written that same day.
            // Unread-and-new is just new. Falling back to `created` sinks them correctly and
            // floats the thing actually worth looking at: written months ago, never once pulled.
            // Deliberately NOT ranked by hit count either — a note read once last week is doing
            // more good than one read twice a year, and raw totals hide that.
            const touched = (r) => r.lastHit || r.created || "";
            // A note whose history predates the log is not evidence of neglect — it is missing
            // evidence. Rank it by when tracking started rather than by its own age, so it sits
            // with its peers instead of heading the deletion list on a technicality.
            const rank = (r) => (!r.lastHit && since && r.created && r.created < since ? since : touched(r));
            rows.sort(
              order === "stale"
                ? (a, b) => String(rank(a)).localeCompare(String(rank(b)))
                : (a, b) => String(b.created || "").localeCompare(String(a.created || "")),
            );
            rows = rows.slice(0, Math.max(1, Math.min(100, limit)));
            if (!rows.length) return { content: [{ type: "text", text: "Nothing in the store for that scope yet." }] };
            const body = rows
              .map(
                (r) =>
                  `• ${r.title} [${r.id}]\n  ${r.scope} · written ${age(r.created)} ago` +
                  `${r.by ? ` by ${r.by}` : ""} · read ${r.hits}×` +
                  `${
                    r.lastHit
                      ? `, last ${age(r.lastHit)} ago`
                      : since && r.created && r.created < since
                      ? " — none since tracking began, earlier unknown"
                      : " — never"
                  }` +
                  `${r.pointer ? `\n  see: ${r.pointer}` : ""}`,
              )
              .join("\n");
            return { content: [{ type: "text", text: `${rows.length} note${rows.length === 1 ? "" : "s"}, ${order === "stale" ? "quietest" : "newest"} first:\n\n${body}` }] };
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
            // A CHUNK ID IS NOT A NOTE ID, and the refusal has to TEACH — `context` now hands back
            // both kinds in one answer, so the first thing an agent will try is forgetting the
            // wrong one. `corpus:path#n` is the shape. Saying "no" alone would leave it believing
            // the chunk is un-removable; the fix is a different verb on a different thing.
            if (/^[a-zA-Z0-9._-]+:.+#\d*$/.test(String(id)))
              return {
                content: [{ type: "text", text:
                  `"${id}" is a DOCUMENTATION chunk, not a note — there is nothing to forget. A chunk is derived from a file, ` +
                  `so an edit or a deletion here is overwritten on the next index. Fix the source document and re-index the corpus ` +
                  `(docsIndex), or drop the corpus entirely (docsDrop). If the chunk is wrong, the FILE is wrong.` }],
                isError: true,
              };
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
      tool(
        "docsList",
        "What documentation corpora exist — name, kind, how many files and chunks, when each was " +
          "last indexed, and how many chunks have drifted from the file on disk.",
        {},
        async () => {
          try {
            const rows = docs.listCorpora();
            if (!rows.length) return { content: [{ type: "text", text: "No corpora configured yet (~/.autobot/corpora.json)." }] };
            const body = rows
              .map((c) => `${c.name}  [${c.kind}]  ${c.files} files · ${c.chunks} chunks${c.stale ? ` · ${c.stale} STALE` : ""}${c.lastIndexed ? ` · indexed ${c.lastIndexed}` : " · never indexed"}\n    ${c.root}  ${c.glob}`)
              .join("\n");
            return { content: [{ type: "text", text: body }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "docsPlan",
        "The DRY RUN: every chunk a corpus would produce, with its heading path and size — and " +
          "nothing embedded. Read the cuts before indexing, and after editing a document, to check " +
          "each subject still lands in one chunk of its own. Chunking is normally invisible, which " +
          "is exactly why it rots.",
        {
          name: z.string().describe("the corpus name"),
          maxChars: z.number().optional().describe("override the split threshold to compare cuts"),
          source: z.string().optional().describe("one document, instead of the whole corpus"),
        },
        async ({ name, maxChars, source }) => {
          try {
            const p = docs.plan(name, maxChars ? { maxChars } : {});
            const files = source ? p.files.filter((f) => f.source === source) : p.files;
            if (source && !files.length)
              return { content: [{ type: "text", text: `no "${source}" in ${name} — files: ${p.files.map((f) => f.source).join(", ")}` }] };
            const t = p.totals;
            const head = `${p.corpus} [${p.kind}]  ${p.root}  ${p.glob}\n${t.files} files · ${t.chunks} chunks · biggest ${t.biggest} · split ${t.split} · over max ${t.overMax} · empty files ${t.empty}`;
            const body = files
              .map((f) => `\n${f.source}  (${f.chunks.length} chunks, ${f.bytes}b, ${f.hash})\n` +
                f.chunks.map((c) => `   ${String(c.chars).padStart(5)}  ${c.part ? c.part + "  " : ""}${c.headingPath.join(" › ") || "(preamble)"}`).join("\n"))
              .join("\n");
            return { content: [{ type: "text", text: head + body }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "docsIndex",
        "Embed a corpus, or refresh it. Unchanged files cost nothing — re-indexing is by file hash, " +
          "so only what changed is embedded. Pass a `root` with a NEW name to create your own WORKING " +
          "corpus: write research to a file, embed it, then query it with context() instead of ever " +
          "reading the whole thing back. A working corpus is yours — it never surfaces in anyone " +
          "else's search unless they name it, and docsDrop retires it when you are done. " +
          "INDEXING PUBLISHES: a wrong document that is indexed answers confidently, so run docsPlan " +
          "and read the document first.",
        {
          name: z.string().describe("an existing corpus from docsList to refresh, or a new name to create one"),
          root: z.string().optional().describe("absolute path to the folder holding the files — required to CREATE a corpus"),
          glob: z.string().optional().describe("which files under root, e.g. `**/*.md` (the default) or `vendor-api.md`"),
          exclude: z.array(z.string()).optional().describe("globs to leave out — a corpus is defined as much by what it omits"),
          kind: z.enum(["working"]).optional().describe("working (the default for a corpus you create): your own research, yours to drop. Permanent corpora are the human's to create, on the context surface"),
        },
        async ({ name, root, glob, exclude, kind }) => {
          try {
            // A PERMANENT CORPUS IS THE HUMAN'S SHAPE. Limiting `kind` to "working" stops an agent
            // minting one; it does not stop an agent REPOINTING an existing one — docsIndex({name:
            // "systemlynx", root: "/tmp/whatever"}) would otherwise rewrite the framework corpus out
            // from under everybody. Same rule as docsDrop, one line lower down.
            if (root || glob || exclude || kind) {
              const c = docs.corpusNamed(name);
              if (c && (c.kind || "permanent") === "permanent")
                return { content: [{ type: "text", text: `"${name}" is a permanent corpus — its root and glob are the human's to change, on the context surface. Refresh it by name alone, or pick a new name for your own working corpus.` }], isError: true };
            }
            const r = await docs.index(name, { root, glob, exclude, kind });
            return {
              content: [{ type: "text", text:
                `${r.corpus} [${r.kind}] → ${r.collection}\n` +
                `${r.files} files · ${r.indexed} chunks embedded · ${r.skipped} unchanged (skipped)` +
                `${r.changedFiles ? ` · ${r.changedFiles} files changed` : ""}${r.removed ? ` · ${r.removed} removed` : ""}` }],
            };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "docsDrop",
        "Remove a corpus's whole collection from the vector store. The files are untouched — this " +
          "deletes what was embedded, not what was written.",
        { name: z.string() },
        async ({ name }) => {
          try {
            const c = docs.corpusNamed(name);
            // A permanent corpus is the human's, configured by hand; dropping one is not an agent's
            // call. A working corpus is the agent's own scratch and it should clean up after itself.
            if (c && (c.kind || "permanent") === "permanent")
              return { content: [{ type: "text", text: `"${name}" is a permanent corpus — dropping it is the human's call. Working corpora are yours to drop.` }], isError: true };
            const r = await docs.drop(name);
            if (r.error) return { content: [{ type: "text", text: r.error }], isError: true };
            return { content: [{ type: "text", text: `Dropped ${r.corpus} (${r.dropped} chunks).` }] };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      // -----------------------------------------------------------------------------------------
      // HOOKS — RFC-005 §7. The third way context reaches an agent, and until now the only one
      // with no door: presence and the system context are LOADED, the store and the corpora are
      // RETRIEVED, and a hook is PUSHED — but every hook in the system was hand-written into
      // ~/.autobot/hooks, which meant the trigger half of every job was hand-written too.
      //
      // WHY IT LIVES ON THIS SERVER. Same argument that moved the docs tools here: an agent
      // reaches for "context", and a server nobody opens is worse than no separation. Hooks are a
      // context layer — the one that fires on a moment instead of on a question — so authoring one
      // belongs beside remembering a note and indexing a corpus, not on a fourth door.
      //
      // WRITING A HOOK DOES NOT ARM IT, and that is the whole approval model rather than a
      // disclaimer. A hook fires only for an agent that CARRIES it (hooks.inScope — the list lives
      // on the agent definition, ticked in the profile). So an agent-authored hook lands on disk
      // inert, visible in the window, and stays inert until a human puts it on somebody. The
      // proposal is the write; the approval is the carry. Nothing had to be invented for that —
      // it falls out of where the carry list already lives.
      tool(
        "hooksList",
        "The moments this system announces, and what is already hooked to them. Read this BEFORE " +
          "writing a hook — a hook can only attach to an event that really fires, and the event " +
          "vocabulary is fixed. Also shows who authored each existing hook.",
        {},
        async () => {
          const evs = hooks.EVENTS.map(
            (e) => `  ${e.name}${e.fields.length ? ` (${e.fields.join(", ")})` : ""} — ${e.what}`
          );
          const hs = hooks.list().map(
            (h) =>
              `  ${h.name} · on ${h.on} · ${h.kind} · ${h.do || "(no pointer)"}` +
              `${h.guard ? ` · ${h.guard}` : ""}${h.enabled ? "" : " · DISABLED"}` +
              ` · by ${h.author || "hand-written (unattributed)"}` +
              `${Object.keys(h.when || {}).length ? `\n      when ${JSON.stringify(h.when)}` : ""}`
          );
          return {
            content: [
              {
                type: "text",
                text:
                  `EVENTS you may hook (${hooks.EVENTS.length}):\n${evs.join("\n")}\n\n` +
                  (hs.length ? `HOOKS that exist (${hs.length}):\n${hs.join("\n")}` : "No hooks exist yet.") +
                  `\n\nA hook only fires for an agent that CARRIES it — that tick lives on the agent's ` +
                  `profile and is the human's. Writing one does not arm it.`,
              },
            ],
          };
        },
        { alwaysLoad: true }
      ),
      tool(
        "hooksWrite",
        "Propose a context hook: when THIS moment happens, point an agent at THIS skill. Use it " +
          "when you find a procedure that is needed rarely and urgently, and that the agent will " +
          "not think to ask for because the moment arrives from outside. A hook holds no content " +
          "— it carries a POINTER to a skill, so it can never drift from the procedure. Call " +
          "hooksList first: the event must be one the system really emits. Writing a hook does " +
          "NOT arm it — it stays inert until a human carries it on an agent.",
        {
          name: z.string().describe("short kebab-case name; it is the filename and the identity"),
          on: z.string().describe("the event it fires on — must be one from hooksList"),
          do: z
            .string()
            .describe('the pointer, "skill:<name>". A hook names a procedure; it never contains one'),
          when: z
            .record(z.any())
            .optional()
            .describe(
              'declarative match on the event payload, e.g. {"pct": {"gte": 70}} or ' +
                '{"input.command": {"contains": "git push"}}. Omit for "always, on this event". ' +
                "Operators: equals not contains startsWith endsWith matches in gt gte lt lte exists"
            ),
          kind: z
            .enum(["context", "work"])
            .optional()
            .describe(
              'context = a pointer arrives and the agent decides (default, and almost always right). ' +
                'work = something RUNS unattended. Say "work" only when you mean it — it is a ' +
                "different level of trust and a human should be told so in the note"
            ),
          guard: z
            .string()
            .optional()
            .describe('"once-per-session" or "cooldown:<seconds>" — a hook with no guard on a ' +
              "frequent event fires forever, which is a context leak"),
          note: z.string().optional().describe("one or two lines for the agent: why this moment matters"),
          scope: z.string().optional().describe("who it is SUGGESTED for — the profile pre-fills from it"),
          wasName: z.string().optional().describe("the old name, when renaming a hook you authored"),
        },
        async (args) => {
          try {
            const me = scopes.by ? `agent:${scopes.by}` : "agent:(anonymous)";
            if (!hooks.isEvent(args.on))
              return {
                content: [{ type: "text", text:
                  `"${args.on}" is not an event this system emits, so a hook on it would never fire. ` +
                  `Call hooksList for the vocabulary.` }],
                isError: true,
              };
            const pointer = String(args.do || "").trim();
            if (!/^skill:.+/.test(pointer))
              return {
                content: [{ type: "text", text:
                  `\`do\` must be a pointer of the form "skill:<name>". A hook names a procedure and ` +
                  `never carries one — that is what keeps it from drifting out of date.` }],
                isError: true,
              };
            // AN AGENT MAY ONLY OVERWRITE ITS OWN. Attribution exists so this is checkable rather
            // than trusted: an unattributed hook was hand-written before authors were recorded, and
            // is read as the operator's — the conservative side of an ambiguity.
            const existing = hooks.list().find((h) => h.name === args.name || h.name === args.wasName);
            if (!hooks.mayWrite(existing, me))
              return {
                content: [{ type: "text", text:
                  `"${existing.name}" was written by ${existing.author || "hand (unattributed)"}, not by you. ` +
                  `Editing someone else's hook is not yours to do — say what you would change and let ` +
                  `them or the human change it.` }],
                isError: true,
              };
            const skill = pointer.slice(6).trim();
            const saved = hooks.save({ ...args, author: me });
            const warn = fs.existsSync(path.join(os.homedir(), ".claude", "skills", skill))
              ? ""
              : `\nNOTE: no skill named "${skill}" under ~/.claude/skills — fine if it is a plugin or ` +
                `bundled skill, but check the name if it is meant to be one of yours.`;
            return {
              content: [{ type: "text", text:
                `Wrote ${saved.file}\n` +
                `  on ${saved.on}${Object.keys(saved.when).length ? ` when ${JSON.stringify(saved.when)}` : ""}` +
                ` → ${saved.do} (${saved.kind}${saved.guard ? `, ${saved.guard}` : ""})\n` +
                `It is INERT. It fires for nobody until a human ticks it onto an agent in that ` +
                `agent's profile. Tell them it is there and what it is for.${warn}` }],
            };
          } catch (e) {
            return { content: [{ type: "text", text: e.message }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "hooksDrop",
        "Delete a hook you authored. Yours only — a hook written by the operator or by another " +
          "agent is theirs to remove.",
        { name: z.string() },
        async ({ name }) => {
          const me = scopes.by ? `agent:${scopes.by}` : "agent:(anonymous)";
          const h = hooks.list().find((x) => x.name === name);
          if (!h) return { content: [{ type: "text", text: `No hook named "${name}".` }], isError: true };
          if (h.author !== me)
            return {
              content: [{ type: "text", text:
                `"${name}" was written by ${h.author || "hand (unattributed)"}, not by you. ` +
                `Deleting it is not yours to do.` }],
              isError: true,
            };
          hooks.remove(name);
          return { content: [{ type: "text", text: `Removed ${name}.` }] };
        },
        { alwaysLoad: true }
      ),
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// STATISTICS. The store already answers "what exists"; nothing answered "what gets USED", and
// usage is the only signal that says what to delete. Two numbers per note — how often it is
// pulled, and by whom — turn curation from taste into evidence.
//
// The same log serves both directions, which is why there is one and not two: read FORWARD it says
// what is load-bearing; read BACKWARD it says what has gone quiet. `since` is reported because a
// note older than the log has an unknown read history, not a zero, and a surface that forgets that
// will happily recommend deleting the oldest and most-used notes in the store.
function stats(scopes = []) {
  const want = scopes.length ? scopes : ["system"];
  const notes = want.flatMap((sc) => listNotes(sc));
  const readers = {};
  // ONE PASS OVER THE LOG. This re-read and re-parsed the whole usage sidecar once PER NOTE — the
  // log is append-only and only grows, so the cost was notes × reads on a surface whose entire job
  // is to be opened and looked at.
  const usage = readUsage();
  for (const n of notes) {
    const u = usage[n.id];
    n.readers = (u && u.readers) || {};
    for (const [who, count] of Object.entries(n.readers)) readers[who] = (readers[who] || 0) + count;
  }
  const read = notes.filter((n) => n.hits > 0).length;
  return {
    since: usageSince(),
    notes,
    readers,
    totals: {
      notes: notes.length,
      read,
      unread: notes.length - read,
      reads: notes.reduce((a, n) => a + (n.hits || 0), 0),
    },
  };
}

module.exports = { SERVER, TOOL_NAMES, ROOT, serverFor, remember, search, place, listNotes, saveNote, deleteNote, editNote, purgeAgent, stats, readUsage, usageSince };
