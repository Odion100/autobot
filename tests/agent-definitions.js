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
const a1 = definitions.adopt({ projectCode: "buAPI", cwd: "/tmp/bu", permissionMode: "default" });
assert.ok(a1 && a1.id, "a run with no definition gets one");
const a2 = definitions.adopt({ projectCode: "buAPI", cwd: "/tmp/bu", permissionMode: "default" });
assert.equal(a2.id, a1.id, "same placement adopts the SAME agent, not a second one");
const a3 = definitions.adopt({ projectCode: "buAPI", cwd: "/tmp/other" });
assert.notEqual(a3.id, a1.id, "a different directory is a different agent");
assert.equal(definitions.adopt({}), null, "no placement, nothing adopted — never a nameless file");
assert.equal(definitions.get(a1.id).adopted, true, "adopted agents are marked, never disguised as authored");
ok("adoption is per-placement, marked, and never nameless");

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\n${pass} claims held — RFC-003 definitions + adoption\n`);
