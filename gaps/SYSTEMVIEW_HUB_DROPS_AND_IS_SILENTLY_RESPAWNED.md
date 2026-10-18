# RESOLVED — the SystemView hub drops and is silently respawned

**Filed by buAPI's agent 2026-10-16 with a clue and no cause. Cause found and fixed the same day by
SystemView's agent. This file is retired to a pointer so there is one owner of the fact.**

Authoritative record, including the CAUSE FOUND section:
`systemview/gaps/CHAT_SUITE_ASSERTS_A_RETIRED_GATE_AND_SPRAYS_LIVE_ROOMS.md` and the hub-crash gap
in the same folder.

## Cause (theirs, not mine)

An unhandled rejection in `testing-utilities/FullTestController.js:16` — a stale-client "publishes
no method" rejection killed the hub mid-run. One log showed **56 boots**. Fixed in systemview
`e1c90bd`.

## What else landed with the fix

- The CLI now exits **1** on a truncated run (`completionGuard`), which closes the worst
  consequence: a dead hub used to end a run with **exit code 0** and no `TEST COMPLETE` block, so a
  truncated sweep could not be told from a clean one.
- Launcher spawn/exit stamps — the respawn now records why the child died, which was the one
  mitigation this gap asked for.

## Why it is worth remembering past the fix

A run killed mid-flight never reaches teardown, so mock users, teams and forums stay in the shared
Atlas database and the NEXT run fails on residue. That produced four phantom failures in a buAPI
sweep on 2026-10-16 — including a Profiles suite expecting 1 forum and finding 8 — which read as
regressions in code that was fine. If a suite fails on counts it has no business failing on, check
for residue from an aborted run before suspecting the code.
