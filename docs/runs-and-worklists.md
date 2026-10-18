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

- **The branch must exist.** The registration runs `git rev-parse --verify` — in the session's own
  repo first, and on a miss in every other root the project registry knows (`repoHolding`), because
  coupled work routinely cuts its branch in the OTHER repo. A `lane:` source whose branch no
  registered repo holds is **refused**, writing nothing. A row points at work; a row pointing at
  nothing is worse than no row at all — which is not hypothetical, it is the 9/9 run addressed to
  `lane/job-authoring`, a branch nobody ever cut.
- **The dead `lane/` spelling is refused too.** The old convention sourced runs `lane/<branch>`
  (slash, no colon); surfaces filter on `lane:`, so that spelling produced invisible rows. The
  write door now refuses it by name instead of accepting a run no surface will ever draw.
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

## What rides a run record — passengers, never testimony

Beside its list, a run record carries fields each stamped in ONE act and preserved by every later
list write (`save()` carries what a writer does not own):

- **`broughtIn`** — the receipt: who applied the branch into which tree, when, against what base.
  Unretractable; written at the moment of the bring-in, because derivation goes blind the moment
  anyone edits those files again.
- **`status`** — the statement: free text, dated, attributed, clearable. The row's headline.
- **`selfDirected`** — provenance, read off the SESSION by the host, never off the input: `set`
  takes `items` and `source` and nothing else, so an agent cannot testify about its own
  commissioning. Absent reads false — every record from before the field was commissioned work.
- **A job's run carries the lanes it cut** — so the job's card can show its lanes after the
  session that cut them is gone.

There is deliberately NO report field: an account already has a home — `show` files it into the
reports panel — and a second store on the run record was built once and retracted on sight
(RFC-066 §5 carries the full retraction; do not re-add it).

## The strip reads run files — and rows leave when HE clears them

Every kind of row — lane, job, skill — is drawn from the run FILES (`stripRuns`), never from
session events, so a shell restart cannot erase a row whose record is on disk. And no clock
removes one: an open run draws at any age (a procedure that died three days ago is exactly what
to see), and a closed run's row stands until his press or the retention janitor takes the record
itself. A recency window shipped here once and was retired — rows that vanish on a schedule read
as work that never happened.

## Retention sweeps itself

Closed runs are swept after two weeks. **A run that died stays** — where it died is the record. A
user's confirmed delete removes the run file and everything riding on it, which is why anything about a
lane belongs on its run record rather than in a store of its own: it cannot outlive what it describes,
and nobody has to remember to clean it.

## The whiteboard

Beside the list sits a freeform markdown board for the conversation's working state — drafts, values
under discussion, open threads. It renders live for the human and survives a compaction. Items are
tasks; the board is prose; long artifacts belong in files.
