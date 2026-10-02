# Apps — the contract

An app is **a URL served by its own process**, registered in `~/.autobot/apps.json`, that the
shell opens as a tab and hands a scoped bridge. SystemView was once the only one, and the
contract exists because that stopped being true.

## Registration

```json
{ "id": "blink", "title": "Blink", "url": "http://localhost:3200",
  "capabilities": ["context:read", "files:read", "components", "systemlynx"],
  "start": { "cwd": "~/Systemly/blink", "cmd": "npm run app" },
  "icon": "http://localhost:3200/app/icon.png" }
```

`id` is derived from the title (lowercased, non-alphanumerics to `-`) when the programmatic door
is used; write it explicitly in the file so a later edit updates in place instead of duplicating.
`icon` and `components` are optional. The file is re-read live — **registering an app does not
need a restart.**

`start` takes two shapes: an argv array, or `{cwd, cmd}`. The command is **split on whitespace and
spawned without a shell**, so `npm run app` works and `&&`, pipes and env prefixes do not — chain
inside the npm script instead. `~` is expanded only at the head of `cwd`, because there is no
shell to do it.

## The capability gate

**Absent, not denied.** An app that never asked for `files:write` does not have the method — there
is no function to call and no error to catch. A namespace with no granted members is dropped
entirely rather than left empty, because `window.systemview.files` existing-but-empty reads as
"supported, currently broken." **A missing `capabilities` list is not an unknown field; it is a
security decision with a default, and the default is none.**

The read/write split is not symmetry for its own sake. `context:write` reaches what every later
agent retrieves *as fact*, which makes it the poisoning surface and the one grant a third-party
app should almost never hold.

### How a preload learns which app it is

It cannot on its own — every `kind:"app"` view gets the same static preload path with no
per-tab arguments. Main already knows, so the preload asks:

```
ipcRenderer.sendSync("app:grants")  →  main: event.sender → tab → appId → capabilities
```

`sendSync`, not `invoke`, because `contextBridge.exposeInMainWorld` must run *during* preload
execution; an awaited answer arrives after the page has already looked for its bridge.

**The trap that cost a day:** `e.returnValue` sends the reply on **first assignment**. Computing a
deny-by-default and then refining it ships the denial and discards the refinement, silently — every
app gets an empty bridge while the logs show the correct answer being computed. Compute first,
assign once, at the end. That failure was safe; the inverse fails *open* just as quietly.

### Grants are bound to the origin

There is no `will-navigate` guard. A preload stays attached to its view across navigation, so a
registered app that followed a redirect would carry its grants to wherever it landed. Main
therefore compares the asking URL's origin against the declared one and answers with nothing when
they differ. `127.0.0.1` and `localhost` are **different origins** — same server, same content,
no grants. This also means a separate dev-server port is an ungranted origin.

### It is a surface gate, not an authority gate

`ipcMain.handle` appears dozens of times across `electron/` and none of them check
`event.sender`. Withholding a method from the bridge withholds the **call site**, not the
capability. Context isolation is on and plain web tabs get no preload, so it holds today — but the
authoritative check belongs in main, and the next person to add a handler will assume the preload
was the boundary.

## Escalation by rendering — the rule that inverts the gate

A custom element mounts into the **host's** page and therefore closes over the **host's** bridge.
An app granted only `files:read` publishes a component, SystemView mounts it, and it is now
holding SystemView's `files:write`, `terminal` and `context:write`. The gate resolves grants
correctly and then *mounting* hands the publisher a strictly larger set.

> **An element may be mounted only when the publishing app is the hosting app. Anything crossing
> an app boundary renders in a frame.**

Same-app is the identity case, not an exception — the component closes over the bridge of the app
that published it, which is what it already had. A cross-app element is **dropped, not downgraded
to a frame**: an element's `src` is a JS module rather than a page, so loading it in an iframe
renders nothing and reads as a bug in the component. Frames are safe by construction here because
subframes get no preload at all.

## Theme rides outside the gate

Light/dark is **the environment an app is being displayed in**, not an action it performs, so no
capability is required and every app gets it. Two things to know:

- It speaks `{dark: boolean}` — an **object**, from both `current()` and the `onChange` callback.
  Comparing it to a string pins an app to dark inside the harness while its OS fallback keeps
  working, which is a very convincing bug.
- `current()` is **synchronous on purpose**: an awaited answer means a flash of the wrong palette
  on every load. Read it before first paint.

## window.systemlynx

Apps holding the `systemlynx` grant get the SystemLynx client library injected into the page
world — not a wrapper the harness invented, the library itself, so `const { Client } =
window.systemlynx; Client.loadService(url)` is the package's own convention. The grant gates
**injection**, which is why it maps to no namespace.

Do not assume it exists at module-eval time; poll briefly for it. And a page can load its **own**
service (same origin — one express server serves the page and mounts the service) but not one on
another origin: SystemLynx only installs its CORS headers when it builds its own express app, and
passing your own server silently opts out. The browser's refusal surfaces as a generic network
error, which reads like a dead service.

## Proving a registration worked

`npm run smoke:app` boots a headless shell, opens a real tab as a registered app, and checks the
four things that fail independently — the library was injected, the gate is genuinely closed, the
theme bridge speaks the right shape, and the page can load its own service. Reasoning about the
gate is not the same as watching it hold.
