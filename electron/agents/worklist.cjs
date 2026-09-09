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
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const SERVER = "worklist";
const TOOL = "set";
// SDK MCP tools are addressed as mcp__<server>__<tool>; a definition that pins
// `tools` must include this name or the agent silently loses its worklist.
const TOOL_NAME = `mcp__${SERVER}__${TOOL}`;

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

// One server per session: the handler closes over that session's update callback,
// so the tool needs no session id in its arguments and cannot write to the wrong
// list even if the model invents one.
function serverFor(onSet) {
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
    ],
  });
}

module.exports = { serverFor, normalize, SERVER, TOOL, TOOL_NAME };
