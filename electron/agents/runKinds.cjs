// A MODULE OF ITS OWN, AND THE REASON IS A CYCLE. These facts are read by worklist.cjs (retention,
// the strip filter) and by nudge.cjs (which sources the chaser counts), and worklist already
// requires nudge for the retention windows — so putting the kinds in either one makes the other
// load it mid-initialisation. Measured: Node warned "Accessing non-existent property 'readSettings'
// of module exports inside circular dependency", and the only reason nothing broke was luck of
// ordering. A definition two modules share belongs to neither.
// His ask, 2026-11-09: a new kind should be able to arrive and "could potentially grow into more",
// with its own tab and its own switch in the settings. It could not, and the reason is this file's
// own history: the facts about a kind were typed into five places that had no idea about each other
// — this regex, `stripRuns`' filter, the chaser's default `sources`, the sourced-write door's advice
// to the agent, and the window's tab list. `correction:` landed in three of the five and the two it
// missed each failed in a different disguise: a run that reached the window but drew no row, and a
// door that told the agent working a correction that its run was unheld while the band drew it.
//
// So the kinds are DATA and everything derives. A new one is this array plus a tab label.
//
//   prefix — what a source starts with, colon included. The identity.
//   label  — what the window calls a group of them. Plural, because it labels a count.
//   work   — does it have an ARTIFACT somebody may come back to? That decides retention:
//            `keepWorkHours` (14 days) rather than `keepHours` (12 hours). A job and a lane do. So
//            does a CORRECTION — it is work another agent owes, and that agent may not sit down
//            again until tomorrow, so at the short window one submitted in the evening is swept
//            before anybody reads it, a bug indistinguishable from nobody submitting any.
//   own    — may an agent SOURCE ITS OWN run with it? Three may. `correction:` may not: the assign
//            verb writes it when work is handed to another agent, and an agent sourcing its own list
//            that way would be forging a correction against itself.
const KINDS = Object.freeze([
  Object.freeze({ prefix: "job:", label: "jobs", work: true, own: true }),
  Object.freeze({ prefix: "lane:", label: "lanes", work: true, own: true }),
  Object.freeze({ prefix: "skill:", label: "skills", work: false, own: true }),
  Object.freeze({ prefix: "assignment:", label: "assignment", work: true, own: true }),
  Object.freeze({ prefix: "correction:", label: "corrections", work: true, own: false }),
]);

const kindOf = (source) => KINDS.find((k) => String(source || "").startsWith(k.prefix)) || null;
const PREFIXES = Object.freeze(KINDS.map((k) => k.prefix));
const OWN_PREFIXES = Object.freeze(KINDS.filter((k) => k.own).map((k) => k.prefix));

// Kept for readers that want the old predicate's shape; it now derives, so it cannot disagree.

module.exports = Object.freeze({ KINDS, kindOf, PREFIXES, OWN_PREFIXES });
