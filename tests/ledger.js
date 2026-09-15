// smoke:ledger — RFC-057's call ledger against the REAL module: classification, pairing a call to
// its result, failures, the day file, the sweeper, the `since` stamp, and the aggregate.
//
// WRITES NOWHERE NEAR THE REAL LEDGER. AUTOBOT_LEDGER_DIR points the module at a temp directory
// created and removed by this file. The context smoke test's preface is the reason: a test that
// writes to the live path does not fail loudly, it quietly makes the numbers wrong.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-smoke-"));
process.env.AUTOBOT_LEDGER_DIR = dir;
const require = createRequire(import.meta.url);
const ledger = require("../electron/agents/ledger.cjs");

let failed = 0;
const ok = (what, cond) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${what}`);
  if (!cond) failed++;
};
const eq = (what, a, b) => ok(`${what} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

try {
  console.log("\nclassification — kind comes from the tool name, never a second vocabulary");
  eq("an MCP tool", ledger.classify("mcp__context__remember", {}), { kind: "mcp", name: "context.remember" });
  eq("a skill names the skill it loaded", ledger.classify("Skill", { skill: "context-retrieval" }), { kind: "skill", name: "context-retrieval" });
  eq("anything else is a plain tool", ledger.classify("Bash", {}), { kind: "tool", name: "Bash" });

  const s = { agentId: "smoke-agent", projectCode: "smoke-proj", sessionId: "smoke" };
  const t0 = Date.parse("2026-09-14T10:00:00.000Z");

  console.log("\npairing — the name and the clock live on the call, ok lives on the result");
  ledger.record(s, { kind: "tool.call", id: "a", name: "Bash", input: {}, ts: t0 });
  ledger.record(s, { kind: "tool.result", id: "a", ok: true, ts: t0 + 250 });
  let st = ledger.stats({});
  eq("one row, one call", st.totals.calls, 1);
  eq("duration came from the pair", st.calls[0].p50, 250);
  eq("the agent is on the row", st.calls[0].agents, { "smoke-agent": 1 });

  console.log("\na result with no call is a replayed transcript, not a live call");
  ledger.record(s, { kind: "tool.result", id: "never-called", ok: true, ts: t0 + 300 });
  eq("still one row", ledger.stats({}).totals.calls, 1);

  console.log("\nfailures are counted, not hidden");
  ledger.record(s, { kind: "tool.call", id: "b", name: "mcp__context__remember", input: {}, ts: t0 });
  ledger.record(s, { kind: "tool.result", id: "b", ok: false, ts: t0 + 10 });
  st = ledger.stats({});
  eq("one failure", st.totals.fails, 1);
  ok("it is on the MCP row", st.calls.some((c) => c.kind === "mcp" && c.fails === 1));

  console.log("\nhooks and sessions are their own kinds");
  ledger.record(s, { kind: "hook.fired", name: "context-retrieval", on: "compaction.after", ts: t0 });
  ledger.record(s, { kind: "session.started", origin: "resumed", ts: t0 });
  st = ledger.stats({});
  eq("byKind", st.byKind, { tool: 1, mcp: 1, hook: 1, session: 1 });
  // ORIGIN SURVIVES THE ROW. A hook keys on it, so a log that drops it can show that the hook fired
  // and never what it matched — which is the question asked the first time one misfired.
  const sessionRows = fs
    .readFileSync(path.join(dir, `calls-${new Date(t0).toISOString().slice(0, 10)}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((r) => r.kind === "session");
  eq("origin is on the session row", sessionRows[0] && sessionRows[0].origin, "resumed");

  console.log("\nnarration is not a call — deltas would be the highest-frequency rows in the system");
  ledger.record(s, { kind: "assistant.text", text: "hello", ts: t0 });
  ledger.record(s, { kind: "usage", pct: 40, ts: t0 });
  eq("nothing added", ledger.stats({}).totals.calls, 4);

  console.log("\nfilters");
  eq("by agent, present", ledger.stats({ agent: "smoke-agent" }).totals.calls, 4);
  eq("by agent, absent", ledger.stats({ agent: "nobody" }).totals.calls, 0);
  eq("by project", ledger.stats({ project: "smoke-proj" }).totals.calls, 4);

  console.log("\nthe day file, and a `since` that tells the truth about what survives");
  const files = fs.readdirSync(dir).filter((f) => /^calls-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  eq("one dated file", files.length, 1);
  ok("since is an ISO stamp from the first surviving line", !!Date.parse(ledger.since() || ""));

  console.log("\nthe sweeper drops whole days, older than the window");
  // ONCE PER DAY, NOT ONCE PER WRITE. The sweep is guarded on the date it last ran, so it costs one
  // readdir a day rather than one per call — which means a file dropped in mid-day survives until
  // the first write of the NEXT day. That is the real contract, so it is what gets asserted.
  fs.writeFileSync(path.join(dir, "calls-2020-01-01.jsonl"), JSON.stringify({ ts: Date.parse("2020-01-01T00:00:00Z"), kind: "tool", name: "Ancient", ok: true }) + "\n");
  ok("an old day is readable before the sweep", ledger.stats({}).calls.some((c) => c.name === "Ancient"));
  const tomorrow = t0 + 86400000;
  ledger.record(s, { kind: "tool.call", id: "c", name: "Read", input: {}, ts: tomorrow });
  ledger.record(s, { kind: "tool.result", id: "c", ok: true, ts: tomorrow + 5 });
  ok("swept on the first write of a new day", !fs.existsSync(path.join(dir, "calls-2020-01-01.jsonl")));
  ok("the new day has its own file", fs.existsSync(path.join(dir, "calls-2026-09-15.jsonl")));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n✗ ${failed} failed\n` : "\n✓ ledger smoke passed\n");
process.exit(failed ? 1 : 0);
