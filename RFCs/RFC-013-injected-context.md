# RFC-013 — Context subscriptions: the reader chooses what meets it, and when

**Status:** built (v2 — the subscription model; v1's mark-on-the-note design was rebuilt after
discussion, 2026-09-26).

Some context is needed exactly when nobody thinks to ask — the moment after a compaction, the
start of a cold session. A lesson behind a query it would never occur to you to make is a lesson
that does not exist. This adds delivery unasked — as **subscriptions**.

## The model: subscribe, never mark

**Injection is a property of the reader, not the content.** An agent subscribes to a piece of
context; the content is never touched. This one choice dissolves every hard problem the first
design had: multiple agents "remember" the same thing by each subscribing to the same note; caps
are per-subscriber, so nobody spends anyone else's attention; any scope you can read is
subscribable — a system note, a project note, a **corpus chunk** — because subscribing only
spends your own budget. There is no commons, no mark authorship, no operator-only scope rule.

```
subscribe(what, when, until)
  what:  note:<id>@<scope>  |  corpus:<name>:<source>#<heading>
  when:  one or more of  every-turn | session-start | post-compaction
  until: { ttl: "7d" }  |  { turns: N }  |  { run: "skill:<name>" }   (clock may back up either)
```

Subscriptions live **in the agent's definition** — its standing orders, beside the skills and
hooks it carries, rendered in the profile (Context region), editable and deletable there. Writes
route through `definitions.cjs` (the def's one writer); turn-countdowns live in a sidecar so a
delivery never rewrites the def. `remember` stays one job: it writes notes. Subscribing is
`subscribe`'s job.

## Every subscription ends, and dead means deleted

- **Clock** — `ttl`, default 7d, max 30d.
- **Count** — `turns: N`: delivered N times, then done. No waiting for a week to pass.
- **Condition** — `run: "skill:x"`: ends when a CLOSED run carrying that source exists — the
  record clears it, never the agent's word.
- **Target gone** — a note deleted, a corpus heading re-chunked away: the subscription dies
  loudly (named in the next delivery's wrapper), never delivers stale text.

A dead subscription is **deleted at the first read that finds it dead**. No grey rows, no pile,
nobody's janitor job. The content always survives in the store or corpus — only the preference
dies.

## Gates at the subscribing door

Refusals happen at write, never save-then-ignore: unknown moments, bad clocks, targets that
don't exist or resolve over **700 chars** (injection spends attention on every delivery), and
full shelves — **every-turn: 2 items / 1,000 chars · session-start: 5 / 3,000 ·
post-compaction: 5 / 3,000**, per subscriber — where the refusal names what to `unsubscribe`.

## The moments

- **session-start** — joins the system-prompt composition beside presence; survives compaction
  by construction; costs no turn.
- **post-compaction** — delivered on `compaction.after`, into the conversation on the far side —
  the moment the agent is most confident and most wrong, met with context it chose for exactly
  that moment.
- **every-turn** — rides ahead of the human's words in the same message (the feed never shows it
  as his words). Highest rent, smallest shelf.

All three read the def live at delivery. Every delivery emits a `context.injected` receipt the
feed renders (`⚡ injected context · <moment> · N chars`) — nothing arrives invisibly.

## Validation walkthrough (after relaunch)

1. As an agent: `subscribe(what: "note:<some id>@agent:<slot>", when: "post-compaction")` → ack
   names the target, moments, and gate.
2. `subscriptions()` → the row, with its gate state (`0/3 deliveries spent`, expiry date).
3. Over-fill a shelf → the refusal names the holders and the verb.
4. Compact the session → the ⚡ receipt row in the feed, the wrapped notes in the next turn.
5. `until: {turns: 1}` on a throwaway → deliver once, then `subscriptions()` shows it gone.
6. Delete a subscribed note → next delivery names it ended, the row is gone, nothing stale.
7. The profile shows the same rows — edit or delete one there.

## Follow-ups (gated on this landing + relaunch)

- `context-maintenance` gains a set-subscriptions step; `context-retrieval` is replaced by a
  re-orientation procedure (verify state · read what subscriptions delivered · square the list ·
  wait); the `compaction.after` hook repoints; the system-context line about retrieval gains its
  subscription clause (operator's wording).
- Profile UI: the subscriptions rows (systemview side).

## Open questions

- Discovery: the note you most need at a cold moment is the one you didn't retrieve — should
  maintenance suggest subscriptions from retrieval patterns ("read three times this week")?
- A recommendation channel softer than push: content hinting "this is post-compaction-shaped"
  while the reader still decides.
