# autobot — the handbook

autobot is **the harness**: an Electron browser that hosts local applications and the agent
sessions that work on them. SystemView is its flagship app; Blink, Workers and BUStudio are
others. Everything an agent does in this ecosystem happens inside a window this repo draws.

It is also, in the same repo, the **web-automation project it started as** — agentci agents
driving a real browser, with learned selectors in a vector store. That half is live code, not
history, and the two share nothing but a `package.json`.

## The two halves

| | the harness | the automation project |
|---|---|---|
| lives in | `electron/` | `agents/`, `common/`, `db/` |
| module system | **`.cjs`** (CommonJS) | ESM (`import`/`export`) |
| entry | `npm start` → `electron/launch.js` | `node index` |
| needs | node ≥ 22 | ChromaDB and MongoDB running |
| what it is | the browser, its apps, its agent sessions | a browser-driving assistant |

The split is not cosmetic. `package.json` declares `"type": "module"`, so a `.js` file is ESM
and `require()` throws *"require is not defined in ES module scope."* Electron's main process
needs CommonJS, so every harness file carries the `.cjs` extension and ESM tests reach into them
through `createRequire`. Putting a harness file at `.js` is the single most common way to break
the shell.

## Running it

```bash
npm start          # the browser: builds the chrome, opens the shell
npm run ui:dev     # chrome with hot reload, then AUTOBOT_UI_URL=http://localhost:5173 npm run shell
npm run hub        # the SystemView hub service
chroma run --path ./vectorStore && node index    # the automation half
```

## The pages

| page | what it answers |
|---|---|
| [the-shell.md](the-shell.md) | how the browser is built: chrome, views, and why your change isn't showing |
| [apps.md](apps.md) | what it takes to be an app here — the capability gate and travelling components |
| [agent-sessions.md](agent-sessions.md) | hosting Claude sessions: the SDK, permission modes, the event contract |
| [verification.md](verification.md) | how harness work is proven, and the number-scope class of bug |
| [automation.md](automation.md) | the driver, the element pipeline, the selector store, agentci |

## Where decisions live

`RFCs/` holds the design record — why the shell hosts the hub, why an agent is a configured
session, the app contract, jobs, injected context. They are **arguments at a point in time**,
some still drafts; this handbook is what is true now. When they disagree, the code wins, then
this handbook, then the RFC.
