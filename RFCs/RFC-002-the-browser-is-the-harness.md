# RFC-002 — The browser is the harness

**Status:** draft for Odion's review — 2026-08-23
**Owner:** autobot (harness side). The IDE side is systemview-test's RFC-047 (the codebase comes from the host) and RFC-046 (the workbench).

Odion's framing, 2026-08-23, verbatim intent: the Autobot browser and the SystemView IDE are siblings. The next main goal is agents integrated **properly** into the IDE — today's CLI relay (`systemview say`/`join`) is the hacky way. The browser needs to become a **proper harness** for agents, with the Claude Code–in–VS Code experience as the bar: you feel directly in the chat, you see the live log of actions the agent is taking — in our style, our implementation. Eventually other agents connect too (MCP, agentci). And SystemView becomes a proper IDE: a codebase comes in with a project code alone — codebase, agents, terminal — with SystemLynx services as a section that lights up when connected, not the price of admission.

---

## 1. The auth answer (the "I just need to know")

**No subscription switch is needed.** Claude Code's harness *is* the `claude` binary, and both ways of embedding it ride your existing login:

- **pty lane** — what the supervisor already does: run `claude` in a session. It authenticates exactly like your terminal does today, against your login.
- **SDK lane** — the Claude Agent SDK drives the same Claude Code under the hood, so it inherits the same credentials. This is the lane that hands us what the pty can't: the conversation as **data** — streamed tokens, tool-use events, permission requests we can render as buttons.

The raw Anthropic API (key, per-token billing) is only required for agents that are *not* Claude Code — our own agentci agents, or if we ever bypass Claude Code entirely. That's a separate, later decision, not a prerequisite for this iteration.

## 2. The dividing rule, applied to agents

*(Sharpened by Odion, 2026-08-23 evening: the browser's agent concern is SETUP and FACILITATION — auth (Claude login or API key), hosting sessions, the project registry. Branches, worktrees, multi-agent arrangement on a codebase are the IDE's concern entirely; the browser carries branch/worktree only as wire data in the event envelope, for the IDE to render.)*

Same three layers as RFC-001:

- **Capability (browser):** agent sessions. Spawn/attach one per project, stream its events out, accept input and permission answers in, keep it alive across window closes (the hub-outlives-shell rule already covers the pattern). The seam is the same preload that carries the terminal transport.
- **Components (shared registry):** the chat thread, the activity feed, the permission control. Built once, handed to any app.
- **Arrangement (the app):** SystemView's workbench — RFC-046's territory. The browser doesn't own what the workbench looks like; SystemView doesn't own how sessions run.

## 3. Both lanes, one event vocabulary

RFC-046's fork (pty vs SDK vs both) resolves to **both, with jobs split cleanly**:

- **SDK is the primary harness** for embedded agents: token streaming into the chat, tool actions into the activity feed, permission prompts as controls.
- **pty stays as the escape hatch and the transparency window** — a real terminal you can open on the project, and the lane for anything the SDK doesn't surface.

What the two sides must share is the **event vocabulary** (edit / run / permission / thinking / say — the RFC-046 thread). Whatever emits — SDK stream, hooks, a future agentci adapter — it speaks the same events, so the workbench renders any agent the same way. **This is the one item the two agents need to work out together, on your go.**

## 4. Chat exists completely differently

*(Odion's correction, 2026-08-23: this is not an update to the CLI verbs. Chat, cooking, and visiting are concepts that get redefined, not re-transported.)*

Rooms, `say`, holds, status narration, the cooking gap — all of it is an artifact of agents being **external processes** that have to phone in. When the browser hosts the session, the artifact goes away:

- **Chat** is the session's own conversation — you type to the agent and watch it answer, Claude Code–style, not messages relayed into a room the agent polls. There is nothing to "deliver"; you're already talking to it.
- **Cooking** stops being a silent gap covered by status updates. A working agent is *visible* working — the activity feed streams its actions live. The narration duty dies because the harness narrates.
- **Visiting** stops being `--as` labels on relayed lines. An agent joining another project's conversation is a session being brought into that context, with its identity carried by the harness.
- **Presence** = the session being alive. Not a TTL, not a heartbeat, not a hold to re-arm.

The CLI survives only at the edge: it's how agents *outside* the browser (other machines, other harnesses) reach in, and those still look like visitors. For hosted agents it isn't the transport anymore — the conversation is native. What the new chat looks and feels like is workbench territory (RFC-046, their side); what the harness must supply it is the session stream and input path (our side).

## 5. The IDE half (systemview-test's side, stated here for the seam)

RFC-047 already draws it: project identity = a project code + a directory; the codebase half of the plugin binds to a folder the *host* opened; services become a section that appears when SystemLynx connects. The browser's part of that seam is already built — `~/.autobot/projects.json` resolves project code → cwd for terminals, and does the same for agent sessions. Launch-your-project-from-the-terminal is then free: the terminal is already in the right cwd.

## 6. What wasn't mentioned (the asked-for additions)

- **Permission policy.** Claude Code asks before dangerous actions; in the harness that prompt is data. Someone must answer it: you, via a button in the window — with per-project settings for what auto-allows. This is the single biggest piece of the "feels like Claude Code" experience.
- **Interrupt and steer.** A stop button (your ctrl+C), and typing into the chat mid-run reaching the agent the way mid-turn messages do in Claude Code.
- **Session persistence and identity.** Sticky by project across restarts (q3's machinery, already built dormant); one identity per project so the room's agent and the harness session are the same actor.
- **Usage visibility.** The harness sees the stream, so it can show per-session activity/cost — matters the day any agent moves to API billing.
- **Credential storage.** The browser stores nothing for Claude login (the `claude` binary owns it); anything we ever hold for other agents goes in `~/.autobot/`, visible like everything else.
- **Other agents.** agentci agents and MCP-connected tools enter through the same event vocabulary — the harness contract is agent-agnostic; Claude Code is just the first implementation. (MCP-manager-as-extensions is the already-parked lane 5.)
- **SystemLynx as MCP (Odion, 2026-08-23: bring systemlynx in).** The already-drafted SystemLynx-MCP-server plan (systemlynx's agent owns it; translator → tests-as-schema → declared params → bridge, provenance rules settled) is exactly the "agents call methods on services" piece. It runs as a **parallel lane, not a blocker**: Claude Code speaks MCP natively, so the moment a prototype `/mcp` exists, a hosted session gets the endpoint in its config and every service method becomes a tool. autobot's standing commitment holds — first consumer against any prototype, provenance-routed guardrails in the middleware. Two constraints from systemlynx's agent (2026-08-23): the manifest alone carries no argument shapes — `tools/list` schemas come from docs + saved tests, proposed by inference and asserted by a correctable document (matching Odion's t11 answer); and identity doesn't survive the hub hop — in-process a caller's identity rides `withHeaders` per call, through the hub every call wears the hub's credential (the buAPI ambient-identity bug). "Hub for reach, plugin for identity" — and identity decided it: **settled (his t10/t11 answers, systemlynx's reading) as plugin, per project**, with acting methods decided per-method by configuration — SystemView serves no tool until its ingredients exist (marked description, schema document, serve switch); a method without a schema doc isn't listed rather than listed with a guess.
- **Multi-instance/workspaces (q6)** intersects here: two windows on one project must not mean two agents.

## 7. Order of work

1. **Event vocabulary agreed** (both agents, on your go — the RFC-046 thread). **DONE 2026-08-23:** RFC-048 in the systemview repo is the contract; the harness emits it verbatim (amendments: raw thinking deltas rendered as a tail-line, `file.changed` kept with an fs-watcher follow-up, `permissionMode` on `session.started`, `usage` every turn).
2. **SDK session host in the browser** — sessions per project, events over the preload seam, permission answers back in. Supervisor graduates from dormant pty-runner to this. **BUILT + GREEN 2026-08-23**: `electron/agents/{sessions,host}.cjs`, `window.systemview.agent.open() → AgentTransport {send, onEvent, answerPermission, interrupt, history, dispose, kill, initialEvents}`, events = `status | text-delta | thinking-delta | text | thinking | tool-start | tool-end | permission-request | result | error | exit`. Proven on his login end-to-end (`npm run smoke:agent` inside the real SystemView tab). One constraint learned: permission-request events exist only for sessions opened in `default` permission mode — `bypassPermissions` (his personal default) auto-approves before the callback, so gated-vs-open is a per-session choice at open time.
3. **Workbench consumes** (their side): chat + activity feed + permission controls in SystemView. **BUILT 2026-08-23** against the live transport — agent section per codebase card: streamed text, thinking as the set-back line, tool calls as skimmable lines opening to raw, written paths carrying a diff button, permission controls, ready/working/waiting header with stop; the padlock re-opens the session because permission mode is fixed at open.
4. **Room transport swap** — hosted agents hear the room through the harness; CLI stays for external agents.
5. **agentci/MCP adapters** — after the Claude lane proves the contract.

## His calls (2026-08-23, from the said-back report threads)

- **Auth doesn't block anything.** There will be multiple ways for an agent to connect, not one. Seamless-for-him = his existing Claude Code subscription — the CLI (and the SDK, which drives the same binary) ride his login; API keys are for non-Claude agents when they arrive.
- **Project identity:** a project code IS required — chosen when the folder is chosen; it's what the agent's name is attached to. What's NOT required is the SystemLynx plugin/service — services are the optional section.
- **The agent process lives in the browser host.** Global agents are set up in the browser; SystemView spawns and attaches them from there. For SystemView, agents run per project per codebase — attached to and represented by the codebase, each in a specific directory; multiple agents from one project on separate branches is intended (worktree-shaped: separate directories, separate sessions — the terminal substrate's keying already fits).
- **Permissions + the action log go in THIS iteration.** His own posture is permissions-off; the surface exists because others will use this — so it's a per-user/per-project setting with models and effort alongside, not a gate on him.
- **The point of the whole thing (his words):** connecting through the CLI is hacky AND you can't see the agent work — the experience of watching it think, interact with files, take hits, is the deliverable.
- **CLI verbs become a thin client** over the same interface — transitional, and the CLI stays useful regardless.
- **MCP:** systemlynx's parked plan IS the plan — SystemLynx and SystemView work together to serve the endpoint; schemas come from SystemView's definitive places (docs + tests define the arguments) and must be ready AND configured to serve. Acting methods are where agentci comes in — how agents get implemented over the tools.
- **New surface he asked for (t7):** an agents UI — a place in the browser where agents are *presented*: where each is defined, its documents, its skills — rendered properly for a person, not raw files. SystemView consumes it like everything else.

## Still open (his)

- **q-order:** SDK host first, or workbench mocked on pty+hooks first to feel the UI sooner?
- **q6 (carried):** multi-instance/workspaces — now sharpened by his separate-branches intent: worktrees per agent is the natural shape, needs his confirmation.
