# onnxruntime hangs in the Electron main process — cause unknown, routed around

**Status: WORKED AROUND, NOT UNDERSTOOD.** The vector capability ships with its embedder in a
child process (`electron/apps/vectors-worker.cjs`), which makes the symptom go away. Nobody has
explained the symptom. This file exists so that fact does not quietly become "we designed it that
way" — the out-of-process design is defensible on its own merits, and it is *also* covering for a
bug we never found.

## What happens

`@huggingface/transformers` 4.2.0 → `onnxruntime-node` (napi-v6 prebuilt, `darwin/arm64`) does
feature-extraction work correctly and fast in **plain node 22**. The identical code path in the
**Electron 43.4.1 main process** either dies with `SIGTRAP` or hangs indefinitely with no output
and no error.

Measured, 2026-09-08:

| where | workload | result |
|---|---|---|
| plain node | 227 wiki chunks, batch 32, `bge-small-en-v1.5` | OK, ~10.6s |
| plain node | 227 wiki chunks, batch 32, `all-MiniLM-L6-v2` | OK, ~5.8s |
| electron main | `require()` the package, read `env.useFS` | OK — resolves to `dist/transformers.node.cjs`, `useFS: true` |
| electron main | ONE short string, `all-MiniLM-L6-v2`, `dtype: q8` | **OK**, dims `[1,384]`, 151ms warm |
| electron main | 227 chunks, batch 32, `bge-small-en-v1.5` | **SIGTRAP** |
| electron main | batch-size bisect (1,4,8,16,32), `bge-small-en-v1.5` | **hung >5min**, killed; never printed even the post-load line |

## What is ruled out

- **Not module resolution.** Electron resolves the package to the node CJS build and reports
  `useFS: true`. An earlier failure that looked like this *was* resolution — importing
  `dist/transformers.js` (the web bundle) directly makes `node:fs` an empty stub, so it tries to
  `fetch()` a local path and reports the model as missing. That is a different, fully understood
  bug; do not confuse the two. Requiring the package **by name** is correct and works.
- **Not the native ABI.** The prebuilts are **napi-v6**, which is ABI-stable across Node and
  Electron. No `electron-rebuild` step is needed and adding one is not the fix.
- **Not a missing model.** The weights are on disk at `~/.autobot/models/embed/` and the same
  files serve the successful plain-node runs. The single-string Electron run succeeded against
  them with `allowRemoteModels: false`, so it was genuinely offline and genuinely local.
- **Not an uncaught JS error.** All calls were inside `try/catch` that printed on failure. Nothing
  printed. This is process-level (SIGTRAP) or a stall below JS.

## What was NOT isolated — the honest hole

Between the working Electron case and the failing ones, **two variables changed at once**:

1. the model — `all-MiniLM-L6-v2` (works, single string) vs `bge-small-en-v1.5` (fails)
2. the workload — one string vs a batched loop over hundreds

So "Electron cannot run onnxruntime" is **not** established. What is established is that *some*
combination of model and batched workload wedges it, while a single short inference on a different
model does not. The obvious next experiment is the 2×2: MiniLM-batched and bge-single. It was
never run, because the child-process design made the question stop blocking progress — which is
exactly how a gap becomes permanent.

## Why the workaround is right anyway

Even with a fix in hand, the embedder should stay out of the main process:

- **Blast radius.** A native crash in the model would take the whole browser — every window, every
  session — with it. Out of process it is a rejected promise.
- **Responsiveness.** A full index is ~10s of CPU. In the main process that blocks every window.
- **Precedent.** `dictation.cjs` already shells out to `whisper-cli`. Local inference living in its
  own process is the established shape here, not an exception carved for this.

The child is guarded accordingly: `vectors.cjs` fails every in-flight caller when the child exits,
and times out at 120s. Without that, a wedged child would reproduce the exact silent-hang failure
this capability was moved out of process to avoid — one layer up.

## Why it still matters

- Anything else in the harness that wants local inference (a reranker, a larger model, image
  embeddings) will hit this and has no documented reason for the wall.
- If the true cause is a thread/signal interaction between onnxruntime and Electron's main loop,
  it may affect other native modules, and we would not recognize it.
- `SIGTRAP` specifically suggests a debugger-trap/assert path in native code, not an ordinary
  crash. That is a lead nobody followed.

## Narrowed on review — autobot, 2026-09-08

Two reads of the table above that the author missed, and both shrink the search:

1. **"Electron cannot run onnxruntime" is disproven by row 4 of this document's own table.** One
   short string on `all-MiniLM-L6-v2`/`q8` ran in the electron main process in 151ms. So the
   variable is **scale, model, or dtype — not the runtime**. Anyone picking this up should stop
   looking for an Electron/native incompatibility; there isn't one at the level of "can it run."

2. **The bisect hung BEFORE printing its post-load line, which points at LOAD, not inference.**
   `batch.js` printed nothing at all — not even `BATCH model loaded` — before being killed at five
   minutes. If inference were the problem the load message would have appeared first. So the
   suspect is `pipeline()` constructing the session for `bge-small-en-v1.5`, not the forward pass.
   That also explains why the SIGTRAP run and the hang run look different: they may be the same
   failure caught at two points.

Combined, the 2×2 in the section above is now more like a 1×2: run **bge-single-string** in the
electron main process. If it hangs, it is the model/session construction and batching is irrelevant.
If it succeeds, it is scale.

## Fix direction

1. **Run the 2×2** to name the actual variable — model or batching.
2. If batching: cap batch size in the worker (currently 8) and confirm whether the main process
   tolerates the same cap. That would turn "Electron cannot" into "Electron cannot above N."
3. Capture the native side — run Electron under `lldb`, or set
   `ORT_LOG_SEVERITY_LEVEL=0`, to get the assert onnxruntime is tripping instead of a bare signal.
4. Report upstream once it is characterized. `onnxruntime-node` + Electron main is a common enough
   pairing that a clean repro has value beyond this repo.
