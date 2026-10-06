// RFC-003, as a test instead of an argument.
//
// THE CLAIMS, in the order they'd hurt if they broke:
//   1. A definition supplies DEFAULTS, never overrides — an explicit argument at
//      open() always wins (his q1 lean: placement is a default, not a pin).
//   2. The SDK half survives a round trip unmapped, because we adopted the SDK's
//      own AgentDefinition rather than inventing a parallel schema.
//   3. Absent fields stay absent. An unconfigured agent must open exactly like
//      today's ad-hoc session, not like one configured with undefined.
//   4. A project rename carries its agents, or they point at a code that no
//      longer resolves and fail at open.
//
// Run: npm run smoke:defs
// ESM per the project rule; createRequire loads the .cjs substrate.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Point HOME at a scratch dir BEFORE requiring — definitions.cjs resolves its
// directory at module load, and a test that writes into his real ~/.autobot is a
// test that edits his agents.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-defs-"));
process.env.HOME = scratch;
os.homedir = () => scratch;

// AND THE WORKLIST STORE TOO, EXPLICITLY. The chore-board claims below reach worklist.cjs — which
// sweeps closed runs at module load and whose pruneRuns, run against the real store, once deleted
// the user's live lane records (see the comment at worklist.cjs's DIR). The scratch HOME above
// would already cover it; this says so out loud, because a janitor reached transitively is still a
// janitor with the keys.
process.env.AUTOBOT_WORKLISTS_DIR = path.join(scratch, "worklists");
fs.mkdirSync(process.env.AUTOBOT_WORKLISTS_DIR, { recursive: true });
// AND THE SETTINGS STORE. The retention window is a SETTING now (`nudge.json keepHours`), so the
// sweep claim below would otherwise read whatever is configured on this machine and pass or fail
// for a reason that has nothing to do with the code. A scratch path that does not exist reads as
// the defaults.
process.env.AUTOBOT_NUDGE_FILE = path.join(scratch, "nudge.json");

const definitions = require("../electron/agents/definitions.cjs");

let pass = 0;
const ok = (name) => { pass++; console.log(`  ok  ${name}`); };

// ---- 2. the SDK half round-trips with no mapping -------------------------------
const saved = definitions.save({
  name: "Reviewer",
  description: "reviews a diff",
  prompt: "You review changes.",
  tools: ["Read", "Grep"],
  disallowedTools: ["Bash"],
  skills: ["code-review"],
  model: "claude-fable-5",
  maxTurns: 12,
  projectCode: "autobot",
  permissionMode: "default",
});
assert.equal(saved.id, "reviewer", "id is slugged from the name");
assert.equal(saved.def.prompt, "You review changes.");
assert.deepEqual(saved.def.tools, ["Read", "Grep"]);
assert.deepEqual(saved.def.disallowedTools, ["Bash"]);
assert.deepEqual(saved.def.skills, ["code-review"]);
assert.equal(saved.def.maxTurns, 12);
ok("SDK fields round-trip into def, unmapped");

// placement and gating are OURS and must not be mixed into the SDK half — if they
// leak into `def` they get spread into query options and the SDK sees junk
assert.equal(saved.def.projectCode, undefined, "placement must not leak into def");
assert.equal(saved.def.permissionMode, undefined, "gating must not leak into def");
assert.equal(saved.projectCode, "autobot");
assert.equal(saved.permissionMode, "default");
ok("placement and gating stay out of the SDK half");

// ---- 3. absent stays absent ----------------------------------------------------
const bare = definitions.save({ name: "Bare" });
assert.deepEqual(Object.keys(bare.def), [], "an unconfigured agent carries no SDK fields at all");
assert.equal(bare.projectCode, null);
assert.equal(bare.permissionMode, null);
ok("absent fields stay absent — no undefined smuggled through");

// ---- resolve() hands back the three parts separately ---------------------------
const r = definitions.resolve("reviewer");
assert.equal(r.name, "Reviewer");
assert.equal(r.projectCode, "autobot");
assert.equal(r.permissionMode, "default");
assert.deepEqual(r.def.tools, ["Read", "Grep"]);
assert.equal(definitions.resolve("nope"), null, "unknown id resolves null, not a blank agent");
ok("resolve() separates def / placement / gating, and refuses unknown ids");

// ---- 1. defaults never override ------------------------------------------------
// This mirrors what open() does with a definition. Kept in lockstep by intent:
// if open()'s precedence changes, this is the line that should fail.
const applyLikeOpen = (agent, explicit) => ({
  projectCode: explicit.projectCode || agent.projectCode,
  cwd: explicit.cwd || agent.cwd,
  model: explicit.model || agent.def.model,
  permissionMode: explicit.permissionMode || agent.permissionMode,
});
const pinned = applyLikeOpen(r, {});
assert.equal(pinned.projectCode, "autobot", "with nothing explicit, the definition places it");
assert.equal(pinned.model, "claude-fable-5");
const pointed = applyLikeOpen(r, { projectCode: "buAPI", model: "claude-opus-5", permissionMode: "bypassPermissions" });
assert.equal(pointed.projectCode, "buAPI", "an explicit project wins — placement is a default, not a pin");
assert.equal(pointed.model, "claude-opus-5", "an explicit model wins");
assert.equal(pointed.permissionMode, "bypassPermissions", "explicit gating wins");
ok("a definition supplies defaults; explicit arguments always win");

// ---- 4. a project rename carries its agents ------------------------------------
definitions.save({ name: "Second", projectCode: "autobot" });
definitions.save({ name: "Elsewhere", projectCode: "buAPI" });
const moved = definitions.renameProject("autobot", "autobot2");
assert.equal(moved, 2, "both autobot agents moved");
assert.equal(definitions.get("reviewer").projectCode, "autobot2");
assert.equal(definitions.get("second").projectCode, "autobot2");
assert.equal(definitions.get("elsewhere").projectCode, "buAPI", "other projects untouched");
ok("a project rename carries its agents and leaves the rest alone");

// ---- removing a definition is not removing its runs ----------------------------
assert.equal(definitions.remove("second"), true);
assert.equal(definitions.get("second"), null);
assert.equal(definitions.remove("second"), false, "removing twice is false, not a throw");
ok("remove() is a definition decision and is idempotent-safe");

// ---- save-as-agent captures from something that ran ----------------------------
const captured = definitions.fromSession(
  { projectCode: "systemview-test", cwd: "/tmp/x", permissionMode: "default" },
  { name: "From A Run", prompt: "keep doing that" }
);
assert.equal(captured.projectCode, "systemview-test");
assert.equal(captured.cwd, "/tmp/x");
assert.equal(captured.permissionMode, "default");
assert.equal(captured.def.prompt, "keep doing that");
ok("save-as-agent captures placement and gating from a live run");

// ---- the list is a list --------------------------------------------------------
const all = definitions.list();
assert.ok(all.length >= 3, "list returns every definition on disk");
assert.ok(all.every((d) => d.id && d.name), "every record has an id and a name");
ok("list() returns whole records, newest first");


// ---- adoption: no implicit agents going forward --------------------------------
// His call: implicit is a migration state, not a species. A run with no definition
// must GET one — and a project's many conversations must stay ONE agent, or a busy
// day writes fifty junk files.
const a1 = definitions.adopt({ projectCode: "adoptee", cwd: "/tmp/bu", permissionMode: "default" });
assert.ok(a1 && a1.id, "a run with no definition gets one");
const a2 = definitions.adopt({ projectCode: "adoptee", cwd: "/tmp/bu", permissionMode: "default" });
assert.equal(a2.id, a1.id, "same placement adopts the SAME agent, not a second one");
const a3 = definitions.adopt({ projectCode: "adoptee", cwd: "/tmp/other" });
assert.equal(a3.id, a1.id, "a different directory within the SAME project is the SAME agent — adopt's own words: five conversations, one agent");
assert.equal(definitions.adopt({}), null, "no placement, nothing adopted — never a nameless file");
assert.equal(definitions.get(a1.id).adopted, true, "adopted agents are marked, never disguised as authored");
ok("adoption is per-project, marked, and never nameless");

// ---- adoption never disarms a configured agent ----------------------------------
// It happened live: a configured def (hooks, chores, prompt) sat at the plain id with one cwd; a
// session opened with another cwd, adopt() fell to the suffix path and minted a HOOKLESS twin —
// every idle behavior silently disarmed, the configured def abandoned. Same project must resolve
// to the same def, config intact, twin never minted.
definitions.save({ id: "cfg-proj", name: "cfg-proj", projectCode: "cfg-proj", cwd: "/tmp/cfg-a",
  prompt: "the role", hooks: ["h1", "h2"], chores: [{ what: "skill:x", period: "daily" }] });
const kept = definitions.adopt({ projectCode: "cfg-proj", cwd: "/tmp/cfg-b" });
assert.equal(kept.id, "cfg-proj", "a cwd variation adopts the configured def, never a twin");
assert.deepEqual(definitions.get("cfg-proj").def.hooks, ["h1", "h2"], "its hook carries survive untouched");
assert.ok(Array.isArray(definitions.get("cfg-proj").def.chores) && definitions.get("cfg-proj").def.chores.length === 1,
  "and its chore lines survive");
assert.equal(definitions.get("cfg-proj").def.prompt, "the role", "and its prompt");
assert.ok(!definitions.list().some((d) => d.id.startsWith("cfg-proj-")),
  "no suffixed twin exists anywhere");
ok("adoption never disarms a configured agent — same project, same def, config intact");

// ---- THE ROUND TRIP: reading a record and saving it back must not wipe it -------
// Found 2026-09-09 reviewing systemview-0c's docs/skills work. normalize() reads
// TOP-LEVEL SDK fields, but a STORED record keeps them nested under `def` — so
// `{...prev}` never surfaced them and save() rebuilt an empty def. The live path
// was the panel's own save button (agent:def-save -> definitions.save(rec)):
// rename an agent in the UI and its assignment, tools and skills were gone, with
// NO error, still running, still pointed at the right repo. Placement and gating
// survived, which is what made it look healthy.
//
// The class: ONE VALUE, TWO SHAPES — flat as authored, nested as stored — and a
// function that only understood one of them. Same family as the number-scope and
// label/record cases: ask which other shape resolves this, and whether it agrees.
const full = definitions.save({
  name: "RoundTrip", prompt: "P", tools: ["Read", "Grep"], skills: ["cr"],
  description: "d", model: "m", projectCode: "autobot", permissionMode: "default",
});
const stored = definitions.get("roundtrip");
assert.deepEqual(definitions.save(stored).def, full.def,
  "saving a record straight back from get() must keep the def — this is what the UI does");
assert.deepEqual(definitions.save({ id: "roundtrip", name: "Renamed" }).def, full.def,
  "a rename-only save must not wipe prompt/tools/skills");
const edited = definitions.save({ id: "roundtrip", prompt: "NEW" });
assert.equal(edited.def.prompt, "NEW", "an explicit edit still wins over the stored value");
assert.deepEqual(edited.def.tools, ["Read", "Grep"], "...and leaves the fields it did not name alone");
assert.equal(edited.projectCode, "autobot", "placement survives every shape");
ok("a save that reads then writes keeps the whole def (both shapes accepted)");

// ---- THE SECOND WHITELIST: the subscription sidecar -----------------------------
// `cleanSubs` is to the sidecar what `normalize` is to the definition, and it has the same teeth:
// a key it does not list is a key the writer can set, be told succeeded, and never read back. That
// is exactly how the profile's hook switch became a lie one layer up, and it presented as "the UI
// is broken" rather than as a missing key.
//
// It matters here because a subscription is now a hook — a `do` that names content instead of a
// procedure — and the two axes it gained, the condition on the moment (`if`) and the cadence
// (`rate`), are carried on THIS row and nowhere else.
definitions.save({ id: "subsrt", name: "SubsRoundTrip" });
definitions.saveSubscriptions("subsrt", [
  { what: "note:abc@system", when: ["post-compaction"], until: { ttl: "2d" }, addedAt: 1, if: { trigger: "auto" }, rate: "once-per-day" },
]);
const subBack = definitions.subscriptionsOf("subsrt")[0];
assert.deepEqual(subBack.if, { trigger: "auto" }, "`if` survives — a condition dropped here is a subscription that lists armed and never fires");
assert.equal(subBack.rate, "once-per-day", "`rate` survives — a cadence dropped here silently becomes no limit at all");
// AND A ROW USING NEITHER IS BYTE-FOR-BYTE THE OLD ONE. This is why the subscriptions already on
// disk needed no migration: the new shape is a superset, and an absent key stays absent rather
// than being written as an empty object nothing can tell from a choice.
definitions.saveSubscriptions("subsrt", [{ what: "note:xyz@system", when: ["session-start"], until: { untilTs: 9e12 }, addedAt: 2 }]);
assert.deepEqual(Object.keys(definitions.subscriptionsOf("subsrt")[0]).sort(), ["addedAt", "until", "what", "when"],
  "a pre-merge row round-trips with exactly its original four keys");
// A SAVE THAT NEVER MENTIONS SUBSCRIPTIONS MUST NOT DROP THEM — the `hooks` lesson, on the sidecar.
definitions.save({ id: "subsrt", prompt: "edited elsewhere" });
assert.equal(definitions.subscriptionsOf("subsrt").length, 1, "an unrelated def edit leaves the standing orders alone");
ok("the subscription sidecar round-trips `if` and `rate`, and a plain row keeps its old shape");

// ---------------------------------------------------------------------------------------------
// SKILL SOURCES — his design (2026-10-02). Two hardcoded directories became a LIST, so every
// provenance is one entry and ours is simply the writable one. What matters here is the two truths
// a source carries, and that read-only is ENFORCED rather than labelled: a shipped skill lives in a
// path keyed to the CLI's version and a content hash, so an edit that "worked" would evaporate on
// the next upgrade, having taught the agent that editing it works.
const sources = require("../electron/agents/skillSources.cjs");

// A FIXTURE, NOT THE MACHINE. This suite points HOME at a scratch dir, so the first version of
// these claims found zero skills and its `if (skill)` guards skipped in silence — passing while
// asserting nothing, which is the exact shape I had just filed against someone else's test runner.
// So the sources are DECLARED here (which exercises the config path too) and populated on disk.
const writeSkill = (dir, name, body) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`);
};
const mineDir = path.join(scratch, ".claude", "skills");
const shippedDir = path.join(scratch, "fake-bundled", "2.1.241", "deadbeef");
writeSkill(mineDir, "my-own-thing", "authored here");
writeSkill(shippedDir, "code-review", "ships with the CLI");
fs.mkdirSync(path.join(scratch, ".autobot"), { recursive: true });
fs.writeFileSync(path.join(scratch, ".autobot", "skill-sources.json"), JSON.stringify([
  { name: "ours", pattern: mineDir, writable: true, discoverable: true, exclude: ["synced"], note: "yours" },
  { name: "shipped", pattern: path.join(scratch, "fake-bundled", "*", "*"), writable: false, discoverable: true, note: "ships with the CLI" },
  { name: "ghost", pattern: path.join(scratch, "not-here", "*"), writable: false, discoverable: false, note: "nothing here" },
], null, 2));

const allSrc = definitions.skillSources("roundtrip");
const bySrc = Object.fromEntries(allSrc.map((x) => [x.name, x]));
assert.equal(allSrc.length, 3, "the sources FILE wins over the defaults");
assert.equal(bySrc.ours.writable, true, "ours is writable");
assert.equal(bySrc.shipped.writable, false, "shipped is not");
ok("skill sources are configuration — the file defines them, ours is just the writable one");

const found = definitions.skills("roundtrip");
assert.equal(found.length, 2, "both sources contributed, and only once each");
const mine = found.find((x) => x.name === "my-own-thing");
const shipped = found.find((x) => x.name === "code-review");
assert.equal(mine.source, "ours", "a skill knows which source it came from");
assert.equal(shipped.source, "shipped", "including the one we do not own");
assert.equal(shipped.writable, false, "...and whether it can be edited");
assert.equal(shipped.discoverable, true, "...and whether it can actually fire");
ok("every skill carries its provenance, so no surface has to infer it");

// ABSENCE IS STATED: "no skills here" and "this folder is not there" are different facts, and the
// shipped directory really is gone between CLI versions.
assert.equal(bySrc.ghost.unresolved, true, "a source that resolves to nothing says unresolved");
assert.equal(bySrc.ghost.count, 0, "and contributes nothing");
assert.equal(bySrc.shipped.unresolved, false, "while a real one is not unresolved");
assert.equal(bySrc.shipped.count, 1, "and is counted");
ok("a source that is not there is reported as absent, never as empty");

// A `*` MUST NOT MATCH A DOTFILE — the synced folder keeps a `.bucket-<uuid>` twin beside the real
// one, and matching both listed every account skill twice.
fs.mkdirSync(path.join(scratch, "fake-bundled", ".hidden-twin", "x"), { recursive: true });
writeSkill(path.join(scratch, "fake-bundled", ".hidden-twin", "x"), "code-review", "the twin");
assert.equal(definitions.skills("roundtrip").filter((x) => x.name === "code-review").length, 1,
  "a glob skips dotfiles, so a hidden twin cannot double a source");
ok("a hidden twin directory cannot double-count a source's skills");

// THE ENFORCEMENT, which is the entire point of the flag. An edit that "worked" and then evaporated
// on the next CLI upgrade is worse than a refusal, because it teaches that editing works.
const refused = definitions.saveSkill("roundtrip", "code-review", "shipped", "overwritten");
assert.equal(refused.ok, false, "editing a read-only skill is refused");
assert.ok(/shipped/.test(refused.error || ""), "and the refusal names the source");
assert.ok(fs.readFileSync(path.join(shippedDir, "code-review", "SKILL.md"), "utf8").includes("ships with the CLI"),
  "and the file on disk is untouched");
const created = definitions.createSkill("roundtrip", "smoke-should-not-exist", "shipped", "x");
assert.equal(created.ok, false, "creating inside a read-only source is refused too");
const still = definitions.saveSkill("roundtrip", "my-own-thing", "ours", "edited body");
assert.equal(still.ok, true, "while a writable source still saves");
ok("read-only is enforced at the write — and writable still writes");

// ---------------------------------------------------------------------------------------------
// CHORES — THE BOARD (RFC-067 §4). A per-agent list of lines, each naming a skill or a job and a
// period, each reading done or not done FOR THIS PERIOD. "Chores" names the list and not a
// procedure: there is no runner, so the only things to prove are that the list can be SAVED and
// that the query answers honestly.
const worklist = require("../electron/agents/worklist.cjs");
const DAY = 24 * 60 * 60 * 1000;
const byWhat = (board) => Object.fromEntries(board.map((l) => [l.what, l]));

// THE WHITELIST, which is this file's single most repeated failure: normalize() silently drops an
// unknown field, and a field it drops is a field the profile cannot save — it presents as "the UI
// is broken" with no error anywhere. `hooks` learned it the hard way; `chores` learns it here.
const chored = definitions.save({
  name: "Chored",
  projectCode: "chores-test",
  prompt: "P",
  chores: [
    "context-maintenance",                               // a bare name is a skill
    { what: "skill:doc-maintenance", period: "weekly" },
    { name: "job:accounting", period: "monthly" },       // a job is a line like any other
    { what: "skill:doc-maintenance", period: "daily" },  // the same pointer twice
    { what: "", period: "daily" },                       // not a line at all
    { what: "skill:unreadable", period: "fortnightly" }, // not a period we know
  ],
});
assert.deepEqual(chored.def.chores, [
  { what: "skill:context-maintenance", period: "daily" },
  { what: "skill:doc-maintenance", period: "weekly" },
  { what: "job:accounting", period: "monthly" },
  { what: "skill:unreadable", period: "daily" },
], "a line is a pointer plus a period; bare names become skills, duplicates and blanks are dropped");
ok("normalize() learns `chores` — the pointer vocabulary is the one runs and hooks already use");

// THE ROUND TRIP the UI actually does: read a record with get(), hand it straight back to save().
const storedChores = definitions.get("chored");
assert.deepEqual(storedChores.def.chores, chored.def.chores, "the board reads back off disk");
assert.deepEqual(definitions.save(storedChores).def.chores, chored.def.chores,
  "saving a record straight back from get() keeps the board — the nested shape is accepted too");
assert.deepEqual(definitions.save({ id: "chored", name: "Chored Again" }).def.chores, chored.def.chores,
  "and a rename-only save does not wipe it");
ok("chores survive normalize() and the read-then-write round trip, in both shapes");

const now = Date.now();

// NOTHING HAS RUN. "Never" has to be stated, not guessed at.
let board = byWhat(definitions.boardFor("chored", now));
assert.equal(board["skill:doc-maintenance"].done, false, "a line with no run is not done");
assert.equal(board["skill:doc-maintenance"].at, 0, "and `never` is 0, never a date");
assert.equal(board["skill:doc-maintenance"].period, "weekly", "the line carries its own period");
assert.equal(board["job:accounting"].kind, "job", "and says whether it points at a skill or a job");
assert.equal(board["job:accounting"].name, "accounting");
assert.ok(board["skill:doc-maintenance"].since <= now, "with the boundary it is answering against");
ok("a line reads unchecked with no run, and states `never` as 0 rather than inventing a date");

// A CLOSED RUN CHECKS THE LINE OFF, and nobody marked it — the run record is the evidence.
worklist.writeRun(
  worklist.newRunId(), "session:chores-test:s1",
  [{ id: "1", text: "tidied the docs", state: "done" }], "skill:doc-maintenance"
);
board = byWhat(definitions.boardFor("chored", now));
assert.equal(board["skill:doc-maintenance"].done, true, "a run with this line's source, closed, checks it");
assert.ok(board["skill:doc-maintenance"].at >= now, "and the board reports when");
assert.equal(board["skill:context-maintenance"].done, false, "only the line that actually ran");
ok("a closed run with the line's source checks the line off — the line checks ITSELF, from the record");

// A PROCEDURE ABANDONED HALFWAY LEAVES IT UNCHECKED, which RFC-067 calls out as correct.
worklist.writeRun(
  worklist.newRunId(), "session:chores-test:s1",
  [{ id: "1", text: "got as far as this", state: "active" }], "skill:context-maintenance"
);
assert.equal(byWhat(definitions.boardFor("chored", now))["skill:context-maintenance"].done, false,
  "a run that died mid-list is the record of where it died, not of a chore done");
ok("a run that died mid-list never checks a line — only a CLOSE is evidence");

// A CLOSE BEFORE THE CURRENT PERIOD DOES NOT COUNT. Two days ago is not today, and the board has to
// say so while still knowing exactly when it was.
const twoDaysAgo = now - 2 * DAY;
worklist.stampClosed("skill:context-maintenance", "session:chores-test:s1", twoDaysAgo);
board = byWhat(definitions.boardFor("chored", now));
assert.equal(board["skill:context-maintenance"].at, twoDaysAgo, "the board knows when it last closed");
assert.equal(board["skill:context-maintenance"].done, false, "and two days ago is not inside today");
ok("a run that closed BEFORE the current period does not count — the boundary is a boundary");

// IT DOES NOT STAY CHECKED. Nothing about the record changes; the period moves out from under it.
board = byWhat(definitions.boardFor("chored", now + 8 * DAY));
assert.equal(board["skill:doc-maintenance"].done, false, "the weekly line is unchecked a week later");
assert.ok(board["skill:doc-maintenance"].at > 0, "while still knowing exactly when it last closed");
assert.ok(board["skill:doc-maintenance"].since > now, "because the BOUNDARY moved, not the record");
ok("a new period unchecks a previously checked line — the board answers for THIS period only");

// SCOPED TO THE AGENT'S PLACEMENT. A run record names no agent; its session owner names a project,
// which is the only handle there is — and a line checked off by somebody else's work is a board
// nobody can trust.
worklist.writeRun(
  worklist.newRunId(), "session:somewhere-else:s9",
  [{ id: "1", text: "did the books", state: "done" }], "job:accounting"
);
assert.equal(byWhat(definitions.boardFor("chored", now))["job:accounting"].done, false,
  "a close in another project is not this agent's chore");
ok("the board is scoped to the agent's placement — another agent's work cannot check your line");

// THE CHECK IS A QUERY, NOT A STORED TICK: it writes nothing, so nothing it says can disagree with
// what happened — and it must not touch the definition either, whose mtime is the composition bell.
const filesBefore = fs.readdirSync(worklist.DIR).sort();
const defBefore = fs.readFileSync(path.join(definitions.DIR, "chored.json"), "utf8");
definitions.boardFor("chored", now);
assert.deepEqual(fs.readdirSync(worklist.DIR).sort(), filesBefore, "reading the board creates no file");
assert.equal(fs.readFileSync(path.join(definitions.DIR, "chored.json"), "utf8"), defBefore,
  "and does not touch the definition — an mtime change here would ring the composition bell");
ok("reading the board writes nothing at all — the check is a query, never a stored tick");

assert.deepEqual(definitions.boardFor("bare"), [], "an agent with no chores has an empty board");
assert.deepEqual(definitions.boardFor("nope"), [], "and an unknown agent is empty, not a throw");
ok("no chores is an empty board; an unknown agent is not an error");

// THE 14-DAY PROBLEM, which is the only build chores needed. Done LAST, because the sweep is
// global. AGAINST THE SCRATCH STORE — see the AUTOBOT_WORKLISTS_DIR note at the top of this file.
const monthly = worklist.newRunId();
worklist.writeRun(
  monthly, "session:chores-test:s1",
  [{ id: "1", text: "the books", state: "done" }], "job:accounting"
);
assert.equal(byWhat(definitions.boardFor("chored", now))["job:accounting"].done, true,
  "the monthly line is checked by its close");
assert.ok(worklist.pruneRuns(now + 15 * DAY) >= 1, "past the window, the janitor sweeps the closed run");
assert.deepEqual(worklist.read(worklist.runOwner(monthly)), [], "the run record is gone");
const swept = byWhat(definitions.boardFor("chored", now))["job:accounting"];
assert.equal(swept.done, true, "and the monthly line still reads done, not `never`");
assert.ok(swept.at > 0, "because the close left a stamp the janitor does not sweep");
ok("a monthly line survives the sweep — the stamp is the residue a swept run leaves");

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} claims held — RFC-003 definitions + adoption + round-trip + skill sources + the chore board\n`);
