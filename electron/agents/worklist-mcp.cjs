#!/usr/bin/env node
// THE WORKLIST, FOR SESSIONS THE BROWSER DOESN'T HOST — Odion's point, 2026-08-25:
// he built this because it helped the AGENT as much as him, and asked whether I
// could actually use it. In the browser I hand every hosted session an in-process
// worklist tool (worklist.cjs). A Claude Code session in a terminal gets nothing,
// because it isn't a session in that harness. That asymmetry is an accident of
// where the tool was wired, not a rule — so this is the same tool over stdio,
// registered in .mcp.json, available to any session working in this repo.
//
// SAME NORMALIZER, DELIBERATELY. It requires worklist.cjs rather than
// reimplementing the rules, so "exactly one active, first wins, whole list every
// call" cannot drift between the two doors into the same idea. Two copies of a
// rule is two rules eventually.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { normalize } = require("./worklist.cjs");

// A terminal session has no session record to hang state on, so the worklist is
// keyed by WORKING DIRECTORY — the same placement key agent definitions adopt by.
// One repo, one worklist: the plan belongs to the work, not to whichever window
// happens to be open on it.
const DIR = path.join(os.homedir(), ".autobot", "worklists");
const keyFor = (cwd) => String(cwd || process.cwd()).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-80);
const fileFor = (cwd) => path.join(DIR, `${keyFor(cwd)}.json`);

function read(cwd) {
  try { return JSON.parse(fs.readFileSync(fileFor(cwd), "utf8")).items || []; } catch { return []; }
}
function write(cwd, items) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(fileFor(cwd), JSON.stringify({ cwd, items, ts: Date.now() }, null, 2));
  } catch {}
}

const server = new McpServer({ name: "worklist", version: "1.0.0" });

server.tool(
  "set",
  "Record your worklist for this task: the plan you are working through. Send the " +
    "COMPLETE list every time — items you omit are dropped. Mark exactly one item " +
    "active (what you are doing right now), finished ones done, the rest pending. " +
    "Call it when you start a multi-step task and again each time a step finishes " +
    "or the plan changes.",
  {
    items: z.array(z.object({
      id: z.string().optional(),
      text: z.string(),
      state: z.enum(["pending", "active", "done"]),
    })).describe("the whole list, in order — not a delta"),
  },
  async ({ items }) => {
    const list = normalize(items);
    write(process.cwd(), list);
    const done = list.filter((i) => i.state === "done").length;
    const active = list.find((i) => i.state === "active");
    return { content: [{ type: "text", text: `worklist: ${done}/${list.length} done${active ? ` · now: ${active.text}` : ""}` }] };
  }
);

// The read verb exists for the reason the browser half doesn't need one: a hosted
// session is handed its list back through the event stream on resume, but a fresh
// terminal session starts blind. This is how it picks up a plan already in flight.
server.tool(
  "get",
  "Read back the worklist for this working directory — use it at the start of a " +
    "task to see whether a plan is already in flight.",
  {},
  async () => {
    const list = read(process.cwd());
    return {
      content: [{
        type: "text",
        text: list.length
          ? list.map((i) => `${i.state === "done" ? "[x]" : i.state === "active" ? "[>]" : "[ ]"} ${i.text}`).join("\n")
          : "no worklist yet for this directory",
      }],
    };
  }
);

server.connect(new StdioServerTransport()).catch((e) => {
  process.stderr.write(`worklist mcp failed: ${e?.message || e}\n`);
  process.exit(1);
});
