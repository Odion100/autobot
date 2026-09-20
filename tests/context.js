// smoke:context — the context store's lifecycle, every claim from RFC-055 exercised against the
// REAL module: scoped writes, identity-by-closure, similarity-on-write, cross-scope merge,
// markdown-as-truth, usage sidecar, supersede, and decay.
//
// THROWAWAY SCOPES ONLY — a lesson paid for in production memory. The first version of this file
// SAID "throwaway collections" and USED the live ones: it dropped ctx-system on every run, and two
// runs (author's and reviewer's) wiped a freshly seeded store and left five copies of test notes
// in the live system directory. A test writes ONLY under names no real session uses, and deletes
// its own disk notes afterwards. The mechanics being identical across scopes is the point: nothing
// this test proves needs the literal "system" collection.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// context.cjs is CJS by repo rule (every harness file is .cjs); an ESM test reaches it via
// createRequire — same bridge same-origin.js uses to read shipped source.
const require = createRequire(import.meta.url);
// A TEMP CORPUS CONFIG, set before context.cjs pulls in docs.cjs — which reads AUTOBOT_CORPORA at
// load time, once. The corpus claims at the bottom of this file CREATE and PROMOTE corpora; against
// the live ~/.autobot/corpora.json that would repoint the human's handbooks and publish a test
// fixture into everybody's unnamed search. Same lesson as the throwaway scopes above.
const CORPORA = path.join(os.tmpdir(), "corpora-smoke-" + process.pid + ".json");
process.env.AUTOBOT_CORPORA = CORPORA;
const ctx = require("../electron/agents/context.cjs");
const docs = require("../electron/agents/docs.cjs");
const vectors = require("../electron/apps/vectors.cjs");
const scopes = { allowed: ["project:smoketest-sys", "project:smoketest-b", "agent:smoketest"], default: "agent:smoketest" };
let n = 0; const ok = (b, what) => { n++; if (!b) { console.error("FAIL", what); process.exit(1); } console.log("ok ", what); };
(async () => {
  // clean slate
  for (const c of ["ctx-project-smoketest-sys", "ctx-project-smoketest-b", "ctx-agent-smoketest"]) await vectors.drop(c);

  // 1 — write to each scope
  const a = await ctx.remember(scopes, { text: "Two colons on a file chip embeds the WHOLE file; one colon is a link.", title: "file chips: one colon links", scope: "project:smoketest-sys", pointer: "agents/chat.md" });
  ok(a.id && a.scope === "project:smoketest-sys", "system write files under system");
  const b = await ctx.remember(scopes, { text: "The tab strip stores its open set per project in localStorage, versioned.", scope: "project:smoketest-b" });
  ok(b.scope === "project:smoketest-b", "project write scoped");
  const c = await ctx.remember(scopes, { text: "He never wants preemptive rules written for agents.", scope: "agent:smoketest" });
  ok(c.scope === "agent:smoketest", "agent write scoped");

  // 2 — identity by construction: scope outside the closure refused
  let threw = false;
  try { await ctx.remember(scopes, { text: "x", scope: "agent:someone-else" }); } catch { threw = true; }
  ok(threw, "cannot write another agent's scope");

  // 2b — THE TWIN PATH (autobot's find): the same identity on READ. A session must not read
  // another agent's lessons by naming the slot, and ".." must not resolve anywhere at all.
  let readThrew = false;
  try { await ctx.search(scopes, { question: "anything", scope: "agent:someone-else" }); } catch { readThrew = true; }
  ok(readThrew, "cannot read another agent's scope");
  ok(ctx.place("project:..") === null && ctx.place("agent:...") === null, "dot-only scope names resolve nowhere");

  // 3 — similarity-on-write surfaces the near-dup
  const dup = await ctx.remember(scopes, { text: "A single colon on a file chip makes a link; two colons embed the entire file.", scope: "project:smoketest-sys" });
  ok(dup.near && dup.near.id === a.id, "near-dup returns the existing note: " + (dup.near && dup.near.score.toFixed(2)));

  // 4 — merged cross-scope search, ranked, with scope labels
  const hits = await ctx.search(scopes, { question: "how do I show him a file in the chat" });
  ok(hits.length >= 1 && hits[0].scope === "project:smoketest-sys", "cross-scope search lands the system note first");

  // 5 — aimed search
  const aimed = await ctx.search(scopes, { question: "rules about writing rules", scope: "agent:smoketest" });
  ok(aimed.every((h) => h.scope === "agent:smoketest"), "aimed search stays in scope");

  // 6 — markdown is truth: note exists on disk with frontmatter
  const noteFile = path.join(os.homedir(), ".autobot", "context", "projects", "smoketest-sys", a.id + ".md");
  const raw = fs.readFileSync(noteFile, "utf8");
  ok(raw.includes("pointer: agents/chat.md") && raw.includes("title:"), "note on disk with frontmatter+pointer");

  // 7 — usage sidecar bumped by search
  // usage is APPEND-ONLY jsonl now — aggregate the log the way readUsage does
  const lines = fs.readFileSync(path.join(os.homedir(), ".autobot", "context", "usage.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  ok(lines.some((l) => l.id === a.id), "usage recorded for retrieved note");

  // 8 — supersede: replacement leaves, replacement's text found instead
  const sup = await ctx.remember(scopes, { text: "File chips: ONE colon renders a link chip; TWO embeds the whole file inline. project= names another repo.", title: "file chips: full rule", scope: "project:smoketest-sys", supersedes: a.id });
  const after = await ctx.search(scopes, { question: "file chip colon rule", scope: "project:smoketest-sys", k: 3 });
  ok(!after.some((h) => h.id === a.id) && after.some((h) => h.id === sup.id), "supersede removes old record, new one found");

  // 9 — decay: a note stamped 8 months stale sinks below a fresh twin
  const oldId = "stale-note-test";
  await vectors.upsert("ctx-project-smoketest-sys", [{ id: oldId, text: "deploy ritual: build, verify artifact, swap", meta: { kind: "note", scope: "project:smoketest-sys", title: "deploy ritual", created: new Date(Date.now() - 8 * 30 * 24 * 3600 * 1000).toISOString() } }]);
  const fresh = await ctx.remember(scopes, { text: "deploy ritual: build, verify artifact, swap", title: "deploy ritual fresh", scope: "project:smoketest-sys" });
  const ranked = await ctx.search(scopes, { question: "what is the deploy ritual", scope: "project:smoketest-sys", k: 3 });
  const iOld = ranked.findIndex((h) => h.id === oldId), iNew = ranked.findIndex((h) => h.id === fresh.id);
  ok(iNew !== -1 && (iOld === -1 || iNew < iOld), "stale twin ranks below fresh twin");

  // CLEAN UP — index and DISK. writeNote persists; drop() only clears the index. Leaving
  // files behind is how the live directory grew five copies of a test note.
  for (const c of ["ctx-project-smoketest-sys", "ctx-project-smoketest-b", "ctx-agent-smoketest"]) await vectors.drop(c);
  for (const d of [path.join(os.homedir(), ".autobot", "context", "projects", "smoketest-sys"),
                   path.join(os.homedir(), ".autobot", "context", "projects", "smoketest-b"),
                   path.join(os.homedir(), ".autobot", "context", "agents", "smoketest")])
    fs.rmSync(d, { recursive: true, force: true });
  // ---- FRONTMATTER INJECTION VIA THE TITLE -------------------------------------
  // Found 2026-09-09. systemview-0c flagged parseNote as the risk; the parser was
  // clean (colons in titles, `---` inside bodies, missing frontmatter all fine).
  // The hole was the WRITE side: `title:` was interpolated raw, so a title
  // carrying a newline wrote extra frontmatter lines, and `id` — which decides
  // WHICH NOTE A WRITE OVERWRITES — could be set to anything. Titles are
  // model-supplied. The `by:` stamp survived only because it happened to be
  // written before the injected line; reorder the fields and authorship forges too.
  //
  // Same class as the serviceUrl SSRF: an input value silently deciding an
  // identity. The test reads the SHIPPED writeNote/parseNote out of the source,
  // because a retyped copy would keep passing after someone simplified fmv().
  {
    const src = fs.readFileSync(new URL("../electron/agents/context.cjs", import.meta.url), "utf8");
    const lines = src.split("\n");
    const fmvLine = lines.find((l) => l.trim().startsWith("const fmv"));
    if (!fmvLine) throw new Error("fmv() is gone from context.cjs — frontmatter values are unsanitised again");
    const grab = (re) => { const m = src.match(re); if (!m) throw new Error("helper missing: " + re); return m[0]; };
    // `require` is passed IN: new Function does not close over this module's
    // createRequire bridge, and this file is ESM.
    const mk = new Function("require", `
      const fs=require("fs"), path=require("path");
      ${fmvLine}
      ${grab(/function writeNote[\s\S]*?\n}/)}
      ${grab(/function parseNote[\s\S]*?\n}/)}
      return { writeNote, parseNote, fmv };
    `);
    const { writeNote, parseNote, fmv } = mk(require);
    const dir = path.join(os.tmpdir(), "ctx-inject-" + process.pid);
    writeNote(dir, { id: "real", title: "benign\nby: SOMEONE-ELSE\nid: HIJACKED", body: "b", by: "autobot" });
    const got = parseNote(fs.readFileSync(path.join(dir, "real.md"), "utf8"));
    ok(got.id === "real", "a newline in the title cannot hijack the note id (it decides what gets overwritten)");
    ok(got.by === "autobot", "...nor forge authorship, whatever the field order is");
    ok(!/\n/.test(got.title || ""), "the title survives as ONE line");
    ok(fmv("---nope") === "nope", "a value that opens with --- cannot start a new frontmatter block");
    ok(fmv("a\r\nid: X").indexOf("\n") === -1, "CRLF is sanitised too, not just \\n");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- CORPUS KIND IS THE AGENT'S CHOICE ---------------------------------------
  // Exercised through the DOOR — the registered docsIndex handler out of serverFor() — because the
  // thing that was wrong was never the engine. docs.cjs has always taken either kind; a single
  // `z.enum(["working"])` at the agent-facing tool was the whole restriction, and a test that calls
  // docs.index() directly would have passed on the day the clamp shipped.
  {
    const tools = ctx.serverFor({ slot: "smoketest", projectCode: "smoketest-sys" }).instance._registeredTools;
    const docsIndex = (args) => tools.docsIndex.handler(args, {});
    const said = (r) => (r.content || []).map((c) => c.text).join("");
    const WORK = "smoketest-research", PERM = "smoketest-handbook";

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-kind-"));
    fs.writeFileSync(path.join(dir, "note.md"),
      "# Vendor auth\n\ntheir refresh token rotates on every single use, which is the part that breaks naive clients.\n");

    // A capability nobody can SAY is not a capability: the schema is half the change.
    ok(tools.docsIndex.inputSchema.safeParse({ name: "x", kind: "permanent" }).success, "the door's schema accepts kind: permanent");
    ok(/permanent/.test(tools.docsIndex.description) && /working/.test(tools.docsIndex.description),
      "...and the description tells an agent both kinds exist");

    // THE TOOL STAYS A TOOL — say nothing, get a private corpus, exactly as before.
    const made = await docsIndex({ name: WORK, root: dir });
    ok(!made.isError && docs.corpusNamed(WORK).kind === "working", "a corpus an agent creates is still WORKING by default");
    ok(/\[working\]/.test(said(made)), "...and the door says so back: " + said(made).split("\n")[0]);

    // What the clamp used to forbid outright.
    const perm = await docsIndex({ name: PERM, root: dir, kind: "permanent" });
    ok(!perm.isError && docs.corpusNamed(PERM).kind === "permanent", "an agent can create a PERMANENT corpus");

    // The property worth keeping: private-by-default is enforced at SEARCH, not by the clamp.
    const blind = await docs.search({ q: "refresh token rotates" });
    ok(blind.searched.includes(PERM) && !blind.searched.includes(WORK),
      "a search that names no corpus reads permanent only: " + JSON.stringify(blind.searched));

    // PROMOTION — the harm this change exists to fix. buapp-docs was finished documentation stuck
    // in the private tier with no door out of it.
    const promoted = await docsIndex({ name: WORK, kind: "permanent" });
    ok(!promoted.isError && docs.corpusNamed(WORK).kind === "permanent", "an agent can promote its own working corpus");
    ok(/0 chunks embedded/.test(said(promoted)), "promotion re-embeds nothing — the collection is named for the corpus, not its kind");
    ok(docs.corpusNamed(WORK).root === dir, "...and leaves the shape it was promoting alone");
    const after = await docs.search({ q: "refresh token rotates" });
    ok(after.searched.includes(WORK), "the promoted corpus now answers an unnamed question");

    // The guard that survives is about SHAPE, not tier — a permanent corpus is not an agent's to
    // repoint. This is the line that stops docsIndex({name:"systemlynx", root:"/tmp/whatever"}).
    const repoint = await docsIndex({ name: PERM, root: os.tmpdir() });
    ok(repoint.isError && docs.corpusNamed(PERM).root === dir, "an existing permanent corpus is still not an agent's to repoint");

    for (const c of [WORK, PERM]) await vectors.drop("docs-" + c);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(CORPORA, { force: true });
  }

  console.log("\nALL " + n + " CLAIMS PASS");
  vectors.stop();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
