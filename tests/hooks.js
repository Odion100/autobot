// smoke:hooks — CARRYING A HOOK SURVIVES A SAVE.
//
// The bug this exists for: three hooks were enabled, the switches moved, the agent ran them — and
// the `hooks` key was gone from disk. It only showed up after a re-init, because the live session
// still held the list in memory from when it opened. So the surface said enabled, the agent behaved
// enabled, and the truth on disk was empty. Every assertion here is about the WRITE path, because
// that is the half nobody watches.
//
// THROWAWAY IDS ONLY. Writes agents named `smoke-hooks-*` under the real agents dir and deletes
// them; it never touches a definition anyone uses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// THE SUITE MUST NOT READ HIS LIVE NUDGE SETTINGS. The nudge — on by default — sets an idle-clock
// floor for every session; that is ITS claim (tests/nudge.js #8), not this file's. The idle claims
// below are about HOOK thresholds, so the nudge is parked off in a scratch file — otherwise this
// suite passes or fails with whatever he last set in the cog, which is a suite reading the user's
// live config to decide what is true.
const nudgeScratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-hooks-"));
process.env.AUTOBOT_NUDGE_FILE = path.join(nudgeScratch, "nudge.json");
fs.writeFileSync(process.env.AUTOBOT_NUDGE_FILE, JSON.stringify({ on: false }));

// THE FIRE LEDGER GOES TO SCRATCH. Firing a hook writes the ledger, and the ledger is his live
// `~/.autobot/logs` — so every run of this suite appended test fires to `agents.log` and the day's
// `calls-*.jsonl` (measured 2026-10-19). A log that contains runs nobody made is a log that
// misleads the next investigation, which is the whole reason it exists. `ledger.cjs` has had the
// pin all along; this suite simply never set it, and it must be set BEFORE the require that reads
// it at load time.
process.env.AUTOBOT_LEDGER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-hooks-ledger-"));

const defs = require("../electron/agents/definitions.cjs");
const hooks = require("../electron/agents/hooks.cjs");

const ID = "smoke-hooks-agent";
const HOOK = "smoke-hooks-authored";
const HOOK2 = "smoke-hooks-renamed";
let failed = 0;
const ok = (what, cond) => { console.log(`${cond ? "  ✓" : "  ✗"} ${what}`); if (!cond) failed++; };
const eq = (what, a, b) => ok(`${what} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const onDisk = (id) => JSON.parse(fs.readFileSync(path.join(defs.DIR, `${id}.json`), "utf8"));

try {
  console.log("\nnormalize keeps the field at all — the whitelist IS the definition");
  defs.save({ id: ID, name: "smoke hooks", prompt: "a throwaway", hooks: ["context-retrieval", "context-maintenance"] });
  eq("written to disk", onDisk(ID).def.hooks, ["context-retrieval", "context-maintenance"]);

  console.log("\nA SAVE THAT NEVER MENTIONS HOOKS MUST NOT DROP THEM");
  // This is the exact shape that wiped them: some other field is edited and the payload simply has
  // no `hooks` key. Anything that reads the whitelist and rebuilds `def` from scratch will silently
  // lose every field the caller didn't happen to send.
  defs.save({ id: ID, prompt: "edited somewhere else entirely" });
  eq("still carried after an unrelated edit", onDisk(ID).def.hooks, ["context-retrieval", "context-maintenance"]);
  eq("and the edit landed", onDisk(ID).def.prompt, "edited somewhere else entirely");

  console.log("\nthe profile's own save shape — the flattened record, def: undefined");
  const rec = defs.get(ID);
  defs.save({ id: rec.id, name: rec.name, ...rec.def, projectCode: rec.projectCode, cwd: rec.cwd, permissionMode: rec.permissionMode, def: undefined });
  eq("survives a full-form save", onDisk(ID).def.hooks, ["context-retrieval", "context-maintenance"]);

  console.log("\nturning one off is a real write, not a UI state");
  defs.save({ id: ID, hooks: ["context-retrieval"] });
  eq("one left", onDisk(ID).def.hooks, ["context-retrieval"]);
  defs.save({ id: ID, hooks: [] });
  eq("empty is a value, not an absence", onDisk(ID).def.hooks, []);

  console.log("\nfiring: a hook reaches an agent ONLY if that agent carries it");
  const all = hooks.index ? hooks.index() : hooks.list();
  ok("the library has hooks to test with", Array.isArray(all) && all.length > 0);
  const name = (all.find((h) => h.on === "compaction.after") || all[0] || {}).name;
  if (name) {
    const ev = { kind: (all.find((h) => h.name === name) || {}).on || "compaction.after" };
    const carrying = hooks.fire(ev, { agentId: ID, projectCode: "smoke", carries: [name], fired: new Map() });
    const bare = hooks.fire(ev, { agentId: ID, projectCode: "smoke", carries: [], fired: new Map() });
    ok(`carried → fires (${name})`, carrying.some((h) => h.name === name));
    ok("not carried → silent", bare.length === 0);
  }

  console.log("\nwhat the session will actually carry, read the way sessions.cjs reads it");
  defs.save({ id: ID, hooks: ["context-retrieval"] });
  const agent = defs.get(ID);
  const carries = Array.isArray(agent.def && agent.def.hooks) ? agent.def.hooks : [];
  eq("carriesHooks at open", carries, ["context-retrieval"]);
  // -------------------------------------------------------------------------------------------
  // AUTHORING (RFC-005 §7). Hooks became writable by an agent, which makes two things testable
  // that did not exist before: that the event vocabulary is checked at the WRITING door, and that
  // a hook records who wrote it. The second is the one with teeth — without an author there is no
  // way to stop one writer overwriting another's hook, and no way to tell them apart afterwards.
  console.log("\nthe hookable vocabulary is checked where hooks are WRITTEN, not where they fire");
  ok("a real event passes", hooks.isEvent("compaction.after"));
  ok("a typo does not", !hooks.isEvent("compaction.finished"));
  ok("hook.fired is not offered — it is the injection loop", !hooks.isEvent("hook.fired"));

  console.log("\nauthor survives the round trip to disk");
  hooks.save({ name: HOOK, on: "usage", do: "skill:context-maintenance", when: { pct: { gte: 70 } },
               kind: "context", guard: "once-per-session", author: "agent:smoke", note: "throwaway" });
  const mine = hooks.list().find((h) => h.name === HOOK);
  eq("author read back", mine && mine.author, "agent:smoke");
  eq("kind is written explicitly, never left to a default", mine && mine.kind, "context");
  eq("when survives as an object", mine && mine.when, { pct: { gte: 70 } });

  console.log("\nwho may overwrite whom");
  ok("a new name is nobody's yet", hooks.mayWrite(null, "agent:smoke"));
  ok("mine, by me", hooks.mayWrite(mine, "agent:smoke"));
  ok("mine, NOT by another agent", !hooks.mayWrite(mine, "agent:other"));
  ok("the operator owns everything", hooks.mayWrite(mine, "user"));
  ok("hand-written (unattributed) reads as the operator's", !hooks.mayWrite({ author: "" }, "agent:smoke"));

  console.log("\na rename is a move, not a copy — two files is a hook that fires twice");
  hooks.save({ name: HOOK2, wasName: HOOK, on: "usage", do: "skill:context-maintenance", author: "agent:smoke" });
  const after = hooks.list().map((h) => h.name);
  ok("new name exists", after.includes(HOOK2));
  ok("old name is gone", !after.includes(HOOK));

  console.log("\nan authored hook is INERT — the write is the proposal, the carry is the approval");
  const ev = { kind: "usage", pct: 90 };
  ok("nobody carries it → silent", hooks.fire(ev, { carries: [], fired: new Map() }).length === 0);
  ok("carried → fires", hooks.fire(ev, { carries: [HOOK2], fired: new Map() }).some((h) => h.name === HOOK2));

  // -------------------------------------------------------------------------------------------
  // A SUBSCRIPTION IS A CARRIED HOOK WHOSE `do` NAMES CONTENT (settled 2026-10-05). The claims
  // here are the MECHANISM half — the vocabulary, the classification, and the two writing-door
  // refusals that need no context store. Delivery, the caps and the `when`/`rate` gates are proved
  // in tests/context.js, where the notes to point at already exist.
  console.log("\na subscription is a hook: the three moments ARE events, and `do` names content");

  // THE EVIDENCE THE MERGE IS NATURAL RATHER THAN FORCED. The sharpest subscription moment and a
  // hook event were already the same moment under two names, before any of this was written.
  eq("post-compaction IS compaction.after", hooks.MOMENTS["post-compaction"], "compaction.after");
  ok("...and that event was already declared", hooks.isEvent("compaction.after"));
  eq("session-start IS session.started", hooks.MOMENTS["session-start"], "session.started");
  eq("every-turn IS turn.started", hooks.MOMENTS["every-turn"], "turn.started");
  // A MOMENT THAT MAPS TO AN UNDECLARED EVENT IS THE WORST FAILURE THIS MECHANISM HAS — it would
  // list correctly and never fire. So every one of the three is checked against the vocabulary.
  ok("all three moments name events the system really declares",
    Object.values(hooks.MOMENTS).every((e) => hooks.isEvent(e)));
  ok("an unknown moment maps to nothing at all, rather than to a plausible event", hooks.eventForMoment("sometimes") === "");

  // THE CLASSIFICATION, which is the one place the difference between the two kinds of pointer
  // lives: a skill may be declined, content may not.
  ok("note: is content", hooks.isContent({ do: "note:abc@system" }));
  ok("corpus: is content", hooks.isContent({ do: "corpus:handbook:a.md#Heading" }));
  ok("skill: is not", !hooks.isContent({ do: "skill:study" }));
  ok("job: is not", !hooks.isContent({ do: "job:accounting-close" }));
  eq("and it is read through the SAME grammar `job:` is", hooks.targetOf({ do: "note:abc@system" }).kind, "note");

  // THE OPERATOR VOCABULARY, CHECKABLE AT A WRITING DOOR. testOne() refuses an operator it does not
  // know, which is right at fire time and turns a typo into a condition that is false forever —
  // so the same list is assertable before anything is saved.
  // THE TWO LISTS MUST AGREE OR THE CHECK IS A LIE. `OPS` is written by hand beside testOne's
  // switch, so this asserts each declared operator actually MATCHES something — an operator in the
  // list that the switch does not implement would fall through to `default: return false` and the
  // door would be blessing a condition that can never be true.
  {
    const PASSES = { equals: "x", not: "y", contains: "x", startsWith: "x", endsWith: "x", matches: "^x$", in: ["x"], gt: 1, gte: 5, lt: 9, lte: 5, exists: true };
    const unimplemented = hooks.OPS.filter((op) => {
      const field = ["gt", "gte", "lt", "lte"].includes(op) ? "n" : "f";
      return !hooks.matchesWhen({ [field]: { [op]: PASSES[op] } }, { f: "x", n: 5 });
    });
    eq("every operator the door accepts is one the matcher implements", unimplemented, []);
    ok("...and the list is not quietly short of the switch", hooks.OPS.length === Object.keys(PASSES).length);
  }
  eq("a known operator passes the check", hooks.checkWhen({ pct: { gte: 70 } }), "");
  eq("a bare value is an equality test, not an error", hooks.checkWhen({ trigger: "auto" }), "");
  eq("no condition at all is fine", hooks.checkWhen(undefined), "");
  ok("a typo'd operator is NAMED, with the field it is on", /"greaterThan" is not an operator \(on field "pct"\)/.test(hooks.checkWhen({ pct: { greaterThan: 70 } })));
  ok("...and the refusal says why it matters: false forever, not noisy", /false forever/.test(hooks.checkWhen({ pct: { greaterThan: 70 } })));

  // REFUSED AT THE WRITING DOOR, like the rate and the event name before it.
  {
    const tryWhen = (when) => { try { hooks.save({ name: "smoke-when-bad", on: "idle", do: "skill:study", kind: "context", author: "agent:smoke", when }); return false; } catch { return true; } };
    ok("save refuses a condition with an unknown operator", tryWhen({ quietMin: { atLeast: 3 } }));
    ok("...and accepts the one that means it", !tryWhen({ quietMin: { gte: 3 } }));
    try { hooks.remove("smoke-when-bad"); } catch {}
  }

  // A CONTENT POINTER AT NOTHING IS REFUSED THE WAY A SUBSCRIPTION TO NOTHING IS — one wording,
  // because context.cjs owns both doors.
  {
    let said = "";
    try { hooks.save({ name: "smoke-content-ghost", on: "compaction.after", do: "note:no-such-note@system", kind: "context", author: "agent:smoke" }); }
    catch (e) { said = e.message; }
    ok("a content hook pointing at nothing is refused, saying the target must exist: " + said.slice(0, 48), /must exist/.test(said));
    ok("...and no file was written for it", !hooks.list().some((h) => h.name === "smoke-content-ghost"));
    try { hooks.remove("smoke-content-ghost"); } catch {}
  }

  // -------------------------------------------------------------------------------------------
  // RFC-067 §3 — A HOOK GIVES A JOB, THROUGH THE SAME `do` FIELD.
  //
  // A job is triggered exactly as a skill is: the hook already carries who (whoever ticked it),
  // when (its event and rate) and what (`do`), so there is no second field and no second matcher.
  // What is new is the half a hook could not carry — `with:`, the inputs the job declared in part 2
  // — and the consequence of a job being GIVEN rather than chosen: given too little, it REFUSES BY
  // NAME, and nothing runs.
  //
  // EVERY CLAIM HERE GOES THROUGH `hooks.fire()`, the door sessions.cjs actually calls. A check
  // that called jobs.check() directly would prove the function works and prove nothing about
  // whether a firing hook ever reaches it — which is how `markBroughtIn` once shipped defined,
  // exported and "tested" while being reachable by nothing.
  console.log("\na hook's `do` names a job by the same grammar it names a skill");
  {
    const jobs = require("../electron/agents/jobs.cjs");
    const worklist = require("../electron/agents/worklist.cjs");
    const JOB = "smoke-hooks-job";
    const JHOOK = "smoke-hooks-gives-job";
    const SESSION = "session:smoke-hooks:1";
    const docFor = (...names) => `---\nrequires: ${JSON.stringify(names)}\n---\n\n# smoke job\n\n` +
      `## 2 · What it must be given\n${names.map((n) => `- \`${n}\` — a missing one is a refusal.\n`).join("")}`;
    const opened = [];
    try {
      jobs.save({ id: JOB, name: "smoke job", doc: docFor("period") });

      eq("job: parses", hooks.targetOf({ do: `job:${JOB}` }), { kind: "job", name: JOB });
      eq("skill: still parses the same way", hooks.targetOf({ do: "skill:study" }), { kind: "skill", name: "study" });
      eq("a bare pointer has no kind, and is not guessed at", hooks.targetOf({ do: "study" }), { kind: "", name: "study" });
      ok("and `isJob` reads that one grammar, so nothing re-derives it", hooks.isJob({ do: `job:${JOB}` }) && !hooks.isJob({ do: "skill:study" }));

      console.log("\n`with:` round-trips through the file — a hook could not carry inputs before");
      hooks.save({ name: JHOOK, on: "idle", when: { quietMin: { gte: 5 } }, do: `job:${JOB}`,
                   with: { period: "2026-09", dry: true }, author: "agent:smoke", note: "throwaway" });
      const back = hooks.list().find((h) => h.name === JHOOK);
      eq("read back as the same object", back && back.with, { period: "2026-09", dry: true });
      ok("and it is in the front matter, not invented on read",
        /^with: \{"period":"2026-09","dry":true\}$/m.test(fs.readFileSync(back.file, "utf8")));
      eq("a skill hook carries an empty one rather than an absence", (hooks.list().find((h) => h.name === HOOK2) || {}).with, {});

      // THE BUG THIS FOUND, and it is older than jobs: `index()` rebuilds on the DIRECTORY's mtime,
      // which does not move when a file inside it is rewritten. So an EDITED hook kept firing on its
      // old condition, with its old `do` and its old inputs, until something unrelated happened to
      // touch the folder — and every surface reads list(), so every surface agreed with the edit
      // while the firing path did not. An edit to `with:` would have been the loudest possible
      // version of it: the job given the values you replaced.
      console.log("\nAN EDIT TAKES EFFECT ON THE NEXT FIRE — the writer invalidates the index");
      hooks.save({ name: JHOOK, on: "idle", when: { quietMin: { gte: 5 } }, do: `job:${JOB}`,
                   with: { period: "1999-01" }, author: "agent:smoke", note: "throwaway" });
      eq("the edited value is what fires",
        (hooks.fire({ kind: "idle", quietMin: 9 }, { carries: [JHOOK], fired: new Map(), cleared: new Map(), turn: 1 })[0] || {}).with,
        { period: "1999-01" });
      hooks.save({ name: JHOOK, on: "idle", when: { quietMin: { gte: 5 } }, do: `job:${JOB}`,
                   with: { period: "2026-09", dry: true }, author: "agent:smoke", note: "throwaway" });

      console.log("\nfiring it resolves the job and reports what it was given");
      const hit = hooks.fire({ kind: "idle", quietMin: 9 }, { carries: [JHOOK], fired: new Map(), cleared: new Map(), turn: 1 });
      eq("one hook fired", hit.length, 1);
      eq("and it names the job", hit[0].job, JOB);
      ok("given everything it declared → no refusal", hit[0].given === true && hit[0].refusal === "");
      // THE INDEX IS SHARED. These objects are handed to every session carrying the hook, so a
      // verdict attached to the cached one would leak this session's refusal into the next match.
      ok("the verdict rode a COPY — the cached index is not poisoned",
        !("given" in (hooks.list().find((h) => h.name === JHOOK) || {})));

      console.log("\nthe pointer for a job says GIVEN, and offers no way out of it");
      const ptr = hooks.pointerText(hit[0], { kind: "idle" });
      ok("it names the job and says it was given", new RegExp(`\`${JOB}\` job has been GIVEN`).test(ptr));
      ok("it lists what it was given, by name and value", /`period`: "2026-09"/.test(ptr));
      ok("it names the run source the job must open", new RegExp(`source: "job:${JOB}"`).test(ptr));
      // THE WHOLE REASON A JOB DOES NOT REUSE THE SKILL POINTER. "ignore it if it does not apply"
      // handed to assigned work is a licence to drop it, and "a pointer, not an instruction" is
      // true of something CHOSEN and false of something GIVEN.
      ok("and it does NOT tell the agent to ignore it if it does not apply", !/ignore it if it does not/i.test(ptr));
      ok("nor call itself a pointer rather than an instruction", !/pointer, not an instruction/i.test(ptr));

      console.log("\nwith a session named, the fire path OPENS the run — and it is the worklist's");
      const withRun = hooks.fire({ kind: "idle", quietMin: 9 },
        { carries: [JHOOK], fired: new Map(), cleared: new Map(), turn: 1, session: SESSION });
      if (withRun[0] && withRun[0].runId) opened.push(withRun[0].runId);
      ok("a run id came back", !!(withRun[0] || {}).runId);
      eq("sourced with the job's own owner", (withRun[0] || {}).runSource, `job:${JOB}`);
      eq("and the run is on disk, open, with one pending item",
        worklist.read(worklist.runOwner(withRun[0].runId)).map((i) => i.state), ["pending"]);
      ok("the pointer says the run is already open rather than telling it to open one",
        /run is already open/.test(hooks.pointerText(withRun[0], { kind: "idle" })));
      // A SECOND MATCH IS THE SAME WORK. Minting a second run id would leave a corpse reading
      // died-at-step-1 for a job that simply got nudged twice.
      const twice = hooks.fire({ kind: "idle", quietMin: 9 },
        { carries: [JHOOK], fired: new Map(), cleared: new Map(), turn: 2, session: SESSION });
      eq("a second fire resumes that same run", (twice[0] || {}).runId, withRun[0].runId);

      // -----------------------------------------------------------------------------------------
      // THE REFUSAL, AT FIRE TIME, AND WHY IT IS NOT REDUNDANT WITH THE WRITE-DOOR CHECK: the
      // document is the job and it is edited between runs. A hook written correctly in September
      // against a job that gained an input in October is the real case, and nobody re-saves the
      // hook. Only the fire-time check can catch it.
      console.log("\nthe job gains an input, and the hook that cannot supply it REFUSES BY NAME");
      jobs.save({ id: JOB, name: "smoke job", doc: docFor("period", "ledger") });
      const refused = hooks.fire({ kind: "idle", quietMin: 9 },
        { carries: [JHOOK], fired: new Map(), cleared: new Map(), turn: 3, session: SESSION });
      eq("it still FIRES — a hook that silently never runs is the worst failure this has", refused.length, 1);
      eq("but it was not given", (refused[0] || {}).given, false);
      eq("and the missing input is named, not counted", (refused[0] || {}).missing, ["ledger"]);
      ok("the refusal text names it too", /`ledger`/.test((refused[0] || {}).refusal || ""));
      eq("NO RUN WAS OPENED for it", (refused[0] || {}).runId, "");
      const rptr = hooks.pointerText(refused[0], { kind: "idle" });
      ok("the pointer is the refusal, naming the job and the missing input",
        /REFUSED/.test(rptr) && /`ledger`/.test(rptr) && new RegExp(JOB).test(rptr));
      ok("and it forbids filling the gap in — the guess part 2 exists to stop",
        /Do not fill in the missing value/.test(rptr));

      console.log("\nand the writing door refuses it too, where somebody is watching");
      let msg = "";
      try {
        hooks.save({ name: JHOOK, on: "idle", do: `job:${JOB}`, with: { period: "p" }, author: "agent:smoke" });
      } catch (e) { msg = String(e.message || e); }
      ok("a hook that cannot supply what the job declares is refused at save", /ledger/.test(msg));
      // A HOOK WRITTEN BEFORE ITS JOB IS NOT AN ERROR — refusing would make the two orderings of
      // the same two writes behave differently.
      let ordering = true;
      try { hooks.save({ name: JHOOK, on: "idle", do: "job:smoke-job-not-written-yet", author: "agent:smoke" }); }
      catch { ordering = false; }
      ok("but a hook pointing at a job nobody has written yet saves fine", ordering);

      console.log("\na job hook persists against its OWN source — `until: run` needed no new vocabulary");
      const persisting = { name: JHOOK, on: "idle", do: `job:${JOB}`, until: "run" };
      eq("cleared by a run sourced job:<id>", hooks.clearedBy(persisting), `job:${JOB}`);
      {
        const fired = new Map();
        const ev = { kind: "idle", quietMin: 9 };
        hooks.save({ name: JHOOK, on: "idle", when: { quietMin: { gte: 5 } }, do: `job:${JOB}`,
                     with: { period: "p", ledger: "l" }, until: "run", rate: "once-per-session", author: "agent:smoke" });
        ok("it fires while the job has not run", hooks.fire(ev, { carries: [JHOOK], fired, cleared: new Map(), turn: 1 }).length === 1);
        const done = new Map([[`job:${JOB}`, Date.now() + 1000]]);
        ok("and a closed run carrying the job's source clears it",
          hooks.fire(ev, { carries: [JHOOK], fired, cleared: done, turn: 2 }).length === 0);
      }

      // -----------------------------------------------------------------------------------------
      // AND NOW THROUGH THE WHOLE DOOR. Everything above calls hooks.fire() — the function
      // sessions.cjs calls — but the thing that has to be true is that a job pointer reaches an
      // AGENT. `markBroughtIn` once shipped defined, exported and "tested" while being reachable by
      // nothing, because the test called the module function instead of the handler. So: the real
      // fireHooks, the real turn-end hold, the real flush, and the pointer read off the queue.
      console.log("\na given job reaches the agent through sessions.fireHooks — the real path");
      {
        const sessions = require("../electron/agents/sessions.cjs");
        hooks.save({ name: JHOOK, on: "idle", when: { quietMin: { gte: 5 } }, do: `job:${JOB}`,
                     with: { period: "2026-09", ledger: "main" }, author: "agent:smoke", note: "throwaway" });
        const s = {
          key: "smoke:hooks-job", sessionId: "smoke", projectCode: "smoke", cwd: process.cwd(), model: "",
          events: [], subs: new Set(), toolsInFlight: 0, sent: [],
          hooksFired: new Map(), pendingHooks: new Map(), runsDone: new Map(),
          turnSeq: 0, turnActive: false, turnEndTimer: null, carriesHooks: [JHOOK],
        };
        s.input = { push(m) { s.sent.push(m.message.content[0].text); } };
        sessions.fireHooks(s, { kind: "idle", quietMin: 9 });
        await new Promise((r) => setTimeout(r, sessions.TURN_SETTLE_MS + 250));
        eq("one pointer was pushed to the agent", s.sent.length, 1);
        ok("and it is the job being GIVEN, not a skill being offered",
          new RegExp(`\`${JOB}\` job has been GIVEN`).test(s.sent[0] || ""));
        // THE RECEIPT, so an unattended giving is never silent — the feed row says which job.
        const receipt = s.events.find((e) => e.kind === "hook.fired");
        eq("the feed receipt names the job as the target", receipt && receipt.to, `job:${JOB}`);
      }

      console.log("\na skill hook is untouched by any of it");
      const skillHit = hooks.fire({ kind: "usage", pct: 90 }, { carries: [HOOK2], fired: new Map(), cleared: new Map(), turn: 1 });
      ok("no job verdict is attached to one", skillHit.length === 1 && !("given" in skillHit[0]) && !("job" in skillHit[0]));
      ok("and its pointer still reads as the choice it is",
        /pointer, not an instruction|ignore it if it does not/i.test(hooks.pointerText(skillHit[0], { kind: "usage" })));
    } finally {
      for (const id of opened) { try { worklist.deleteRun(id); } catch {} }
      try { hooks.remove(JHOOK); } catch {}
      try { jobs.remove(JOB); } catch {}
    }
  }

  // -------------------------------------------------------------------------------------------
  // RFC-012 — WHEN THE POINTER LANDS, AND WHETHER IT COMES BACK.
  //
  // The bug behind all of this: a pointer was pushed the instant its event matched, which put it
  // on the input queue beside the message the human had just sent. It competed with his request
  // and lost — observed live, at 60% context, where the pass only happened because he asked why it
  // had not. The two halves of the fix are tested separately because they fail separately: the
  // classification decides WHERE a pointer goes, `until` decides whether missing it is fatal.
  console.log("\nsession-level pointers are held for the yield; in-turn hooks do not move");
  eq("usage → the turn boundary", hooks.deliverAt({ on: "usage" }), "turn-end");
  eq("compaction.after → the turn boundary", hooks.deliverAt({ on: "compaction.after" }), "turn-end");
  // THE ONE THAT MUST NOT REGRESS. A hook watching `git push` exists to land NEAR the action;
  // deferring it to the end of the turn delivers it after the push it was watching for.
  eq("tool.call stays immediate", hooks.deliverAt({ on: "tool.call" }), "now");
  eq("tool.result stays immediate", hooks.deliverAt({ on: "tool.result" }), "now");
  eq("permission.request stays immediate", hooks.deliverAt({ on: "permission.request" }), "now");
  eq("an author may override either way", hooks.deliverAt({ on: "tool.call", deliver: "turn-end" }), "turn-end");
  eq("and back", hooks.deliverAt({ on: "usage", deliver: "now" }), "now");

  console.log("\n`until` is CONFIG beside `guard`, not a second kind of hook");
  hooks.save({ name: HOOK, on: "usage", do: "skill:context-maintenance", when: { pct: { gte: 60 } },
               guard: "once-per-session", until: "run", author: "agent:smoke", note: "throwaway" });
  const persist = hooks.list().find((h) => h.name === HOOK);
  eq("until survives the round trip", persist && persist.until, "run");
  eq("bare `run` means this hook's own pointer", hooks.clearedBy(persist), "skill:context-maintenance");
  eq("or name a different source", hooks.clearedBy({ until: "run:job:nightly" }), "job:nightly");
  ok("no until → does not persist", !hooks.persists({ on: "usage", guard: "once-per-session" }));

  console.log("\nuncleared, it comes back every turn — the guard is suspended, not honoured");
  {
    const fired = new Map();
    const ctxAt = (turn) => ({ carries: [HOOK], fired, cleared: new Map(), turn });
    const hot = { kind: "usage", pct: 82 };
    ok("turn 1 fires", hooks.fire(hot, ctxAt(1)).some((h) => h.name === HOOK));
    // ONE PER TURN, NOT ONE PER EVENT. `usage` is emitted per assistant message AND at the yield,
    // so without the turn number a persisting hook would queue a pointer for every message.
    ok("a second match in the SAME turn does not fire again", !hooks.fire(hot, ctxAt(1)).some((h) => h.name === HOOK));
    ok("turn 2 fires again, despite once-per-session", hooks.fire(hot, ctxAt(2)).some((h) => h.name === HOOK));
    ok("turn 3 too", hooks.fire(hot, ctxAt(3)).some((h) => h.name === HOOK));
  }

  console.log("\nand the RUN RECORD clears it — never the agent's say-so");
  {
    const fired = new Map();
    const hot = { kind: "usage", pct: 82 };
    ok("fires while nothing has run", hooks.fire(hot, { carries: [HOOK], fired, cleared: new Map(), turn: 1 }).length === 1);
    // A pass that finished BEFORE the pointer went out is not an answer to it — otherwise a run
    // from an hour ago silences a hook that has not been read once.
    const stale = new Map([["skill:context-maintenance", (fired.get(HOOK).firstTs || 0) - 60000]]);
    ok("a run that finished earlier does not count", hooks.fire(hot, { carries: [HOOK], fired, cleared: stale, turn: 2 }).length === 1);
    const done = new Map([["skill:context-maintenance", Date.now() + 1000]]);
    ok("a run all-done since the pointer clears it", hooks.fire(hot, { carries: [HOOK], fired, cleared: done, turn: 3 }).length === 0);
    // Once cleared the ordinary guard applies again, and once-per-session means it is done.
    ok("and once-per-session then holds", hooks.fire(hot, { carries: [HOOK], fired, cleared: done, turn: 4 }).length === 0);
    // A DIFFERENT PROCEDURE IS NOT THIS ONE. The source has to match, or any finished run at all
    // would clear every persisting hook in the session.
    const other = new Map([["skill:study", Date.now() + 1000]]);
    const f2 = new Map();
    hooks.fire(hot, { carries: [HOOK], fired: f2, cleared: new Map(), turn: 1 });
    ok("somebody else's run does not clear it", hooks.fire(hot, { carries: [HOOK], fired: f2, cleared: other, turn: 2 }).length === 1);
  }

  console.log("\nthe pointer text follows the timing");
  {
    const end = hooks.pointerText({ name: "x", on: "usage", do: "skill:context-maintenance", until: "run" }, { kind: "usage" });
    ok("a turn-end pointer stops apologising", !/Finish what you are doing first/.test(end));
    ok("it says the turn is already handed back", /handed the turn back/.test(end));
    ok("a persisting one says it will return, and what clears it", /returns every turn/.test(end) && /run record/.test(end));
    const now = hooks.pointerText({ name: "x", on: "tool.call", do: "skill:study" }, { kind: "tool.call" });
    ok("an in-turn pointer keeps the deferral, and needs it", /Finish what you are doing first/.test(now));
  }

  // -------------------------------------------------------------------------------------------
  // THE BOUNDARY ITSELF, driven without a model on the other end. `result` is the SDK's real
  // yield, so these claims are about a signal we HAVE — the debounce only has to survive the gap
  // between that yield and a turn the human had already queued.
  console.log("\nthe pointer waits for the yield, and a pause is not an ending");
  await (async () => {
    const sessions = require("../electron/agents/sessions.cjs");
    const fake = () => ({
      key: "smoke:hooks", sessionId: "smoke", projectCode: "smoke", cwd: process.cwd(), model: "",
      events: [], subs: new Set(), toolsInFlight: 0, sent: [],
      input: { push(m) { this.owner.sent.push(m.message.content[0].text); } },
      hooksFired: new Map(), pendingHooks: new Map(), runsDone: new Map(),
      turnSeq: 0, turnActive: false, turnEndTimer: null, carriesHooks: [HOOK],
    });
    const mk = () => { const s = fake(); s.input.owner = s; return s; };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const s = mk();
    // the mid-turn ruler tick — the event that used to deliver the pointer beside his message
    sessions.fireHooks(s, { kind: "usage", snapshot: true, pct: 82 });
    eq("nothing is pushed mid-turn", s.sent.length, 0);
    ok("it is held, not dropped", s.pendingHooks.size === 1);
    sessions.fireHooks(s, { kind: "tool.call", name: "Bash" });
    sessions.fireHooks(s, { kind: "usage", snapshot: true, pct: 84 });
    eq("still nothing, however long the turn runs", s.sent.length, 0);
    eq("and three matches are still one pointer", s.pendingHooks.size, 1);

    sessions.armTurnEnd(s);
    eq("not even at the instant of the yield", s.sent.length, 0);
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("delivered once the turn has settled", s.sent.length, 1);
    ok("and it is the pointer, not the payload", /context-hook name="smoke-hooks-authored"/.test(s.sent[0]));

    // THE FAILURE THE DEBOUNCE EXISTS FOR: a turn the human had already queued gets announced
    // between the yield and the flush. Firing into that gap puts the pointer right back beside his
    // message, which is the whole thing this change is undoing.
    const t = mk();
    sessions.fireHooks(t, { kind: "usage", snapshot: true, pct: 82 });
    sessions.armTurnEnd(t);
    sessions.fireHooks(t, { kind: "user.prompt", text: "actually, one more thing" });
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("a new turn cancels the flush", t.sent.length, 0);
    eq("and the pointer is still held for the NEXT ending", t.pendingHooks.size, 1);
    sessions.armTurnEnd(t);
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("which it gets", t.sent.length, 1);

    // AND A MOMENT THAT ARRIVES AT AN IDLE SESSION STILL LANDS. session.started, a message from
    // another session, a page event — none of them are inside a turn, so there is no yield coming.
    // Holding for one would mean waiting until the human happened to speak, which for an
    // unattended agent is never.
    const u = mk();
    sessions.fireHooks(u, { kind: "usage", snapshot: true, pct: 82 });
    await wait(sessions.TURN_SETTLE_MS + 250);
    eq("an idle session gets it without waiting for a turn that is not coming", u.sent.length, 1);

    // ---------------------------------------------------------------------------------------
    // THE IDLE EVENT — the turn ended and nobody came back. Driven with the real timer, not a
    // mocked clock, so the claims are about the mechanism as it will actually run; IDLE_MS is
    // read from the module and temporarily shortened, which is the only way to assert a
    // five-minute quiet inside a smoke test.
    // QUIET TICKS AND REPORTS; THE HOOK DECIDES WHAT COUNTS. No threshold lives in the emitter,
    // so what these claims check is that `quietMin` keeps an honest count, that activity resets
    // it, and that a hook's own `when` is what picks a duration out of it.
    console.log("\nquiet ticks, and the hook picks its own threshold");
    {
      const REAL = sessions.IDLE_TICK_MS;
      const SOON = "smoke-idle-nudge", LONG = "smoke-idle-long", LONG15 = "smoke-idle-15";
      hooks.save({ name: SOON, on: "idle", when: { quietMin: { gte: 1 } }, do: "skill:context-maintenance", kind: "context", author: "agent:smoke" });
      hooks.save({ name: LONG, on: "idle", when: { quietMin: { gte: 3 } }, do: "skill:study", kind: "context", author: "agent:smoke" });
      hooks.save({ name: LONG15, on: "idle", when: { quietMin: { gte: 15 } }, do: "skill:doc-maintenance", kind: "context", author: "agent:smoke" });

      // NOBODY LISTENING, NOTHING RUNS. The cost of the signal exists only where it was asked for.
      const none = mk();
      none.carriesHooks = [];
      sessions.armTurnEnd(none);
      eq("an agent with no idle hook arms no clock", none.idleTimer, null);
      eq("and its wake interval is nothing at all", sessions.idleWakeMs(none), 0);

      // THE WAKE RATE IS THE HOOKS' THRESHOLDS, NOT A CONSTANT. Waking every minute to learn it
      // is not 15 yet is work nobody ordered.
      eq("one hook at 15 minutes → wake every 15", sessions.idleWakeMs({ carriesHooks: [LONG15] }), 15 * 60000);
      eq("plus one at 1 minute → wake at the smallest", sessions.idleWakeMs({ carriesHooks: [LONG15, SOON] }), 60000);

      // DERIVED FROM THE CLOCK, NOT COUNTED — so a throttled or slept timer still tells the truth.
      // The hook's own event carries the answer, so that is what gets asserted.
      sessions.__setIdleTick(60);
      const i = mk();
      i.carriesHooks = [SOON];
      sessions.armTurnEnd(i);
      ok("a listening agent does arm one", !!i.idleTimer);
      i.quietSince = Date.now() - 7 * 60000;  // as if the machine had been asleep seven minutes
      await wait(150);
      const held = i.pendingHooks.get(SOON);
      ok("one late wake still delivers the pointer", !!held);
      eq("and reports the REAL elapsed quiet, not a tick count", held && held.event.quietMin, 7);
      eq("and NOTHING was written to the feed", i.events.length, 0);

      // ACTIVITY RESETS IT — he came back, so the session is not quiet at all.
      sessions.fireHooks(i, { kind: "user.prompt", text: "actually —" });
      eq("he came back, so the stretch is discarded", i.quietSince, 0);
      sessions.armTurnEnd(i);
      ok("and the next yield starts a fresh one", i.quietSince > 0);
      sessions.__setIdleTick(REAL);

      // THE THRESHOLD IS THE HOOK'S, NOT THE EMITTER'S — one event, two durations, no constant
      // anywhere in the harness. This is the whole reason the emitter reports instead of judging.
      const at = (m, carries) => hooks.fire({ kind: "idle", quietMin: m }, { carries, fired: new Map(), cleared: new Map(), turn: m }).length;
      eq("at 1 quiet minute the nudge fires", at(1, [SOON]), 1);
      eq("the long-work hook does not", at(1, [LONG]), 0);
      eq("at 3 minutes it does", at(3, [LONG]), 1);
      eq("and both fire once it is quiet enough for both", at(3, [SOON, LONG]), 2);
      for (const n of [SOON, LONG, LONG15]) { try { hooks.remove(n); } catch {} }
    }

    // -------------------------------------------------------------------------------------------
    // THE FIRE RATE — his decomposition. `when` is a condition about NOW; the rate is a fact about
    // this hook and this agent over TIME, and they are orthogonal. Every claim here is about the
    // half that was broken: a rate longer than one session silently became once-per-session,
    // because the fire history lived in a Map the session threw away.
    console.log("\nthe fire rate is persisted, parsed, and refused when malformed");
    {
      const RATE = "smoke-rate-daily";
      const FIRED = path.join(process.env.HOME || "", ".autobot", "hooks-fired.json");
      const keep = (() => { try { return fs.readFileSync(FIRED, "utf8"); } catch { return null; } })();
      try { fs.unlinkSync(FIRED); } catch {}

      eq("30m", hooks.parseDur("30m"), 1800000);
      eq("3d12h", hooks.parseDur("3d12h"), 302400000);
      eq("2w", hooks.parseDur("2w"), 1209600000);
      eq("bare digits are still seconds, so old hooks keep their meaning", hooks.parseDur("302400"), 302400000);
      ok("and a duration it cannot read is NaN, never zero", Number.isNaN(hooks.parseDur("2weeks")));

      // REFUSED AT THE WRITING DOOR. `cooldown:2w` used to save, read back, and fire every time.
      const bad = (r) => { try { hooks.save({ name: "smoke-rate-bad", on: "idle", do: "skill:study", kind: "context", author: "agent:smoke", rate: r }); return false; } catch { return true; } };
      ok("cooldown:2weeks is refused", bad("cooldown:2weeks"));
      ok("once-per-fortnight is refused", bad("once-per-fortnight"));
      ok("cooldown:2w is accepted", !bad("cooldown:2w"));
      try { hooks.remove("smoke-rate-bad"); } catch {}

      hooks.save({ name: RATE, on: "idle", when: {}, do: "skill:doc-maintenance", kind: "context", author: "agent:smoke", rate: "once-per-day" });
      const ev = { kind: "idle", quietMin: 20 };
      // a FRESH fired Map each time is exactly what a restarted session looks like
      const go = () => hooks.fire(ev, { agentId: "agent:smoke", carries: [RATE], fired: new Map(), cleared: new Map(), turn: 1 });
      const first = go();
      eq("it fires once", first.length, 1);
      hooks.recordFired(first[0], { agentId: "agent:smoke" });
      eq("and is held for the rest of the day", go().length, 0);
      eq("HELD ACROSS A RESTART — the rate is not session state", go().length, 0);

      // and the calendar turns over
      const st = JSON.parse(fs.readFileSync(FIRED, "utf8"));
      st[`agent:smoke|${RATE}`].ts = Date.now() - 26 * 3600000;
      fs.writeFileSync(FIRED, JSON.stringify(st));
      eq("a new day releases it", go().length, 1);

      // PER AGENT, NOT PER HOOK: a shared hook carried by two agents has two cadences.
      eq("another agent is not silenced by mine", hooks.fire(ev, { agentId: "agent:other", carries: [RATE], fired: new Map(), cleared: new Map(), turn: 1 }).length, 1);

      try { hooks.remove(RATE); } catch {}
      if (keep == null) { try { fs.unlinkSync(FIRED); } catch {} } else fs.writeFileSync(FIRED, keep);
    }

    // ── ONCE-PER-RISE — ONCE PER CROSSING, AND THE FALL IS WHAT RE-ARMS IT ───────────────────
    // His report, 2026-10-12: *"two times in a row context maintenance did not fire."* He was
    // right. `context-maintenance` is `on: usage, when: pct >= 60` with `once-per-session`: it
    // fired at the first crossing and then never again for that session's whole life, because
    // `s.hooksFired` is created at session birth and NOTHING clears it — not even a compaction.
    // So the pass ran once, he compacted, the window refilled, and every later crossing was eaten.
    {
      console.log("\nonce-per-rise — the falling edge is the whole mechanism");
      const RISE = "smoke-hooks-rise";
      try { hooks.remove(RISE); } catch {}
      hooks.save({ name: RISE, on: "usage", when: { pct: { gte: 60 } }, do: "skill:context-maintenance",
                   kind: "context", author: "agent:smoke", rate: "once-per-rise", note: "throwaway" });

      // ONE Map across the whole sequence — that is what makes it one session's life, which is
      // exactly the condition the old rate could not survive.
      const fired = new Map();
      const at = (pct) => hooks.fire({ kind: "usage", pct }, { agentId: "agent:smoke", carries: [RISE], fired, cleared: new Map(), turn: 1 });

      eq("below the line it does not fire", at(40).length, 0);
      eq("the crossing fires it", at(72).length, 1);
      eq("held high, it stays quiet — a rise is not a clock", at(80).length, 0);
      eq("...and quiet however long it stays up there", at(95).length, 0);
      // THE FALL. This is the line that distinguishes this rate from once-per-session: under the
      // old rate everything below this point was silent forever.
      eq("the fall re-arms it, and is itself silent", at(25).length, 0);
      eq("THE SECOND CROSSING FIRES — the bug he reported", at(66).length, 1);
      eq("and it is one per crossing, not one per event above the line", at(67).length, 0);
      eq("a third crossing, after a third fall", (at(10), at(88)).length, 1);

      // NOT PERSISTED. A rise is about one context's life; a restart is a new one, and a restart
      // that found it still "fired" would stay silent on a fresh window — the original failure.
      hooks.recordFired({ name: RISE, rate: "once-per-rise" }, { agentId: "agent:smoke" });
      const st = (() => { try { return JSON.parse(fs.readFileSync(FIRED, "utf8")); } catch { return {}; } })();
      ok("nothing durable was written for it", !st[`agent:smoke|${RISE}`]);
      eq("so a fresh session is ARMED, not silenced",
        hooks.fire({ kind: "usage", pct: 90 }, { agentId: "agent:smoke", carries: [RISE], fired: new Map(), cleared: new Map(), turn: 1 }).length, 1);

      // ONLY ITS OWN EVENT KIND CAN RE-ARM IT. If any event lacking `pct` counted as a fall, an
      // idle tick between two usage reports would re-arm it and it would fire on every message.
      const f2 = new Map();
      const usage = (pct) => hooks.fire({ kind: "usage", pct }, { agentId: "agent:smoke", carries: [RISE], fired: f2, cleared: new Map(), turn: 1 });
      usage(70);
      hooks.fire({ kind: "idle", quietMin: 30 }, { agentId: "agent:smoke", carries: [RISE], fired: f2, cleared: new Map(), turn: 1 });
      eq("an unrelated event does not count as a fall", usage(75).length, 0);

      // REFUSED AT THE WRITING DOOR: with no `when` there is nothing to cross, so it would mean
      // once-per-session — the exact bug, wearing the new name.
      let refused = false;
      try {
        hooks.save({ name: "smoke-rise-nowhen", on: "compaction.after", do: "skill:context-retrieval",
                     kind: "context", author: "agent:smoke", rate: "once-per-rise" });
      } catch { refused = true; }
      ok("once-per-rise with no `when` is refused where somebody is watching", refused);
      try { hooks.remove("smoke-rise-nowhen"); } catch {}
      try { hooks.remove(RISE); } catch {}
    }
  })();
} finally {
  try { fs.unlinkSync(path.join(defs.DIR, `${ID}.json`)); } catch {}
  for (const n of [HOOK, HOOK2]) { try { hooks.remove(n); } catch {} }
}

console.log(failed ? `\n✗ ${failed} failed\n` : "\n✓ hooks smoke passed\n");
process.exit(failed ? 1 : 0);
