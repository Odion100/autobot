# Agent sessions — hosting Claude inside the browser

The shell hosts Claude sessions through `@anthropic-ai/claude-agent-sdk`. This is the lane that
makes the harness more than a browser: an agent working on a project is a session the window owns,
not a terminal someone left open.

## The shape

`electron/agents/sessions.cjs` is the **substrate** — sessions keyed by project and session id,
outliving any view that displays them, with a ring-buffered history so a reattaching surface can
replay rather than lose the conversation. `host.cjs` is the **face**, the IPC surface the renderer
talks to. Closing a tab never kills a session; that separation is the point.

Beside them sit the MCP servers a session reaches — context, worklist, discovery, docs, jobs,
skills, hooks — each built per session with the asking agent's identity attached.

## Facts that are not visible in the code

- **The SDK spawns a native `claude` binary**, bundled per platform. No node resolution happens,
  so the `ELECTRON_RUN_AS_NODE` problem that affects our own child spawns does not apply here.
  It rides the user's existing Claude Code login rather than needing an API key in the environment.
- **`permissionMode: "bypassPermissions"` means the permission callback never fires** — the SDK
  warns that it is shadowed. Permission-request events only exist in `default` mode, and the mode
  is chosen when the session opens: wiring the callback afterwards does not retroactively create
  the events.
- **Streaming input is an async-iterable push queue**, not a function call — each user turn is
  pushed as a message object. `includePartialMessages` is what yields the deltas that paint text
  as it arrives.
- **`/compact` sent as an ordinary prompt is executed as a command** by the SDK — verified live.
  The compact button is a real mechanism, not a hopeful string.
- **The model menu comes from the SDK's own `supportedModels()`**, never a hardcoded list, and
  setting a model is a *request*: it is pending until the next turn's re-init confirms it.

## Identity is the definition's id

Anything keyed to "which agent" must use the **definition's id**, never its display name. The
session's MCP servers are built with the agent id as the slot, and the servers resolve who is
asking from that slot. A display name can change; an identity cannot.

## Subagents inherit tools, not context

A spawned subagent inherits the parent's **tools** — including the harness MCP servers — when its
definition leaves `tools` unspecified. It does **not** inherit the parent's context layers: its
system prompt is its own, so presence, the system context and the spawning agent's doc never reach
it. **The brief you write is its entire world**; anything it needs to know has to be in the prompt.

Related: a definition passed through the in-process `agents` option must **omit** `tools`
entirely. Pinning that field builds a narrower allowlist than intended and the lane goes invisible.

## The event vocabulary is a co-owned contract

Session events are not this repo's private shape — they are shared with SystemView, and any new
lane (terminals, hooks, agentci) must speak the same vocabulary. Each event carries its kind, a
timestamp, and an envelope identifying the session, project, working directory and branch, stamped
centrally rather than by each emitter.

Two settled points worth knowing because they look like bugs otherwise: thinking arrives as **raw
deltas** (render the tail as a live line; summarizing it anywhere is wrong), and `file.changed`
exists as its own event because tool results cannot carry paths for shell and MCP calls.

## The restart loop

A backend `.cjs` edit made from *inside* a hosted session restarts the shell and kills the very
turn making it — the dev runner watches those files. Backend edits belong to a terminal session;
chrome edits, which hot-reload, belong to the hosted one. If a hosted session must touch a `.cjs`
file, that save goes last in the turn.
