# The automation half — driving a real browser

The other codebase in this repo: agentci agents controlling a non-headless Puppeteer browser
through natural language. It predates the harness and is still live code. Entry is `node index`,
with ChromaDB and MongoDB running.

Paths matter here because they moved: the agents, their shared middleware and the vision modules
all live under **`agents/`** (`agents/common/middleware/`, `agents/common/modules/`), while the
browser controller is at `common/driver/`.

## The driver owns browser state

`common/driver/index.js` is the single source of truth for everything about the live browser —
pages, selectors, the injected UI, the vector-store calls. **Never reach into Puppeteer
directly.** Two sources of truth for "what is the browser doing" is how this kind of system
starts lying to itself.

## Element resolution — the ladder

The interesting part of this system is how `click` and `type` decide *which* DOM element is
meant. It is a middleware chain, and it is ordered cheapest-first:

```
hideSidePanel → checkMemory → selectContainers → searchPage
```

1. **checkMemory** — has this element been resolved before? Either by an explicit id, or by vector
   search over `"<name>: <functionality>"` against the selector store. A distance **≤ 0.35**
   counts as a candidate, and everything within **+0.05** of the best hit comes along as a
   candidate too. Candidates are not trusted on distance alone — they go to a `CompareDescriptions`
   agent for semantic confirmation. A hit short-circuits the rest of the chain.
2. **selectContainers** — narrow the page to the sections likely to hold the target, using a
   vision agent on a screenshot with containers outlined.
3. **searchPage** — inside those containers, highlight interactive elements with numbered boxes,
   screenshot, and ask a vision agent which number matches.

After a successful interaction the resolved selector is saved back to the store, so the expensive
path pays for itself the next time. **The ladder is the design**: vision is the fallback, not the
method.

### Description quality is a real variable

Vector-search accuracy varies sharply with how the element is described. *"Search Bar: allows
users to search for products on Amazon by typing keywords"* resolves reliably where *"search bar:
input field to search"* does not. When resolution is flaky, suspect the description before the
threshold.

## The selector store

ChromaDB, per domain, in two tiers:

| tier | collection | holds |
|---|---|---|
| long-term | `<domain>` | selectors confirmed enough times to be considered stable |
| cache | `<domain>-cache` | elements whose position moves — search results, recommendations |

Which tier a selector lands in is decided by a `positionRefresh` classification (`static` or
`dynamic`) that the vision agents produce alongside a 1–5 confidence.

**Anchors are the resilience mechanism.** On first save the driver computes parent-selector
anchors plus a sub-selector, so an element can be re-found when its exact selector breaks. On
later uses it prunes anchors that no longer match the live DOM, and once an element has survived
enough uses it is promoted: anchors cleared, `positionRefresh` set to `static`. An element earns
its way into long-term memory by repeatedly being findable.

## agentci

All agents here are built with agentci (informally "agency") — the same framework the SystemLynx
ecosystem uses, with `before`/`after` middleware chains per method, which is what the resolution
ladder above is made of. Read an existing agent before writing a new one; the pattern is
consistent and the chain order carries the meaning.

## Jobs

MongoDB-backed job records, with the model in `db/`. **`executeJob` in
`agents/WebAssistant/methods.js` is still a stub** — it loads the job, logs success, and performs
nothing. Do not treat it as implemented. (The harness has its own, separate jobs system; the two
share a word and nothing else.)

## Running it

```bash
chroma run --path ./vectorStore   # must be up first; data persists in ./vectorStore
node index
```

MongoDB connection string and the model API key live in `.env` (shape in `example.env`).

**Don't mock the browser or the vector store in tests.** Real behaviour is the entire point of a
test here — a mocked selector store proves that the mock works.
