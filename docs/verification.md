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

## Asking the live window — the shell serves a door for it

The section above says reasoning cannot replace looking. The shell makes looking **callable**: it
hosts a SystemLynx service in its own process (`electron/agents/shellService.cjs`), so its methods
close over the live `webContents` rather than a test renderer. In-process is the whole point — a
separate `node` has no window, which is why the older standalone service (ping/echo/info) could
never answer a question about one.

```
AutobotShell.Window.tabs()                             # what this shell has open, honestly
AutobotShell.Window.read({ selector, app, limit })     # the RENDERED dom: tag, class, text, hidden
AutobotShell.Window.count({ selector, app })           # usually what an assertion wants
AutobotShell.Window.bundle({ app })                    # running vs served, and whether a swap is HELD
AutobotShell.Docs.search({ q, corpus, limit })         # the indexed corpora, for a retrieval check
```

Reachable three ways, and that is the point of it being a service rather than a tool: `probe` for a
look right now, a **saved spec** so a claim about the window can carry a living defence, and an HTTP
MCP endpoint (`/autobotshell/api/shell-mcp`) for an agent that is not this session.

**`bundle()` is the one to reach for first when a fresh build "did not land".** The window holds its
own swap until it costs the human nothing, and holding is CORRECT — it reads identical to a stale
bundle, and that confusion once cost him his tabs six times in one session. `holding: true` is the
hold working; it is not a reason to force anything.

**Read-only, deliberately, and `executeJavaScript` is NOT exposed.** The door reads the page and
never clicks, navigates or reloads it: the window is his instrument, and a door that could take it
would not be a proof door. Publication is declared — a method is an MCP tool only with a schema
*and* a name in `expose` — so the whitelist is the security boundary and it holds nothing general.

### What this door cannot defend

**A change-loop defence — and that is a limit on the DOOR, not a demotion of what it produces.**
An assertion about rendered rows needs the document open, so it goes red whenever he is elsewhere:
his navigation is not the world moving, and a spec that reports a finding because a tab is closed
is reporting on him. The headless jest-adapter specs ride the loop; this answers *"is it true on
the real page right now"*, which is the **confirming half** of a proof and is owed by default —
`context("what does a proof owe besides the test chip")`. Two halves, two questions; this door
answers one of them well and cannot answer the other at all.

**So a spec hung on this door must not assert that the window is open.** `theWindowIsOpen` is
precisely the precondition named above as disqualifying, and asserting it converts his navigation
into a red. Assert what the page SAYS, guard on reachability, and report "not open" as a skip the
reader can see rather than as a failure — otherwise the spec's red means nothing and the one thing
a proof must never do is cry wolf on the change loop.

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
