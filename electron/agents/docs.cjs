"use strict";
// RFC-058 — DOCUMENT EMBEDDINGS. The reference layer: markdown chunked, embedded, and retrieved by
// question — kept separate from the context store's notes, because the two have different truth
// conditions. A note is true because someone learned it. A chunk is true only while its file hasn't
// changed. Mixing them lets a stale chunk answer with the authority of a human correction.
//
// THE CHUNKER IS THE PART WORTH JUDGING, so it is written to be read, and `plan()` shows its work
// before a single vector exists. Chunking is normally invisible, which is exactly why RAG rots.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const vectors = require("../apps/vectors.cjs");

// Overridable so a test can point at its own config — the same reason the ledger takes a dir. A
// test that writes to the live path does not fail loudly, it quietly makes the real thing wrong.
const CONFIG = process.env.AUTOBOT_CORPORA || path.join(os.homedir(), ".autobot", "corpora.json");

// Tunable, and deliberately few. Each of these is a rule he can argue with after reading a plan,
// which is the entire point of showing the cuts.
const MAX_CHARS = 2200; // past this a section is split at paragraph edges
const MIN_CHARS = 40;   // below this a section has no body of its own (a heading above subheadings)
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// ---------------------------------------------------------------------------------------------
// The chunker
// ---------------------------------------------------------------------------------------------

// Markdown is already structured, so no fixed token window: cut where the AUTHOR cut. Three rules
// carry all the weight —
//   1. a heading starts a new chunk, and the chunk remembers its full heading path
//   2. a code fence is never split, and a heading inside one is text, not a heading
//   3. an oversized section splits at paragraph breaks, never mid-sentence
function chunkMarkdown(text, { maxChars = MAX_CHARS, minChars = MIN_CHARS } = {}) {
  const raw = String(text || "").replace(/\r\n/g, "\n");
  // Front matter is metadata about the file, not content of it.
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const lines = body.split("\n");

  const sections = [];
  let stack = [];  // heading titles by depth, for the path
  let cur = { path: [], lines: [], line: 1 };
  let fence = null; // the exact fence marker we are inside, or null

  lines.forEach((line, i) => {
    const f = FENCE.exec(line);
    if (f) {
      // Only the SAME marker closes, so a ``` inside a ~~~ block stays text.
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence)) fence = null;
      cur.lines.push(line);
      return;
    }
    const h = !fence && HEADING.exec(line);
    if (!h) {
      cur.lines.push(line);
      return;
    }
    if (cur.lines.length) sections.push(cur);
    const depth = h[1].length;
    stack = stack.slice(0, depth - 1);
    stack[depth - 1] = h[2];
    cur = { path: stack.filter(Boolean).slice(), lines: [line], line: i + 1 };
  });
  if (cur.lines.length) sections.push(cur);

  const out = [];
  for (const sec of sections) {
    const whole = sec.lines.join("\n").trim();
    if (!whole) continue;
    // A heading with no body of its own — a parent above subheadings. Indexing it produces a chunk
    // that is a title and nothing else: matches everything, answers nothing.
    const bodyOnly = sec.lines.slice(HEADING.test(sec.lines[0]) ? 1 : 0).join("\n").trim();
    if (bodyOnly.length < minChars && sec.path.length) continue;
    if (whole.length <= maxChars) {
      out.push({ headingPath: sec.path.slice(), text: whole, line: sec.line, part: null });
      continue;
    }
    const pieces = splitLong(sec, maxChars, minChars);
    pieces.forEach((piece, n) =>
      out.push({
        headingPath: sec.path.slice(),
        text: piece.text,
        line: piece.line,
        part: `${n + 1}/${pieces.length}`,
      }),
    );
  }
  return out;
}

// OVERSIZE SPLITS AT PARAGRAPH EDGES. A blank line is the author's own boundary; a token count is
// ours. And a fence is atomic — half a code block is an example that is subtly wrong rather than
// obviously broken, which is the classic failure of this whole genre.
function splitLong(sec, maxChars = MAX_CHARS, minChars = MIN_CHARS) {
  const blocks = [];
  let buf = [];
  let fence = null;
  let startLine = sec.line;
  sec.lines.forEach((line, i) => {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (line.trim().startsWith(fence)) fence = null;
    }
    if (!fence && !line.trim() && buf.length) {
      blocks.push({ text: buf.join("\n"), line: startLine });
      buf = [];
      startLine = sec.line + i + 1;
      return;
    }
    buf.push(line);
  });
  if (buf.length) blocks.push({ text: buf.join("\n"), line: startLine });

  const pieces = [];
  let acc = null;
  for (const b of blocks) {
    // A PIECE UNDER `minChars` IS A LABEL, NOT CONTENT, so it is carried into the next piece
    // instead of standing alone. `minChars` is checked on the whole SECTION before splitting, and a
    // section that splits can still shed a fragment here — measured: a heading followed by one
    // oversized code fence produced two chunks, the first of which was the four characters "# D".
    // That is precisely the chunk rule 4 exists to prevent: it matches everything and answers
    // nothing, and it orphans the fence from the heading that says what it is.
    if (acc && acc.text.trim().length >= minChars && acc.text.length + b.text.length + 2 > maxChars) {
      pieces.push(acc);
      acc = null;
    }
    if (!acc) acc = { text: b.text, line: b.line };
    else acc.text += "\n\n" + b.text;
  }
  if (acc) pieces.push(acc);
  return pieces.map((p) => ({ text: p.text.trim(), line: p.line })).filter((p) => p.text);
}

// ---------------------------------------------------------------------------------------------
// Corpora — configured, never hardcoded. That is the difference between a pipeline for two repos
// and a feature someone else can point at their own docs.
//
// `kind` decides HOW LONG it is meant to live. It is a lifecycle choice, never an approval tier:
//   permanent — published reference: it outlives the task that produced it. Wrong chunk? Fix the
//               FILE and re-index.
//   working   — private research: written to a file, embedded, and queried instead of being read
//               back whole. Invisible unless someone names the corpus; its author drops it.
// Either kind is an agent's to create (the door is context.cjs, and `working` is its default).
// Promotion is just a re-index with the other kind — same collection, nothing re-embedded.
//
// `agents` decides WHO FINDS IT WITHOUT ASKING, and it is a separate axis because `kind` was doing
// both jobs and only one of them was ever a decision. Sixteen permanent corpora, ~1,500 chunks,
// ranked on cosine alone: a question about report subtypes came back with two chapters from a
// bookkeeping corpus above this system's own reasoning, because `account` is a word in both
// domains. More corpora makes that monotonically worse, so audience is a field, not a tuning knob.
//   "everyone"            — published to every agent's unscoped search
//   ["slot", "slot"]      — those agents' unscoped searches read it; nobody else's does
//   absent                — everyone. The legacy reading, so a corpus indexed before this existed
//                           never disappears from anybody by silence.
// A NEW permanent corpus belongs to the agent that made it, because publishing to every agent is a
// decision and silence must not make it. Changing it later is one call, and an agent may make that
// call for a corpus the same way a human can.
//
// SCOPE IS A DEFAULT, NEVER A WALL. Naming a corpus reads it whatever the audience says — the
// override has to be unconditional or "go look at the accounting docs" becomes unanswerable and
// the agent re-derives from source, which is worse than the noise this fixes. And a search that
// withholds SAYS SO, naming the corpora: an agent cannot ask for a corpus it does not know exists,
// so an unnamed withholding is blindness dressed as an empty answer.
// ---------------------------------------------------------------------------------------------
function corpora() {
  try {
    const v = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// The audience, normalised. A string is a single name or the word `everyone`; a list is the named
// agents; absent is everyone (see above). Empty list is NOT everyone — it is "nobody but a caller
// who names it", which is a legitimate thing to want and an easy thing to erase by being clever.
function audienceOf(corpus) {
  const a = corpus && corpus.agents;
  if (a === undefined || a === null) return "everyone";
  if (Array.isArray(a)) return a.map((x) => String(x).trim()).filter(Boolean);
  const one = String(a).trim();
  if (!one || one === "everyone" || one === "*" || one === "all") return "everyone";
  return one.split(/[\s,]+/).filter(Boolean);
}

/** Does this agent read this corpus without naming it? A caller with no slot reads everything —
 *  withholding from an identity the system could not establish punishes the wrong party. */
function carries(corpus, slot) {
  const who = audienceOf(corpus);
  if (who === "everyone") return true;
  if (!slot) return true;
  return who.includes(String(slot));
}

// RFC-078 §2.6 — HOW TO READ HITS FROM THIS SHELF. Two layers, one fact. A corpus fed by the
// documents registry is machine-fed, and SAYS SO without anybody authoring a word — the derived
// baseline below is true by construction, keyed off the same `registry:` flag that feeds the
// corpus, so there is no second copy to drift. His `treatment` value, when he writes one, prints
// on top of that baseline; an authored-only corpus prints just its statement; a corpus with
// neither prints nothing. Retrieval renders these at the bottom of any answer carrying the
// corpus's hits — instructions where the results are, not metadata in a manual.
const DERIVED_TREATMENT =
  "auto-generated from this project's registered documents — work history, not doctrine";

function treatmentOf(corpus) {
  if (!corpus) return null;
  const said =
    typeof corpus.treatment === "string" && corpus.treatment.trim() ? corpus.treatment.trim() : null;
  const derived = corpus.registry ? DERIVED_TREATMENT : null;
  if (!said && !derived) return null;
  return { said, derived };
}

function saveCorpora(list) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(list, null, 2));
  return list;
}

const corpusNamed = (name) => corpora().find((c) => c.name === name) || null;
const collectionOf = (c) => `docs-${typeof c === "string" ? c : c.name}`;

// A tiny glob: `**/*.md`, `docs/**/*.md`, `*.md`. Not a glob library — the config is one line a
// human writes, and a dependency for that is a dependency to keep alive forever.
// Three forms, and the order matters: `**/` spans directories optionally, a trailing `**` spans the
// rest of the path, and a lone `*` never crosses a `/`. Getting this wrong is silent — a pattern
// that matches nothing excludes nothing, which is how `RFCs/**` let thirteen RFCs into a corpus
// that had explicitly ruled them out.
function globToRe(pat) {
  const esc = String(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = esc
    .replace(/\*\*\//g, "\u0000")   // **/  -> any number of directories, or none
    .replace(/\*\*/g, "\u0001")     // **   -> anything at all, including slashes
    .replace(/\*/g, "[^/]*")        // *    -> one path segment
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp("^" + re + "$");
}

// ---------------------------------------------------------------------------------------------
// REGISTRY-FED CORPORA. A corpus record may say `registry: "<projectCode>"` instead of a glob —
// its file set is that project's rows in ~/.autobot/documents.json, the documents registry. "The
// file set comes from the registry, never a glob" is the janitor's own law: a glob over RFCs/
// would re-derive by folder what the registry already knows by leaf, and the two answers drift.
// Each row's `kind` (rfc, arc, gap, report) becomes the file's SUBSCOPE, so `name:rfcs` or
// `name:rfcs|gaps` narrows a search to exactly those document kinds.
//
// The require is lazy and the resolution is the registry's own `absPathOf` — rows store
// repo-relative paths and the project's root lives in the projects file; re-deriving that join
// here would be a second definition of the same rule.
// ---------------------------------------------------------------------------------------------
const registryMod = () => require("../markdown/registry.cjs");

// A subscope and the way a caller writes it are allowed to disagree by a plural: rows carry `rfc`,
// his own example asks for `rfcs|arcs|gaps`. One normaliser on BOTH sides (index and query) is
// what keeps that a convenience instead of a silent miss.
const normSub = (s) => String(s || "").trim().toLowerCase().replace(/s$/, "");

// Every file a corpus holds, with WHERE IT LIVES and WHAT SUBSCOPE it carries — the one shape
// `plan`, `index` and `filesOf` all walk, whatever fed it.
//   glob corpus     — { source: rel-to-root, abs: root/rel, sub: null }
//   registry corpus — { source: row.path (repo-relative), abs: via absPathOf, sub: row.kind }
// A row whose project has no root resolves to "" and is skipped here: unresolvable is not gone,
// but a file we cannot read is not indexable either way.
function entriesOf(corpus) {
  if (corpus && corpus.registry) {
    const reg = registryMod();
    return reg
      .read()
      .filter((r) => String(r.project || "") === String(corpus.registry))
      .map((r) => ({ source: r.path, abs: reg.absPathOf(r), sub: r.kind || null }))
      .filter((e) => e.source && e.abs)
      .sort((a, b) => a.source.localeCompare(b.source));
  }
  return globFilesOf(corpus).map((rel) => ({ source: rel, abs: path.join(corpus.root, rel), sub: null }));
}

// Where a chunk's source lives on disk NOW — glob corpora join the root, registry corpora resolve
// through the projects file, exactly as they did at index time.
function absOf(corpus, source) {
  if (corpus && corpus.registry) {
    if (path.isAbsolute(source)) return source;
    return registryMod().absPathOf({ project: corpus.registry, path: source });
  }
  return path.join(corpus.root, source);
}

// The public face: a registry corpus answers with the rows' ABSOLUTE paths (there is no root to be
// relative to), a glob corpus with root-relative ones as it always has.
function filesOf(corpus) {
  if (corpus && corpus.registry) return entriesOf(corpus).map((e) => e.abs);
  return globFilesOf(corpus);
}

// EXCLUDES ARE NOT A LUXURY. The first real dry run pulled SystemLynx's RFCs, scratch notes and
// bug write-ups into a "reference" corpus — 261 of 372 chunks were exactly the material he ruled
// out. A corpus is defined as much by what it leaves out as by its root.
function globFilesOf(corpus) {
  const root = corpus.root;
  const rx = globToRe(corpus.glob || "**/*.md");
  const skip = (corpus.exclude || []).map(globToRe);
  const out = [];
  const walk = (dir) => {
    let rows = [];
    try {
      rows = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const r of rows) {
      if (r.name === "node_modules" || r.name.startsWith(".")) continue;
      const full = path.join(dir, r.name);
      if (r.isDirectory()) walk(full);
      else {
        const rel = path.relative(root, full);
        if (rx.test(rel) && !skip.some((x) => x.test(rel))) out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

const hashOf = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

// THE DRY RUN. Every chunk, its heading path, its size, where it came from — and NOTHING embedded.
// He reads the cuts, says where they are wrong, the rules change, it runs again. Nothing is indexed
// until the cuts have been looked at once.
function plan(name, { maxChars = MAX_CHARS } = {}) {
  const corpus = corpusNamed(name);
  if (!corpus) throw new Error(`no corpus "${name}" — add it to ${CONFIG}`);
  const files = [];
  for (const e of entriesOf(corpus)) {
    let text = "";
    try {
      text = fs.readFileSync(e.abs, "utf8");
    } catch {
      continue;
    }
    const chunks = chunkMarkdown(text, { maxChars }).map((c) => ({ ...c, chars: c.text.length }));
    files.push({ source: e.source, ...(e.sub ? { sub: e.sub } : {}), bytes: Buffer.byteLength(text), hash: hashOf(text), chunks });
  }
  const all = files.flatMap((f) => f.chunks);
  return {
    corpus: corpus.name,
    kind: corpus.kind || "permanent",
    ...(corpus.registry
      ? { registry: corpus.registry, root: `registry:${corpus.registry}`, glob: "(registry rows)" }
      : { root: corpus.root, glob: corpus.glob || "**/*.md" }),
    files,
    totals: {
      files: files.length,
      chunks: all.length,
      chars: all.reduce((a, c) => a + c.chars, 0),
      biggest: all.reduce((a, c) => Math.max(a, c.chars), 0),
      overMax: all.filter((c) => c.chars > maxChars).length,
      split: all.filter((c) => c.part).length,
      empty: files.filter((f) => !f.chunks.length).length,
    },
  };
}


// ---------------------------------------------------------------------------------------------
// RFC-058 §4 — INDEXING
// ---------------------------------------------------------------------------------------------

// A stable chunk id, so re-indexing REPLACES rather than duplicates. Without this every run leaves
// another copy of the same paragraph in the collection and retrieval quietly starts returning the
// same answer three times, each with a different `indexedAt`.
const chunkId = (corpus, source, n) => `${corpus}:${source}#${n}`;

// `vectors.records()` answers with an ENVELOPE — { collection, count, records } — not a bare list.
// One reader for it, because the smoke test's double returned a plain array and that difference
// stayed invisible until the first real index run died on "rows is not iterable".
const rowsOf = (r) => (Array.isArray(r) ? r : (r && r.records) || []);

// Re-index by FILE HASH. A corpus is mostly unchanged on any given run, and embedding is the only
// expensive part of this whole pipeline — so a file whose hash matches what is already stored costs
// zero embedding calls. The hash lives on every chunk (it is the FILE's hash, not the chunk's),
// which is also what makes staleness detectable later without re-reading anything.
function indexedState(collection) {
  const byFile = new Map();
  let rows = [];
  try {
    rows = rowsOf(vectors.records(collection));
  } catch {
    return byFile;
  }
  for (const r of rows) {
    const m = (r && r.meta) || {};
    if (!m.source) continue;
    if (!byFile.has(m.source)) byFile.set(m.source, { hash: m.hash, ids: [] });
    byFile.get(m.source).ids.push(r.id);
  }
  return byFile;
}

// CREATE-OR-REFRESH — RFC-058 §7. The working-corpus flow (write research to a file, embed it,
// query it without ever reading it whole) needs `index` to be able to bring a corpus into being,
// because there is no other create door: `corpora.json` is hand-written and the `+ corpus` form is
// a human surface. Shipped for a while with only the refresh half, which left the RFC's own
// four-line example dead on its second line.
//
// The shape arguments are the ENGINE's, not a permission model — the same call backs the human's
// form. Who may do what is decided at the agent-facing door (context.cjs): an agent picks either
// kind (`working` by default), and what the door still refuses is RESHAPING or dropping a corpus
// that is already permanent.
//
// `kind` is in the rewrite condition below on purpose: passing it alone, with no root or glob,
// changes an existing corpus's kind and keeps everything else. That is PROMOTION — finished
// research becoming documentation other agents can find — and it costs no embeddings, because the
// collection is named after the corpus, not after its kind.
async function index(name, { maxChars = MAX_CHARS, root, glob, exclude, kind, agents, registry, as } = {}) {
  let corpus = corpusNamed(name);

  if (!corpus || root || glob || exclude || kind || registry || agents !== undefined) {
    const nextKind = kind || (corpus && corpus.kind) || "working";
    // THE AUDIENCE, AND THE ONE CASE THAT IS NOT INHERITANCE: a corpus coming into being as
    // permanent, or being promoted into permanent, with nothing said about who it is for. That is
    // where the default lands on the MAKER — publishing to every agent is a decision, and the
    // absence of a word must not make it. Everywhere else the existing audience carries over, so
    // a plain refresh can never quietly re-publish something.
    const born = !corpus || (nextKind === "permanent" && (!corpus || corpus.kind !== "permanent"));
    const audience =
      agents !== undefined
        ? agents
        : corpus && corpus.agents !== undefined
          ? corpus.agents
          : born && nextKind === "permanent" && as
            ? [String(as)]
            : undefined;
    const fed = registry || (corpus && corpus.registry);
    const next = {
      name,
      kind: nextKind,
      ...(fed
        ? { registry: String(fed) }
        : {
            root: root ? path.resolve(root) : corpus && corpus.root,
            glob: glob || (corpus && corpus.glob) || "**/*.md",
            ...(exclude ? { exclude } : corpus && corpus.exclude ? { exclude: corpus.exclude } : {}),
          }),
      ...(audience !== undefined ? { agents: audience } : {}),
    };
    if (!next.registry && !next.root)
      throw new Error(`no corpus "${name}" — pass a root to create one (or a registry project), or add it to ${CONFIG}`);
    // A root that does not exist indexes zero files and reports success, which reads as "my research
    // is embedded" and answers nothing forever after. Fail where the typo is.
    if (next.root && !fs.existsSync(next.root)) throw new Error(`root does not exist: ${next.root}`);
    // Same failure, registry flavour: a project code the projects file does not know resolves every
    // row to "", walks zero files, and reports success. `absPathOf` is the resolver, so it is also
    // the probe — a project it cannot root is a project this corpus cannot read.
    if (next.registry && !registryMod().absPathOf({ project: next.registry, path: "probe.md" }))
      throw new Error(`unknown project "${next.registry}" — the projects file has no root for it`);
    saveCorpora(corpus ? corpora().map((c) => (c.name === name ? next : c)) : [...corpora(), next]);
    corpus = next;
  }

  const collection = collectionOf(corpus);
  const before = indexedState(collection);
  const present = new Set();

  let indexed = 0;
  let skipped = 0;
  let changed = 0;
  for (const e of entriesOf(corpus)) {
    const source = e.source;
    present.add(source);
    let text = "";
    try {
      text = fs.readFileSync(e.abs, "utf8");
    } catch {
      continue;
    }
    const hash = hashOf(text);
    const known = before.get(source);
    if (known && known.hash === hash) {
      skipped += known.ids.length;
      continue;
    }
    const chunks = chunkMarkdown(text, { maxChars });
    if (!chunks.length) {
      // A file that chunks to nothing but HAS an entry must lose it, or a doc emptied to a stub
      // keeps answering from the version that had content.
      if (known) await vectors.replaceWhere(collection, { source }, []);
      continue;
    }
    const docs = chunks.map((c, n) => ({
      id: chunkId(corpus.name, source, n),
      text: c.text,
      meta: {
        kind: "docchunk",
        corpus: corpus.name,
        corpusKind: corpus.kind || "permanent",
        source,
        // The file's SUBSCOPE, when the corpus assigns one — a registry row's document kind. Safe
        // under the hash-skip above: the kind is declared by a leaf IN the file, so a kind that
        // changes changes the hash too and the chunk is rewritten with its new sub.
        ...(e.sub ? { sub: e.sub } : {}),
        headingPath: c.headingPath,
        line: c.line,
        part: c.part || null,
        hash,
        indexedAt: new Date().toISOString(),
      },
    }));
    // replaceWhere, not upsert: a file that LOST a section leaves orphan chunks behind otherwise,
    // and an orphan chunk is the worst kind — it reads as current and describes something deleted.
    await vectors.replaceWhere(collection, { source }, docs);
    indexed += docs.length;
    if (known) changed += 1;
  }

  // A file that no longer exists takes its chunks with it.
  let removed = 0;
  for (const [source, known] of before) {
    if (present.has(source)) continue;
    await vectors.replaceWhere(collection, { source }, []);
    removed += known.ids.length;
  }

  return {
    corpus: corpus.name,
    kind: corpus.kind || "permanent",
    collection,
    files: present.size,
    indexed,
    changedFiles: changed,
    skipped,
    removed,
    at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// RFC-058 §5 — RETRIEVAL
// ---------------------------------------------------------------------------------------------

// Every result says WHERE it came from and AS OF WHEN, and whether the file has moved on since.
// Staleness that is visible is survivable; staleness that is silent is the whole reason RAG rots.
function staleness(corpus, source, hash) {
  try {
    const live = hashOf(fs.readFileSync(absOf(corpus, source), "utf8"));
    return live !== hash;
  } catch {
    return true; // the file is gone — the chunk is describing something that no longer exists
  }
}

// `corpus` and `source` are QUERY FILTERS, not separate servers. Narrowing to one document is
// `{ q, source: "research/vendor-api.md" }` — the compartmentalisation is a good filter, never a
// second system.
//
// With no corpus named, only PERMANENT corpora are searched, and only those this agent CARRIES
// (see the audience note above). A working corpus is an agent's own research dump and must not
// surface in someone else's question about the framework; a permanent corpus somebody else's
// expert carries is the same problem one layer up.
//
// THE UNCARRIED ONES ARE STILL SEARCHED, AND THAT IS DELIBERATE. They cost the same vectors query
// they cost today, and their hits come back as `withheld` — a count and the corpus names, never
// the text. Dropping them before the search would make the answer cheaper and the blindness
// permanent: an agent cannot name a corpus it has never heard of, and `corpus:` is the override
// that makes scoping safe.
// HOW A CORPUS IS NAMED: `name` (everything), `name:sub` (one subscope), or `name:a|b|c` — pipes,
// the system's list syntax everywhere. The first colon splits; everything after it is subscopes.
function parseCorpusRef(ref) {
  const s = String(ref == null ? "" : ref).trim();
  const i = s.indexOf(":");
  if (i < 0) return { name: s, subs: null };
  const subs = s
    .slice(i + 1)
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  return { name: s.slice(0, i), subs: subs.length ? subs : null };
}

async function search({ q, corpus, source, limit = 5, min = 0, as = null } = {}) {
  if (!q || !String(q).trim()) return { error: "a question is required" };
  const all = corpora();
  // One ref or several — a string is one, an array is a sweep. Each entry may carry subscopes.
  const refs = (corpus == null ? [] : Array.isArray(corpus) ? corpus : [corpus])
    .map(parseCorpusRef)
    .filter((r) => r.name);
  const named = refs.length > 0;
  const byName = new Map(refs.map((r) => [r.name, r]));
  const wanted = named
    ? all.filter((c) => byName.has(c.name))
    : all.filter((c) => (c.kind || "permanent") === "permanent");
  if (named && !wanted.length)
    return { error: `no corpus "${refs.map((r) => r.name).join('", "')}"`, corpora: all.map((c) => c.name) };
  // A name that resolves to nothing, beside names that do, is SAID — a typo that reads as an empty
  // corpus answers wrong forever.
  const unknown = refs.map((r) => r.name).filter((n) => !all.some((c) => c.name === n));

  // NAMING A CORPUS READS IT, WHATEVER THE AUDIENCE SAYS — one name or a list of them. "Go look
  // at X" must stay answerable, and a corpus carried by nobody exists precisely to be pointed at,
  // which includes being pointed at BESIDE others (the doc-registry design, 2026-11-06: scoped to
  // no one, named at the moment of need, cross-scope by adding names). The first cut held
  // uncarried names in a list back as `withheld`, and the pilot corpus was unreachable by the very
  // multi-search built for it. `withheld` remains the UNSCOPED search's honesty — named is read.
  const override = named;
  const mine = (c) => override || carries(c, as);
  const k = Math.max(1, Number(limit) || 5);
  const out = [];
  const held = new Map();
  for (const c of wanted) {
    const subs = named ? (byName.get(c.name) || {}).subs : null;
    const wantedSubs = subs ? subs.map(normSub) : null;
    let hits = [];
    try {
      hits = await vectors.search(collectionOf(c), String(q), {
        // A subscope filter discards hits AFTER ranking, so it fetches deeper to keep `limit` honest.
        k: wantedSubs ? k * 4 : k,
        min,
        ...(source ? { where: { source } } : {}),
      });
    } catch {
      continue; // a corpus that was never indexed is an empty answer, not a failure
    }
    for (const h of hits || []) {
      const m = (h && h.meta) || {};
      // The parent name alone includes every subscope; naming subscopes filters to exactly those.
      if (wantedSubs && !wantedSubs.includes(normSub(m.sub))) continue;
      if (!mine(c)) {
        const row = held.get(c.name) || { corpus: c.name, hits: 0, best: 0 };
        row.hits += 1;
        row.best = Math.max(row.best, Number(h.score) || 0);
        held.set(c.name, row);
        continue;
      }
      out.push({
        text: h.text,
        score: h.score,
        corpus: c.name,
        source: m.source,
        ...(m.sub ? { sub: m.sub } : {}),
        headingPath: m.headingPath || [],
        line: m.line,
        part: m.part || null,
        indexedAt: m.indexedAt,
        stale: staleness(c, m.source, m.hash),
      });
    }
  }
  // ONE RANKED LIST, however many corpora fed it — merged by score, exactly as a single corpus ranks.
  out.sort((a, b) => (b.score || 0) - (a.score || 0));
  const withheld = [...held.values()].sort((a, b) => b.best - a.best);
  return {
    q: String(q),
    searched: wanted.filter(mine).map((c) => c.name),
    results: out.slice(0, k),
    // Said, never silently dropped — this is the line that makes `corpus:` reachable.
    ...(withheld.length ? { withheld } : {}),
    ...(unknown.length ? { unknown } : {}),
  };
}

// Cheap because `corpus` is a first-class field from day one — miserable to add later.
async function drop(name) {
  const corpus = corpusNamed(name);
  if (!corpus) return { error: `no corpus "${name}"` };
  const collection = collectionOf(corpus);
  let n = 0;
  try {
    n = rowsOf(vectors.records(collection)).length;
  } catch {}
  await vectors.drop(collection);
  return { corpus: corpus.name, collection, dropped: n };
}

// What exists, what is indexed, and how much of it has drifted from disk.
function listCorpora() {
  return corpora().map((c) => {
    let rows = [];
    try {
      rows = rowsOf(vectors.records(collectionOf(c)));
    } catch {}
    const sources = new Set(rows.map((r) => (r.meta || {}).source).filter(Boolean));
    // MATCHED vs INDEXED. Reporting only what is embedded made a corpus he had just defined read
    // as `0 files · 0 chunks` — which looks like "there is nothing there" and means "you have not
    // pressed index yet". Those are different sentences and the surface has to say which.
    let matched = 0;
    try {
      matched = filesOf(c).length;
    } catch {}
    const stale = rows.filter((r) => {
      const m = r.meta || {};
      return m.source && staleness(c, m.source, m.hash);
    }).length;
    const last = rows.map((r) => (r.meta || {}).indexedAt).filter(Boolean).sort().pop() || null;
    return {
      name: c.name,
      kind: c.kind || "permanent",
      agents: audienceOf(c),
      ...(c.registry ? { registry: c.registry } : { root: c.root, glob: c.glob || "**/*.md" }),
      // his statement on how to read hits from this shelf — the panel edits it, retrieval prints it
      ...(c.treatment ? { treatment: c.treatment } : {}),
      matched,
      files: sources.size,
      chunks: rows.length,
      stale,
      lastIndexed: last,
    };
  });
}

module.exports = {
  chunkMarkdown,
  splitLong,
  corpora,
  saveCorpora,
  corpusNamed,
  treatmentOf,
  audienceOf,
  carries,
  collectionOf,
  filesOf,
  entriesOf,
  parseCorpusRef,
  normSub,
  globToRe,
  plan,
  index,
  search,
  drop,
  listCorpora,
  chunkId,
  hashOf,
  CONFIG,
  MAX_CHARS,
  MIN_CHARS,
};
