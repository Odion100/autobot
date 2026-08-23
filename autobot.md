# autobot — the vision, and how the system works today

## The vision (the durable reference)

autobot becomes an **AI-native browser** — not a script inside a browser, but the screen itself. The sci-fi framing: when a movie shows an AI on a screen that can do anything, that screen is a browser that can make dynamic pages, save them locally, and grow whatever UI the moment needs.

**The pillars:**

1. **Agents as extensions** — import agents the way you install extensions; a registry, not hardwiring.
2. **Agent dev tools** — first-class tooling for building, testing, and publishing agents on the platform.
3. **Task learning** — the system learns from demonstrations (the recorder) and reproduces work as reusable skills.
4. **The job engine** — long-running, repeatable automation: scheduling, status, recovery, human checkpoints.
5. **Dynamic UI generation** — the marquee feature: generate real HTML/CSS/JS interfaces on demand, save them as local pages.

**The integration fabric — SystemLynx + SystemView:** importing an agent is pulling in a remote SystemLynx API. A service's `connectionData` is already a tool manifest (service/module/method + routes), and SystemView gives every namespace documentation — so tool descriptions, the hard problem of agent integration, are a byproduct of how this ecosystem builds. Pull in buAPI and the assistant has an API; pull in BUApp and it can create games and talk sports. Design consequence: `this.lynx(url)` beside agency's `this.mcp()` — same seam, two protocols, one of them ours; and a thin SystemLynx→MCP bridge exposes the whole ecosystem to any MCP client in the world.

**The demotion of the URL (2026-08-20):** current-age browsers are built around *where you are* — the URL bar is the hero and you steer. The new-age browser keeps the familiar top (tabs, the bar) — the demotion is per-page: web pages show their URL like always, but a custom application running locally shows its **title** where an address would be (SystemView, not localhost:3000 — address on expansion if you want it). Pages aren't only fetched, they're *generated* — HTML/CSS/JS custom applications, local and saved — so the browser ends up replacing whole applications from inside.

**The flagship built-in app — SystemView as the IDE:** the first proof that pages aren't just the web. SystemView + SystemLynx are growing into a new-age IDE — multiple projects, their codebases, agents working inside them — and it gets built into this browser as a first-class application. Same fabric as everything else. The agent surface changes with it: the old injected sidebar retires, and the shell adopts SystemView's hovering agent — the movable, click-to-open chat — floating with full context of whatever page it's over.

**Trajectory:** in-browser assistant → Electron app (the shell booted 2026-08-20) → something no longer called a browser. Long-horizon: the same substrate runs ambient AI for physical spaces — house controls, custom UIs, your own assistant on every screen.

**Where the edge lives** (post-2026 modernization): grounding and clicking are commodity now; the edge is the layer above — an assistant a non-programmer *teaches* (demonstrations → skills), domain memory that knows *your* sites, jobs that re-run themselves, all in *your* browser with your sessions — plus dynamic UI generation, which nothing in the commodity stack touches.

---

# How the system works today

Written 2026-08-17 as the baseline for deciding what to modernize. Everything here is verified against the code, with the file linked at each claim. The companion report on how the agent landscape has moved since this was built lands separately on the Stage tab.

## The loop

:file[index.js] boots the driver with two agents and opens a non-headless Puppeteer browser with a chatbot sidebar injected into every page. The user talks to :file[agents/WebAssistant/index.js], which runs on `agentci` and exposes **function calls** — `navigate`, `click`, `type`, `scrollUp/Down`, `saveContent`, `promptUser` (:file[agents/WebAssistant/schema.js]). The model plans in text, then emits tool calls; each `click`/`type` call carries a natural-language description of the target (`elementName`, `elementFunctionality`, `innerText`, `containerText`, `containerName`, …) rather than a selector. Resolving that description to a real DOM element is the whole game.

## The vision procedure (first visit)

1. **Break the page into components.** :file[common/driver/index.js] computes **containers** — DOM-semantic groupings, overlaid with numbered labels (the green-box view). Separately, full-page vertical **sections** exist for `ElementLocator` (the red-bordered view). Two coordinate systems, deliberately.
2. **Describe what's in them.** Vision agents look at screenshots of the labeled page: :file[modules/ContainerIdentifier.js] names each container and its purpose; :file[modules/ElementIdentifier.js] does the same for numbered elements inside a container. Both also classify `positionRefresh` (static vs dynamic) with a 1–5 confidence.
3. **Save descriptions pointing back at the components.** Each identifier — description text, CSS selector, container, type (clickable/typeable), static/dynamic — is embedded into ChromaDB, one collection per domain (`driver.saveIdentifier` / `saveSelectors` / `cacheSelectors`). Descriptions point back to their bounding boxes: the selector, its container, and **anchors** (parent selectors + a `subSelector`) that can re-find the element when the exact selector breaks. Anchor lifecycle: computed on first use, pruned against the live DOM after use 2, dropped entirely after use 3 when the element is promoted to `static`.

There is also a human path: the **recorder** (:file[common/driver/index.js] `insertRecorder`) lets you click elements on the page; agents then describe each recorded interaction and save it through the same store.

## The reuse path (every later visit)

Entering a domain, the agent does **not** need a screenshot to act:

- `checkMemory` (:file[common/middleware/checkMemory.js]) vector-searches `"elementName: elementFunctionality"` against the domain's long-term collection, then the cache. Distance ≤ **0.35** is a candidate; candidates within **+0.05** of the best are all kept; :file[modules/CompareDescriptions.js] semantically confirms (full-match / partial-match / no-match).
- A hit sets `selectedElement` and the rest of the pipeline is skipped — no vision, no screenshots, straight to the DOM action.

## The selection algorithm (memory miss)

Middleware chain on every `click`/`type` (:file[agents/WebAssistant/middleware.js]): `hideSidePanel → checkMemory → selectContainers → searchPage`, then `awaitNavigation → clearContainers` after the action.

1. **selectContainers** (:file[common/middleware/selectContainers.js]) — if the model gave a `containerName` that memory knows, use its container directly. Otherwise vector-search container metadata with `containerText + innerText` (same 0.35 / +0.05 thresholds); ambiguity goes to `compareContainers`, and a missing `containerText` triggers :file[modules/RefineSearch.js] to ask the model for better search terms off the previous screenshot.
2. **searchPage** (:file[common/middleware/searchPage.js]) — inside the target containers, DOM vector search for interactive elements (`elementName + innerText`, filtered by clickable/typeable and by already-tried selectors). Matches get numbered green boxes; a screenshot goes to `ElementIdentifier`-driven `compareElements`, and `evaluateSelection` picks the winner. **Two passes**: a miss widens to `fullMatchContainers` and searches once more.
3. On success the resolved selector is saved back (`driver.saveIdentifier`) — the memory grows with every successful action. :file[modules/VisualConfirmation.js] exists to confirm a selection visually before acting; :file[modules/ElementLocator.js] locates elements by page section in the full-page (red-border) view — the branch this repo is currently on.

**Known sensitivity:** retrieval quality depends heavily on how the model phrases descriptions — "Search Bar: allows users to search for products on Amazon by typing keywords" retrieves reliably; "search bar: input field to search" often misses (experiments in :file[README.md]).

## Where the 2024 assumptions live (the seams to modify)

- **Model + API coupling** — everything speaks OpenAI GPT-4o JSON function calling through `agentci`, whose provider layer currently wraps only the `openai` SDK. No structured-output strict mode, no parallel tool calls, no computer-use primitives.
- **Screenshot-only grounding** — element identity comes from vision descriptions of labeled boxes; the DOM/accessibility tree is used for search but never handed to the model as a grounding source.
- **Hand-tuned constants** — 0.35 distance threshold, +0.05 candidate band, use-count-3 static promotion: all chosen against 2024 embedding behavior.
- **`executeJob` is a stub** — the Jobs system (MongoDB CRUD) stores objectives but cannot run them yet.
- **The custom loop predates standards** — MCP, native computer-use APIs, and browser-agent frameworks did not exist when this was designed; the upgrade report covers what they'd replace.
