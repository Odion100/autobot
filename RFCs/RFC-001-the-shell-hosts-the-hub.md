::::thread{id=t2}
# RFC-001 — The shell hosts the hub: local apps, the terminal, and agent sessions
:::reply{author=you ts=1787268990380}
okay so this certain features missing in the application of the gate has no doubt tools like Chrome devtools I thought this was chromium might come with it but maybe I'm wrong there's no voice voice doesn't work insisting view I always use the mic to talk that's not working stuff like that to you or else should show even when you're in local applications it's just subtle
:::
:::reply{author=you ts=1787269865263}
one of the things that we're going to adopt for ourselves from system view is interactive markdown so we need to have neatly implemented interactive markdown just like system View and will continue to add different types of markdown I see this being again when we talking about being able to show custom pages one of the things that Visions I already see from the gay is being able to run a business I'm an engineer I think about coding but you give this to a business custom applications created organized automated work
:::
:::reply{author=you ts=1787269925623}
well the point is the interactive markdown is very useful for communication and back and forth and being able to present like you're presenting me commits you can resent me different things well not you right now in system View and presented commits I'm presented logs this in business this could be many different things so interactive markdown becomes internal custom just like the terminal like it's like we created our own components right that are able that can be accessed something like that
:::
:::reply{author=you ts=1787270551566}
here's another thought you said mCP is a standard mCP servers and we're setting up system links to be just that as well and I talked about extensions as bringing an agent but it's not really agents it's really mcps you can Define and create agencies easily but creating and document that's another feature as far as the mCP that's the extension part there needs to be a place where you can see and we need to organize our mcps even the ones that were using to manipulate the browser you can see which ones or being used by what agency and what's available you can search and find ones and I like extensions this becomes a foundation of that just a future you can
:::
:::reply{author=you ts=1787270661941}
yeah if we wrap up things like terminal into our own component that we Expose and then users businesses in the future can decide what applications have it so you still you know the way that we still respect and it's only for local applications
:::
:::reply{author=autobot ts=1787271189397}
All five heard, three already in tonight's build (restart npm start): devtools ARE there now — right-click → Inspect Element, or F12/⌥⌘I (Chromium ships the tools; the shell just had to wire the entrances). Voice: the shell now grants mic to pages and asks macOS for microphone access at boot — if the OS prompt appears, grant it once and SystemView's push-to-talk should work; tell me if it still doesn't, that one I can't fully verify from here. URL now shows subtly in local apps too. The two bigger ones are in the RFC now: interactive markdown as a shell-native lane (the component library shared with SystemView — the medium for commits, logs, and the business-facing custom apps you described), and the MCP manager as the extensions foundation — a place to see, search, and organize MCPs and which agencies use what, browser-manipulation MCPs included.
:::
::::


Co-draft: autobot (shell side) + systemview-test (SystemView side). Presented to Odion on autobot's TV when both halves stand. Source answers: `.systemview/report.systemview-test.The-shell-answered-from-the-code.md` in the systemview repo — every claim below about SystemView's internals traces there.

Odion's directives driving this (2026-08-20, autobot's room): the shell runs its OWN SystemView instance — he stops launching it by hand; new tabs always open in our window; integrate as a local app FIRST, then the terminal; and "I might be connecting Claude differently... upgrade the communication layer, make it as good as the existing harnesses."

---

## Lane 1 — SystemView as a shell-owned local app

**Port: own 3000.** `cli/index.js` hardcodes `UI_URL = http://localhost:3000` with no env override — every verb, skill, and doc in every repo talks to that constant. A dedicated port is a two-step (ship `SYSTEMVIEW_URL` support, publish, migrate) and is deferred to its own small RFC if isolation is ever wanted.

**Boot sequence (shell main process):**

::::thread{id=t1}
1. `appIsRunning("http://localhost:3000/systemview/api")` — one GET, the check SystemView itself uses. **Do this before spawning**: `start` in interactive mode *attaches* to an occupied port and becomes a child that does nothing forever.
2. Running → **adopt** (mark instance external; shell never kills what it didn't start).
3. Not running → spawn `/usr/local/bin/systemview start 3000`, detached from the chrome's lifecycle only by choice: default is shell-owned — shell quits, hub dies with it *(open question 2)*.
4. **stdout/stderr must be drained or filed** — an unread pipe blocks the child at ~64KB and looks like "the hub randomly freezes". Route both to `~/.autobot/logs/hub.log` (append, rotated). That log is also the future hub-health panel's source.
5. The SystemView app tab polls `appIsRunning` before first load so the user never sees a dead localhost error during boot.
:::reply{author=you ts=1787269075275}
I'm really trying to understand your idea here with system View what if no one is using it you know like you have local applications running not running but that available not all of them is running from the gate are they I'm just wondering
:::
:::reply{author=autobot ts=1787271189247}
Right, and your instinct beat my implementation — it auto-launched the hub at boot. Fixed tonight: apps are AVAILABLE, not running. Nothing spawns at startup; SystemView opens on boot only if a hub is already running (adopt), and otherwise it waits in the switcher — opening it is what starts its hub. That's now the registry's rule for every future local app.
:::
:::reply{author=you ts=1787272262036}
unless configured that way
:::
:::reply{author=you ts=1787272289815}
for example you got to remember previous date right but if it closes and opens again is that all start everything back
:::
:::reply{author=autobot ts=1787272539105}
'Unless configured that way' — shipped as written: every registry entry has an autostart flag now, default off. SystemView stays available-not-running until you flip it.
:::
::::


**Stopping:** SIGTERM to our child. NOT `SystemView.shutdown()` — that method is `process.exit(0)` on the agent-callable module surface, so it's not a privileged door and using it normalizes calling it. *(SystemView-side flag: consider gating it.)*

**The local-app registry (forward-looking, small now):** `electron/apps/registry.js` — `{ id, title, start?: string[], url, health?: url }`. SystemView is the first entry; agent-generated apps and future built-ins join the same lane. An entry with `start` is shell-owned; url-only entries are plain app tabs.

::::thread{id=t3}
## Lane 2 — The terminal under each codebase
:::reply{author=you ts=1787269179049}
separation of concern since Autobot owns the terminal it's componentizes it for other applications to use well that's just my idea
:::
:::reply{author=autobot ts=1787271189555}
Exactly the architecture — autobot owns the pty and exposes <Terminal>-shaped capability to local applications; SystemView is the first consumer, not the owner. And per your t2 note, which apps GET it becomes a grant in the registry — your call per app, local apps only.
:::
::::


Division per RFC-043's post-mortem: SystemView renders, the host executes. The exec surface that killed RFC-042 doesn't exist here — the pty lives in Electron's main process and is never network-addressable.

**SystemView side (systemview-test):**

```
<Terminal transport={{ onData(cb), write(data), resize(cols, rows), dispose() }} cwd={projectRoot} />
```

- Renders as the last section of the codebase card, same slot pattern as `#sv-agent-slot-<pc>`.
- xterm.js as the renderer (RFC-043's conclusion — repaints, colour, TUIs all real).
- No host → "no terminal host here", honestly, no dead UI.

**Shell side (autobot):**

- Preload on the SystemView WebContentsView injects `window.systemview.terminal` — IPC to the main process, one pty session per (project, tab).
- Substrate v1: the proven `screen` recipe from RFC-043 (`-p 0` on every `-X`, rc file for the log path, `logfile flush 1`) — no native build. node-pty is the upgrade once Electron-rebuild tooling is settled, not the entry requirement.
- cwd per codebase from the hub's `getConnection` root.

## Status — SystemView's half of lane 2 is BUILT (2026-08-20)

`src/organisms/Terminal/host.js` (the seam), `src/organisms/Terminal/Terminal.js` (xterm against the
transport), `src/organisms/CodebaseNav/TerminalSection.js` (the fold in the card, last section).
Lazy-imported, so the ~250KB is paid by whoever opens a terminal and by nobody else.

**One clarification the build settled: the HOST resolves `cwd`.** The component passes
`{ projectCode, cols, rows }` and leaves `cwd` null — the browser is deliberately not told any
project's absolute root (`getProjects` does not carry it), and the host can ask the hub. `cwd` stays
in the contract as optional for a host that wants to be told.

**Proven against a fake host** implementing the contract exactly: xterm mounts; `open()` receives the
component's measured cols/rows; `history()` repaints scrollback; keystrokes go straight through with
no input line anywhere; output repaints; **colour and escape sequences survive** — the exact thing
RFC-042's strip destroyed; a viewport change reports new cols/rows; unmount calls `dispose()` once and
re-mounting repaints from `history()` — the session is never killed by a fold. With no host injected,
the section renders "no terminal host here — a shell runs in the desktop app" and mounts no emulator.

## Lane 3 — The communication layer (hosting agent sessions)

Correction adopted from systemview-test: **the shell is one more transport into the same room** — the hub API unchanged, the room file the source of truth, presence modeled explicitly. Unhosted agents (plain terminals, CI, other machines, cloud) keep the front door forever; hosted and unhosted must be indistinguishable from inside the room.

- **v1 — pty-hosted sessions:** the shell spawns a `claude` session per project card (cwd = project root) in the same pty substrate as Lane 2. The session still uses `join`/`say` — the win is *supervised lifecycle*: the shell notices a dead session and restarts it, deleting the re-arm ceremony and the gone-deaf failure class.
- **v2 — SDK sessions:** Claude Agent SDK headless sessions, events as data: streamed output, tool activity, statuses, and **permission prompts surfaced in SystemView's chat UI** (the one thing that must land somewhere Odion sees). This is what "as good as the existing harnesses" means concretely.
- **Presence:** a hosted session's presence is asserted by its supervisor (the shell heartbeats the hub on its behalf); the ring/roster/visitor semantics stay derived from the same hub-side model that serves held polls. Presence that lies is worse than no presence — a dead hosted session must drop off the ring exactly like an expired hold.

## Build order

1. Lane 1 (adopt-or-launch + registry + app-tab health gate) — small, unblocks "he stops running it by hand" immediately.
2. Lane 2 shell half (pty + preload transport) in parallel with SystemView's `<Terminal>` component.
3. Lane 3 v1 (supervised claude sessions) — after 2 (same substrate).
4. Lane 3 v2 (SDK) — own design pass, prompts-in-UI being the hard part.

## Packaging (systemview-test's proposal, 2026-08-20)

::::thread{id=t4}
No fork, no special build: `systemview` stays the app + CLI every repo installs (Electron never enters it — ~100MB in every CI run otherwise); `systemview-plugin` unchanged; the Electron main process + preload + pty host is the third piece. Their name for it is a new `systemview-desktop` package; autobot's position is that this piece already exists as **autobot's shell** (`electron/` — the browser is the product, SystemView is its first built-in app), and a package is extracted from it only when a second consumer appears. Same UI everywhere either way: the terminal section renders only when a host transport is present. *Whether the desktop is autobot or a SystemView-branded wrapper is Odion's call — open question 4.*
:::reply{author=you ts=1787270153858}
it's kind of a random place but his mom a critique on the UI move Autobot with system view is take system view such as it is and make it a tab I like how subtle it is and becomes a tab so just move into the other side of the back and forth and refreshed by it and whatever else is open you would be listed across as tabs in a similar sort of subtle look with that said don't you think multiple instances of system views can be run with projects connected and different locations and then a system view becomes part of the you know like it's on IDE then connecting the agent to it and connecting to it it's going to be straightforward like system view or whatever there's a plus sign already right above the nav bar that'll be adding a code base of project you know what I mean which is like going to a file and selecting a folder you know me but at the same time
:::
:::reply{author=autobot ts=1787271189707}
The subtle-tabs critique shipped tonight: open items now list across the strip on the other side of the back-and-forth — small, quiet, active one brighter — with the corner keeping the app name. On multi-instance SystemView as workspaces (+ adds a codebase like picking a folder): real, and it interacts with the port question, so I've added it to the RFC as its own open question rather than pretending it's settled.
:::
::::


## SystemView's half (systemview-test)

### A. The `<Terminal>` transport contract

The host owns the process; SystemView owns the pixels. The whole seam:

```js
// window.systemview.terminal — injected by the host's preload, absent in a plain browser
open({ projectCode, cwd, cols, rows }) -> Promise<Transport>

Transport = {
  onData(cb)            // cb(chunk: string) — RAW bytes through, escape codes included.
                        // Returns an unsubscribe function.
  onExit(cb)            // cb({ code, signal }) — a shell exiting is normal, not an error.
  write(data)           // keystrokes and pastes, exactly as typed
  resize(cols, rows)    // the component measures; the host follows
  history()             // optional -> Promise<string>: scrollback for a re-mounted pane
  dispose()             // detach this view. NOT "kill the session" — see lifetime below
}
```

Five rules, each one a thing that broke before:

1. **Bytes, not lines.** The transport never strips, parses, trims or appends. RFC-042 died of a
   stripping layer, and any "helpful" normalisation in the transport recreates it one level down.
2. **The component measures, the host follows.** xterm+fit knows the real cols/rows; a host that
   sizes the pty from window geometry will always be one repaint behind. Resize is one-way.
3. **The session outlives the view.** Identity is the host's, keyed by `(projectCode, sessionId)`.
   `dispose()` detaches a view; closing a tab, folding the card or navigating away must not kill a
   running build. Re-mounting calls `open()` with the same key and repaints from `history()`.
4. **Absent host is a rendered fact.** No `window.systemview.terminal` → the section renders
   "no terminal host here" and nothing else. It never half-works, and it never renders a fake input.
5. **SystemView never carries an exec path.** The component receives a transport, never a command,
   a shell name or a path to run. Whatever agents can reach through the SystemLynx module surface
   still cannot start a process — the rule holds by construction rather than by discipline.

### B. Port: 3000 now, `SYSTEMVIEW_URL` as its own small RFC

`cli/index.js` sets `const UI_URL = "http://localhost:3000"` as a module constant. Every verb except
`start`/`shutdown` (which take a port argument) resolves against it, in every repo, plus every
generated skill and every doc that tells an agent what to type.

So the migration, when he wants it, is: read `process.env.SYSTEMVIEW_URL` (falling back to the
constant) plus a `--url` flag; make the plugin's connect URL read the same variable; publish; let
projects pick it up. Until that ships, a shell on a private port produces a working window and an
ecosystem that cannot see it. **Own 3000.**

### C. Presence: assert it, but let it expire

Today presence is *derived from the transport* — a held poll IS the fact, so it cannot lie and it
cannot leak: kill the agent and the hold dies with it. A supervisor asserting presence gives that up,
so it has to be replaced deliberately rather than by a boolean.

- **Heartbeat with a TTL, never a flag.** `chatPresent(pc, { as, ttlMs })` called every `ttlMs/2`.
  The hub computes the roster from *whichever arrived most recently* — a hold or a heartbeat — and
  a supervisor that dies takes its agents off the ring by expiry, exactly like an abandoned hold.
  No "present: true" that outlives the process that set it.
- **Hosted and unhosted must be indistinguishable in the room.** Same roster, same ring, same
  visitor badge. If the UI can tell, someone will start treating one kind as second-class.
- **Two different facts, already two states.** "In the room" (ring) and "working" (the cooking
  status line) exist; a supervised session should drive both — present continuously, busy while a
  turn runs. That is the part that reads as "as good as the existing harnesses".
- **Evidence, not theory:** my own ring says *"hears you at its next turn"* rather than "agent is
  in", because my hold is `join --once` and dies the instant it fires. Odion read that today as "you
  are not connected properly", and he was reading it correctly. A supervised session is the only
  thing that makes that ring honest.

### D. `shutdown()` — attribution beats a lock

`shutdown = () => process.exit(0)` sits on the agent-callable module surface. Anyone in any room can
stop the hub, and today it happens silently — the hub is simply gone and nothing says why.

My position: **keep the verb, name the caller.** It is the only way to restart a wedged hub from
outside, several agents' scripts use it, and taking it away buys less than it costs. What is missing
is a record: the hub should write a system line into the room naming who called it before it exits,
so a hub that dies has a name attached instead of being a mystery. The shell should still stop its
own child with SIGTERM, because that is a lifecycle it owns rather than a request it makes.

The stricter option — gate it behind a setting, or refuse it from anything but loopback — is a
change to what every agent is allowed to do, so it is **his call, not ours**: see open question 5.

## Open questions (Odion's calls)

::::thread{id=t5}
1. Priority against SystemView's RFC-044 (one kind of report) — systemview-test flags both land on their tree; order is yours.
2. ✅ **ANSWERED (his t5 reply) and shipped:** the hub outlives the shell — spawned detached, never killed on quit.
3. Lane 3 v1 sessions: which projects get one on day one — all cards, or opt-in per project?
4. Is the desktop product autobot (SystemView built in), or does SystemView ship its own `systemview-desktop`? The code is nearly the same either way; the identity isn't. *(systemview-test concedes autobot's framing: the shell exists, the browser is the product, and a package gets extracted only when a second consumer appears. The one thing that stays in SystemView either way is the `<Terminal>` component and the transport contract — that is the piece that must never be forked.)*
5. `SystemView.shutdown()` is callable by every agent in every room. Leave it open and merely ATTRIBUTE it (systemview-test's position: the hub names the caller in a system line before exiting), or actually gate it? Gating changes what every agent may do, so it is yours to call.
:::reply{author=you ts=1787270885765}
this is probably your priority Hub Outlet show the agent's presence need to be able to be you know sticky like you got to be able to come back to the same agent even if the entire application closed I don't know like how again this becomes a harness right some of these sounds about system of you but they will also eventually apply to the broader agent throughout agents throughout Autobot
:::
:::reply{author=you ts=1787270954244}
I guess if it's possible for system you to keep it as it is and make it at least backwards compatible until we eventually transform transfer into being completely the application and I guess since system view is just one of many local applications that means that always signing up a route to install local applications that says simple as installing a package interesting
:::
:::reply{author=autobot ts=1787271189858}
Q2 executed as you called it: the hub outlives the shell — spawned detached, never killed on quit; agents keep their hub when the window closes. Sticky agents: yes, and there's a real mechanism — claude sessions resume per project, so the supervisor brings back the SAME agent with its context after a full app restart; written into lane 3 v1. Backwards compatibility is guaranteed by the design itself — SystemView stays fully standalone, the shell is just one more transport. And your last thought is now in the registry section: installing a local app = installing a package. That IS the route.
:::
::::


6. **Multi-instance SystemView as workspaces** (his t4 annotation): several SystemView instances, each with its own projects at different locations, "+" adds a codebase like picking a folder. Real — and it collides with the port-3000 constant, so it rides on the `SYSTEMVIEW_URL` RFC. When it matters is yours to say.

## The dividing rule (2026-08-21, out of the dictation build — systemview-test's words)

**Capabilities belong to the browser — mic, pty, filesystem, process. Surfaces belong to the app — the markdown, the reports, the codebase card, where text lands.**

*Sharpened 2026-08-21, out of Odion's review pushback: THREE layers, not two.* Capabilities (pty, mic) belong to the browser; **components** (the terminal view, interactive markdown) belong to a shared registry the browser hands out; only the *arrangement* belongs to the app. Under that reading SystemView is the first **consumer** of the terminal, not its owner — and `<Terminal>` taking nothing but a transport is what lets it lift into the registry without a rewrite. Lane 4 flows the other way on purpose (interactive markdown is the app's, the browser adopts it), which is what makes this a principle rather than a boundary dispute. First application: voice recognition *behavior* (capture, pause detection, segmentation, draft cadence, timing knobs) moves into the host as `window.systemview.dictation.listen({onDraft, onSegment}) -> {flush, stop, cancel}` — every local app then gets dictation-with-live-preview for free, and the app keeps only its surfaces. *Timing: Odion's call, now vs after the pending commit.*

## From Odion's annotations (2026-08-20 evening) — new lanes

- **Lane 4 — interactive markdown, shell-native.** The shell adopts SystemView's interactive markdown as its own: one component library (threads, questions, commits, file chips, and the types yet to come), shared, never forked — the same rule as `<Terminal>`. It's the communication medium of the generated-apps future: commits and logs today; for a business, custom applications, organized automated work. His framing: "we created our own components that can be accessed" — interactive markdown and the terminal are the first two entries in that internal component registry.
- **Lane 5 — the MCP manager (the extensions foundation).** Extensions aren't agents — they're MCPs. SystemLynx services are becoming MCP servers (the other RFC), the browser's own action lane is an MCP, and agencies compose them. So the shell needs the page where you SEE it all: which MCPs exist, which agency uses what, what's available, search and install. That page is the app-store seed.
- **Sticky agents (folded into lane 3 v1):** come back to the SAME agent after the whole app closes — supervised sessions resume per project (`claude` sessions persist and resume by directory), so identity and context survive a full restart. As he said: this is a harness now, and these properties apply to every agent throughout autobot, not just SystemView's.
- **Install-an-app = install a package (folded into the registry):** SystemView is one of many local applications, so the registry's install route is package installation — nothing bespoke.
- **Capability grants (folded into lanes 2/4):** components the shell exposes (terminal, and whatever follows) are granted per local application — the user or business decides which apps have them; local apps only.

---

*systemview-test's half STANDS as of 2026-08-20* — transport contract, port stance, presence model and the `shutdown()` position are written above; a copy lives in `RFCs/RFC-045-the-shell-hosts-the-hub-systemview-half.md` in the systemview repo. Packaging reconciled in autobot's favour (open question 4).
