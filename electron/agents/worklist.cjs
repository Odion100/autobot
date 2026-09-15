// THE AGENT WORKLIST — harness state, not project content (Odion's framing, via
// systemview-test, 2026-08-25). Every session gets one, in any repo, in any room.
//
// WHY A TOOL AND NOT A CONVENTION: without a tool call a plan is prose the model
// writes and forgets. With one it is state that outlives the turn and anything
// watching the event stream can render it.
//
// MEASURED FIRST (2026-08-25): this SDK ships NO todo tool. Asked to plan with
// one, the model called ToolSearch("todo task list checklist") and got back
// cron/task/worktree/messaging — nothing. So `case "TodoWrite"` in sessions.cjs's
// toolSummary is dead code from an older tool set, and systemview-test's premise
// was right: the harness has to provide this. We provide it as an in-process SDK
// MCP tool, which means no subprocess, no port, and the handler runs right here
// where the session state lives.
//
// THE WHOLE LIST, EVERY CALL — never deltas. That rule is enforced at the TOOL,
// not just in the event: if the only way to write is to send the entire list,
// a delta cannot be expressed, so a subscriber arriving mid-session can always
// render from one event. Their argument, and it belongs one layer lower than
// they proposed it.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const SERVER = "worklist";
const TOOL = "set";
const TOOL_READ = "get";
// SDK MCP tools are addressed as mcp__<server>__<tool>; a definition that pins
// `tools` must include this name or the agent silently loses its worklist.
const TOOL_NAME = `mcp__${SERVER}__${TOOL}`;
const TOOL_READ_NAME = `mcp__${SERVER}__${TOOL_READ}`;
// Both names, for the allow-list: pinning `tools` without the reader leaves an
// agent able to write a plan it can never read back.
const TOOL_NAMES = [TOOL_NAME, TOOL_READ_NAME];

// ONE ACTIVE ITEM, enforced rather than requested (their §3 left it to me).
// "What is it doing right now" has to be unambiguous or the rendering is a guess;
// a rule the tool applies can't drift, a convention the model remembers will.
// Extra actives are demoted to pending in order, so the FIRST one wins — the
// model's own ordering is the intent, and we don't reorder its plan.
function normalize(items = []) {
  let seenActive = false;
  return items.slice(0, 50).map((it, i) => {
    let state = it.state === "active" || it.state === "done" ? it.state : "pending";
    if (state === "active") {
      if (seenActive) state = "pending";
      else seenActive = true;
    }
    return {
      id: String(it.id ?? i + 1),
      text: String(it.text ?? "").slice(0, 300),
      state,
    };
  }).filter((it) => it.text);
}


// ---------------------------------------------------------------------------------------------
// DURABLE WORKLISTS — RFC-005 §3. One concept, two lifetimes.
//
// The worklist was session state: it lived in the session store under the session's own key, and
// nothing outside that session could read it. That is right for a conversation and wrong for a
// JOB, where reading the plan after the run is the entire point — a job that ran at 3am is a job
// nobody watched, so the list it left behind is the only account of what it did.
//
// So the worklist gains an OWNER instead of gaining a parallel structure. `session:<key>` today,
// `job:<id>` when jobs land, `<cwd-key>` for the terminal door that already wrote here. The RFC is
// explicit about why it must not be a second "job steps" model: two structures describing the same
// progress drift within a month, and then the surface showing one is lying about the other.
//
// ONE FILE PER OWNER, and the file is the truth. Not a cache beside the session store — a copy
// that can disagree is worse than no copy, and the session store already proved it by holding a
// `worklist` key nobody could read from outside.
const DIR = path.join(os.homedir(), ".autobot", "worklists");

// An owner is a free-form string; it becomes a filename, so it is sanitised rather than trusted.
// `job:abc` and `session:abc` must not collide, which is why the separator survives as a dash
// instead of being stripped.
const fileFor = (owner) =>
  path.join(DIR, `${String(owner || "unowned").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-90)}.json`);

function read(owner) {
  try {
    const r = JSON.parse(fs.readFileSync(fileFor(owner), "utf8"));
    return Array.isArray(r.items) ? r.items : [];
  } catch {
    return [];
  }
}

function write(owner, items) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    // `updatedAt` is not decoration: for a list nobody watched, "when did this last move" is the
    // difference between a job that finished and a job that stopped.
    fs.writeFileSync(fileFor(owner), JSON.stringify({ owner, items, updatedAt: Date.now() }, null, 2));
  } catch {}
  return items;
}

// Every worklist on this machine, newest first — what makes one readable AFTER the fact, by
// something that is not the session that wrote it.
function all() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch { return []; }
  const out = [];
  for (const n of names.filter((f) => f.endsWith(".json"))) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8"));
      const items = normalize(r.items || []);
      out.push({
        owner: r.owner || n.replace(/\.json$/, ""),
        file: path.join(DIR, n),
        updatedAt: r.updatedAt || 0,
        items,
        done: items.filter((i) => i.state === "done").length,
        total: items.length,
        active: (items.find((i) => i.state === "active") || {}).text || "",
      });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

// One server per session: the handler closes over that session's update callback,
// so the tool needs no session id in its arguments and cannot write to the wrong
// list even if the model invents one.
// WRITE-ONLY WAS THE BUG (his catch, 2026-09-13): there was a `set` and nothing else, and
// the list is never fed back into a session — it went to the UI and stopped. So the plan
// survived a compaction in the harness while the agent on the other side went blind to it,
// and "update your worklist before compaction" was advice that could not pay off. `get`
// closes it: system context survives the boundary and tells the agent to read; the worklist
// holds the state. Two harness layers covering each other.
function serverFor(onSet, getList = () => []) {
  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
      tool(
        TOOL,
        "Record your worklist for this session: the plan you are working through. " +
          "Send the COMPLETE list every time — items you omit are dropped. Mark exactly " +
          "one item active (the one you are doing right now), the finished ones done, " +
          "and the rest pending. Call this when you start a multi-step task, and again " +
          "each time a step finishes or the plan changes.",
        {
          items: z
            .array(
              z.object({
                id: z.string().optional().describe("stable id; keep it the same across calls"),
                text: z.string().describe("what the step is, in a few words"),
                state: z.enum(["pending", "active", "done"]),
              })
            )
            .describe("the whole list, in order — not a delta"),
        },
        async ({ items }) => {
          const list = normalize(items);
          onSet(list);
          const done = list.filter((i) => i.state === "done").length;
          const active = list.find((i) => i.state === "active");
          return {
            content: [{
              type: "text",
              text: `worklist: ${done}/${list.length} done${active ? ` · now: ${active.text}` : ""}`,
            }],
          };
        },
        // alwaysLoad: without it the tool sits behind ToolSearch and the model has
        // to go looking for it — which is exactly the search that came back empty
        // when we measured. A worklist nobody finds is not a worklist.
        { alwaysLoad: true }
      ),
      tool(
        TOOL_READ,
        "Read your worklist — the plan you recorded for this session. It is harness state, " +
          "so it survives a compaction that summarized the conversation away. Call it after a " +
          "compaction, and any time you need to know where you left off.",
        {},
        async () => {
          const list = normalize(getList() || []);
          if (!list.length) {
            return { content: [{ type: "text", text: "worklist: empty — nothing recorded for this session." }] };
          }
          const done = list.filter((i) => i.state === "done").length;
          const mark = (st) => (st === "done" ? "\u2713" : st === "active" ? "\u25b8" : "\u00b7");
          const body = list.map((i) => `${mark(i.state)} ${i.text}`).join("\n");
          return {
            content: [{ type: "text", text: `worklist: ${done}/${list.length} done\n${body}` }],
          };
        },
        // same reasoning as set: a reader the model has to hunt for is a reader it
        // will not reach for in the one moment it matters — straight after a compaction.
        { alwaysLoad: true }
      ),
    ],
  });
}

module.exports = { serverFor, normalize, DIR, read, write, all, SERVER, TOOL, TOOL_READ, TOOL_NAME, TOOL_READ_NAME, TOOL_NAMES };
