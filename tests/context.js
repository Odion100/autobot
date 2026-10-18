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
// A SCRATCH ~/.autobot FOR JOBS.CJS ONLY, pinned before anything loads it. jobs.cjs resolves its
// DIR from os.homedir() at module load, once — so the job claims at the bottom of this file would
// otherwise create and delete fixtures in his REAL ~/.autobot/jobs. Same lesson as the throwaway
// scopes above, and the same technique tests/agent-definitions.js uses.
//
// ONLY jobs.cjs IS PINNED. Its three dependencies are required first, against the real homedir, so
// the definitions/hooks/worklist the rest of this file exercises keep pointing where they always
// did; by the time jobs.cjs loads they are already in require.cache and the override cannot reach
// them. The override is then put back immediately, so nothing else in the process ever sees it.
require("../electron/agents/definitions.cjs");
require("../electron/agents/hooks.cjs");
require("../electron/agents/worklist.cjs");
const JOBS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "jobs-smoke-"));
const realHomedir = os.homedir;
os.homedir = () => JOBS_HOME;
const jobsMod = require("../electron/agents/jobs.cjs");
os.homedir = realHomedir;
if (!jobsMod.DIR.startsWith(JOBS_HOME)) {
  // LOUD, and before a single write: if the pin failed, the job claims below would be running
  // against the live store. This file has wiped his real context twice; it does not get a third.
  console.error("FAIL jobs.cjs is pointing at " + jobsMod.DIR + " — the scratch home did not take");
  process.exit(1);
}

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

  // ── RFC-013 — CONTEXT SUBSCRIPTIONS ─────────────────────────────────────────────────────
  // The reader subscribes; content is never touched. Subscriptions live in the agent's DEF —
  // so these claims create a throwaway agent definition and delete it after.
  {
    const defs = require("../electron/agents/definitions.cjs");
    const sessions = require("../electron/agents/sessions.cjs");
    const AG = "agent:smoketest";
    const subScopes = { ...scopes, slot: "smoketest", by: "smoketest" };
    defs.save({ id: "smoketest", name: "smoketest", description: "throwaway for context smoke" });

    const noteA = await ctx.remember(subScopes, { text: "After a compaction, verify against real state before acting.", scope: AG, title: "verify after boundary" });
    const noteB = await ctx.remember(subScopes, { text: "turn note one", scope: AG });
    const noteC = await ctx.remember(subScopes, { text: "turn note two", scope: AG });

    // gates at the door
    let bad = false;
    try { ctx.subscribe(subScopes, { what: `note:${noteA.id}@${AG}`, when: "sometimes" }); } catch (e) { bad = /unknown moment/.test(e.message); }
    ok(bad, "a bad moment refuses at the door");
    let badTtl = false;
    try { ctx.subscribe(subScopes, { what: `note:${noteA.id}@${AG}`, when: "post-compaction", until: { ttl: "forever" } }); } catch (e) { badTtl = /ttl reads like/.test(e.message); }
    ok(badTtl, "a bad clock refuses at the door");
    let noSlot = false;
    try { ctx.subscribe({ ...scopes, slot: null }, { what: `note:${noteA.id}@${AG}`, when: "post-compaction" }); } catch (e) { noSlot = /no agent slot/.test(e.message); }
    ok(noSlot, "a session without an agent slot cannot subscribe");
    let ghost = false;
    try { ctx.subscribe(subScopes, { what: `note:not-a-real-note@${AG}`, when: "post-compaction" }); } catch (e) { ghost = /must exist/.test(e.message); }
    ok(ghost, "subscribing to a target that does not exist refuses");
    let big = false;
    const noteBig = await ctx.remember(subScopes, { text: "y".repeat(800), scope: AG });
    try { ctx.subscribe(subScopes, { what: `note:${noteBig.id}@${AG}`, when: "post-compaction" }); } catch (e) { big = /capped at 700/.test(e.message); }
    ok(big, "an over-sized target refuses and names the cap");

    // a real subscription: multi-moment, content untouched
    const s1 = ctx.subscribe(subScopes, { what: `note:${noteA.id}@${AG}`, when: ["post-compaction", "session-start"], until: { ttl: "2d" } });
    ok(s1.when.length === 2 && s1.until.untilTs > Date.now(), "one subscription, two moments, clock gate");
    const rawA = fs.readFileSync(path.join(ctx.place(AG).dir, noteA.id + ".md"), "utf8");
    ok(!/inject/.test(rawA), "the note file is UNTOUCHED — the preference lives with the subscriber");

    // delivery at both subscribed moments, silence at the third
    ok(/verify against real state/.test(ctx.injectedFor({ slot: "smoketest" }, "post-compaction")), "delivers at post-compaction");
    ok(/verify against real state/.test(ctx.injectedFor({ slot: "smoketest" }, "session-start")), "delivers at session-start");
    ok(ctx.injectedFor({ slot: "smoketest" }, "every-turn") === "", "silent at the unsubscribed moment");

    // caps per shelf, refusal names the unsubscribe verb's targets
    ctx.subscribe(subScopes, { what: `note:${noteB.id}@${AG}`, when: "every-turn" });
    ctx.subscribe(subScopes, { what: `note:${noteC.id}@${AG}`, when: "every-turn" });
    let full = null;
    const noteD = await ctx.remember(subScopes, { text: "turn note three", scope: AG });
    try { ctx.subscribe(subScopes, { what: `note:${noteD.id}@${AG}`, when: "every-turn" }); } catch (e) { full = e.message; }
    ok(full && /every-turn shelf is full/.test(full) && full.includes(noteB.id), "a full shelf refuses and names the holders");

    // ── HIS BOARD IS A SUBSCRIBABLE TARGET (2026-10-14) ──────────────────────────────────────
    // 32KB of notes written FOR agents was the one context layer that could only be fetched,
    // never delivered. board:<pc> resolves live at every delivery, scope-gated like a note.
    {
      const dirBase = fs.mkdtempSync(path.join(os.tmpdir(), "board-sub-"));
      const bdir = path.join(dirBase, "board-proj", ".systemview", "boards");
      fs.mkdirSync(bdir, { recursive: true });
      fs.writeFileSync(
        path.join(bdir, "board.md"),
        "<!--card 200 by=systemview-test-->\nnewest: the strip nests lanes now\n<!--reply by=you ts=201-->\nlove it\n\n<!--card 100-->\noldest: fix the thing\n",
      );
      fs.writeFileSync(path.join(dirBase, "projects.json"), JSON.stringify({ "smoketest-sys": path.join(dirBase, "board-proj") }));
      process.env.AUTOBOT_PROJECTS_FILE = path.join(dirBase, "projects.json");

      const sb = ctx.subscribe(subScopes, { what: "board:smoketest-sys", when: "session-start", until: { ttl: "2d" } });
      ok(/2 open/.test(sb.title), "subscribing to a board resolves it — the title carries the live count");

      const delivered = ctx.injectedFor({ slot: "smoketest", projectCode: "smoketest-sys" }, "session-start");
      ok(/newest: the strip nests lanes/.test(delivered) && /↳ love it/.test(delivered), "the board DELIVERS — newest card first, replies as lines, no comment markers leaked");
      ok(!/<!--/.test(delivered), "...really no markers");

      let denied = false;
      try { ctx.subscribe(subScopes, { what: "board:someone-elses", when: "session-start" }); } catch (e) { denied = /not readable/.test(e.message); }
      ok(denied, "a board outside the session's scopes is DENIED like a note, not resolved");

      let ghostProj = false;
      try { ctx.subscribe(subScopes, { what: "board:smoketest-b", when: "session-start" }); } catch (e) { ghostProj = /must exist/.test(e.message); }
      ok(ghostProj, "a readable scope whose project has no registered root refuses — an unknown project is gone-for-good");

      // THE DIVERGENCE WITH TEETH: an emptied board keeps its subscription. A corpus heading that
      // vanishes is gone for good; a board empties and refills as part of its normal life — an
      // emptied board even deletes its own file — so target-gone semantics would kill the shelf
      // on the first clean sweep.
      fs.rmSync(path.join(bdir, "board.md"));
      const emptied = ctx.injectedFor({ slot: "smoketest", projectCode: "smoketest-sys" }, "session-start");
      ok(/nothing on the board right now/.test(emptied), "an emptied board delivers its emptiness instead of dying");
      ok(require("../electron/agents/definitions.cjs").subscriptionsOf("smoketest").some((r) => r.what === "board:smoketest-sys"), "...and the subscription SURVIVES the sweep");

      // a board bigger than the shelf self-caps and says what it left out
      const big = Array.from({ length: 12 }, (_, i) => `<!--card ${900 - i}-->\ncard ${i}: ${"x".repeat(90)}`).join("\n");
      fs.writeFileSync(path.join(bdir, "board.md"), big);
      const capped = ctx.injectedFor({ slot: "smoketest", projectCode: "smoketest-sys" }, "session-start");
      const bodyOnly = capped.split("\n").filter((l) => /card \d|more —/.test(l)).join("\n");
      ok(bodyOnly.length <= 700 + 80 && /more — board\(/.test(capped), "a board bigger than the shelf self-caps, newest-first, and counts what it left out");

      ctx.unsubscribe(subScopes, { what: "board:smoketest-sys" });
      delete process.env.AUTOBOT_PROJECTS_FILE;
      fs.rmSync(dirBase, { recursive: true, force: true });
    }

    // sessions seams still ride injectedFor
    const c1 = sessions.sendContent({ slot: "smoketest" }, "what changed?");
    ok(c1.length === 2 && /<injected-context moment="every-turn">/.test(c1[0].text) && c1[1].text === "what changed?",
      "every-turn rides as a leading block, his words last");
    ok(/session-start/.test(sessions.startInjection({ id: "smoketest", projectCode: null })), "session-start joins the composition");
    const pc = sessions.postCompactionInjection({ slot: "smoketest" });
    ok(pc && pc.type === "user" && /verify against real state/.test(pc.message.content[0].text), "post-compaction queues a turn");

    // turns countdown: 1 delivery then dead AND DELETED
    const noteT = await ctx.remember(subScopes, { text: "three turns only", scope: AG });
    ctx.subscribe(subScopes, { what: `note:${noteT.id}@${AG}`, when: "post-compaction", until: { turns: 1 } });
    ok(/three turns only/.test(ctx.injectedFor({ slot: "smoketest" }, "post-compaction")), "count-gated delivery happens");
    const after = ctx.injectedFor({ slot: "smoketest" }, "post-compaction");
    ok(!/three turns only/.test(after), "the count spends and delivery stops");
    ok(!defs.subscriptionsOf("smoketest").some((r) => r.what.includes(noteT.id)), "a spent subscription is DELETED from the def — nothing accumulates");

    // clock death deletes
    ctx.subscribe(subScopes, { what: `note:${noteD.id}@${AG}`, when: "post-compaction", until: { ttl: "12h" } });
    const subsNow = defs.subscriptionsOf("smoketest").map((r) => (r.what.includes(noteD.id) ? { ...r, until: { untilTs: Date.now() - 1000 } } : r));
    defs.saveSubscriptions("smoketest", subsNow);
    ctx.injectedFor({ slot: "smoketest" }, "post-compaction");
    ok(!defs.subscriptionsOf("smoketest").some((r) => r.what.includes(noteD.id)), "an expired subscription is DELETED at the first read that finds it dead");

    // run-condition: cleared by a CLOSED run record, then deleted
    const wlDir = path.join(os.homedir(), ".autobot", "worklists");
    const runFile = path.join(wlDir, "run-smoketest-cond.json");
    ctx.subscribe(subScopes, { what: `note:${noteB.id}@${AG}`, when: "post-compaction", until: { run: "skill:smoketest-proc" } });
    ok(/turn note one/.test(ctx.injectedFor({ slot: "smoketest" }, "post-compaction")), "condition-gated delivers while the run is open");
    fs.mkdirSync(wlDir, { recursive: true });
    fs.writeFileSync(runFile, JSON.stringify({ source: "skill:smoketest-proc", updatedAt: Date.now() + 1000, items: [{ text: "x", state: "done" }] }));
    ok(!/turn note one/.test(ctx.injectedFor({ slot: "smoketest" }, "post-compaction")), "the record clearing the condition ends delivery — never the agent's word");
    ok(!defs.subscriptionsOf("smoketest").some((r) => r.until && r.until.run), "a cleared condition-subscription is deleted");
    fs.rmSync(runFile, { force: true });

    // target gone = dies loudly (deleted), other deliveries unaffected
    ctx.subscribe(subScopes, { what: `note:${noteC.id}@${AG}`, when: "post-compaction" });
    await ctx.deleteNote(AG, noteC.id);
    ctx.injectedFor({ slot: "smoketest" }, "post-compaction");
    ctx.injectedFor({ slot: "smoketest" }, "every-turn"); // noteC's cap-test row dies at ITS moment — death is lazy per moment
    ok(!defs.subscriptionsOf("smoketest").some((r) => r.what.includes(noteC.id)), "a subscription whose target vanished is deleted, not silently stale");

    // the regression he caught live: a subscribe must NOT touch the def file — the composition
    // fingerprint stats its mtime, so a def write per subscribe rang "re-init me" every time.
    const defFile = path.join(defs.DIR, "smoketest.json");
    const mtBefore = fs.statSync(defFile).mtimeMs;
    const noteS = await ctx.remember(subScopes, { text: "sidecar check", scope: AG });
    ctx.subscribe(subScopes, { what: `note:${noteS.id}@${AG}`, when: "post-compaction" });
    ok(fs.statSync(defFile).mtimeMs === mtBefore, "subscribing never touches the def file — no composition bell");
    ok(fs.existsSync(path.join(defs.DIR, "smoketest.subs.json")), "the rows live in the sidecar, same owner");
    ok(defs.get("smoketest").def.subscriptions.some((r) => r.what.includes(noteS.id)), "get() hydrates the sidecar — readers see one record");

    // unsubscribe is the named verb
    const u = ctx.unsubscribe(subScopes, { what: `note:${noteB.id}@${AG}` });
    ok(typeof u.left === "number", "unsubscribe ends a preference by name");

    // ---- THE DECISION IS A PARAMETER ON `remember` (2026-10-04, his call) --------------------
    // Through the REAL TOOL HANDLER, not the module function underneath: everything claimed here
    // lives at the tool layer — that the parameter is required, that it subscribes without an id,
    // that a refused shelf still keeps the note. A test that went around the tool would prove none
    // of it, which is the `markBroughtIn` lesson.
    {
      const tools = ctx.toolsFor({ slot: "smoketest", projectCode: "smoketest-sys" });
      const rem = tools.find((t) => t.name === "remember");
      ok(!!rem && rem.inputSchema.subscribe && !rem.inputSchema.subscribe.isOptional(),
        "`subscribe` is a REQUIRED parameter on remember — no default answers for the agent");

      // "no" is a real answer, and the common one
      const r1 = await rem.handler({ text: "findable only, no shelf", scope: AG, subscribe: "no" }, {});
      const id1 = /Remembered as (\S+) in/.exec(r1.content[0].text)[1];
      ok(!/Subscribed/.test(r1.content[0].text), "\"no\" writes the note and sets no shelf");
      ok(!defs.subscriptionsOf("smoketest").some((x) => x.what.includes(id1)), "and nothing landed in the def");

      // the object subscribes the note THIS call wrote — no id round-trip
      const r2 = await rem.handler(
        { text: "verify the tree before believing a summary", scope: AG, subscribe: { when: "post-compaction", until: { ttl: "2d" } } },
        {}
      );
      const id2 = /Remembered as (\S+) in/.exec(r2.content[0].text)[1];
      ok(/Subscribed at post-compaction/.test(r2.content[0].text), "the reply says the shelf was set, and at which moment");
      ok(defs.subscriptionsOf("smoketest").some((x) => x.what === `note:${id2}@${AG}`),
        "one call wrote the note AND subscribed it — the id never left the handler");
      ok(/verify the tree/.test(ctx.injectedFor({ slot: "smoketest" }, "post-compaction")),
        "and it actually delivers at that moment");

      // editing by id can subscribe too — same door, which is why correcting a note can also shelf it
      const r3 = await rem.handler({ id: id1, text: "findable only — corrected", scope: AG, subscribe: { when: "session-start" } }, {});
      ok(/Updated/.test(r3.content[0].text) && /Subscribed at session-start/.test(r3.content[0].text),
        "the id-edit path subscribes as well — one door for write and correct");

      // A REFUSED SHELF MUST NOT LOSE THE NOTE. The 700-char cap is a legitimate refusal; the write
      // already succeeded, so silence here would mean an agent believing it filed nothing.
      const r4 = await rem.handler({ text: "z".repeat(800), scope: AG, subscribe: { when: "post-compaction" } }, {});
      ok(/Remembered as/.test(r4.content[0].text) && /NOT subscribed/.test(r4.content[0].text),
        "a refused subscription keeps the note and says so out loud — never swallowed");
      const id4 = /Remembered as (\S+) in/.exec(r4.content[0].text)[1];
      ok(!defs.subscriptionsOf("smoketest").some((x) => x.what.includes(id4)), "and no half-row was left behind");
    }

    // cleanup: throwaway def, notes, sidecar keys
    defs.remove("smoketest");
    ok(!fs.existsSync(path.join(defs.DIR, "smoketest.subs.json")), "standing orders die with the agent");
    fs.rmSync(ctx.place(AG).dir, { recursive: true, force: true });
  }

  // ── RFC-067 §3 — THE TWO JOB VERBS ──────────────────────────────────────────────────────
  // Through the REAL TOOL HANDLERS out of toolsFor(), never the module underneath. Everything
  // claimed here IS the tool layer: that the verbs exist at all, that the list is a label and not
  // the documents, and that an absent job is a refusal an agent reads rather than a blank success.
  // A test that called jobs.list()/jobs.doc() directly would pass on the day both tools were
  // deleted — the `markBroughtIn` lesson again.
  //
  // FIXTURES ARE WRITTEN BY HAND, as directories, under the scratch home pinned at the top of this
  // file. By hand rather than through jobs.save() because the claim is "jobsList returns what is ON
  // DISK": a fixture built by the same writer the reader trusts proves less.
  {
    const tools = ctx.toolsFor({ slot: "smoketest", projectCode: "smoketest-sys" });
    const jobsList = tools.find((t) => t.name === "jobsList");
    const jobsLoad = tools.find((t) => t.name === "jobsLoad");
    const said = (r) => (r.content || []).map((c) => c.text).join("");

    // A VERB NOBODY CAN CALL IS NOT A VERB — and jobs are the one context layer `Skill` cannot
    // reach, so if these two are missing there is no door to a job at all.
    ok(!!jobsList && !!jobsLoad, "jobsList and jobsLoad are present in toolsFor's output");
    ok(ctx.TOOL_NAMES.includes("mcp__context__jobsList") && ctx.TOOL_NAMES.includes("mcp__context__jobsLoad"),
      "...and both are in TOOL_NAMES, which is what sessions.cjs hands the SDK as allowedTools");
    ok(jobsLoad.inputSchema.name && !jobsLoad.inputSchema.name.isOptional(), "jobsLoad takes a required `name`");

    // STATED ABSENCE BEFORE ANYTHING EXISTS. An empty directory must read as "there are no jobs",
    // not as an empty list an agent can mistake for a failed call.
    const none = await jobsList.handler({}, {});
    ok(!none.isError && /No jobs exist yet/.test(said(none)), "with nothing on disk, jobsList SAYS there are none: " + said(none).split("(")[0].trim());
    const nothingToLoad = await jobsLoad.handler({ name: "anything" }, {});
    ok(nothingToLoad.isError && /No jobs exist at all yet/.test(said(nothingToLoad)),
      "...and jobsLoad refuses rather than answering blank");

    // ---- the fixtures ----------------------------------------------------------------------
    const mk = (id, { doc, json }) => {
      const dir = path.join(jobsMod.DIR, id);
      fs.mkdirSync(dir, { recursive: true });
      if (doc != null) fs.writeFileSync(path.join(dir, "job.md"), doc);
      if (json != null) fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify(json, null, 2));
      return dir;
    };
    const CLOSE_DOC =
      "# Accounting close\n\n" +
      "Reconcile last month's invoices against the bank export and file the summary. It takes a month.\n\n" +
      "## what it must never do\n\nIt must never email the client directly.\n";
    mk("accounting-close", {
      doc: CLOSE_DOC,
      json: { id: "accounting-close", name: "Accounting close", enabled: true, updatedAt: 2,
              trigger: { on: "schedule.due" }, definition: { prompt: "close the month" } },
    });
    mk("inbox-sweep", {
      doc: "- a bullet is scaffolding, not a sentence\n\nSort the shared inbox into the three folders.\n",
      json: { id: "inbox-sweep", name: "inbox-sweep", enabled: false, updatedAt: 1, definition: {} },
    });
    // A PROJECTION WITH NO AGREEMENT — the hand-edited case jobs.save() refuses to create.
    mk("ghost-job", { json: { id: "ghost-job", name: "ghost", enabled: true, updatedAt: 0, definition: {} } });

    // ---- jobsList: a label, never the documents ---------------------------------------------
    const listed = await jobsList.handler({}, {});
    const text = said(listed);
    ok(!listed.isError && /accounting-close/.test(text) && /inbox-sweep/.test(text),
      "jobsList returns what is on disk — both jobs, read from the folder");
    ok(/Reconcile last month's invoices against the bank export and file the summary\./.test(text),
      "the aim is the document's opening SENTENCE — the `# heading` above it is the name again, not an aim");
    ok(!/It takes a month/.test(text), "...one sentence only, not the opening paragraph");
    ok(/Sort the shared inbox into the three folders\./.test(text),
      "a leading bullet is skipped — the aim is the first line that reads as a sentence");
    ok(!/must never email the client/.test(text),
      "NAMES AND AIMS ONLY — the body stays out of the list, or the list is an injection with extra steps");
    ok(/inbox-sweep · DISABLED/.test(text), "a disabled job is labelled disabled");
    ok(/\("Accounting close"\)/.test(text), "the human name prints beside the id, because that is the form he says it in");
    ok(/given, not chosen/i.test(text), "the list says out loud that it is a directory and not a menu");

    // ---- jobsLoad: the document, whole -------------------------------------------------------
    const loaded = await jobsLoad.handler({ name: "accounting-close" }, {});
    ok(!loaded.isError && said(loaded).trim() === CLOSE_DOC.trim(),
      "jobsLoad returns the document WHOLE — a bound that only arrives in a retrieved chunk is a bound that does not exist at 3am");

    // He says "the Accounting close one", not a slug. Resolved through the folder's own rule.
    const byName = await jobsLoad.handler({ name: "Accounting Close" }, {});
    ok(!byName.isError && /Reconcile last month/.test(said(byName)),
      "a human name resolves through the same slug rule the directory uses");

    const dis = await jobsLoad.handler({ name: "inbox-sweep" }, {});
    ok(!dis.isError && /^NOTE: "inbox-sweep" is DISABLED/.test(said(dis)) && /Sort the shared inbox/.test(said(dis)),
      "a disabled job still loads, with the fact said FIRST — it changes whether to proceed at all");

    // ---- an absent job is a refusal that SAYS SO --------------------------------------------
    const missing = await jobsLoad.handler({ name: "payroll-run" }, {});
    ok(missing.isError, "an absent job is an ERROR, never an empty success");
    ok(/No job named "payroll-run"/.test(said(missing)) && /jobsList/.test(said(missing)),
      "...the refusal names what was asked for and where to get the real names: " + said(missing).slice(0, 80));

    const nearMiss = await jobsLoad.handler({ name: "accounting" }, {});
    ok(nearMiss.isError && /closest name that exists is "accounting-close"/.test(said(nearMiss)),
      "a near-miss name is NAMED in the refusal — cheap, and it is the whole reason jobsList was called");

    const empty = await jobsLoad.handler({ name: "   " }, {});
    ok(empty.isError && /needs the name of a job/.test(said(empty)), "an empty name refuses out loud too");

    // The document IS the job; job.json is a projection of it. So a directory with only the
    // projection has nothing to load, and the refusal has to say which half is missing — "no such
    // job" would send an agent looking for a name that is right there in jobsList.
    const ghost = await jobsLoad.handler({ name: "ghost-job" }, {});
    ok(ghost.isError && /no readable job\.md/.test(said(ghost)) && /document IS the job/.test(said(ghost)),
      "a job with a projection and no agreement is refused by NAMING which half is missing");
    ok(!/No job named/.test(said(ghost)), "...and is not reported as a job that does not exist");

    // ── jobsWrite — the door that did not exist ─────────────────────────────────────────────
    // `jobs.save` had three kinds of caller before 2026-10-08: the suites, an IPC handler the
    // window never called, and nothing else. So `job-authoring` could write a document and had
    // nowhere to put it but the hand, which is the one move that breaks the guarantee job.json
    // agrees with job.md. Through the REAL handler, like the two verbs above, for the same reason.
    // THE AIM IS THE LABEL, so the label must not be the front matter. Caught the first time two
    // real jobs existed: a document declaring `requires: ["project"]` listed its own demand where
    // its name belonged, in the one place whose entire purpose is answering "which job is this?".
    // And markdown WRAPS, so reading one line cut every aim at the author's wrap column.
    const aimed = ctx.toolsFor({ slot: "smoketest", projectCode: "smoketest-sys" });
    const aimWrite = aimed.find((t) => t.name === "jobsWrite");
    await aimWrite.handler({
      id: "ctx-aimed",
      doc:
        '---\nrequires: ["project"]\n---\n\n# Aimed\n\nFind the one thing worth doing in a named\n' +
        'project and leave a proposal. Then a second sentence nobody asked for.\n',
    }, {});
    const aimRow = said(await jobsList.handler({}, {}));
    ok(!/requires: \["project"\]/.test(aimRow.split("ctx-aimed")[1].split("\n")[0]),
      "a job's aim is its opening SENTENCE, never its front matter");
    ok(/Find the one thing worth doing in a named project and leave a proposal\./.test(aimRow),
      "...and the wrapped paragraph is joined into one sentence, not cut at the author's wrap column");
    ok(!/Then a second sentence/.test(aimRow), "one sentence only — a label is read at a glance");
    jobsMod.remove("ctx-aimed");

    const jobsWrite = tools.find((t) => t.name === "jobsWrite");
    ok(!!jobsWrite, "jobsWrite is on the context MCP, beside jobsList and jobsLoad");
    ok(ctx.TOOL_NAMES.includes("mcp__context__jobsWrite"),
      "...and in TOOL_NAMES, or the SDK never offers it however well it is written");
    ok(jobsWrite.inputSchema.doc && !jobsWrite.inputSchema.doc.isOptional(),
      "`doc` is REQUIRED — there is no way to create a job without its document");

    const wrote = await jobsWrite.handler({
      id: "ctx-written",
      doc: '---\nrequires: ["period"]\n---\n\n# A job written through the door\n',
      name: "Written through the door",
    }, {});
    ok(/Wrote job "ctx-written"/.test(said(wrote)), "it writes the job and says where it landed");
    ok(/demands: period/.test(said(wrote)),
      "it reads what the job demands OUT OF THE DOCUMENT and says so back");
    ok(/refuses by name/.test(said(wrote)), "...and says what happens when a hook cannot supply it");
    ok(/fires for nobody/.test(said(wrote)),
      "it states the job is INERT — writing one is a proposal, never an arming");

    const back = jobsMod.get("ctx-written");
    ok(!!back && back.doc.includes("written through the door"), "the document is on disk, whole");
    ok(back.requires.length === 1 && back.requires[0] === "period",
      "and the demand came from the document's front matter, not from a parameter on this verb");

    const noDoc = await jobsWrite.handler({ id: "ctx-nodoc", doc: "" }, {});
    ok(noDoc.isError === true, "a job with no document is REFUSED — the document IS the job");
    ok(!jobsMod.get("ctx-nodoc"), "...and the refused attempt left nothing on disk");

    const second = await jobsWrite.handler({ id: "ctx-written", doc: "# replaced\n" }, {});
    ok(/Updated job/.test(said(second)), "writing an existing id updates it, and says which it did");
    ok(jobsMod.get("ctx-written").requires.length === 0,
      "dropping requires: from the document drops the demand that same afternoon — a projection cannot outlive it");

    fs.rmSync(JOBS_HOME, { recursive: true, force: true });
  }

  // ── hooksCarry — AN AGENT ARMS ITS OWN HOOKS ──────────────────────────────────────────────
  // His call, 2026-10-12: an agent sent out to watch something has to be able to put a hook down
  // and arm it, without a human press it never needed. Before this there was NO VERB AT ALL — the
  // absence read as a guardrail and was a missing door.
  {
    const defsMod = require("../electron/agents/definitions.cjs");
    const hooksMod = require("../electron/agents/hooks.cjs");
    const said = (r) => (r.content || []).map((c) => c.text).join("");
    const SLOT = "ctxcarry-agent";
    const HOOK = "ctxcarry-hook";
    const tools = ctx.toolsFor({ slot: SLOT, projectCode: "smoketest-sys" });
    const carry = tools.find((t) => t.name === "hooksCarry");
    ok(!!carry, "the verb exists at all — an agent can reach its own carry list");

    try { hooksMod.remove(HOOK); } catch {}
    // EXPLICITLY EMPTY, because save() MERGES. The fixture used to omit `hooks` and rely on the
    // field being absent — which held only until a failed run left the slot on disk carrying one,
    // and then the first claim below read "already armed" and failed for a reason that had nothing
    // to do with arming. A fixture that depends on absence depends on the last run having passed.
    defsMod.save({ id: SLOT, name: "carry probe", prompt: "throwaway", skills: ["study"], hooks: [] });
    hooksMod.save({ name: HOOK, on: "usage", when: { pct: { gte: 60 } }, do: "skill:study",
                    kind: "context", author: `agent:${SLOT}`, rate: "once-per-rise" });

    // A NAME NOTHING ANSWERS TO is the failure this mechanism fears most: it would sit in the
    // definition looking armed and never fire.
    const ghost = await carry.handler({ name: "ctxcarry-nope" }, {});
    ok(ghost.isError === true && /nothing to arm/.test(said(ghost)),
      "arming a hook that does not exist is refused, not written");

    const armed = await carry.handler({ name: HOOK }, {});
    ok(/Armed/.test(said(armed)), "arming says so, and says what will now fire");
    ok(/no restart/.test(said(armed)), "...and says it is live, because that was the whole complaint");
    ok((defsMod.resolve(SLOT).def.hooks || []).includes(HOOK), "IT IS ON DISK — read back, not reported from the input");

    // SAVE() MERGES. An earlier version of that function emptied agents silently on a one-field
    // write, so this is the claim that a carry write cannot cost an agent its definition.
    ok(defsMod.resolve(SLOT).def.prompt === "throwaway", "the rest of the definition survived the write");
    ok((defsMod.resolve(SLOT).def.skills || []).includes("study"), "...skills included");

    const again = await carry.handler({ name: HOOK }, {});
    ok(/already armed/.test(said(again)), "arming twice is reported as a no-op rather than written again");

    const off = await carry.handler({ name: HOOK, carry: false }, {});
    ok(/Disarmed/.test(said(off)), "disarming says so");
    ok(!(defsMod.resolve(SLOT).def.hooks || []).includes(HOOK), "...and it is off disk");

    // A SESSION THAT IS NOT AN AGENT has no carry list to write — said plainly, not crashed.
    const noSlot = ctx.toolsFor({ projectCode: "smoketest-sys" }).find((t) => t.name === "hooksCarry");
    const nope = await noSlot.handler({ name: HOOK }, {});
    ok(nope.isError === true && /no agent slot/.test(said(nope)),
      "a session with no agent slot is told there is no carry list, rather than writing one");

    // A DEAD CARRY MUST BE REMOVABLE. Found 2026-10-13, within an hour of shipping this verb:
    // three carries sat on the real systemview-test profile with no hook files behind them
    // (`test-hook`, `probe-turn-end`, `probe-idle`), and the guard above ran BEFORE `want` was
    // consulted — so the one verb that could remove them refused on the grounds that they do not
    // exist. A carry list that can accumulate entries it will not let you delete only ever grows,
    // and every reader then has to guess which names are real.
    {
      defsMod.save({ id: SLOT, name: "carry probe", prompt: "throwaway", hooks: ["ctxcarry-ghost", HOOK] });
      const gone = await carry.handler({ name: "ctxcarry-ghost", carry: false }, {});
      ok(!gone.isError && /NO SUCH HOOK EXISTS/.test(said(gone)),
        "a carried name with no hook behind it CAN be disarmed, and is named as the dead entry it was");
      ok(!(defsMod.resolve(SLOT).def.hooks || []).includes("ctxcarry-ghost"), "...and it is off the list");
      ok((defsMod.resolve(SLOT).def.hooks || []).includes(HOOK), "...without disturbing the real carry beside it");

      const armGhost = await carry.handler({ name: "ctxcarry-ghost", carry: true }, {});
      ok(armGhost.isError === true, "but ARMING a name with no hook is still refused — the asymmetry is the point");
      // Leave the carry list as the next block expects to find it: empty, so arming reports an
      // arm rather than a no-op. A fixture that quietly changes shared state is how a claim below
      // starts failing for a reason that has nothing to do with what it is testing.
      defsMod.save({ id: SLOT, name: "carry probe", prompt: "throwaway", hooks: [] });
    }

    // A PARKED HOOK still fires for nobody, and arming it must not imply otherwise.
    hooksMod.save({ name: HOOK, on: "usage", when: { pct: { gte: 60 } }, do: "skill:study",
                    kind: "context", author: `agent:${SLOT}`, rate: "once-per-rise", enabled: false });
    const parked = await carry.handler({ name: HOOK }, {});
    ok(/PARKED/.test(said(parked)), "arming a parked hook says it still fires for nobody");

    try { hooksMod.remove(HOOK); } catch {}
    try { defsMod.remove(SLOT); } catch {}
  }

  console.log("\nALL " + n + " CLAIMS PASS");
  vectors.stop();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
