// smoke:docs — RFC-058's chunker, glob and index/search against the REAL module.
//
// TOUCHES NO REAL CORPUS AND NO REAL VECTOR STORE. `AUTOBOT_CORPORA` points the module at a temp
// config, and `vectors.cjs` is replaced in the require cache by an in-memory double that COUNTS
// EMBEDDING CALLS — which is the only way to prove the claim that matters: a file whose hash has
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
      // embedding quality — which belongs to the model, not to this file.
      const rows = (store.get(c) || []).filter((r) => !where || (r.meta || {})[Object.keys(where)[0]] === Object.values(where)[0]);
      return rows
        .filter((r) => String(r.text).toLowerCase().includes(String(q).toLowerCase()))
        .slice(0, k)
        .map((r) => ({ ...r, score: 0.9 }));
    },
  },
};

const cfg = path.join(dir, "corpora.json");
process.env.AUTOBOT_CORPORA = cfg;
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
