# RFC-003 — An agent is a configured session

**Status:** draft for Odion's review — 2026-08-25
**Owner:** autobot (the harness holds the sessions). Sibling: systemview-test's RFC-053 (one source of interactive markdown) — the capability bag there and the tool list here are the same idea at two altitudes.

Odion, 2026-08-25, verbatim intent: *"we got to define each conversation more as an agent — with different assignments, different places where they run, different tool access, different skills. They got to be places where you can go and view their skills in a neat way, and build skills, and soon we'll come with MCP functionality. I don't know how it's going to be organized, if it's just organized as skills or tools or something."* And: the browser must see **all** the agents, not only the ones an app happens to use.

---

## 1. The finding that shapes this RFC: don't invent the schema

Before designing a shape, I read the one we already depend on. `@anthropic-ai/claude-agent-sdk` exports **`AgentDefinition`**, and it is almost exactly the thing he described:

```ts
export declare type AgentDefinition = {
  description: string;            // when to use this agent
  prompt: string;                 // THE ASSIGNMENT
  tools?: string[];               // TOOL ACCESS (allow)
  disallowedTools?: string[];     // tool access (deny)
  skills?: string[];              // SKILLS
  mcpServers?: AgentMcpServerSpec[];   // MCP, per agent
  model?: string;
  maxTurns?: number;
  background?: boolean;
  memory?: 'user' | 'project' | 'local';
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number;
};
```

Four of his five nouns are already fields: assignment (`prompt`), tool access (`tools`/`disallowedTools`), skills (`skills`), MCP (`mcpServers`). **We should adopt this type rather than parallel it.** A schema we invent has to be translated at the SDK boundary forever, and every field we add is a field that must be mapped; a schema we adopt is passed through.

**It answers his open question, too.** He asked whether MCP organizes "as skills or tools or something." The SDK's answer is that they are **three separate axes**, not one: `tools` (what verbs exist), `skills` (procedures the agent can follow), `mcpServers` (where additional tools come from). So the UI shows three lists, not one merged list. That is a design constraint we get for free by not inventing.

## 2. What `AgentDefinition` does NOT carry — and it's exactly our half

Two things his description requires are absent from the SDK type:

- **Where it runs.** "Different places where they run" — `cwd`, and our `projectCode`. The SDK takes `cwd` as a *query option*, not part of the agent.
- **How it's gated.** `permissionMode` is a query option too, and per RFC-002 it is a **per-session choice made at open** — `bypassPermissions` shadows `canUseTool` entirely, so a permission surface only exists for sessions opened in `default` mode.

Both are already parameters of `sessions.open()`. So:

> **An agent = `AgentDefinition` + placement (`projectCode`, `cwd`) + gating (`permissionMode`).**

Nothing else. That is the whole schema, and two thirds of it is not ours to maintain.

## 3. Definition vs run — and a naming collision to fix first

Today `~/.autobot/agents.json` stores **live/sticky sessions** keyed `projectCode:sessionId`. That file is *runs*, not *agents*. If definitions land under a name that close, someone will read one as the other within a week.

Proposed:

| | what it is | where |
|---|---|---|
| **definition** | the configured agent, reusable | `~/.autobot/agents/<id>.json` |
| **run** | one conversation of that agent | `~/.autobot/sessions.json` *(today's `agents.json`, renamed)* |

One definition → many runs. A run records the `agentId` it was opened from, so the panel can say *whose* conversation this is rather than only which project.

**Renaming a live store is a migration, not an edit** — read-both/write-new for one release, per the same discipline that made project renames survive in `files-host.cjs`.

## 4. Conversations become runs — without breaking today

Every session that exists right now was opened with no definition. They must not disappear or grow a fake identity.

- A session with no `agentId` is an **ad-hoc run**: it displays as it does today (project + what it's about).
- "Save as agent" turns an ad-hoc run into a definition, seeded from what that session was actually opened with. **The definition is captured from a thing that ran**, which is a better authoring path than a blank form.
- Nothing is rewritten on disk to make this true. The absence of `agentId` *is* the ad-hoc case.

## 5. The browser sees all of them

Per his line that agents are only in SystemView "right now" and shouldn't be: the shell holds the definitions and the sessions, so the agents surface is the **shell's**, not an app's. SystemView is a consumer, like any other app or a web page. `window.systemview.agent` already exposes sessions to a local app; agent definitions ride the same bridge.

This is also where his older rule lands: **the browser defines what an agent may touch.** `tools` / `disallowedTools` / `mcpServers` on the definition is that permission model — the same seam systemview-test built as the capability bag, one level up. Their split is worth copying exactly: **absent ≠ denied**. A tool the browser doesn't have and a tool this agent may not use are different sentences and must read differently.

## 6. Skills: view, then build

`skills: string[]` on the definition is a *reference* list — the skills themselves live on disk (`.claude/skills/`). So the surface is two things, and only the first is needed to be useful:

1. **View** — read the skills a definition names, rendered properly. This is a read of files we can already read (`files.cjs`).
2. **Build** — author a skill and add it to a definition. A skill is a markdown file with frontmatter; the editor already exists in the code pane.

Shipping (1) alone makes the definitions legible. (2) is where "a neat way" earns its keep.

## 7. What I'd build, in order

1. Rename the session store, read-both/write-new. *(Unblocks everything; safe alone.)*
2. `AgentDefinition + placement + gating` as a stored type; `open({ agentId })` resolves it.
3. Agents surface in the panel: definitions and their runs, with tools/skills/MCP as three lists.
4. Save-as-agent from a live run.
5. Skills viewer, then skills authoring.

Steps 1–2 are invisible and make the rest cheap. Nothing here needs the markdown package to land first.

## 8. Open — his calls

- **q1 — does an agent pin its project, or is placement per run?** "Where they run" reads as pinned; but a reviewer agent you point at any repo is the more useful thing. I lean **placement is a default, overridable at open**.
- **q2 — `permissionMode` on the definition?** It's the one field that changes whether a permission UI exists at all. Putting it on the agent makes "this agent always asks" expressible — which seems to be the point of defining agents at all.
- **q3 — do definitions sync to SystemView, or does the browser stay the only home?** RFC-001's rule says capabilities → browser, so I've assumed the browser owns them and apps read them.
- **q4 — `background: true` agents.** The SDK supports it. That is the door to agents that run without a conversation open — closest thing here to the jobs system, and worth knowing whether you want that door now or later.

Related: [[agent-harness]], RFC-002, systemview-test's RFC-053.
