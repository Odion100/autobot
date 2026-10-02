# RFC-012 — A hook fires when the turn ends

**Status:** built, on `lane/hooks-end-of-turn` — 2026-09-23. Settled with Odion in conversation and
built in the same pass; this is the record, not a request for approval.
**Owner:** autobot (the harness emits the events and owns the hook machinery).
**Lands in:** `electron/agents/hooks.cjs` (the classification, `until:`, the guard, the pointer
text), `electron/agents/sessions.cjs` (the boundary, the hold, the flush), `electron/agents/context.cjs`
(`hooksWrite` / `hooksList`), `tests/hooks.js`.
**Related:** RFC-005 §7 (hooks — the mechanism this changes the timing of), RFC-005 §3 and the runs
model in `worklist.cjs` (what "the procedure actually ran" is read from).

---

## 1. The failure

A context hook that surfaces in the chat — `context-maintenance`, `context-retrieval` — was pushed
onto the input queue the instant its event matched. In practice that put it **beside the message
the human had just sent**, and there it competes with the thing he actually asked for and correctly
loses. The longer the turn, the more certain it is forgotten.

This is not a behavioural failure and it should not be answered with a stronger instruction. The
pointer and the request arrive in the same breath, one of them is from a person waiting for an
answer, and the agent is right to serve that one. The old pointer text is the confession:

> Finish what you are doing first — anything the human asked for comes before this.

A mechanism that has to apologise for its own timing is telling you the timing is wrong.

Observed live on 2026-09-22, in the session that produced this RFC: the hook fired at 60% context,
the agent answered the question in front of it, and the maintenance pass happened only because the
user asked *"did you do context maintenance already? I see you at 64%"*. The hook worked. Nobody
acted on it. That is the same thing as not having it.

### 1.1 The second defect, from the same cause

A threshold measured at the start of a turn is **stale by the time anything is done about it**. A
heavy turn burns 15–20 points of context, so a hook armed at `{"pct": {"gte": 60}}` fires before
the turn has spent anything and is acted on — if ever — at 80. Measuring at the end measures the
truth, and there is no version of "measure it earlier and guess the delta" worth writing.

### 1.2 What the code actually did, which is not quite what we thought

The brief for this work said hooks fire "at the start of a turn, injected alongside the user's
message". That is the symptom, and the mechanism underneath it is worth writing down because the
**documentation was the thing that was wrong**, and a wrong description in a vocabulary agents read
is how a hook comes to look perfectly armed for weeks.

`usage` is emitted **twice, with two meanings** (`sessions.cjs`, the pump):

- once per assistant message, `snapshot: true` — the context ruler. The first of these lands
  immediately after the prompt, before the turn has spent anything.
- once at `m.type === "result"` — the turn's receipt, carrying cost, turns and the final reading.

The `EVENTS` entry described `usage` as *"fires at the END of a turn, a safe place to hook"*. Half
true. `context-maintenance` is armed on `usage` with `guard: once-per-session`, so it matched the
**first snapshot of the turn** — start-of-turn delivery and a stale number in one move — and the
guard then burned the one shot, so the real end-of-turn `usage` never got a look. Every observed
symptom falls out of those two lines.

That description is corrected in this change. It is the only part of the diagnosis that was a bug
in the ordinary sense; the rest is a design that put the pointer in the wrong place.

## 2. The yield is a signal we have, not one we infer

The first thing to establish, because the whole shape of the answer depends on it: **can the shell
see the agent hand the turn back, or does it have to infer it from activity going quiet?**

It can see it. `@anthropic-ai/claude-agent-sdk` emits `m.type === "result"` when the turn ends —
the pump already handles it, already reads `num_turns` and `total_cost_usd` off it, and already
comments that *"`result` fires at the END of a turn, a natural boundary"*. It is the real yield.

This matters more than it looks. Had the boundary been inferred from a quiet period, the debounce
would have been **the mechanism**, and its value would have been the entire design — too short and
every pause for thought between two tool calls becomes a delivery into the middle of the work,
which is the exact failure being moved away from; too long and the pointer lands in the next turn.
Because the yield is real, the debounce is a **safety net on a signal we already have**, and it can
be short.

## 3. The design

### 3.1 Session-level pointers are held for the boundary; in-turn hooks do not move

Delivery is now a property of the hook, resolved by `hooks.deliverAt()`:

```js
const IN_TURN_EVENTS = new Set(["tool.call", "tool.result", "permission.request", "file.changed"]);
```

A hook on one of those is handed over the instant it matches, exactly as before. **That is not a
carve-out, it is the point.** A hook watching for `git push` exists to land near the action; defer
it to the end of the turn and it arrives after the push it was watching for, which is worse than
not having it. Those hooks do not surface in the chat — they interrupt — and nothing in this RFC
touches them.

Everything else — `usage`, `session.started`, `compaction.after`, `run.*`, `todo.updated`,
`message.landed`, `status`, the page events — is **held** until the agent yields. The match still
happens the moment the event happens; only the handover moves.

`deliver: now | turn-end` in the front matter overrides the table in either direction, for the
author who knows better than the default. It is one key, next to `guard`, and `hooksList` prints
the **resolved** value for every hook so the default is never invisible.

### 3.2 The hold is keyed by name, and the newest match wins

`s.pendingHooks` is a Map from hook name to `{ hook, event }`. A hook that matched three events
inside one turn is **one pointer**, not three — which matters immediately, because `usage` fires
per assistant message and a long turn emits a lot of them.

The newest match wins the payload, and that is §1.1's fix: the event carried to the agent is the
one from the yield, whose `pct` is what the window actually holds now rather than what it held
before the turn started.

### 3.3 The debounce: a pause is not an ending

`armTurnEnd()` runs on `result`. It marks the turn inactive, increments the turn counter, and arms
a flush `TURN_SETTLE_MS` later. **Any in-turn activity cancels it** — `user.prompt`,
`assistant.text`, `assistant.thinking`, `tool.call`, `tool.result`, `permission.request` — and the
pointer simply waits for the next ending. The flush also refuses to run while tools are in flight.

`usage` is deliberately *not* in that activity set: the mid-turn snapshot and the end-of-turn
receipt share a kind, so treating it as activity would have the session's own ruler tick cancel the
flush it had just armed.

**The value is 1500ms, and here is what it is buying.** The collision it exists to prevent is a
turn the human had already queued being announced in the gap between the yield and the flush —
firing into that gap puts the pointer right back beside his message, undoing the whole change. That
race is milliseconds of message-pump latency, not seconds; the cancel-on-activity rule does the
real work. 1.5s covers it with room and keeps the seam under what reads as a pause: the UI shows
the session cooking, the pointer lands, and the user sees one continuous run and then completion,
which is the behaviour he asked for explicitly.

**And §3.4 is what makes a conservative value free.** With persistence, missing a boundary costs
one turn — the hook comes back around. Without it the timing would have to be exact, because a miss
would be permanent, and every argument about this number would be an argument about correctness
instead of about polish.

**An idle session is its own case.** A moment that arrives when no turn is running —
`session.started`, a cross-session message, a page event fanned out by `emitAmbient` — has no yield
coming. Queuing one at idle arms the same timer directly, so the pointer lands; and if a turn
starts inside that window it wins, and the pointer waits for its ending instead. Without this, an
unattended agent's hooks would wait for a human to speak, which is to say forever.

### 3.4 `until:` — fire until cleared, as configuration

A guard's job is to stop a hook leaking context. Its side effect is that **one badly-timed pointer
is the whole budget**: it fires, it is missed, and `once-per-session` has already spent the shot.

`until:` is a key beside `guard:`:

```
until: run                 # cleared by a finished run whose source is this hook's own `do`
until: run:skill:<name>    # cleared by a finished run with that exact source
```

While a persisting hook is **uncleared**, the guard is suspended and the only limit is **once per
turn** — it comes back at the end of every turn until the procedure runs. Once cleared, the
ordinary guard applies again, which for `once-per-session` means it is done for good.

**It is configuration, not a second kind of hook, and that was settled explicitly.** The moment
fire-until-cleared becomes its own species there are two vocabularies for one thing; one of them
gets a feature the other does not, nobody notices, and a hook behaves differently depending on
which shelf it was filed on. So it is a front-matter key, a `hooksWrite` argument, and a line in
`guardAllows` — no new file type, no new resolver, no parallel list.

#### What clears it is the run record

**Not the agent's word.** An agent's testimony is the weakest evidence in this system, and an agent
can wipe its own worklist at will — it routinely does. So "the procedure ran" means the system
observed a **run** carrying that source go all-done: `worklist.allDone()` over the persisted items,
which is the same condition that emits `run.finished`. There is no flag an agent can set, because
there is no flag.

Two properties fall out of reading the record rather than a signal:

- **A run that finished before the pointer went out is not an answer to it.** `isCleared()` compares
  the run's completion against `firstTs` — when this hook first fired. Without that compare, a pass
  done an hour ago would silence a hook that has not been read once.
- **It survives a restart.** `s.runsDone` is seeded at session open by scanning the run files for
  this session's owner, then kept current by the `run.finished` events `fireHooks` already sees. A
  maintenance pass done before a re-init must not be demanded again after it. The scan is **once,
  at open** — re-reading a directory per emitted event is exactly the read-a-file-per-event shape
  that cost this project a day of CPU and a jammed main process, and the hook path is the one place
  in the harness where that mistake is guaranteed to be expensive.

#### The pointer says it persists

A persisting pointer that arrived three turns running with no explanation would read as a
malfunction. So the text says what it is: it returns every turn until a run with that source has
every item done, and the run record is what clears it — saying it is handled does not.

### 3.5 The pointer text follows the timing

The old sentence was written for a pointer that landed beside a human's request. A turn-end pointer
has nothing to defer to, so repeating the apology would be telling the agent to postpone a moment
that has already waited for it. At the boundary it now reads:

> You have just handed the turn back, so nothing is waiting on you — this is the moment to act on
> it if it applies. It is still a pointer, not an instruction: ignore it if it does not.

An in-turn pointer keeps the original sentence, and still needs it, for the original reason.

### 3.6 The receipt moved to delivery

`hook.fired` used to be emitted where the hook matched. With a hold between matching and handing
over, that would put a row in the feed for something that had not happened yet — and for a hook
whose session ends before the flush, never would. The receipt is now written in `deliverHook()`, so
the feed says a pointer reached the agent only when one did.

## 4. What this does not change

- **Tool-gating hooks.** §3.1. They fire where they always did.
- **Who carries a hook.** Writing one still does not arm it; the tick lives on the agent's profile
  and is the human's.
- **The pointer holds no content.** Still a `skill:` pointer and a note, never a procedure.
- **The hot path.** The index is still a Map keyed by event name, rebuilt on the hooks directory's
  mtime. The two new fields are read at parse time and the classification is a Set lookup. A
  session with nothing wired still pays one Map miss.
- **The existing hook files** under `~/.autobot/hooks`. They are the operator's, they are outside
  any worktree, and they are unchanged by this branch. `context-maintenance` gains the new timing
  for free because the default moved under it; adding `until: run` to it is a one-line edit he can
  make when he wants it, and §6 says what it would do.

## 5. Evidence

`tests/hooks.js` grew claims for each half, because they fail separately: the classification decides
*where* a pointer goes, `until` decides whether missing it is fatal.

- the classification, including the three in-turn events that must not regress, and the override
- `until` round-tripping to disk; bare `run` resolving to the hook's own `do`; `run:<source>` naming
  another
- uncleared → fires on turn 1, 2 and 3 **despite `once-per-session`**; a second match inside one
  turn does not fire twice
- a run that finished *before* the pointer does not clear it; one that finished *after* does; a
  different procedure's run does not; and once cleared, `once-per-session` holds
- the boundary itself, driven without a model on the other end: nothing is pushed mid-turn however
  long the turn runs, three matches are one pointer, nothing at the instant of the yield, delivered
  after the settle — and a `user.prompt` inside the window cancels the flush and the pointer waits
  for the *next* ending
- an idle session gets its pointer without waiting for a turn that is not coming

`armTurnEnd`, `flushTurnEndHooks`, `fireHooks` and `TURN_SETTLE_MS` are exported from `sessions.cjs`
for that last group. Holding a pointer is behaviour that is invisible when it is right and
indistinguishable from "the hook never fired" when it is wrong, and a test that can drive the
boundary is the only thing that separates those two readings.

Adjacent suites re-run clean: `smoke:worklist` (24), `smoke:context` (29), `smoke:jobs` (19).

## 6. What a hook looks like after this

`context-maintenance`, the hook this RFC was written about, wants exactly two lines:

```yaml
on: usage
when: {"pct": {"gte": 60}}
do: skill:context-maintenance
guard: once-per-session
until: run
```

Read as behaviour: from the first turn that **ends** past 60%, a pointer lands at each turn
boundary — never beside a request, always against a reading taken after the turn spent what it
spent — and it keeps coming until a run sourced `skill:context-maintenance` has every item done. At
that point `once-per-session` takes over and it is finished for the session.

The `pct` threshold is also now honest for the first time. It was being compared against a number
measured before the turn started; it is now compared against the number at the turn's end.

## 7. What I did not resolve

- **Whether `deliver` should key off `kind` (`context` / `work`) instead of the event.** It does not
  today, because `work` currently delivers identically to `context` — the field is recorded on the
  receipt and nothing branches on it. Classifying by a field with no live behaviour would have
  invented semantics for `work` in passing, in an RFC about something else. If `work` ever means
  something mechanically, this is the second place to look.
- **Whether a held pointer should survive the session that held it.** It does not: pending pointers
  die with the pump. For a persisting hook that costs nothing (it returns next session), and for a
  one-shot hook the guard has already counted it as fired — so a session that ends in the settle
  window loses it silently. I judged the alternative (persisting a pending queue to disk) to be more
  machinery than the case is worth, but the asymmetry is real and it is the one place `until` is
  doing load-bearing work that is not visible as a feature.
- **Whether 1500ms is right in front of a human.** It is reasoned from what the debounce actually
  guards (§3.3) and it is one constant, but I could not watch the seam — I have no eyes on the
  window. If the gap between the reply landing and the session cooking again reads as a stutter,
  the number is the fix and nothing else needs to move.
- **Whether the run-record check should be scoped tighter than "this session's owner".** A run's
  `session` field is `session:<project>:<id>`, and a session id is often stable across restarts, so
  a run from an earlier *life* of the same conversation is visible to the seed. The `firstTs`
  compare makes that harmless for anything that has fired in this life, and the seed is what makes
  a re-init not re-demand a completed pass — but the two are in tension and a case I have not
  imagined may fall between them.
- **What happens to a hook held across a compaction.** The pending map is in-memory session state,
  so it survives (a compaction does not restart the pump) — but the event payload it is holding may
  describe a world the summary no longer contains. Untested, and probably fine, since a pointer
  carries almost no payload.
