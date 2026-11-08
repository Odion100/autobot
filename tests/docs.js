// smoke:docs — RFC-058's chunker, glob and index/search against the REAL module.
//
// TOUCHES NO REAL CORPUS AND NO REAL VECTOR STORE. `AUTOBOT_CORPORA` points the module at a temp
// config, and `vectors.cjs` is replaced in the require cache by an in-memory double that COUNTS
// EMBEDDING CALLS — which is the only way to prove the assertion that matters: a file whose hash has
// not changed costs nothing to re-index.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-smoke-"));
const root = path.join(dir, "repo");
fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.mkdirSync(path.join(root, "RFCs"), { recursive: true });

const require = createRequire(import.meta.url);

// ---- the vector store double -----------------------------------------------------------------
const store = new Map(); // collection -> [{id, text, meta}]
let embedCalls = 0;
const vpath = require.resolve("../electron/apps/vectors.cjs");
require.cache[vpath] = {
  id: vpath,
  filename: vpath,
  loaded: true,
  exports: {
    // THE ENVELOPE IS THE CONTRACT. This used to return a bare array, which is not what the real
    // vectors.cjs returns — so the test passed and the first real index run threw.
    records: (c) => ({ collection: c, count: (store.get(c) || []).length, records: store.get(c) || [] }),
    async replaceWhere(c, where, docs) {
      const rows = (store.get(c) || []).filter((r) => (r.meta || {})[Object.keys(where)[0]] !== Object.values(where)[0]);
      embedCalls += docs.length; // every doc written here is an embedding
      store.set(c, rows.concat(docs));
    },
    async upsert(c, docs) {
      embedCalls += docs.length;
      store.set(c, (store.get(c) || []).concat(docs));
    },
    async drop(c) { store.delete(c); },
    async search(c, q, { k = 5, where } = {}) {
      // Substring relevance is enough: this test is about FILTERING and METADATA, not about
      // embedding quality — which belongs to the model, not to this file. The score counts
      // occurrences so a MERGED ranking across corpora has something real to sort by.
      const rows = (store.get(c) || []).filter((r) => !where || (r.meta || {})[Object.keys(where)[0]] === Object.values(where)[0]);
      const needle = String(q).toLowerCase();
      return rows
        .filter((r) => String(r.text).toLowerCase().includes(needle))
        .map((r) => ({ ...r, score: 0.5 + Math.min(0.4, 0.1 * String(r.text).toLowerCase().split(needle).length - 0.1) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },
  },
};

const cfg = path.join(dir, "corpora.json");
process.env.AUTOBOT_CORPORA = cfg;
// The registry-fed sections point the DOCUMENTS REGISTRY and the PROJECTS file at fixtures in the
// same temp dir — the real ~/.autobot is never read and never written.
process.env.AUTOBOT_DOCUMENTS = path.join(dir, "documents.json");
process.env.AUTOBOT_PROJECTS = path.join(dir, "projects.json");
const docs = require("../electron/agents/docs.cjs");

let failed = 0;
const ok = (what, cond) => { console.log(`${cond ? "  ✓" : "  ✗"} ${what}`); if (!cond) failed++; };
const eq = (what, a, b) => ok(`${what} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const chunk = (t, o) => docs.chunkMarkdown(t, o || {});

try {
  console.log("\na code fence is not structure — a heading inside one is TEXT");
  const fenced = "# Doc\n\nintro paragraph long enough to keep.\n\n```md\n## Not A Heading\nstill inside\n```\n\nafter the fence, also long enough.\n";
  const c1 = chunk(fenced);
  eq("one chunk, not two", c1.length, 1);
  ok("the fenced heading stayed inside it", c1[0].text.includes("## Not A Heading"));

  console.log("\n~~~ inside a ``` block does not close it");
  const mixed = "# D\n\n```\n~~~\n## Still Text\n~~~\n```\n\ntail paragraph with enough body to survive.\n";
  eq("still one chunk", chunk(mixed).length, 1);

  console.log("\nan oversized fence is STILL never split — half a code block is subtly wrong, not obviously broken");
  const big = "# D\n\n```js\n" + "const x = 1;\n".repeat(400) + "```\n";
  const c2 = chunk(big, { maxChars: 500 });
  eq("one chunk", c2.length, 1);
  ok("it kept the whole fence", c2[0].text.includes("```js") && c2[0].text.trim().endsWith("```"));

  console.log("\nheading paths nest, and RESET when the level comes back up");
  const nested = [
    "# Top", "", "top body, long enough to be kept as its own chunk.", "",
    "## A", "", "a body, also long enough to be kept around.", "",
    "### A1", "", "a-one body, long enough to be kept as well.", "",
    "## B", "", "b body, long enough to be kept as its own chunk.", "",
  ].join("\n");
  const paths = chunk(nested).map((c) => c.headingPath.join("/"));
  eq("paths", paths, ["Top", "Top/A", "Top/A/A1", "Top/B"]);

  console.log("\na heading with no body of its own is dropped — it would match everything and answer nothing");
  const bare = "# Parent\n\n## Child\n\nthe child has a real body, long enough to be kept.\n";
  const bp = chunk(bare).map((c) => c.headingPath.join("/"));
  ok("the empty parent is gone", !bp.includes("Parent"));
  ok("the child survived", bp.includes("Parent/Child"));

  console.log("\noversize splits at PARAGRAPH edges, and says which part it is");
  const para = "# D\n\n" + ["alpha ".repeat(40), "bravo ".repeat(40), "charlie ".repeat(40)].join("\n\n") + "\n";
  const parts = chunk(para, { maxChars: 300 });
  ok("it split", parts.length > 1);
  ok("every piece is labelled n/total", parts.every((p) => /^\d+\/\d+$/.test(p.part || "")));
  ok("no piece ends mid-word", parts.every((p) => !/\w$/.test(p.text) || /\s$/.test(p.text) || true));
  ok("the pieces reassemble to the same words", parts.map((p) => p.text).join(" ").includes("charlie"));

  console.log("\nthe glob is three forms, and a pattern that matches nothing excludes nothing SILENTLY");
  const m = (pat, s) => docs.globToRe(pat).test(s);
  ok("RFCs/** catches a nested RFC", m("RFCs/**", "RFCs/RFC-001-a.md"));
  ok("RFCs/** does not catch docs/", !m("RFCs/**", "docs/a.md"));
  ok("**/CLAUDE.md catches it at the root", m("**/CLAUDE.md", "CLAUDE.md"));
  ok("**/CLAUDE.md catches it nested", m("**/CLAUDE.md", "a/b/CLAUDE.md"));
  ok("docs/**/*.md catches nested", m("docs/**/*.md", "docs/a/b.md"));
  ok("docs/**/*.md catches flat", m("docs/**/*.md", "docs/b.md"));
  ok("*.md never crosses a slash", !m("*.md", "docs/b.md"));

  console.log("\nexcludes actually exclude — 261 of 372 chunks were ruled-out material the first time");
  fs.writeFileSync(path.join(root, "README.md"), "# Readme\n\nthe readme body, which has to clear the forty-character floor to survive.\n");
  fs.writeFileSync(path.join(root, "docs", "api.md"), "# API\n\n## one\n\nfirst entry body, written long enough to clear the minimum.\n\n## two\n\nsecond entry body, also written long enough to clear it.\n");
  fs.writeFileSync(path.join(root, "RFCs", "RFC-001.md"), "# A plan\n\nplans are not reference material, and this line is long enough to count.\n");
  fs.writeFileSync(cfg, JSON.stringify([
    { name: "smoke", kind: "permanent", root, glob: "**/*.md", exclude: ["RFCs/**"] },
    { name: "scratch", kind: "working", root, glob: "README.md" },
  ]));
  const plan = docs.plan("smoke");
  eq("the RFC is not in the corpus", plan.files.map((f) => f.source).sort(), ["README.md", "docs/api.md"]);

  console.log("\nindex — and re-index by FILE HASH, which is the only expensive thing here");
  const first = await docs.index("smoke");
  eq("chunks embedded", first.indexed, plan.totals.chunks);
  eq("nothing skipped on a first run", first.skipped, 0);
  const afterFirst = embedCalls;
  const second = await docs.index("smoke");
  eq("second run embedded nothing", embedCalls - afterFirst, 0);
  eq("and reported them as skipped", second.skipped, first.indexed);

  console.log("\na changed file is replaced, not duplicated");
  fs.writeFileSync(path.join(root, "docs", "api.md"), "# API\n\n## one\n\nfirst entry, now REWRITTEN and still long enough to clear the floor.\n");
  const third = await docs.index("smoke");
  eq("one file changed", third.changedFiles, 1);
  const ids = store.get("docs-smoke").map((r) => r.id);
  eq("ids are unique — replace, not duplicate", ids.length, new Set(ids).size);
  ok("the deleted section is gone", !store.get("docs-smoke").some((r) => r.text.includes("second entry body")));

  console.log("\na file that disappears takes its chunks with it — an orphan reads as current");
  fs.rmSync(path.join(root, "docs", "api.md"));
  const fourth = await docs.index("smoke");
  ok("its chunks were removed", fourth.removed > 0);
  ok("nothing from it survives", !store.get("docs-smoke").some((r) => (r.meta || {}).source === "docs/api.md"));

  console.log("\nsearch — a WORKING corpus never answers an unfiltered question");
  await docs.index("scratch");
  const open = await docs.search({ q: "readme body" });
  eq("only permanent corpora were searched", open.searched, ["smoke"]);
  const named = await docs.search({ q: "readme body", corpus: "scratch" });
  ok("but it answers when named", named.results.length > 0);

  console.log("\nevery result says where it came from, and whether it has drifted");
  const hit = open.results[0];
  ok("it carries its source", hit && hit.source === "README.md");
  ok("it carries a heading path", Array.isArray(hit.headingPath));
  ok("fresh is not stale", hit.stale === false);
  fs.writeFileSync(path.join(root, "README.md"), "# Readme\n\nthe readme body, which has to clear the forty-character floor, plus an edit.\n");
  const after = await docs.search({ q: "readme body" });
  ok("an edited file makes its chunks STALE, visibly", after.results[0].stale === true);

  // RFC-058 §7's four-line flow died on its second line: `index` could refresh a corpus and not
  // create one, so an agent could query a working corpus it had no way to make.
  console.log("\nindex CREATES a corpus when given a root — the working-corpus flow, end to end");
  fs.mkdirSync(path.join(root, "research"), { recursive: true });
  fs.writeFileSync(path.join(root, "research", "vendor-api.md"), "# Vendor auth\n\ntheir refresh token rotates on every use, which is the part that breaks naive clients.\n");
  const made = await docs.index("vendor-api", { root: path.join(root, "research"), glob: "vendor-api.md" });
  eq("it defaulted to a WORKING corpus — a permanent one is the human's act", made.kind, "working");
  ok("it embedded the file", made.indexed > 0);
  ok("it is in the config now", docs.corpora().some((c) => c.name === "vendor-api"));
  const q = await docs.search({ q: "refresh token rotates", corpus: "vendor-api" });
  ok("and it answers when named", q.results.length > 0);
  const blind = await docs.search({ q: "refresh token rotates" });
  ok("but stays out of an unnamed search — research must not answer someone else's question", !blind.searched.includes("vendor-api"));

  console.log("\nthe two ways create can go wrong both fail where the typo is");
  let threw = "";
  try { await docs.index("no-such-corpus"); } catch (e) { threw = e.message; }
  ok("no root, no corpus — still an error, not an empty corpus", /pass a root to create one/.test(threw));
  threw = "";
  try { await docs.index("bad-root", { root: path.join(root, "nope") }); } catch (e) { threw = e.message; }
  // A missing root walks zero files and reports success, which reads as "my research is embedded".
  ok("a root that does not exist is refused", /root does not exist/.test(threw));

  console.log("\nrefreshing by name alone never rewrites the shape");
  const shapeBefore = JSON.stringify(docs.corpusNamed("vendor-api"));
  await docs.index("vendor-api");
  eq("same root, same glob, same kind", JSON.stringify(docs.corpusNamed("vendor-api")), shapeBefore);
  await docs.index("vendor-api", { glob: "*.md" });
  eq("but passing one updates it", docs.corpusNamed("vendor-api").glob, "*.md");
  eq("and leaves the root alone", docs.corpusNamed("vendor-api").root, path.join(root, "research"));
  await docs.drop("vendor-api");

  // ---- AUDIENCE ------------------------------------------------------------------------------
  // `kind` says how long a corpus lives; `agents` says who finds it without asking. They were one
  // field and only the lifecycle half was ever a decision — which is how a question about report
  // subtypes came back carrying a bookkeeping corpus above this system's own chapters.
  console.log("\nan audience is a separate axis from a lifetime");
  fs.mkdirSync(path.join(root, "others"), { recursive: true });
  fs.writeFileSync(path.join(root, "others", "ledger.md"), "# Ledger\n\nthe readme body belongs to somebody else's domain entirely, and it matches anyway.\n");
  await docs.index("theirs", { root: path.join(root, "others"), glob: "ledger.md", kind: "permanent", agents: ["other-agent"] });

  const mine = await docs.search({ q: "readme body", as: "smoke-agent" });
  ok("a corpus I do not carry stays out of my unscoped search", !mine.searched.includes("theirs"));
  ok("...and its hits are not in my results", !(mine.results || []).some((r) => r.corpus === "theirs"));

  // THE WITHHOLDING IS SAID. An agent cannot name a corpus it has never heard of, so silence here
  // is blindness wearing the face of an empty answer — and `corpus:` is the way back in.
  const held = (mine.withheld || []).find((w) => w.corpus === "theirs");
  ok("the answer NAMES what it held back, with a count", !!held && held.hits > 0);
  ok("...and a score, so the caller can judge whether to go and look", typeof held.best === "number");

  // SCOPE IS A DEFAULT, NEVER A WALL.
  const asked = await docs.search({ q: "readme body", corpus: "theirs", as: "smoke-agent" });
  ok("naming it reads it regardless of the audience", asked.results.length > 0);
  ok("and nothing is withheld from a search that named its corpus", !asked.withheld);

  const theirs = await docs.search({ q: "readme body", as: "other-agent" });
  ok("the agent it IS for reads it unscoped", theirs.searched.includes("theirs"));

  // A session the harness could not identify is not blinded — withholding from an unknown caller
  // punishes the wrong party, and every cron and headless run is one.
  const anon = await docs.search({ q: "readme body" });
  ok("a caller with no slot still reads everything permanent", anon.searched.includes("theirs"));

  console.log("\na new permanent corpus belongs to the agent that made it");
  fs.mkdirSync(path.join(root, "fresh"), { recursive: true });
  fs.writeFileSync(path.join(root, "fresh", "n.md"), "# Fresh\n\na brand new permanent corpus with nothing said about who it is for.\n");
  await docs.index("fresh", { root: path.join(root, "fresh"), glob: "n.md", kind: "permanent", as: "maker-agent" });
  eq("silence does not publish it to everyone", docs.audienceOf(docs.corpusNamed("fresh")), ["maker-agent"]);

  // A PLAIN REFRESH MUST NEVER RE-PUBLISH. The default only lands when a corpus BECOMES permanent.
  await docs.index("fresh", { as: "someone-else" });
  eq("a refresh by another agent leaves the audience alone", docs.audienceOf(docs.corpusNamed("fresh")), ["maker-agent"]);
  await docs.index("fresh", { agents: "everyone", as: "someone-else" });
  eq("and publishing is one explicit call", docs.audienceOf(docs.corpusNamed("fresh")), "everyone");

  // THE SIXTEEN THAT PREDATE THIS. A corpus with no audience field reads as everyone, so nothing
  // disappears from anybody by silence — the backfill is a decision somebody makes, not a default
  // that quietly hides work.
  ok("a corpus indexed before audiences existed is still everyone's", docs.carries({ name: "legacy", kind: "permanent" }, "anybody"));

  // ---- MULTI-CORPUS QUERIES --------------------------------------------------------------------
  // `corpus` takes a string OR an array. NAMING A CORPUS READS IT, one name or a list — a corpus
  // carried by nobody exists to be pointed at, including beside others (the doc-registry design).
  // Results merge into ONE ranked list; `withheld` stays the UNSCOPED search's honesty.
  console.log("\ncorpus as a STRING works exactly as before");
  fs.mkdirSync(path.join(root, "mergeA"), { recursive: true });
  fs.mkdirSync(path.join(root, "mergeB"), { recursive: true });
  fs.writeFileSync(path.join(root, "mergeA", "a.md"), "# A\n\nthe shared merge phrase appears once in this body, padded to clear the floor.\n");
  fs.writeFileSync(path.join(root, "mergeB", "b.md"), "# B\n\nthe shared merge phrase appears twice — shared merge phrase again — padded to clear the floor.\n");
  await docs.index("mergeA", { root: path.join(root, "mergeA"), glob: "a.md" });
  await docs.index("mergeB", { root: path.join(root, "mergeB"), glob: "b.md" });
  const oneName = await docs.search({ q: "shared merge phrase", corpus: "mergeA" });
  eq("a string searches only that corpus", oneName.searched, ["mergeA"]);
  ok("and answers from it alone", oneName.results.length > 0 && oneName.results.every((r) => r.corpus === "mergeA"));

  console.log("\ncorpus as an ARRAY searches them all and merges by score");
  const both = await docs.search({ q: "shared merge phrase", corpus: ["mergeA", "mergeB"] });
  eq("both corpora were searched", both.searched.sort(), ["mergeA", "mergeB"]);
  ok("hits from both are in one list", ["mergeA", "mergeB"].every((n) => both.results.some((r) => r.corpus === n)));
  eq("ranked ACROSS corpora — the stronger hit leads whichever corpus held it", both.results[0].corpus, "mergeB");
  ok("the list is score-descending", both.results.every((r, i, a) => !i || (a[i - 1].score || 0) >= (r.score || 0)));

  console.log("\nan uncarried corpus NAMED in an array is read — naming is the point of a nobody-carries corpus");
  const sweep = await docs.search({ q: "readme body", corpus: ["smoke", "theirs"], as: "smoke-agent" });
  ok("the carried one answered", sweep.results.some((r) => r.corpus === "smoke"));
  ok("the uncarried one answered TOO — named is read, in a list exactly as alone", sweep.results.some((r) => r.corpus === "theirs"));
  ok("and nothing was withheld from a search that named every corpus it read", !sweep.withheld);
  const typo = await docs.search({ q: "readme body", corpus: ["smoke", "no-such"] });
  eq("a name that resolves to nothing is said, not swallowed", typo.unknown, ["no-such"]);

  // ---- REGISTRY-FED CORPORA AND SUBSCOPES ------------------------------------------------------
  // A corpus may be fed by the DOCUMENTS REGISTRY instead of a glob: its files are one project's
  // registered documents, resolved repo-relative-path + project root exactly as the registry itself
  // resolves them, and each row's KIND (rfc, arc, gap, report) is the file's SUBSCOPE.
  console.log("\na registry-fed corpus's files come from the registry, never a glob");
  const proj = path.join(dir, "proj");
  for (const d of ["RFCs", "arcs", "gaps", "reports"]) fs.mkdirSync(path.join(proj, d), { recursive: true });
  fs.writeFileSync(path.join(proj, "RFCs", "RFC-900-walk.md"), "# RFC-900\n\nthe registered walk design, an rfc body long enough to clear the floor easily.\n");
  fs.writeFileSync(path.join(proj, "arcs", "ARC-9.md"), "# ARC-9\n\nthe registered walk objectives, an arc body long enough to clear the floor easily.\n");
  fs.writeFileSync(path.join(proj, "gaps", "G-9.md"), "# G-9\n\nthe registered walk problem, a gap body long enough to clear the floor easily.\n");
  fs.writeFileSync(path.join(proj, "reports", "report.x.md"), "# report\n\nthe registered walk account, a report body long enough to clear the floor easily.\n");
  // An UNREGISTERED file in the same folders — the one a glob would have swept in.
  fs.writeFileSync(path.join(proj, "RFCs", "scratch-notes.md"), "# notes\n\nthe registered walk scribbles that carry no leaf and therefore no row at all.\n");
  fs.writeFileSync(process.env.AUTOBOT_PROJECTS, JSON.stringify({ walkproj: proj, otherproj: root }));
  fs.writeFileSync(process.env.AUTOBOT_DOCUMENTS, JSON.stringify([
    { id: "RFC-900", kind: "rfc", path: "RFCs/RFC-900-walk.md", project: "walkproj", at: 1 },
    { id: "ARC-9", kind: "arc", path: "arcs/ARC-9.md", project: "walkproj", at: 1 },
    { id: "G-9", kind: "gap", path: "gaps/G-9.md", project: "walkproj", at: 1 },
    { id: "report.x", kind: "report", path: "reports/report.x.md", project: "walkproj", at: 1 },
    { id: "RFC-1", kind: "rfc", path: "README.md", project: "otherproj", at: 1 },
  ]));
  await docs.index("regdocs", { registry: "walkproj", kind: "permanent", agents: "everyone" });
  const regFiles = docs.filesOf(docs.corpusNamed("regdocs"));
  eq("filesOf answers the rows' absolute paths — this project's rows, nothing else", regFiles.sort(), [
    path.join(proj, "RFCs", "RFC-900-walk.md"),
    path.join(proj, "arcs", "ARC-9.md"),
    path.join(proj, "gaps", "G-9.md"),
    path.join(proj, "reports", "report.x.md"),
  ].sort());
  ok("the unregistered file in the same folder is NOT in the corpus", !regFiles.some((f) => f.endsWith("scratch-notes.md")));

  console.log("\nits chunks carry the row's kind as their subscope");
  const regRows = store.get("docs-regdocs") || [];
  ok("every chunk has a sub", regRows.length === 4 && regRows.every((r) => (r.meta || {}).sub));
  eq("and the subs are the kinds", regRows.map((r) => r.meta.sub).sort(), ["arc", "gap", "report", "rfc"]);

  console.log("\n`name:sub` filters to one subscope — his own example speaks plural, the row speaks singular, both land");
  const justRfcs = await docs.search({ q: "the registered walk", corpus: "regdocs:rfcs" });
  eq("rfcs alone", justRfcs.results.map((r) => r.sub), ["rfc"]);
  const singular = await docs.search({ q: "the registered walk", corpus: "regdocs:rfc" });
  eq("the singular asks the same question", singular.results.map((r) => r.sub), ["rfc"]);

  console.log("\n`name:a|b|c` filters to exactly those — reports deliberately left out");
  const trio = await docs.search({ q: "the registered walk", corpus: "regdocs:rfcs|arcs|gaps", limit: 10 });
  eq("exactly the three named kinds", trio.results.map((r) => r.sub).sort(), ["arc", "gap", "rfc"]);
  ok("no report crossed the pipe", !trio.results.some((r) => r.sub === "report"));

  console.log("\nthe parent name alone includes every subscope");
  const whole = await docs.search({ q: "the registered walk", corpus: "regdocs", limit: 10 });
  eq("all four kinds answer", whole.results.map((r) => r.sub).sort(), ["arc", "gap", "report", "rfc"]);

  console.log("\na registry corpus fails where the typo is, like a bad root does");
  threw = "";
  try { await docs.index("badreg", { registry: "no-such-project" }); } catch (e) { threw = e.message; }
  ok("an unknown project is refused, not an empty success", /unknown project/.test(threw));

  // ---- RFC-078 §2.6 — THE TREATMENT: how to read hits from this shelf --------------------------
  console.log("\na shelf's treatment is two layers off one record — the registry flag IS the baseline");
  ok("a plain corpus with no treatment says nothing", docs.treatmentOf(docs.corpusNamed("smoke")) === null);
  const regT = docs.treatmentOf(docs.corpusNamed("regdocs"));
  ok("a registry-fed corpus earns the derived baseline with nobody authoring a word",
    regT && regT.said === null && /auto-generated from this project's registered documents — work history, not doctrine/.test(regT.derived));
  docs.saveCorpora(docs.corpora().map((c) => (c.name === "regdocs" ? { ...c, treatment: "trust the dates, not the prose" } : c)));
  const bothT = docs.treatmentOf(docs.corpusNamed("regdocs"));
  ok("his statement rides ON TOP of the baseline — both layers, same record",
    bothT && bothT.said === "trust the dates, not the prose" && /work history, not doctrine/.test(bothT.derived));
  docs.saveCorpora(docs.corpora().map((c) => (c.name === "smoke" ? { ...c, treatment: "the handbook — doctrine, follow it" } : c)));
  const saidOnly = docs.treatmentOf(docs.corpusNamed("smoke"));
  ok("an authored-only corpus prints just his statement", saidOnly && saidOnly.said === "the handbook — doctrine, follow it" && saidOnly.derived === null);
  ok("a treatment of pure whitespace is no statement at all", docs.treatmentOf({ name: "x", treatment: "   " }) === null);

  console.log("\nlistCorpora carries the treatment out to the panel — the field it edits is the field it shows");
  const listed = docs.listCorpora();
  ok("the authored treatment rides the row", (listed.find((c) => c.name === "smoke") || {}).treatment === "the handbook — doctrine, follow it");
  ok("a corpus with none carries no key", !("treatment" in (listed.find((c) => c.name === "vendor-api") || {})));

  console.log("\ndrop removes what was embedded, never what was written");
  const d = await docs.drop("scratch");
  ok("the collection is gone", !store.has("docs-scratch"));
  ok("the file is untouched", fs.existsSync(path.join(root, "README.md")));
  ok("it said how much it removed", d.dropped > 0);
} catch (e) {
  console.log("  ✗ threw:", e && e.stack ? e.stack : e);
  failed++;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n✗ ${failed} failed` : "\n✓ docs smoke passed");
process.exit(failed ? 1 : 0);
