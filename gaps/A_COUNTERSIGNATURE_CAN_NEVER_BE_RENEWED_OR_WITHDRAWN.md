# A countersignature can never be renewed or withdrawn — an agent signs once, forever

::gap{id=G-15}

An agent that has countersigned a claim is stuck with that signature. It cannot refresh it, it
cannot stand down from it, and nothing anywhere records that the thing it signed has since moved.

`electron/agents/sessions.cjs` (`markBlock`, the countersign branch):

```js
const signers = listOf(prior.by);
const me = by || "agent";
if (prior.state === want && signers.length) {
  if (signers.includes(me))
    return { ok: true, changed: false, marked: "claim", state: want, already: `${me} already signs this mark` };
  …
```

`ok: true`, nothing written, `at=` untouched. And there is no unsign verb on the agent face at all
— the window can step off a filled badge (the claim row's own suite asserts it), the agent door
cannot.

## Why that is worse than "a signature has no freshness"

Measured 2026-11-09 on RFC-078. `manager` countersigned c49 at `at=1794217900247`. Four hours later
c64 landed in the same door — a gone-document escape that returns *before* c49's refusal — and
c49's sentence had to be narrowed, because as written it was false. The reviewer found it. Then:

- The **author** correctly refused to touch another agent's badge, which is the right instinct: an
  author deleting a reviewer's signature to tidy an edit is the worst available version of it.
- The **reviewer** could not re-sign the narrowed sentence, could not withdraw from the old one,
  and could not refresh the stamp.

So a stale signature stands on a sentence that changed under it, and **neither party can correct
the record from where they stand.** That is not a freshness problem, it is an absence of remedy.

## What the design has to decide, which is why this is a gap and not a patch

- Does re-signing refresh `at=`, or is a signature a point in time that a second signature replaces?
- Does standing down leave a trace, or vanish? A reviewer who looked and walked away is not the
  same as one who never looked, and `reviewers=` minus `by=` already renders as an open obligation.
- Does a claim whose STATEMENT changes invalidate standing signatures automatically? `by=` already
  stashes on a state flip (`metBy=`/`unmetBy=`); a label edit moves nothing, which is how this one
  survived.
- Is there an authority question? Withdrawing another agent's signature must stay impossible; a
  reviewer withdrawing its own is a different act and probably fine.

## Filed HERE, and the leaf cannot do that job

It was first written into systemview's `gaps/` with `project=autobot` on the leaf, which looked
like a routing instruction and routed nothing: `registry({kind:"gap"})` listed it *in
systemview-test*, because `electron/markdown/registry.cjs` computes `project` from the longest
project root containing the FILE and never parses it off the leaf. `project=` is not in the
persisted field list at all, so an un-whitelisted attribute was silently absent rather than
refused — and the agent that owns the fix could not have found it by asking. Caught by manager.

**For a gap, the folder IS the routing**, and that is the one thing a leaf cannot override.

## What would close it

At minimum a door an agent can call for its own name only — refresh or withdraw, never somebody
else's — and a decision about whether a label edit should stash the signatures that stood on the
old wording. The flip path already has that machinery (`metBy=`/`unmetBy=`) and only the state
transition reaches it today.

**And this is the second thing in one night that nothing derives.** The first: a claim falsified by
a later claim in the same walk, where both pass their own checks (see the board card on the
cross-claim observable). This one: a signature falsified by an edit to the sentence it signed. Both
need a reader holding two things at once, and neither has a judge.
