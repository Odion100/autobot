# Runs and worklists — the only proof a procedure was followed

A worklist is not a log written afterwards. It is the one record that outlives a session, and the
system reads it to answer three questions nothing else can: **was this executed**, **was it complete**,
and **where did it die**. `electron/agents/worklist.cjs`.

## A session plan, and runs beside it

An agent's own plan has no `source`. Anything executed — a skill, a job, a lane — opens a
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

## The `lane:` write IS the registration

A lane is one worktree + one branch + one **registered** run (2026-10-08), and the `worklist set`
that names a `lane:` source is what makes it a lane — it opens the run, draws the row, and answers
*"registered as a lane on `<branch>`"*. So the prefix is not only an address, it is a claim, and
both halves of it are enforced:

- **The branch must exist.** `sessions.cjs` runs `git rev-parse --verify` in the session's cwd and
  **refuses** a `lane:` source whose branch it cannot find, writing nothing. A row points at work;
  a row pointing at nothing is worse than no row at all — which is not hypothetical, it is the 9/9
  run addressed to `lane/job-authoring`, a branch nobody ever cut.
- **The run must exist.** A `lane/*` branch with no run against it is **not a lane**: the agent-side
  `lanes` verb names it separately rather than listing it, because `worklist.registeredLanes()` is
  what that verb intersects git's answer with. Asked of the BRANCH across every run on disk and
  deliberately not project-scoped — the run that registers a lane is written by whichever session
  did the work, and the branch lives in whichever repo the work was in, which are routinely
  different projects.

**Registering does not require delegation.** Any agent cuts a branch and registers its own work;
handing the work to a subagent is one *use* of lanes, not the door to them.

What made that worse than invisible: a source the surface does not recognise was **promoted into the
session-plan slot**, so three subagents' private lists appeared wearing the owner's chrome, and the
displayed "plan" flapped between them. An hour of argument came out of that — both people describing
something true about a screen neither could see. When a subagent IS doing the work, brief it with the
exact source string rather than leaving it to derive one — an agent registering its own lane has
nobody to brief it, and writes the string itself.

## Retention sweeps itself

Closed runs are swept after two weeks. **A run that died stays** — where it died is the record. A
user's confirmed delete removes the run file and everything riding on it, which is why anything about a
lane belongs on its run record rather than in a store of its own: it cannot outlive what it describes,
and nobody has to remember to clean it.

## The whiteboard

Beside the list sits a freeform markdown board for the conversation's working state — drafts, values
under discussion, open threads. It renders live for the human and survives a compaction. Items are
tasks; the board is prose; long artifacts belong in files.
