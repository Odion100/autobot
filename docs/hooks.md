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

Three families, because people mean all three:

- **`cooldown:<duration>`** — sliding: no sooner than N since the last fire. This is how you say
  "twice weekly" (`cooldown:3d12h`).
- **`once-per-day` · `once-per-week` · `once-per-month`** — CALENDAR: once within each period, however
  the periods fall. Fire at 11pm Monday and a sliding day blocks all Tuesday daytime; "once per day"
  does not, and the calendar one is what the words mean.
- **`once-per-session`** — scoped to the session, so the session's own memory is the right store.
- **`once-per-rise`** — EDGE: once per **crossing** of the hook's own `when`, re-armed the moment the
  condition goes false again. Neither a clock nor a calendar — a fact about the condition's shape.

## `once-per-rise` — for a hook on a threshold, which is most of them

Added 2026-10-12, from a report that the context-maintenance hook *"did not fire, two times in a
row."* It had not. `on: usage, when: pct >= 60` with `once-per-session` fires at the **first**
crossing of 60% and then never again for that session's entire life: the pass runs, the human
compacts, the window drops to 25%, it climbs straight back past 60% — and the guard eats every one
of those crossings, in silence. `s.hooksFired` is created once at session birth and **nothing**
clears it, not even a compaction.

No existing rate could say it. A cooldown re-fires at sustained high usage whether or not anything
changed; a calendar is blind to the window entirely. `once-per-session` was always standing in for
*once per context*, and that proxy broke the moment sessions started outliving their windows — which
is now normal.

**The falling edge is the whole mechanism.** `fire()` is the only place in the file where a
*non*-match does work: when `when` stops matching, a `once-per-rise` hook's fired entry is deleted,
so "is there an entry" means "has it fired since the last fall". Two properties follow and both are
load-bearing:

- **Only its own event kind can re-arm it.** The hooks being iterated came from `index().get(kind)`,
  so every one is `on` this event — a `usage` hook can never be re-armed by an `idle` tick that
  simply has no `pct` field. Without that it would fire on every message.
- **It is session-scoped and never persisted.** A restart is a new context and should find the hook
  **armed**; a persisted rise would come back still "fired" and stay silent on a fresh window, which
  is the original failure wearing a new hat.

**A `once-per-rise` with no `when` is refused at the writing door.** With nothing to go false it can
never re-arm, so it would silently mean `once-per-session` — exactly the bug it exists to end.

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

## Writing a hook is not arming it — and an agent arms its own

`hooksWrite` creates a hook that fires for **nobody**. Carrying it is what arms it, and the carry
list lives on the agent (`def.hooks`). `scope:` is a suggestion the editor pre-fills from, not a
targeting rule.

**Who may carry what, settled 2026-10-12:**

| | |
|---|---|
| **on yourself** | `hooksCarry({name, carry})` — your own context, your own continuation, no press required. It takes effect immediately: the carry list is read per fire, not snapshotted when the session opened |
| **on another agent** | the human's. It imposes standing behaviour on context somebody else pays for every turn, which is a different act — the verb refuses it by name rather than being silently unable |

**The old rule was "a human ticks it", and it was wrong.** His argument: an agent sent out to watch
something has to be able to put a hook down and arm it — *"you might see a sign, put a hook down for
later."* Nobody else's attention is spent by that. And the rule manufactured the exact failure this
file calls the worst one it has — a hook that looks correct, appears in every list, and silently
never runs: `run-the-path-check` sat written, correct and inert for four days waiting for a tick.

What actually protected anything was never the press. It is the **writing door**: an event that does
not exist, a malformed rate, a `once-per-rise` with no `when`, a job hook that cannot supply what the
job declares — all refused where somebody is watching. And every fire is a feed row carrying who
wired it, so an armed hook was never invisible. Gating it was solving visibility with a lock.

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
