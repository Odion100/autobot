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
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
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
} finally {
  try { fs.unlinkSync(path.join(defs.DIR, `${ID}.json`)); } catch {}
  for (const n of [HOOK, HOOK2]) { try { hooks.remove(n); } catch {} }
}

console.log(failed ? `\n✗ ${failed} failed\n` : "\n✓ hooks smoke passed\n");
process.exit(failed ? 1 : 0);
