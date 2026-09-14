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
} finally {
  try { fs.unlinkSync(path.join(defs.DIR, `${ID}.json`)); } catch {}
}

console.log(failed ? `\n✗ ${failed} failed\n` : "\n✓ hooks smoke passed\n");
process.exit(failed ? 1 : 0);
