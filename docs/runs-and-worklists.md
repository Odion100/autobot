# Runs and worklists — the only proof a procedure was followed

A worklist is not a log written afterwards. It is the one record that outlives a session, and the
system reads it to answer three questions nothing else can: **was this executed**, **was it complete**,
and **where did it die**. `electron/agents/worklist.cjs`.

## A session plan, and runs beside it

An agent's own plan has no `source`. Anything executed — a skill, a job, a delegated lane — opens a
**run**: its own list, owned by that execution, with `source` naming what it is the execution of
(`skill:doc-maintenance`, `lane:lane/engagement`, `job:<id>`). The session plan is untouched by it.

**Marking every item done is what closes a run.** Nothing else marks a procedure complete — not the
agent saying so, not the work being finished. A run that finishes its work but not its list looks dead
at 4/5 forever, and that is the honest reading: the record is what exists.

## Where it died is the most useful thing it can say

A procedure that stops leaves its list **exactly where it stopped** — one item `active`, the rest
pending. Tidying it destroys the only evidence of the failure. One run sat at 7/8 for ten days, stuck
on its own "report" step; that visible stall is what let anyone find it.

Two failure shapes worth recognising, both of which make a record lie:

- **A 0-item run.** An empty list is vacuously complete — the skill reads as followed while asserting
  nothing. If a procedure is abandoned, leave no sourced run rather than an empty one.
- **A human-dependent item.** A step only somebody else can check off never reaches done, so the
  procedure can never complete. Name your half of it ("report X and ask him to Y") and close it when
  you have said it.

## The source IS the address, and the prefix is protocol

A lane's run is sourced `lane:` + the branch name, **whatever that name is**. So a branch already
called `lane/engagement` takes `source: "lane:lane/engagement"` — doubled, and correct. It reads like a
stutter and is not one: the strip filters on `startsWith("lane:")`, so a run sourced `lane/engagement`
gets no lane row.

What made that worse than invisible: a source the surface does not recognise was **promoted into the
session-plan slot**, so three subagents' private lists appeared wearing the owner's chrome, and the
displayed "plan" flapped between them. An hour of argument came out of that — both people describing
something true about a screen neither could see. Brief a lane with the exact source string rather than
leaving a subagent to derive it.

## Retention sweeps itself

Closed runs are swept after two weeks. **A run that died stays** — where it died is the record. A
user's confirmed delete removes the run file and everything riding on it, which is why anything about a
lane belongs on its run record rather than in a store of its own: it cannot outlive what it describes,
and nobody has to remember to clean it.

## The whiteboard

Beside the list sits a freeform markdown board for the conversation's working state — drafts, values
under discussion, open threads. It renders live for the human and survives a compaction. Items are
tasks; the board is prose; long artifacts belong in files.
