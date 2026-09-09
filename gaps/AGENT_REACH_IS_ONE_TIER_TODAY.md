# Agent reach is one tier — fine today, not fine when a whitelisted service is a live product

**Status: DELIBERATE, NOT OVERLOOKED.** Odion's call, 2026-09-09: *"we can go with the current
policy and upgrade in the future."* This file exists so the upgrade is a decision someone makes on
purpose, rather than a surprise someone discovers.

## What exists now

`~/.autobot/services.json` is a **reach** policy and only that:

```json
[{ "name": "workbench", "url": "http://localhost:6420/workbench" }]
```

An agent passes a NAME, never a URL (`services.cjs:attach`). A whitelisted service is attached, every
method it publishes is indexed into the vector store, and `mcp__systemlynx__call` can invoke **any**
of them. Reachable and fully callable are the same bit.

That is correct for what is whitelisted today: local development services on localhost, where the
blast radius is this machine and the operator is the person typing.

## Why it stops being correct

The projects are separate now and converge later. **buAPI is a consumer social app.** When it launches
and is served through SystemLynx, agents will want to use it — that is the point of building it this
way. At that moment a whitelist entry stops meaning "a dev service on my laptop" and starts meaning
"production, with other people's data in it," while the mechanism behind the entry does not change.

Two axes the current single tier cannot express:

**1 — WHICH METHODS.** Attach indexes every method a service publishes. `Posts.search` and
`Users.delete` arrive with identical authority. The natural home for this is the whitelist entry
itself (an allow list, or a served/not-served flag per method), and it matches what SystemView already
settled for its own MCP surface: *a method without a schema document is not listed, rather than listed
with a guess.* Per-method exposure is the agreed direction on that side; this side has no expression
of it yet.

**2 — WHOSE IDENTITY.** In-process, a caller's identity rides `withHeaders` per call. Through the hub,
every call wears the hub's credential — the ambient-identity problem already recorded against buAPI.
For a local workbench "as the operator" is the only sensible answer. For a live product, "as whom?"
has to be answerable before an agent calls a mutating method, and today nothing in this repo asks it.

## Why not now

Nothing whitelisted today is a product. Building a trust tier before there is a thing to protect means
guessing at the shape, and the guess would be load-bearing by the time it mattered. The current policy
is small, legible, and easy to replace precisely because it is one bit.

## The trigger to watch for

**The first non-localhost entry in `services.json`.** That is the moment reach and authority stop
being the same question. If that entry appears and this file has not been revisited, the upgrade was
skipped rather than declined.

Related: `tests/same-origin.js` (the reach guard and its pinned policies),
`electron/agents/services.cjs`, SystemView RFC-055.
