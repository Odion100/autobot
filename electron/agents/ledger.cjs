"use strict";
// RFC-057 — THE CALL LEDGER. The context store can answer "is this note earning its place?" because
// every retrieval is stamped. Nothing else was written down: tool calls, MCP calls, skill fires and
// hook fires all went out through emit() to the live feed and vanished with the session. So the
// question he actually asked — "if we created these internal tools, are they being used properly?"
// — had no data behind it.
//
// A LEDGER, NOT A TRANSCRIPT. One flat line per completed call: ts · agent · project · kind · name
// · ok · ms. No arguments, no output. Arguments are what would make this file enormous and turn it
// into a privacy question, and the transcript already holds them. Small is the whole value.
const fs = require("fs");
const path = require("path");
const os = require("os");

// A SEAM FOR TESTS, AND ONLY FOR TESTS. The context store's own smoke test is prefaced with the
// lesson that paid for this: a test that SAYS "throwaway" and writes to the live path wipes real
// data. A ledger test that appended here would not wipe anything — it would do something subtler
// and worse, quietly inventing calls nobody made in the numbers this surface exists to be trusted
// about.
const ROOT = process.env.AUTOBOT_LEDGER_DIR || path.join(os.homedir(), ".autobot", "logs");
const KEEP_DAYS = 14;
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const fileFor = (ts) => path.join(ROOT, `calls-${day(ts)}.jsonl`);

// A tool call and its result are two events with an id between them. The name and the clock live on
// the CALL; ok lives on the RESULT. Holding the pair here is what makes one row possible — and it
// is bounded, because a session that leaks ids would otherwise leak them forever.
const pending = new Map();
const PENDING_MAX = 500;

let sweptDay = "";

function sweep(ts) {
  const d = day(ts);
  if (sweptDay === d) return;
  sweptDay = d;
  // DATED FILES AND A SWEEPER, not one file that grows forever (RFC-057 §Cost). Dropping a whole
  // day is honest in a way that truncating a file is not: `since()` re-reads from what survives, so
  // the surface says "tracked since" the real date instead of implying it saw everything.
  const cutoff = new Date(Date.parse(`${d}T00:00:00Z`) - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  try {
    for (const f of fs.readdirSync(ROOT)) {
      const m = /^calls-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(ROOT, f));
    }
  } catch {}
}

function append(row) {
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    sweep(row.ts);
    fs.appendFileSync(fileFor(row.ts), JSON.stringify(row) + "\n");
  } catch {}
}

// WHAT KIND OF CALL IS THIS. Derived from the tool name, never from a second vocabulary: an MCP
// tool is one whose name says so, and a skill is the `Skill` tool naming the skill it loaded. A
// skill that never fires looks exactly like a skill that was never needed — this is the only place
// the difference becomes visible.
function classify(name, input) {
  const n = String(name || "");
  if (n === "Skill") return { kind: "skill", name: String((input && input.skill) || "?") };
  const mcp = /^mcp__([a-z0-9-]+)__(.+)$/i.exec(n);
  if (mcp) return { kind: "mcp", name: `${mcp[1]}.${mcp[2]}` };
  return { kind: "tool", name: n || "?" };
}

// Called from emit() for every event. Returns nothing and throws nothing — a ledger that can break
// a session is worse than no ledger.
function record(s, event) {
  try {
    const who = { agent: s.agentId || null, project: s.projectCode || null, session: s.sessionId || null };
    switch (event.kind) {
      case "tool.call": {
        if (pending.size >= PENDING_MAX) pending.clear(); // a leak is not worth memory
        pending.set(event.id, { name: event.name, input: event.input, at: event.ts || Date.now() });
        return;
      }
      case "tool.result": {
        const call = pending.get(event.id);
        pending.delete(event.id);
        if (!call) return; // a result with no call is a replayed transcript, not a live call
        const c = classify(call.name, call.input);
        append({ ts: event.ts || Date.now(), ...who, kind: c.kind, name: c.name, ok: event.ok !== false, ms: Math.max(0, (event.ts || Date.now()) - call.at) });
        return;
      }
      case "hook.fired":
        append({ ts: event.ts || Date.now(), ...who, kind: "hook", name: event.name || "?", ok: true, on: event.on || null });
        return;
      case "session.started":
      case "session.ended":
      case "session.reinit":
        // ORIGIN RIDES ALONG, because it is the field that decides behaviour. A hook keys on
        // `origin === "cold"`, and without it here the log could show THAT the hook fired and never
        // what it matched — which is exactly the question asked the first time it misfired.
        append({
          ts: event.ts || Date.now(),
          ...who,
          kind: "session",
          name: event.kind.slice(8),
          ok: true,
          ...(event.origin ? { origin: event.origin } : {}),
        });
        return;
      case "compaction.after":
        append({ ts: event.ts || Date.now(), ...who, kind: "compaction", name: "after", ok: true });
        return;
      default:
        return; // everything else is narration — deltas especially, which are the highest-frequency events in the system
    }
  } catch {}
}

function files() {
  try {
    return fs
      .readdirSync(ROOT)
      .filter((f) => /^calls-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort()
      .map((f) => path.join(ROOT, f));
  } catch {
    return [];
  }
}

function rows({ days = 0 } = {}) {
  let list = files();
  if (days > 0) list = list.slice(-days);
  const out = [];
  for (const f of list) {
    let text = "";
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
  }
  return out;
}

// WHEN THE LEDGER STARTS. Same rule the context store learned: anything before the first retained
// line has an UNKNOWN history, not a zero, and "never called" is the sentence that deletes a tool.
function since() {
  const list = files();
  if (!list.length) return null;
  try {
    const first = fs.readFileSync(list[0], "utf8").split("\n").find(Boolean);
    return first ? new Date(JSON.parse(first).ts).toISOString() : null;
  } catch {
    return null;
  }
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))];
};

// The aggregate the surface reads. Global by default with an agent filter — which tools does the
// SYSTEM use is the more useful question than which tools one agent used (RFC-057 §Open 1).
function stats({ days = 0, agent = null, project = null } = {}) {
  const all = rows({ days }).filter(
    (r) => (!agent || r.agent === agent) && (!project || r.project === project),
  );
  const byName = new Map();
  const agents = {};
  const byKind = {};
  for (const r of all) {
    const key = `${r.kind}:${r.name}`;
    const e = byName.get(key) || { kind: r.kind, name: r.name, calls: 0, fails: 0, ms: [], agents: {}, last: null };
    e.calls += 1;
    if (r.ok === false) e.fails += 1;
    if (typeof r.ms === "number") e.ms.push(r.ms);
    if (r.agent) e.agents[r.agent] = (e.agents[r.agent] || 0) + 1;
    e.last = r.ts;
    byName.set(key, e);
    if (r.agent) agents[r.agent] = (agents[r.agent] || 0) + 1;
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  }
  const list = [...byName.values()]
    .map((e) => ({
      kind: e.kind,
      name: e.name,
      calls: e.calls,
      fails: e.fails,
      p50: pct(e.ms, 50),
      p90: pct(e.ms, 90),
      agents: e.agents,
      last: e.last ? new Date(e.last).toISOString() : null,
    }))
    .sort((a, b) => b.calls - a.calls);
  return {
    since: since(),
    days: files().length,
    calls: list,
    agents,
    byKind,
    totals: {
      calls: all.length,
      fails: all.filter((r) => r.ok === false).length,
      names: list.length,
    },
  };
}

module.exports = { record, stats, rows, since, classify, ROOT, KEEP_DAYS };
