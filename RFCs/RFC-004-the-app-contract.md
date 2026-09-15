# RFC-004 — The app contract: what it takes to be an app here that isn't SystemView

**Status:** design. Split out of the original RFC-004 (the apps lane), which is now three documents:
this one, **RFC-005 — Jobs**, and **RFC-006 — The business app**.
**Owner:** autobot. Depends on RFC-002 (the browser is the harness).
**Blocks:** both apps. Neither can be built until an app can exist.

---

## Why this is its own RFC

The original draft treated this as section 6 of a document about two applications. That was the
wrong shape, and the reason is simple: **neither app is the foundation.** The foundation is the
contract, and the contract is currently unproven — SystemView works because it is native and
day-one, spawned by code that knows its name. Nothing has yet demonstrated the path for anything
else.

Write either app first and the contract gets discovered by accident, in that app's shape, which is
how you end up with a platform that hosts exactly one thing.

---

## 1. The load-bearing change, first: the capability gate

`electron/apps/svPreload.cjs` exposes **one fixed bag to every app page** — context, files,
projects, git, agents, dictation. It does not consult the app. It does not consult anything.

That means today, **any URL registered in `apps.json` gets the whole harness**: read and write the
filesystem, read the context store, open agent sessions, drive dictation. The registration is the
grant, and the grant is total.

This is the single most important thing in the contract and it should land before anything else in
any of the three RFCs, because it is small and because everything downstream assumes it.

### 1.1 What the obvious sketch hid — built, and what building it changed

**Status: built and verified.** `npm run smoke:caps` drives a real shell: SystemView keeps all
eight namespaces, an app granted only `files:read` receives one namespace with six members and no
`writeFile`, and the same app navigated off-origin receives nothing. The paragraphs below are what
actually happened, not what was drafted.

**The preload could not identify itself.** `main.cjs:addTab` hands every app view the same static
preload path with no `additionalArguments`, and `svPreload.cjs` read nothing from argv, origin or
any channel. `appRecord` — the first line of every version of this sketch — was the entire unsolved
problem, and writing it as a given made the gate look built.

**The mechanism works as proposed.** `ipcRenderer.sendSync("app:grants")` at preload time, with main
resolving `event.sender` → tab → `appId` → capabilities. `addTab` already carries `appId`, so main
already knew *which app is this*. Two properties that were assumptions and are now measured:

- `e.sender.getURL()` **is already the post-navigation URL at preload time.** This was the risk that
  would have forced a fallback (`additionalArguments` for first load, `sendSync` for navigations).
  It did not materialise — one mechanism covers both.
- It **re-runs per navigation**, which is what makes the next paragraph enforceable.

**THE ONE THAT COST A CYCLE: `e.returnValue` sends the sync reply on FIRST assignment.** The natural
way to write the handler — assign a `deny` default at the top, refine it as the checks pass — does
not work. The denial is already on the wire; every later assignment is discarded, silently. The
resolver computed correct answers, logged them, and every app still came back with an empty bridge.

> **Compute the answer, then assign `e.returnValue` exactly once, at the end.**

This is worth stating because the failure is invisible and it fails *safe* — everything looks
locked down, so nobody investigates. The inverse mistake (a permissive default refined to a
denial) would fail *open* with exactly the same silence.

Related, for whoever debugs this next: **a preload's `console.log` goes to the renderer console,
not main's stdout.** Instrumenting the preload and watching the terminal shows nothing at all.

**Grants bound to the view, not the origin — and nothing stops an app navigating.** There is still
no `will-navigate` guard in `main.cjs`; the only navigation control is `setWindowOpenHandler`, which
redirects popups into tabs. The preload stays attached across navigation. So a registered app that
navigates itself, follows a redirect, or has an open redirect would **carry its full grant to
wherever it lands** — `files:write`, on somebody else's page, with our bridge attached.

> The grant is re-evaluated **per navigation** and matched against the app's declared `url` origin.
> Main answers with no capabilities when the asking origin is not the registered one.

**The check lives in main, not in the preload.** Main holds the registry and the tab record, so it
compares `e.sender.getURL()` against the declared `url` itself rather than trusting the renderer to
report its own origin honestly. The preload only applies what it is handed.

The smoke test proves this with `127.0.0.1` against a declared `localhost` — **same server, same
content, different origin.** If the comparison ever degrades to a host, port or substring match,
that is the case that catches it, and it needs nothing running that the app does not already need.

### 1.2 The bridge

```js
// svPreload.cjs — shape, once identity and origin are resolved per 1.1
const granted = new Set(app.capabilities || []);   // absent = NONE, see §2.1
const api = {};
if (granted.has("context:read"))  api.context   = contextReadFns;
if (granted.has("context:write")) api.remember  = contextWriteFns;
if (granted.has("files:read"))    api.readFile  = readFileFn;
if (granted.has("files:write"))   api.writeFile = writeFileFn;
if (granted.has("agents"))        api.agent     = agentFns;
if (granted.has("dictation"))     api.dictation = dictationFns;
contextBridge.exposeInMainWorld("systemview", api);
```

**Absent, not denied.** An app that never asked for `files:write` does not have the method — there
is no function to call and no error to catch. This is the same rule the component surfaces use
(RFC-001's `capabilities.js`: absent is not denied), and it matters because a denied-but-present
method invites retry logic, while an absent one is simply not part of that app's world.

**The named capabilities**, each mapping to something that exists today:

| capability | what it exposes |
|---|---|
| `context:read` | `context()`, `list()`, `docsList` — retrieval only |
| `context:write` | `remember()`, `forget()`, `docsIndex`, `docsDrop` |
| `files:read` | `readFile`, `listFiles`, `changedFiles`, `gitState` |
| `files:write` | `writeFile`, `deleteFile` |
| `projects` | the registry — which projects exist, their roots |
| `agents` | open a session, send, read the feed |
| `dictation` | host recording |
| `jobs` | define, run, read (RFC-005) |
| `driver` | web automation (RFC-005) |

**Why `context` splits, when nothing else does.** `remember()` writes into the store **every agent
retrieves from as fact**, and `docsIndex` publishes a whole corpus. An app granted one undifferentiated
`context` can write notes that other agents later act on — that is shared memory, not app data. It
splits for the same reason `files` does, and the surface is about to get more load-bearing, not
less, now that job history feeds retrieval (RFC-005 §6).

### 1.3 This is a surface gate, not an authority gate

`ipcMain.handle` appears **78 times** across `electron/` and **not one handler checks
`event.sender`.** Withholding a method from the bridge withholds the *call site*, not the
*capability* — the handler still answers anything that reaches it.

This holds today: context isolation is on and ordinary web tabs get no preload. It is not an
exploit. But it means the whole gate lives in the renderer, and §1.1's navigation case is exactly
where that is not enough.

> **State it as layering, not as done.** The authoritative check belongs in main, keyed on
> `event.sender`. Absent-not-denied is the ergonomic layer above it.

Adding 78 sender checks is not this RFC's work. Leaving the impression that the preload alone is the
boundary **is** this RFC's problem, because the next person to add a handler will believe it.

**SystemView gets its list like everyone else.** If the native app is exempt, the gate is decorative
— the first app to need something will be handed the exemption rather than a grant. SystemView's
entry declares every capability it uses, and it stops being special except in that it ships with us.

---

## 2. The manifest

`apps.json` holds `{ id, title, url, autostart }` today, written by `registry.addApp({title, url})`
— which is exactly why an app is currently just a URL in a tab. The contract is that entry, grown:

```json
{ "id": "business",
  "title": "Business",
  "url": "http://localhost:3200",
  "autostart": false,
  "start": { "cwd": "~/Systemly/business", "cmd": "npm run app" },
  "capabilities": ["context:read", "files:read", "files:write", "jobs"],
  "components": [ … ],
  "agent": { "projectCode": "business", "definition": "business-agent" } }
```

Every field has a counterpart in the running system; none of it is invented.

- **`start`** — SystemView already spawns lazily on `openApp`, detached and unref'd so the hub
  outlives the shell. That behaviour becomes declarative instead of native-only. *Available, not
  running* stays the rule: an app in the dock is not an app consuming a port.
- **`capabilities`** — §1.
- **`components`** — §3.
- **`agent`** — `usedBy` already separates projectCode (whose code), cwd (where it runs) and usedBy
  (which app is using it). The manifest declares the default; it invents no new axis.

### 2.1 The migration default decides whether the gate ever closes

Every `apps.json` entry that exists today has **no `capabilities` key**, and the default chosen for
that absence is the whole outcome:

- **absent = all** preserves the current hole permanently, and nobody notices, because nothing breaks.
- **absent = none** breaks whatever ships without a declared list — loudly, immediately, once.

> **Absent = none.** The change ships together with SystemView's own entry declaring its list, which
> is the same argument as SystemView not being exempt: if the first migration is a grandfather
> clause, the gate never closes.

This is deliberately *not* covered by the unknown-fields rule below. An unknown field is a feature
we do not have yet; a missing `capabilities` is a security decision with a default.

**Unknown fields are ignored, not rejected.** A manifest written against a later version of this
contract must still register, or every capability we add becomes a breaking change for every
installed app.

---

## 3. Components travel

This **inverts** the dividing rule as written in RFC-001 lane 4. It was: the browser hands out
components, the app arranges them. It becomes bidirectional — an app can contribute a component
back, and the system renders it on the surfaces that component declares.

**Not any component anywhere.** A component declares where it is allowed, and the manifest is where
it says so.

### 3.1 What exists, and what breaks when it travels

`systemview/src/atoms/Markdown/registry.js` is already a component registry — a `BLOCKS` map of
directive name → React component. Three properties are worth keeping:

1. adding a feature to every markdown surface is **one line**; the renderer never changes
2. **nothing renders that isn't in the map** — the closed allowlist *is* the security story
3. the contract is props-only: `{ name, kind, attrs, label, children }`, kind = `inline | leaf | container`

What breaks is the binding — React, bundled at compile time into one app. The registry idea
survives; its implementation does not travel.

### 3.2 Two mechanisms

**Custom element.** Authored in any stack, compiled to a browser primitive
(`<autobot-sheet rows="…">`), mounted by the host page, styles isolated by shadow DOM. This is the
framework-agnostic boundary: **the browser does not ship React to apps**, and does not need to,
because a custom element is something every stack can emit.

**Own-origin frame.** A small page served by the component's *own* app — an iframe inline, or a
browser-positioned `WebContentsView` when it floats. It keeps its own origin, session, auth and data
connection.

**Which one is decided by an invariant, not by taste:**

> A component may depend entirely on **its own** app — origin, session, auth, live data. It must not
> depend on the **surface hosting it**.

Self-contained means it *brings* its connection, not that it has none. A component with live state
of its own is a frame, precisely so it keeps that connection when it travels. A component that is
genuinely a pure render of handed-in data can be the lighter element.

**Over a third-party web page it is always a frame.** We do not inject bundles into someone else's
JS context.

### 3.3 Registration

```json
"components": [
  { "name": "sheet",
    "mode": "element",
    "tag": "autobot-sheet",
    "src": "/components/sheet.js",
    "kind": "leaf",
    "props": { "source": "string", "range": "string" },
    "surfaces": ["markdown", "app", "overlay"] }
]
```

- `src` resolves against the app's own `url` — **the app serves its own components.** Nothing is
  copied into the browser, so a component is never a stale fork of itself.
- `surfaces` is the allowlist for *where*. A component that only makes sense inside its app says
  `["app"]` and cannot be summoned over a web page.
- An app may only publish under its own namespace.

**The two registries bridge rather than merge.** SystemView's `BLOCKS` stays React for its own
built-ins. The renderer gains one fallback: a directive absent from `BLOCKS` is looked up in the
cross-app registry and mounted if the current surface is allowed. *Nothing renders that isn't in a
map* still holds — there are now two maps, both closed.

### 3.4 Costs, named rather than discovered mid-build

- An inline frame needs a declared height or a resize message; there is no auto-height across origins.
- A frame does not inherit the host theme. A travelling component is **handed** a theme via props or
  `postMessage`, or it looks foreign. The tokens exist (`src/sass/theme.scss`) and both themes are
  defined, so this is a plumbing job, not a design one.
- A custom element shares the host page's JS context. That is acceptable **only** on our own
  surfaces, which is why the third-party rule above is absolute.

---

## 4. What "prove the contract" means

Three falsifiable checks. Not a vibe, and not "it feels like a platform."

1. An app in **its own repo**, on its own port, appears in the dock from an `apps.json` entry alone
   — with **no autobot code edited**.
2. It receives **less** than the full preload bag, and an ungranted namespace **is not present on
   the bridge** — `typeof window.systemview.writeFile === "undefined"`, not a call that throws.
   ("Fails cleanly" would let a denied-but-present implementation pass a check written to prove
   absent-not-denied.)
3. A component it publishes renders **inside SystemView's markdown**, proving the cross-app registry
   is real and not a same-app shortcut.

**Pass all three and the platform exists. Fail any and we have built a second SystemView.**

One app is enough to prove it. The business app (RFC-006) is that app; jobs (RFC-005) benefits from
the contract landing first but does not strictly require it.

---

## 5. Order, and who holds what

1. **The capability gate** (§1) — one file, and it is the only item here that is a security change
   rather than a feature. It should land on its own, before either app exists, so no app is ever
   written against the total-grant world.
2. **The manifest** (§2) — schema plus `registry.addApp` accepting the new fields.
3. **A second app, minimally** — enough to run checks 1 and 2.
4. **The component bridge** (§3) — the renderer fallback and the cross-app registry, proving check 3.

**autobot** owns all four: it is the browser's own process, its preload, its registry.

**systemview** owns the renderer fallback in §3.3 — the one line in `Markdown.js` that looks past
`BLOCKS` — and the theme hand-off in §3.4.

---

## 6. Open

- **Where do app project folders live** relative to `~/autobot` and `~/Systemly`? This is a
  convention question, not a design one, but the manifest's `start.cwd` bakes the answer in.
- **The bridge's name.** Every app gets its grants under `window.systemview`. Fine for SystemView,
  odd for a business app calling `window.systemview.files`. `window.autobot` is the honest name,
  since the harness is what is granting — but note this is a **migration with an existing consumer**,
  not a fresh choice: SystemView's own pages call `window.systemview.*` today. Either both names are
  exposed for a release, or the rename lands with SystemView's calls in the same change. Deciding
  before a second app depends on it is the cheap moment; after is a coordinated edit across repos.
- **Revoking a capability from a running app.** Today the preload is built once at page load. Either
  a grant change requires a reload (simple, honest) or the bridge consults a live policy per call
  (complex, and a call-time check can be forgotten in one place). I would take the reload.
