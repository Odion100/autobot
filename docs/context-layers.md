# Context layers — what reaches an agent, and when

Four mechanisms put context in front of an agent, and they differ in **who pulls the trigger**. Getting
the layer wrong is the commonest way knowledge fails to arrive: a fact in the wrong layer is either
paid for every turn forever, or never found at all.

| layer | trigger | cost |
| --- | --- | --- |
| **loaded** — presence, system context, the agent's doc | arrives at session open | every turn, forever |
| **retrieved** — the store, corpora, skills | the agent asks | only when asked |
| **hooked** — a pointer on an event | an event fires | one line, at a moment |
| **subscribed** — content delivered unasked | a moment the READER chose | the reader's own attention |

The loaded layers are files the human edits — `~/.autobot/presence.md` (where you are) and
`~/.autobot/system-context.md` (how to be) — read at session open, injected for every agent, so there
are no copies to drift. An agent's own doc is the third.

## The cost of a loaded sentence is attention, not tokens

A document that says everything aims nothing. The specific failure to know about: a CLAUDE.md that says
"read the handbook before non-trivial work" is **pollution, not a backup** — always-loaded attention
spent instructing an agent to hand-do what retrieval already does on demand. What belongs in an
always-loaded layer is only what must be known **before** acting and cannot live anywhere else.

The sharper version of the same rule: **stale always-loaded text beats a correct on-demand tool, every
time.** A slash command injects its body as a standing order; an MCP tool is a deferred schema nobody is
told to look for. One user-level command taught a retired CLI for four months and kept steering every
agent on the machine while the current interface sat unlisted. So when an interface is retired, the
sweep covers the always-loaded layers — commands, agent prompts, presence, system context, CLAUDE.md —
not just the code.

## Subscriptions — injection is a property of the reader

`subscribe(what, when, until)`. The reader subscribes; **the content is never touched**, so one agent's
delivery preference cannot change what anyone else reads. `what` is `note:<id>@<scope>` or
`corpus:<name>:<source>#<heading>` — any scope the subscriber can read.

Moments: **`post-compaction`** (meets you on the far side, where a summary has replaced your reasoning —
the sharpest use), **`session-start`** (rides the composition like presence), **`every-turn`** (ahead of
every prompt; highest rent, smallest shelf).

**Every subscription ends** — a clock (`{ttl:"7d"}`, the default), a delivery count (`{turns:N}`), or a
run condition (`{run:"skill:x"}`, cleared only by a closed run record). Shelves are capped per moment
and per subscriber, and a refusal names what to unsubscribe rather than silently dropping.

**Dead means deleted, at the first read that finds it** — an expired clock, spent turns, a cleared
condition, or a target that no longer exists. Nothing accumulates and nobody has to sweep. The content
always survives the subscription; only the delivery preference dies.

Storage is a **sidecar**, `~/.autobot/agents/<id>.subs.json`, deliberately not the definition file:
the staleness check for a running session stats the definition's mtime, so writing a subscription into
it would ring the re-init bell every time an agent subscribed to anything.

The wrapper around a delivery is `~/.autobot/injected-context.md` — the human's file, read at delivery
time, same mould as the hook pointer.

## What a delivered block is, to the agent receiving it

Context an **earlier self chose for this exact moment** — the most deliberate thing in the window, and
still a note rather than the world. Anything it claims about code or trees is verified before acting
on it. This matters most post-compaction, which is where an agent is most confident and most wrong.

## Notes and corpora are one pipeline, not two stores

**Notes** are information: written the moment something is learned, cheap, scoped `system` /
`project:<code>` / the agent's own slot. The bar is "would this help anyone this month."

**Corpora** are crystallized knowledge: a folder of markdown indexed for retrieval, distilled
downstream when note-clusters are folded into a handbook — and the notes they absorb are then
**retired**. That is the whole pipeline, and the handbook page you are reading is its output.

Two rules that keep it honest. **Never write state into a note** — what the code does right now is
re-read, never recalled. And **never copy a live vocabulary into a document**: ask the verb that reads
it from the code, because a list of twenty things is wrong the day someone adds the twenty-first.
