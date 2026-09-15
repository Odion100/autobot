# RFC-005 — Jobs: unattended work that is observable

**Status:** design. Split out of the original RFC-004 (the apps lane).
**Owner:** systemview (the engine and the context halves); autobot owns `emit()` and the hooks module it builds on.
**Depends on:** the hooks engine shipped in `3c47dd2`; the context store and document embeddings (RFC-058).
**Related:** RFC-004 — the app contract. Jobs benefit from it but do not require it.

> **The definition, and it is Odion's:** *the difference between doing something and doing a job is
> that a job is observable.* Not that it is scheduled. Not that it is unattended. **Observable.** A
> job is a package — the work, the log of it happening, what it produced, and how it rated.

This document is two parts, and the seam between them is load-bearing:

- **Part one — the engine.** Emits, records, runs. Owned by nobody's app.
- **Part two — workers.** A surface that reads and arranges. The engine's first consumer.

**The test for that seam:** if the workers half cannot be deleted without the engine half changing,
the seam is in the wrong place. The engine must never know that workers exists, the same way the
terminal does not know SystemView is drawing it.

---

# Part one — the engine

## 1. The dispatch engine already exists, and it is `hooks`

Before designing a job runner, read the one we have. `electron/agents/hooks.cjs` plus `fireHooks()`
in `sessions.cjs` already do every hard part of dispatch:

- **Matching** — `matchesWhen()` tests an emitted event against conditions by dotted path.
- **Dispatch** — `pointerText()` rides the agent's **input queue** as a turn that arrived from
  outside, which is precisely how unattended work starts without a human typing.
- **Idempotence** — `guardAllows()` plus the `fired` Map stops a re-fire.
- **Scope** — `inScope()` means an agent carries a hook the way it carries a skill; nothing acquires
  one it never opted into.
- **Loop safety** — `fire()` refuses to match on `hook.fired`, so receipts cannot feed themselves.
- **A receipt** — `hook.fired` is emitted, so an unattended trigger is never silent.

The principle the whole design rests on is already written in `sessions.cjs`: **observability and
hookability are the same thing.** Every moment the harness announces is already a possible trigger,
and a future moment becomes triggerable *by being emitted*, with nothing wired.

**Jobs build on this seam, not beside it.** A second dispatch path would duplicate matching, guards,
scope and receipts — and would be the half that drifts.

## 2. What a job has that a hook does not

A hook is a pointer: *go look at this.* A job is work with an identity that survives, gets revised,
and can be reasoned about when it is not running. Four gaps, and only four.

### 2.1 The job document is the job

**The document is the source; the config is a projection of it.** A job begins as a planning session
with a human and ends as a written agreement: what this job does, what it must never do, what
"done" looks like, what to do when it is unsure. The machine half — trigger, definition, criteria —
is derived from that document, not the other way round.

**It is loaded whole when the job fires. It is never retrieved against.**

This is the correction that shaped this section, and the reasoning is autobot's: retrieval is lossy,
and a job document is an **instruction set**. A corpus answers by returning the chunks that scored,
which is right for reference material where a miss costs you a re-read — and wrong for instructions,
where *"never email the client directly"* sitting in a chunk that did not score means the constraint
**silently does not exist at 3am**. The failure is invisible and unattended, which is exactly the
condition we are building for.

A skill file is loaded whole when it fires, for the same reason. A job document is that shape.

Practically: one file, four to six sections, comfortably inside context. Chunking it to answer
questions about itself is heavy machinery standing in for *read the file*.

### 2.2 A durable definition

The machine half lives at system level in `~/.autobot/jobs/<id>/`, beside `~/.autobot/hooks` —
**owned by no app**, the same as presence and the system context:

```
~/.autobot/jobs/<id>/
  job.md          the agreed document — the source (§2.1)
  job.json        the projection: trigger, definition, criteria
  runs/           one record per run (§2.4)
```

`job.json` is an **AgentDefinition plus three fields**, not a new schema:

```json
{ "id": "weekly-revenue",
  "definition": { "prompt": "…", "tools": […], "skills": […], "mcpServers": […], "model": "…" },
  "trigger": { "on": "schedule.due", "when": { "job": { "equals": "weekly-revenue" } } },
  "confirmation": "the report exists and its totals reconcile to the ledger",
  "evaluation": "was this worth reading on Monday morning?" }
```

`AgentDefinition` is adopted, not paralleled — RFC-003's rule. Anything else translates at the SDK
boundary forever.

### 2.3 Trigger sources that are not emitted events

Today something must happen *inside* the harness for anything to fire. Jobs need the clock and
external arrivals. Per §1's own logic the fix is **to emit them**, not to add a parallel path.

**The scheduler is a service, not part of the harness process.** The harness restarts constantly —
five times in one evening during the session that produced this RFC. A job that misses Monday 6am
because the shell restarted on Sunday is unrecoverable and, worse, **silent**: you do not find out
it did not run. A service outlives the shell, and the harness subscribes to it.

It emits `schedule.due { job, dueAt, firedAt }`.

**Downtime forces a question the in-process version never had to answer: catch up, or skip?** Both
are defensible. Silence is not — *"it ran fourteen hours late"* with no explanation is the same
class of failure as a trigger with no receipt.

> **The rule:** skip by default for anything periodic; catch up only when the definition says
> `onMissed: "run"`. **Emit `schedule.missed { job, dueAt, skipped }` either way**, so the feed
> carries the fact regardless of which branch ran.

Ingress (a webhook, a file landing, a service calling in) follows the same shape: emit
`external.arrived`, and it is hookable, observable and feed-visible on day one.

### 2.4 An outcome that outlives the session

Hooks fire and dissolve into the feed. A job must leave a record: what ran, what happened, what it
produced, and **how it rated**.

Jobs emit through the same `emit()` as everything else — `job.started`, `job.step`, `job.finished` —
which means they land in the feed and the chat for free, and, by §1's principle, **a job's own
progress is hookable.** One job triggers another with no new machinery.

## 3. The worklist is the job's progress model

A job follows a worklist and updates it as it goes. That buys, with nothing new invented: one active
item at a time, a live model rather than a log, and an honest completion signal.

It also makes an existing rule **correctness rather than etiquette**: *never put an item on the list
that only a human can check off.* For a job running at 3am, an item that can never complete means
the job can never finish.

**The worklist is currently write-only and session-scoped, and that has to change.** A job's worklist
must outlive its session — reading it after the fact is the entire point. One concept, two
lifetimes: the worklist gains persistence when it belongs to a job. Not a parallel "job steps"
structure, which would drift from the real one within a month.

## 4. A trigger must be explainable, and must carry enough to act on

Two properties. Neither restricts how loose a trigger may be.

**Explainable.** You must always be able to answer *why did this run?* The receipt says what matched.
A fuzzy `when` is fine if it can report *"the value you asked me to watch crossed its threshold."* A
trigger that fired because an embedding scored 0.81 is not, because there is no answer to give at
3am. This is a property of the **receipt**, not a constraint on the condition.

**Sufficient payload.** A hook that matches but hands the agent nothing useful is the worse failure —
the agent guesses, and guessing unattended is how a job does damage. The trigger carries: the event,
the matched value, and the job document (§2.1).

## 5. The rating is the loop, and it is what makes history worth keeping

Reports say what happened. Ratings say which definitions are any good — and a rated history of
outcomes is **task learning** arriving as a byproduct instead of as a feature someone has to invent.

A constraint on the **view**, not the engine: the rating must be capturable at the moment the report
is read. A rating you have to navigate to is a rating that never gets given.

## 6. The job's HISTORY is the corpus

This is where RFC-058 belongs, and it is the half that genuinely needs retrieval.

A job's history — past runs, what happened, what was produced, what it rated, what was learned —
**grows without bound**, quickly exceeds context, and carries the question a job actually has when
it wakes up: *has this failed before, and how?* That is not answerable from the document, and it is
exactly what semantic search is for.

- Each job's history is a **`working` corpus** owned by that job, indexed as runs land, dropped when
  the job is deleted. `working` is not decoration: it keeps N job histories out of every unfiltered
  answer, so one job's failures never surface in someone's question about the framework.
- A history corpus is **append-only**, so the staleness bookkeeping does not apply — nothing drifts
  from a file that is never rewritten.
- An **unrated** history is a pile of transcripts. A rated one is a corpus worth querying, which is
  why §5 is structural rather than a nicety.

The split, stated once: **the document is loaded whole (the instruction); the history is retrieved
(the experience).**

## 7. Authoring hooks — the missing half

Today hooks are files in `~/.autobot/hooks` and **nothing in the system writes them.** No tool, no
UI. Every hook is hand-authored, which means the trigger half of every job is hand-authored, and
the *"watch this value"* idea has nowhere to land.

This is a prerequisite, not a follow-up.

**Two front doors onto one mechanism**, which is the only way they stay consistent:

- **A tool**, so an agent can propose a hook the way it proposes an agent doc — the agent writes the
  proposal, the human approves, the approval is the write.
- **A right-click menu in the browser**: point at a node → we record a stable locator and the
  current value → write a hook whose `when` is *this value changed* → point it at a job.

### 7.1 Page events are the unlock

The browser already sees clicks, navigation, reload, DOM mutation. Under §1's principle, making them
triggers means **emitting what we already observe** — `page.clicked`, `page.navigated`,
`page.value-changed` — and they are hookable with nothing else wired.

*"Watch this table"* then stops being a feature and becomes a hook authored from a right-click. It is
also the confirmation primitive web automation needs to know that what it did actually worked.

---

# Part two — workers

**A surface that reads and arranges. It does not own the engine.**

## 8. Why it is an app and not a SystemView lane

The claim is about a category, not a decoration: **the surface is composed, personal, and it
changes.** Dynamic backgrounds, dynamic components, an arrangement that is not the same every
morning — the interface is something the system composes for you rather than a fixed layout that
data gets poured into. A surface that is sparse after a quiet weekend and dense after a heavy week.

That is the opposite product from SystemView's agent cards, which is precisely why it is a separate
app: **same mechanisms, opposite arrangement** — the dividing rule working as intended.

And it is the real answer to *why not inject this into SystemView*: SystemView's surface is **fixed
and technical by design** — panels, cards, lists, a developer's instrument. You cannot reach a
composed surface by adding a lane to an instrument. The thing that makes workers work is the thing
SystemView deliberately is not.

It is therefore the **first real consumer of dynamic interface generation**, which is what turns
that from a pillar in a vision document into something that has to render something worth looking at
on a Monday.

## 9. What it does

Define jobs. Watch running ones. Read finished reports — **and rate them where they are read** (§5).

A report you have to go find is work. A report already there when you sit down is the entire value
of having run the job overnight.

## 10. The seam, stated so it can be checked

The engine emits and records. Workers reads and arranges. Concretely:

- Workers holds **no job state**. It reads `~/.autobot/jobs` and the event stream.
- The engine emits the same events whether workers is open, closed, or uninstalled.
- Rating writes through a job API, not into a workers-owned store.

> **If the workers half cannot be deleted without the engine half changing, the seam is in the wrong
> place.** SystemView is the terminal's first consumer, not its owner; workers is the job engine's.

---

## 11. Order

1. **Hook authoring** (§7) — **owned by systemview.** The tool first, the right-click menu second.
   Nothing else can be triggered by a human without it, and §7.1's page-events unlock has nowhere to
   land until it exists. It is a context-layer surface — the same family as the agent-doc proposal
   flow and the corpora panel — which is why it sits here rather than with the browser's own work.
2. **Durable worklists** (§3) — small, and the progress model everything else reports against.
3. **The job document and definition** (§2.1, §2.2) — planning session in, document out.
4. **The scheduler service** (§2.3), emitting `schedule.due` and `schedule.missed`.
5. **Run records and the history corpus** (§2.4, §6).
6. **Workers** (part two) — which by definition cannot start until there is something to arrange.

Odion writes the **job planning skill** on top of 3, rather than us guessing the procedure: the
skill encodes how *he* wants a job planned, and that is his.

## 12. Open

- **Confirmation criteria in prose vs checkable.** *"The totals reconcile"* is the honest statement
  and is not machine-checkable. Either the agent judges it (and can be wrong, unattended) or we
  demand a check that can run (and lose the ones that matter). I lean toward: the agent judges, and
  the judgement is recorded as part of the run so the rating can disagree with it.
- **What a job may do without asking.** A job that can write files and call services at 3am is a job
  that can do damage at 3am. The capability list in RFC-004 §1 is the right vocabulary; whether a
  job's grants are its agent's grants, or narrower, is unresolved.
