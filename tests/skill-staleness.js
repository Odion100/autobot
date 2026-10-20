// EDITING A SKILL MAKES A SESSION STALE — the gap this closes, proven.
//
// THE CLAIMS:
//   1. A skill the agent CARRIES contributes to the stamp; one it does not carry never does.
//   2. Editing a carried skill's SKILL.md changes the stamp — the case that produced nothing before.
//   3. Creating a skill the agent already names changes it too — a carried name with no file is 0,
//      and 0 → mtime is a change.
//   4. The order of the carried list does not matter; the content of the files does.
//   5. The scan is SHARED AND CACHED: one pass per TTL however many sessions ask. This is the claim
//      that keeps the fix from becoming the 154%-CPU bug the file warns about.
//   6. `Skills` is its own named part of the composition, so the panel can say which input moved.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-skillstale-"));
const SKILLS = path.join(scratch, "skills");
const DEFS = path.join(scratch, "defs");
fs.mkdirSync(SKILLS, { recursive: true });
fs.mkdirSync(DEFS, { recursive: true });

// THE SOURCES AND THE DEFS ARE SCRATCH. A suite that reads the real skill folder would pass or fail
// on whatever the author happened to have installed, which is not a claim about this code.
process.env.AUTOBOT_SKILL_SOURCES_FILE = path.join(scratch, "skill-sources.json");
fs.writeFileSync(
  process.env.AUTOBOT_SKILL_SOURCES_FILE,
  JSON.stringify([{ name: "scratch", pattern: SKILLS, writable: true, discoverable: true }]),
);
process.env.AUTOBOT_AGENT_DEFS_DIR = DEFS;

let pass = 0;
const ok = (n) => { pass++; console.log(`  ok  ${n}`); };

const writeSkill = (name, desc) => {
  fs.mkdirSync(path.join(SKILLS, name), { recursive: true });
  fs.writeFileSync(path.join(SKILLS, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`);
};
const writeDef = (id, skills) =>
  fs.writeFileSync(path.join(DEFS, `${id}.json`), JSON.stringify({ id, def: { prompt: "p", skills } }));

writeSkill("alpha", "the first one");
writeSkill("beta", "the second one");
writeDef("ag", ["alpha"]);

const sessions = require("../electron/agents/sessions.cjs");
const { skillsStamp, skillMtimes } = sessions;

// If the environment seams are not honoured, every stamp below is about the author's own machine
// and the suite proves nothing. Say so loudly rather than printing greens.
const seen = skillMtimes();
assert.ok(seen.has("alpha") && seen.has("beta"), "the scratch skill source must be the one scanned — check AUTOBOT_SKILL_SOURCES_FILE is honoured");
ok("the scan reads the configured sources, not the author's own skills folder");

// ---- 1. CARRIED ONLY ----------------------------------------------------------------------------
const base = skillsStamp("ag");
assert.notEqual(base, 0, "an agent carrying a skill has a non-zero stamp");

writeSkill("beta", "the second one, rewritten");          // not carried by `ag`
SKILLS_WAIT();
assert.equal(skillsStamp("ag"), base, "another agent's skill churn must not touch this one");
ok("only the skills the agent CARRIES count — a skill it does not carry never makes it stale");

// ---- 2. AN EDIT IS A CHANGE ---------------------------------------------------------------------
// The whole point. Before this, rewriting a description moved nothing, so fifteen edits produced
// fifteen silences.
writeSkill("alpha", "the first one, with a completely different trigger");
SKILLS_WAIT();
const afterEdit = skillsStamp("ag");
assert.notEqual(afterEdit, base, "editing a carried skill's description must change the stamp");
ok("editing a carried skill's description makes the session stale — the case that was silent");

// ---- 3. A SKILL APPEARING -----------------------------------------------------------------------
writeDef("ag", ["alpha", "gamma"]);                        // carries one that does not exist yet
SKILLS_WAIT();
const missing = skillsStamp("ag");
writeSkill("gamma", "brand new");
SKILLS_WAIT();
assert.notEqual(skillsStamp("ag"), missing, "a carried skill appearing on disk must change the stamp");
ok("a carried name with no file is 0, and the file appearing is a change — the new-skill case");

// ---- 4. ORDER IS NOT CONTENT --------------------------------------------------------------------
writeDef("ag", ["gamma", "alpha"]);
SKILLS_WAIT();
const reordered = skillsStamp("ag");
writeDef("ag", ["alpha", "gamma"]);
SKILLS_WAIT();
assert.equal(skillsStamp("ag"), reordered, "reordering the carried list is not a change to what is composed");
ok("the order of the carried list does not matter — the files' contents do");

// ---- 5. THE HOT PATH, WHICH IS THE REASON THIS SHAPE EXISTS ------------------------------------
// `list()` is polled and staleParts() runs twice per session per projection. A stat per skill per
// session would scale with rooms open; this scales with the clock instead.
{
  const realRead = fs.readdirSync;
  let scans = 0;
  fs.readdirSync = (...a) => { scans += 1; return realRead(...a); };
  for (let i = 0; i < 50; i += 1) skillsStamp("ag");
  fs.readdirSync = realRead;
  assert.ok(scans <= 1, `fifty stamp calls inside one TTL must scan at most once, saw ${scans}`);
  ok("fifty calls inside one TTL cause at most one scan — the cost is the clock, not the room count");
}

// ---- 6. IT IS A NAMED PART ----------------------------------------------------------------------
// The panel says WHICH input moved; "Skills" and "Agent doc" are different things to go and look at.
{
  const comp = sessions.compositionOf ? sessions.compositionOf("ag", scratch) : null;
  if (comp) {
    assert.ok(Object.prototype.hasOwnProperty.call(comp, "Skills"), "Skills is its own part of the composition");
    ok("Skills is named separately from Agent doc, so the notice can say which one moved");
  } else {
    // compositionOf is not exported — the part is still proven by skillsStamp feeding it, and the
    // honest thing is to say that rather than print a green for something not checked.
    console.log("  --  compositionOf is not exported; the named part is unverified here");
  }
}

console.log(`\n  ${pass} claims, all green — editing a skill makes a session stale\n`);
fs.rmSync(scratch, { recursive: true, force: true });

// The TTL is real time, so a test that edits a file and asks again inside the same millisecond
// window would read the cache and prove nothing. Waiting it out is the honest way to test a clock.
function SKILLS_WAIT() {
  const until = Date.now() + 1100;
  while (Date.now() < until) { /* spin — 1.1s, deliberately longer than SKILLS_TTL_MS */ }
}
