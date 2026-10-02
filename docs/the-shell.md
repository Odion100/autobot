# The shell — how the browser is built

## Chrome and content are different processes, and that is the whole design

The window draws **chrome** — tab rail, nav strip, dock, the agent surface — as a React app
(`electron/ui/`, built by Vite). Every page is a separate **`WebContentsView`** positioned
*beneath* that chrome by the main process. Pages never contain our UI, and the chrome never
contains a page.

This buys isolation, and it costs one thing you will trip over: **a `WebContentsView` swallows OS
input over its own rectangle.** Anything the chrome needs the mouse for — a drop zone over the
content area, a drag divider between panes — only works if the content views are hidden or the
pixels belong to the chrome. That constraint, not aesthetics, is why drag interactions blank the
content while they are in progress.

## Why your change isn't showing

Three different edits reach a running shell three different ways, and mixing them up produces
"I changed it and nothing happened":

| you edited | reaches a running shell by |
|---|---|
| `electron/ui/` (the chrome) | `npm run ui:build`, then reload — or `npm run ui:dev` for hot reload |
| `electron/*.cjs` (main process, preload) | **restart**. Nothing short of it. |
| `~/.autobot/*.json` (apps, agents, projects) | **live** — these are re-read on change |

The third row is why registering an app takes effect immediately while a capability change in
`capabilities.cjs` does not.

**The freeze applies to context too.** The layers composed into an agent session — presence, the
system context, the agent doc, the CLAUDE.md stack — are assembled once when the session opens.
Editing any of those files changes nothing for a session already running, and a compaction does
not help. A re-init does.

## The layout of the harness

```
electron/
  main.cjs          # the window, the views, tab verbs, the smokes
  launch.js         # spawns Electron (scrubs ELECTRON_RUN_AS_NODE)
  ui/               # the React chrome — Vite project, dist/ is what ships
  apps/             # everything about hosting an application (see apps.md)
  agents/           # hosting agent sessions and the MCP servers they reach
  terminal/         # terminal sessions, same substrate/face split as agents
```

`electron/agents/` and `electron/terminal/` share a shape worth knowing because every new lane
copies it: a **substrate** (`sessions.cjs` — the real state, keyed by project and session id,
outliving any view that shows it) and a **face** (`host.cjs` — the IPC surface the renderer
talks to). State lives in the substrate so closing a tab never kills a session.

## State lives outside the repo

`~/.autobot/` holds what the shell actually runs on: registered apps, agent definitions, project
paths, presence, hooks. It belongs to the user, not to this repo — treat it as live
configuration you may read and should be careful about writing.

## Node version

Everything shell-related needs **node ≥ 22** (Electron 43 and Vite 8 both). There is an `.nvmrc`;
`nvm use` is enough. A `prestart` check fails loudly rather than letting a wrong version produce
a confusing crash deeper in.
