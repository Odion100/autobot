# Verification — how harness work is proven

## The smoke pattern

Harness behaviour is proven by the `smoke:*` scripts in `package.json`. They are not unit tests:
each one **boots a real headless shell**, drives a real tab or a real session, and exits non-zero
on failure. The pattern is an environment flag read in `main.cjs`, which runs the check once the
app is ready and then exits with a verdict.

```bash
AUTOBOT_SHELL_SHOW=0 AUTOBOT_<NAME>SMOKE=1 node electron/launch.js
```

Two conventions make them usable:

- **Print the evidence, then the verdict.** Every smoke logs the object it judged before `PASS` or
  `FAIL`, so a failure tells you what the world actually looked like instead of only that it was
  wrong.
- **Pass `AUTOBOT_CDP_PORT=<other>` to run one beside a live shell**, or the two fight over the
  debugging port.

Run `npm run` to see what exists — the list changes, and a list copied into a document is wrong
the day someone adds the next one.

**A smoke pinned to one subject stays pinned.** When a check generalises, write the generic one
beside it rather than widening the specific one; the regression test for a particular app is worth
more than a parameterised test that nobody remembers to point anywhere.

## The thing reasoning cannot replace

The gate, the injection, the theme shape and the origin binding all *look* correct in the source.
Each of them has shipped broken at least once while looking correct. The capability gate shipped a
silent total denial because `e.returnValue` sends on first assignment; an app shipped pinned to
dark because a theme object was compared to a string. Neither was visible in review and both were
one smoke away.

## The number-scope class of bug

Four meter bugs shipped in one day, and they were the same defect in different clothes: **a number
that describes one thing, read as if it described another.** Not arithmetic errors — scope errors.

| axis | the lie | what it looked like |
|---|---|---|
| **whose?** | a subagent's usage ruled the parent's meter | the ruler shrank, the bar flared on every attach |
| **over what span?** | a cumulative total read as a per-call snapshot | red at every turn end |
| **as of when?** | a pre-compaction reading survived the boundary | the bar looked unchanged after compacting |

**Before wiring any number to a display, ask it three questions: whose is it, over what span, and
as of when?** A number that cannot answer all three is not ready to be shown to a human.

The fix in every case had the same shape, and it is the general lesson: **when one field means two
things, the answer is two fields, not a better rule for reading the one.** Keep the honest number
and the impostor in separate fields with separate names.

## Two rules that act on the pixels

These came out of the same day and outrank the diagnostics above, because they bind the display
instead of asking the next engineer to be careful:

1. **A number that cannot answer "as of when" must say so where it is read, or not be shown at
   all** — on its face, not in a tooltip.
2. **A bound on a record is a performance decision; a bound on a label is a correctness decision.**
   They look identical in a diff — `.slice(0, N)` — and they are not the same fact. Changing the
   first is tuning; changing the second is a bug in either direction.

That second rule resolves the clamping question that keeps recurring. Clamping at the source is
wrong when the source feeds two consumers, because it shrinks the record to fit the label.
Clamping at each consumer is right but leaves every new consumer to remember. The real answer is
the one the numbers already taught: **give each consumer its own field** — a bounded label,
clamped by construction, alongside the whole record. The status reads the label, the detail view
reads the record, and nobody has to remember where to cut.

**Corollary:** when you conclude you are immune to a class of bug, write the regression test that
says so. "We happen to be immune" is a fact that rots silently.
