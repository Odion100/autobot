# Jobs — the written agreement an agent is given

A **job** produces a **deliverable** — a thing that lands somewhere a third party can check: a
report, an answered question, work on a lane. A **skill** is a procedure, the HOW — it produces an
outcome, not an artifact. A **chore** is neither: a standing line saying a procedure must stay
*current*, checked off only by a run of the thing it names closing. ("A job is observable" never
discriminated — everything in this harness is observable; the deliverable is what does.)

A job is **GIVEN, never chosen**: a hook points at it, or the human names it. `jobsList` is a
directory for resolving a name somebody said, not a menu. The machinery is
`electron/agents/jobs.cjs`; the sibling handbook for runs and lanes is
[runs-and-worklists.md](runs-and-worklists.md).

## Where a job lives — the folder, and the sidecar that IS the identity

`~/.autobot/jobs/<id>/` holds three things:

- **`job.md`** — the whole agreement: aim, `requires:` front matter, procedure, bounds. It is
  loaded **whole** by `jobsLoad`, on purpose: a bound that only turned up in a chunk nobody
  retrieved is a bound that does not exist at 3am.
- **`job.json`** — the sidecar: `{id, name, requires, enabled, …}`. **The sidecar `id` is the
  identity, not the folder name.** Renaming only the folder is half a rename: the machinery reads
  the sidecar id, finds no folder matching it, and *heals a twin folder back into existence* under
  the old id. A rename is folder + sidecar `id`/`name` + any hook file pointing at it, in one
  motion.
- **`runs/<runId>.json`** — one record per run (below).

## Creating a job — `jobsWrite` is the only door

`mcp__context__jobsWrite({id, doc, name})` writes the folder. Nothing else creates jobs — `jobs.save`
has no other live caller. And **turning a skill into a job means DELETING the skill**: one procedure
living as both is two definitions drifting, and the skill's trigger description will keep stealing
the turns the job was supposed to get.

## How a job is given — one dispatch path, and the gate is honest

A job carries **no trigger of its own**. The hook is the dispatch path: a hook whose `do` is
`job:<id>`, whose `with:` supplies every input the job's `requires:` declares. On match,
`jobs.given()` checks the declared inputs against `with:` — missing inputs refuse the giving with a
named refusal, which is why a hook that cannot supply them is refused at write time instead of
failing silently on every match.

The other legitimate giving is **the human naming it in conversation**. That path cannot be
machine-checked, and it is not pretended to be: the session opens the run record with a `why` that
says exactly how it arrived ("named in the conversation, not fired by a hook — its declared inputs
were not machine-checked"). The gate is not claimed to have run.

**What a job must be given is declared, never improvised.** `requires:` in the front matter is the
contract. A **chore line** (`{what, period}`) has no `with:` and nowhere to put one — so a job a
chore names can only demand what its runner can derive from where it is running; anything else makes
the line unworkable, which is reported, not guessed around.

## The run record — opened at the giving, closed by observation

`runs/<runId>.json` carries `why` (how the job arrived), `event` (what fired it), `status`,
timestamps, the worklist as it stood, and the pointers below. Two rules with teeth:

- **The run's worklist is the execution** — the agent writes its plan with
  `source: "job:<id>"`, and the SAME runId continues the record the giving opened.
- **`done` is observed, never declared** — the session watches the worklist close (every item done)
  and only then stamps the record finished; `jobs.done` re-reads the list and refuses to close a
  run that is not all-done. A job run on disk saying "running" forever is a job that never actually
  closed its list.

## The run points at its report — the stamp rides the FILING

A report already has a home: `show` files it into the project's reports panel. The run record keeps
only a **pointer** (`report: {path, label, ts}`, history in `reports[]`) — nothing stores a second
copy. The session stamps it (`onReportFiled` → `jobs.reported`): the host is the only place that
knows both halves — which document was just filed, and whether this session is working a job — so
nothing is asked of the agent. The stamp reaches back to the job run that just closed
(`lastJobRun`), because an agent usually files its account *after* marking the last item done.

**Unattended runs file with `show` + `quiet: true`** — the stamp rides the filing, the TV stays the
human's. A run that skips `show` entirely leaves a card reading **"no report"** while its document
sits on disk: three overnight runs did exactly that (2026-10-18), and the miss is invisible until
the human asks. If the room's shell predates the `quiet` flag, not calling `show` is still right —
an interruption costs more than a pointer.

## The lanes a run cut — the job refers to the lane, never the reverse

When a session working a job registers a lane, the host records `laneCut` on the **job's** run
record (`lanes: [{branch, repo}]`). The lane is a branch of work, disposable by construction — it
learns nothing about the job. The strip uses the claim to pull lane rows under the job's card, and
the card's lane history is how landed work stays visible after its row is cleared.

## Rating a run

`jobs.rateRun(id, runId, {rating, note})` — the five stars on the job card write here. It is the
human's judgment of the run, stored on the record the run left.

## The window's job card — it reads its own record

The chat strip draws one card per job run: name, state, progress bar (the run's list), the report
chip, the lanes it cut. The card asks for **its own** run id — no fallback to the newest record,
because two cards wearing one record is how two different runs showed the same report. States it
can say: `running`, `finished`, `finished · landed` (every lane the record names is verifiably in
the tree — a cleared row is the landed signal, since the clearing door refuses work not in the
tree). **"no report" is a fact about the record, not the disk** — see the stamp rule above. And the
card can only read with the `jobs:read` grant: without it the window has no way to look, and the
card says "cannot read" rather than claiming an absence it cannot see.
