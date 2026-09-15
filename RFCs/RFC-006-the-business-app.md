# RFC-006 — The business app: define it, connect it, derive on it

**Status:** design. Split out of the original RFC-004 (the apps lane).
**Owner:** autobot (the reactive layer and the app itself).
**Depends on:** RFC-004 — the app contract. This is the app that proves it.
**Trips:** `gaps/AGENT_REACH_IS_ONE_TIER_TODAY.md` — see §3.

> Odion, verbatim: *"the aim is to be able to do what businesses do — accounting, tracking and
> organizing, math and projections and predictions."* And the constraint that decides the
> architecture: *"it probably won't even be a page where you're in a full-screen spreadsheet ever."*

---

## 1. What this app is for, and what it is not

It is a set of **business functions**: accounting, tracking, organizing, math, projections,
predictions.

It is **not a spreadsheet that grows**. The spreadsheet-like layer is how the math gets *expressed*,
not what the app is — and the constraint above is the useful one, because it settles the
architecture in one move:

> If the grid is never the destination, then the reactive layer is **infrastructure**, and every
> surface is a document, a view, or a component that happens to be computing.

That inverts the obvious build order. You do not build a spreadsheet and add business features to
it. You build the thing underneath that makes values derive from other values, and the grid becomes
one view among several.

## 2. Define the business first

Accounting, projections and tracking all presuppose a model: what it sells, who it bills, what its
periods are, what counts as a cost, when revenue is recognised. That model is the schema the
reactive layer computes over, and it is what makes the app *yours* rather than generic.

**It is the first workflow**, and nothing else can be built before it — every other function is a
derivation over this model, so a wrong model is not a bug you fix later, it is a rebuild.

Concretely, the first thing the app does is a **planning session that produces a document**: the
business, written down and agreed, the same shape as a job document in RFC-005 §2.1. The schema is a
projection of that document. The document is the source.

**This is also the app's first real workflow end to end**, which is the scope discipline: *"an app to
manage any business"* is where these die. Generality arrives by pressure, not by design.

## 3. Integrations are a requirement, not a later nicety

An accounting app whose numbers are typed in by hand is a spreadsheet with extra steps. The value is
that **the data arrives on its own and the derivations stay live** — so Stripe, a bank feed, an
invoicing service are in scope from the start.

**The fabric already exists and it is SystemLynx.** Importing a service means pulling in a remote API
whose `connectionData` *is* the tool manifest, and the SystemLynx→MCP bridge hands those methods to
any agent. Vendors arrive the same way as anything else and the app hand-rolls no clients.

### 3.1 This trips a flag we already set, deliberately

`~/.autobot/services.json` is a **reach** policy and only that. A whitelisted service is attached,
every method it publishes is indexed, and `mcp__systemlynx__call` can invoke **any** of them.
Reachable and fully callable are the same bit. Identity rides the hub's credential, not yours.

That is correct for what is whitelisted today — localhost development services, where the blast
radius is this machine and the operator is the person typing. It was Odion's call on 2026-09-09:
*"we can go with the current policy and upgrade in the future."*

**Stripe is the trigger condition that note was written for.** The first non-localhost entry is
exactly when reach and authority stop being the same question:

- a payment API's read methods and its *refund* method are not the same grant
- an agent calling as "the hub" is not an audit trail anybody would accept
- and a job (RFC-005) calling one at 3am is the same authority with nobody watching

> **Per-method exposure and per-identity calls become a prerequisite of this app, not a deferred
> idea.** The gap note stops being a note the day this app connects its first real vendor.

## 4. The reactive layer

What makes something spreadsheet-like is not the grid — it is the **dependency graph**. A database
stores values. A spreadsheet stores values *and the derivations between them*, and recomputes when
inputs change.

Building that first buys three things at once:

- **Live views are live** because the cells under them recompute — not because something polls.
- **Components are powerful at calculate / render / display** because calculation lives in the data
  layer rather than in the widget.
- **It drops into interactive markdown cleanly**: a document embedding a live derived value is the
  same primitive as a grid embedding one. Which means the business app's numbers can appear in a
  report, a chat reply, or over a web page — that is RFC-004 §3 doing its job.

### 4.1 The shape

```
source        an integration feed, or a typed input          (Stripe, a bank feed, a human)
cell          a named value, or a formula over other cells
derivation    the graph edge — what recomputes when what changes
view          a document, a component, or a grid, reading cells
```

**The grid ships browser-side, not inside this app** (RFC-004 §3.3). If it ships inside the business
app, workers forks it the first time it needs a table, and then there are two.

### 4.2 What to be careful of

- **Recompute storms.** A feed that updates every second recomputing a graph that fans out to
  hundreds of cells. The answer is the same as the chunker's: derive lazily, mark dirty, recompute
  on read.
- **Derivations are code.** A formula is a program, and a program from an integration feed is an
  injection surface. Formulas are authored by the human or by an agent whose output the human
  approved — never assembled from vendor data.

## 5. The shape of the build

**Define the business → connect what already holds the data → derive on top → surface it as
documents and components, one of which happens to be a grid.**

Growing bit by bit means each of those four thickens over time. It does not mean starting with a
spreadsheet and hoping.

## 6. Why this app proves RFC-004

It is the app that is **not SystemView**: its own repo, its own port, its own origin, registered
from an `apps.json` entry. It needs a real capability list (it wants `files:read` and `context:read`; it has no business
with `dictation`, and no business writing into shared memory with `context:write`). And it publishes a component — the grid — that has to render
inside SystemView's markdown to be worth anything.

Those are RFC-004's three falsifiable checks, and this app fails to be useful if any of them fails.
That is the right relationship between a platform and its first tenant: the tenant cannot succeed by
cheating.

## 7. Order

1. **The business document and its schema** (§2) — the planning session, and the model it produces.
2. **The reactive layer** (§4) — sources, cells, derivations, lazy recompute.
3. **One integration, end to end** (§3) — and with it, the per-method/per-identity upgrade, because
   the first real vendor is when that becomes real.
4. **The grid as a published component** (RFC-004 §3.3), browser-side.
5. **The rest of the business functions**, by pressure.

## 8. Open

- **Which vendor is first**, and therefore which authority model gets designed against a real API
  rather than a hypothetical one.
- **Where the reactive layer runs.** In the app (simple, and the numbers live where the app lives)
  or as a service (survives the app restarting, and jobs can read it at 3am without the app being
  open). RFC-005's scheduler argument applies here too, and I lean the same way — but the business
  app, unlike a clock, has no reason to be running at 3am unless a job needs it.
- **Historical correctness.** An accounting model that recomputes everything from live feeds will
  cheerfully rewrite last quarter when a vendor backfills a record. Periods have to close, and
  closing is the opposite of live — it is the one place the reactive layer must be told to stop.
