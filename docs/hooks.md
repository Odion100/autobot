# Hooks — pointing an agent at a procedure, at the moment it matters

The context stack has three ways to reach an agent. **Loaded** (presence, the system context, the
agent's own doc) is paid every turn forever. **Retrieved** (the store, corpora, skills) is paid only
when the agent thinks to ask. Hooks are the third, for the procedure that is needed rarely and
urgently — and that the agent will not think to ask for, because the moment arrives from outside.

A hook holds **no content**. It says "this moment happened, and this skill applies" and hands over a
pointer; the agent still decides whether to pull it. That is what keeps a hook from ever drifting
from the skill it names — a hook has nothing to drift with. `electron/agents/hooks.cjs`.

## A hook is five things, each answering a different question

| field | answers |
| --- | --- |
| `on` | which event |
| `when` | the CONDITION — what must be true right now |
| `rate` | the FIRE RATE — how often it may fire at all |
| `until` | whether missing it is fatal |
| `deliver` | where in the turn it lands |

They compose freely, and the test that they are genuinely separate axes is that a nonsensical-sounding
combination still reads sensibly: `usage` at 60% context (a condition about state) with `once-per-day`
(a statement about frequency) is a coherent hook nobody would write. Axes that produce nonsense when
combined were the same axis in disguise.

`guard:` is the old spelling of `rate`. It is still read on the way in and never written on the way
out, so a hook edited once migrates itself and only one spelling exists on disk.

## The vocabulary is not written down here, on purpose

`mcp__context__hooksList` returns the hookable events, their fields, the ambient fields, and every
hook that exists with its rate and delivery — read from the code, incapable of drifting. A page
listing twenty events is wrong the day someone adds the twenty-first. **Ask the verb.**

## The condition can mix what happened with what the world can afford

Every event is stamped with AMBIENT fields at the fire point, so a `when` can combine the event's own
fields with the session's state: `ctxPct` (context fill), and `quotaStatus` / `quotaType` /
`quotaResetsInMin`, which are **absent until the API has actually reported a limit** — absent meaning
honestly unknown, never invented. So a long procedure can require room to run in (`ctxPct ≤ 50`) and a
hook can back off while an account is throttled.

Operators: `equals · not · contains · startsWith · endsWith · matches · in · gt · gte · lt · lte · exists`.

## The fire rate is a different axis from the condition, and it is persisted

Two families, because people mean both:

- **`cooldown:<duration>`** — sliding: no sooner than N since the last fire. This is how you say
  "twice weekly" (`cooldown:3d12h`).
- **`once-per-day` · `once-per-week` · `once-per-month`** — CALENDAR: once within each period, however
  the periods fall. Fire at 11pm Monday and a sliding day blocks all Tuesday daytime; "once per day"
  does not, and the calendar one is what the words mean.
- **`once-per-session`** — scoped to the session, so the session's own memory is the right store.

Durations are `30m`, `24h`, `3d12h`, `2w`. **Bare digits still mean seconds**, so hooks written before
durations existed keep their meaning.

**The record lives on disk**, `~/.autobot/hooks-fired.json`, keyed `<agent>|<hook>` — per agent, so a
shared hook carried by three agents has three cadences rather than the first one silencing the rest.
Before that it lived in a Map created per session, which silently degraded **every** cadence longer
than one session into `once-per-session`: a 3.5-day hook in a session restarted daily fired daily.
`once-per-session` was the only rate that ever worked, because it is the only one whose scope is the
thing it was stored in.

A hook's record **dies with the hook** — `remove()` sweeps every agent's entry for that name. Nothing
accumulates in the background.

## A malformed rate is refused at the writing door

`cooldown:2w` once saved cleanly, read back cleanly, and then fired **every single time** — the parser
took digits only, and an unrecognised guard deliberately did not block ("a typo, not a lock"). For a
condition that default is sane; for a rate it is backwards, because the hook you slowed down becomes
the noisiest thing in the system, silently. So the vocabulary is checked where a human is watching,
the same reason the event name is.

## `until: run` — when missing the procedure matters more than the repetition costs

`until: "run"` makes a hook keep returning, once per turn, until the system **observes** a run whose
`source` is this hook's own `do` go all-done. `until: "run:<source>"` names a different one.

The run record is the proof — **saying it is handled does not clear it**, and an agent that wipes its
worklist has cleared nothing. While a persisting hook is uncleared the rate is suspended and the only
limit is one pointer per turn; a hook that matched three events inside one turn is one pointer, not
three. That is what makes a cadence mean *done* rather than *offered*.

## Where a pointer lands, and why `idle` is not the end of a turn

`tool.call`, `tool.result`, `permission.request` and `file.changed` are handed over **immediately** —
their whole value is proximity to the action. Everything else is held until the agent **yields the
turn**, so a pointer never competes with what the human just asked for. `deliver: "now" | "turn-end"`
overrides either way.

The boundary is **observed**, not inferred: the SDK's `result` message is the real yield. A 1.5s
settle timer is a net over the gap between that yield and a turn the human had already queued, not the
mechanism itself.

**`idle` is a different moment from the turn ending, and the difference is the human.** A turn ending
means he has just been answered and may be typing; `idle` means nobody came back. Work that should
never compete with him — doc maintenance, an audit — belongs there and nowhere else. Note the
consequence: *quiet is zero at the end of a turn*, so "wait for a pause" can only be expressed as
`on: idle`, never as a `quietMin` condition on `usage`.

## The emitter reports; the hook judges

`idle` carries `quietMin` and nothing else. There is no configured idle duration anywhere in the
harness, because a hook already says what it wants: `when: {quietMin: {gte: 15}}` names the duration
and `rate:` names the repetition. Three consequences worth knowing:

- **Nobody listening, nothing runs.** An agent carrying no idle hook arms no clock at all.
- **The wake interval is the smallest threshold any carried hook asked for** — one hook at 15 minutes
  wakes every 15, not fourteen times to learn it is not 15 yet.
- **A wake asks the clock, it does not count.** `now - lastActivity`, derived — so a throttled
  background timer or a slept laptop cannot make a three-hour quiet report as two minutes.

Idle ticks reach hooks only, never the feed: a session sitting quiet for a week must not write ten
thousand rows about its own silence into anyone's log.

## Writing a hook is the proposal; carrying it is the approval

`hooksWrite` creates a hook that fires for **nobody**. It arms only when a human ticks it onto an
agent's profile, and that tick is the agent's opt-in exactly like a skill. `scope:` is a suggestion
the editor pre-fills from, not a targeting rule. So an agent can propose a standing behaviour for
everyone and change nothing until someone agrees.

`hook.fired` is emitted as a receipt but is deliberately **not hookable** — a hook on it would deliver
a pointer, which writes a receipt, which fires the hook, at input-queue speed.

## The words wrapped around a pointer are a file, not code

`~/.autobot/hook-pointer.md`, read at **fire time** — edit it and the next pointer uses the new words,
with no restart and no stale session. Placeholders `{{event}} {{what}} {{note}} {{when}} {{again}}`;
the comment block documenting them is stripped before an agent sees it. Delete the file and the
built-in text is the fallback.

It closes a door worth knowing about: "a pointer, not an instruction — ignore it if it does not apply"
was read by an agent as licence for a **third** option — do a proportionate version, the spirit
without the ceremony. It hand-rolled a maintenance pass and skipped the one step that finds notes
nobody would think to search for. So the wrapper now says there is no third option: if it applies,
invoke the skill; if it does not, say so in one line. The value of a procedure is the steps you would
not have thought of, which is exactly what a subset leaves out.
