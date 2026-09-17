# RFC-007 — Blink: dynamic tables, and the links that make data mean something

**Status:** draft for Odion's review — 2026-09-15
**Owner:** blink (`~/Systemly/blink`, port 3200). Supersedes the data-layer half of **RFC-006 — The
business app**, which assumed a spreadsheet of scalar cells; RFC-006's integrations (§3) and its
reach/authority trigger (§3.1) still stand and are not restated here.
**Depends on:** RFC-004 (the app contract — Blink is a registered app and publishes `blink:sheet`).

Odion, 2026-09-15, brainstorming: *"So instead of a spreadsheet, you have dynamic tables. Same but
different."* … *"on the surface, I need to have separate separations of quote unquote businesses,
'cause this is not really about business, right? It's more generic."* … *"we have to build our
philosophy… on the foundation of what data, information, knowledge, and wisdom is. Raw data,
contextualised to information. What contextualises? Links, showing the relationships."*

The name is his and it is the concept, not a label: **Blink** — business links, and the app whose
namesake feature is revealing every link in the thing you are modelling.

---

## 1. The philosophy, and the one place it must not be obeyed

**DIKW** — data, information, knowledge, wisdom. Ackoff's chain: data are symbols; information is
data in context (who/what/where/when); knowledge is information applied (how); wisdom is evaluated
judgement (why, and whether to act).

It maps onto this system **descriptively** — these are decisions already made, not aspirations:

| Layer | In Blink | The promotion |
|---|---|---|
| **Data** | a cell — `5000` | means nothing alone |
| **Information** | the table *and its links* — an invoice amount, owed by Acme, in Sales, due in 30 days | **links are the contextualisation** |
| **Knowledge** | derivations and views — `runway`, `receivable`, `margin` | the reusable *how* |
| **Wisdom** | jobs, agents, and the **rating** on their outcomes (RFC-005 §5) | *whether to act, and what worked* |

Two consequences worth stating, because they decide arguments later:

**Links are not a feature, they are the promotion mechanism.** The reason this app is named after
them is that data without relationships is not information. Everything in §4 follows from that.

**The rating loop is the wisdom layer, and it arrived by accident.** RFC-005 §5 argued ratings
matter because a rated history is what makes a job's corpus worth querying. Under this vocabulary it
is the only evaluated-experience surface in the whole system. That was not designed; it fell out,
which is mild evidence the vocabulary is describing something real.

> **The caution, and it belongs in the document rather than in someone's head:** DIKW is a good
> design *vocabulary* and a shaky *ontology*. The strict pyramid does not survive scrutiny — wisdom
> is not merely more-processed information, and knowledge routinely precedes the data you go and
> collect. Use it to name layers and decide what belongs where. **Do not make it a rule that every
> feature must occupy exactly one tier**, or it becomes a bed we cut features to fit.

### 1.1 The pyramid belongs in the UI — as a diagnostic, not decoration

Show it, but make it **do** something. For any table, four tiers, lit as far as that table has been
promoted:

- **Data** — rows exist. A freshly imported CSV, connected to nothing.
- **Information** — it has links. Something refers to it, or it refers out.
- **Knowledge** — derivations stand on it: computed columns, views, aggregates.
- **Wisdom** — a job acts on it, and those runs are rated.

Now it is a reading rather than a badge. **A table stuck at Data is a table nobody has connected to
anything** — either dead weight, or exactly where a suggested link (§8.5) should be offered. That
also gives the suggestion engine a home: surface proposals where the pyramid is short, not
everywhere.

The logo can carry the same idea. His generated icon already draws *derivation* — a grid whose
centre cell takes arrows in and sends one out — so a pyramid mark in that vocabulary reads as the
same family rather than a second brand.

> **Do not let it become a score.** The moment it reads as a bar to fill, someone declares a link
> because the tier is dark rather than because the relationship is true — and a wrong link produces
> a confident wrong total. It must **describe** what is there, never reward adding more. "Not yet
> linked" is a fact; "3/4 complete" is a target.

---

## 2. What exists today, read from the code

`~/Systemly/blink` — 1,456 lines, 73 assertions green (`model/reactive.test.js` 22,
`model/document.test.js` 51).

**`model/reactive.js` — the graph.** `Sheet` holds `cells` (name → node) and `tables` (name → rows).
Node kinds: `source`, `derived`, `column`, `computed-column`. Reads are lazy — `_invalidate()` marks
dependents dirty and computes nothing; `get()` computes on read and memoises. Cycles are rejected at
**declaration** (`_assertNoCycle`), not discovered at read. `explain()` returns a node's inputs and
`dependentsOf()` its dependents. Rows carry a stable `_id`; `setCell`/`removeRow` take an id *or* an
index, and `_id` refuses to be edited.

**`model/document.js` — the projection.** One fenced ` ```business ` block is the machine-read half
of a markdown document. Five keywords: `source`, `derive`, `table` (inline CSV until `end`),
`column` (a formula per row), `func` (user-defined). A hand-written recursive-descent parser over a
closed grammar — **formulas are parsed, never evaluated as source**, so `constructor(1)` and
`a.b.c(1)` are parse errors. Eleven built-ins (`SUM AVG MIN MAX COUNT ABS ROUND FLOOR CEIL IF
GROWTH`), plus whatever the user declares with `func`. Two real passes, so declaration order does
not matter.

**`server.js`** — `/api/model`, `/api/explain`, `/api/source`, `/api/cell`, `/api/row`,
`/api/row-delete`, `/api/import`. The document is re-read on mtime change; a bad document keeps the
last good model and reports the error rather than blanking.

**`components/sheet.js`** — `<autobot-sheet>`, published to the browser's registry as `blink:sheet`.

**What it cannot do, precisely:** see another table, filter, group, express a type, or produce
anything but a grid. Every calculation lives inside one table. That is the gap this RFC closes.

---

## 3. Dynamic tables, not a spreadsheet — and why that is a technical claim

A spreadsheet's identity is **position**: `A1:B5`. That is also its original sin — insert a row and
formulas rot, because a reference is a coordinate into a list that moves.

Blink addresses by **name and relationship**: `invoices.amount`, `invoices.client → clients.id`.
Dropping position is not a compromise, it is the point. It is also already load-bearing: row `_id`
shipped for exactly this reason, and `model/document.test.js` demonstrates the hazard directly —
after a delete, the same *index* addresses a different row while the id still finds the right one.

**Everything a spreadsheet gives up by being positional, this gains by being named.** What it must
not give up is the ergonomics (§10), which is the part people actually feel.

---

## 4. Links

### 4.1 Declared relations, not `LOOKUP`

Two shapes were considered:

```
LOOKUP(clients, id, client_id, "rate")     -- VLOOKUP: the relationship, re-stated per formula
link invoices.client -> clients.id         -- declared once, on the table
```

**The second wins**, and the reason is not aesthetic: a link is **a fact about the model**, so it
belongs in the document once rather than in nine formulas. Once declared, a row formula on
`invoices` can read `client.rate`, and — the part that matters — **the graph gets the edge**, so
editing one client's rate recomputes every invoice standing on it. That liveness is what makes them
*dynamic* tables rather than a join.

### 4.2 The `ref` type is the link

A link is a **column whose declared type is `ref`**, holding another row's `_id`. That is what row
identity unblocked, and it is why identity had to land first: addressed by index, deleting a row
silently re-points every reference past it — no error, no blank, just a number that now means
something else.

### 4.3 The hierarchy is navigation, not scope

Spaces contain arrangements contain tables. **"Department" is a name the user gives a node**, not a
level in the schema — a solo operation should not have to invent a department, and a business that
breaks down by region or client should not be forced to call those departments. One level or five,
same shape.

> **Links cross the hierarchy freely.** A table in Sales must be able to link to a table in Finance,
> or "revealing every link in your business" cannot happen. This is worth stating because the
> obvious implementation — namespacing tables under their arrangement — quietly makes cross-branch
> links the awkward case, and those are the valuable ones.

**And it is not "business."** The top level is a **space**, and the user names it: business,
project, household, research programme. The generic version costs nothing and stops the vocabulary
lying to someone whose thing is not a business.

---

## 5. Typed columns

A spreadsheet's misery is that every cell is text-that-might-be-a-number. Building fresh is the one
chance not to inherit it.

A column **declares** what it holds, and the type decides rendering, validation, and which
operations are legal: `number`, `money`, `percent`, `date`, `duration`, `text`, `markdown`, `enum`,
`url`, `file`, and **`ref`**.

**This is a real change to existing code, not an addition.** `coerce()` in `document.js` currently
*infers* per cell — `"007"` stays text, `"42"` becomes a number. Inference is exactly the sin above;
it is right only while columns are untyped. Typed columns move coercion from per-cell guessing to
per-column declaration, and `coerce()` becomes the fallback for untyped columns rather than the rule.

"More than primitives" is spent here. A web-native cell can hold a file, a rich-text blob, an enum
with a colour, a live vendor value — but only a *typed* cell can be rendered and validated without
guessing what it is.

### 5.1 A column carries a DESCRIPTION, and it does three jobs

A column declaration holds prose about what it means — not a comment, a field.

**It is what makes schema search work at all.** Column *names* are terrible search targets: `amt`,
`cl_id`, `st`. The meaning lives in the description or nowhere, so §8.2's schema index is really an
index over descriptions with names attached.

**It is what makes cross-table link suggestion possible.** Two arrangements will never name the same
thing the same way — `client` here, `customer_id` there, `account` in the third. Names differ;
meanings do not. Suggested links (§8.3) match on description, which is why they can cross a
boundary that a name-matching heuristic cannot.

**It is the tool description the agent gets.** Through the MCP (§14), an agent reading a table needs
to know what a column *means* to use it correctly — and per the vision note, documentation supplying
tool descriptions as a byproduct of how the work is written down is already how this system behaves.
One field, written once, serves the human reading the header, the search index, and the agent.

**It belongs on the column, never the cell.** A description is schema: stable, small, and it changes
when the model changes. Cell-level prose is data — large, churning, and it belongs in the data index
(§8.2) if it belongs anywhere. Putting descriptions on cells would collapse the two-index split that
section exists to protect.

---

## 6. Closure: a derived table is a table

**The single idea the rest of the system stands on.** Filter, group, join, and semantic search all
return **tables**.

```
view open       invoices WHERE status = "open"
view by-client  invoices GROUP BY client SUM amount
view disputed   invoices WHERE note ~ "payment dispute"
```

Because those are tables, they inherit everything with no special cases: they render in the grid,
chart, travel as components, and **other tables can link to them**. Artifacts produce artifacts, to
whatever depth — nothing special-cases the second generation.

A search box hands you a list you look at once. A **view** hands you something the rest of the
system can build on. That difference is the whole argument.

---

## 7. The link graph — the namesake feature, and it is nearly free

`explain(name)` already returns a node's `inputs` and `dependents`. `dependentsOf(name)` already
walks every cell. **The graph exists; it has no view.**

That view *is* Blink: the map of every relationship in a space, across arrangements. And it is the
thing Excel and Airtable structurally cannot show you — in a spreadsheet the relationships are
hidden *inside* formulas, visible one cell at a time by clicking. Here they are declared, therefore
drawable.

**Implementation:** a renderer over two functions that already exist, plus the cross-table edges from
§4. This is the cheapest feature in the document and the one the app is named after.

---

## 8. Semantic search

Blink holds `context:read`, which carries `vectors.search`, `vectors.embed`, `vectors.index` and
friends (`electron/apps/vectorsBridge.cjs`). **The wiring exists.** This section is about what to
point it at.

### 8.1 As a derivation, not a feature

`view disputed  invoices WHERE note ~ "payment dispute"` returns a table (§6), so it charts, reports,
travels and can be linked to.

### 8.2 Two targets, two indexes

- **Schema** — "where do I track refunds?" across arrangements, over table names and **column
  descriptions** (§5.1), which are where the meaning actually lives — names alone are `amt` and
  `cl_id`. Small, stable, cheap to keep fresh.
- **Data** — "which invoices mention a dispute." Large, and changes on every keystroke.

Treating them as one collection makes both worse: the schema index gets churned by data edits, and
the data index gets polluted by names.

### 8.3 Similarity is a VALUE, and scope is a parameter

The move that makes this tractable: **`SIMILARITY(a, b)` returns a number**. Once meaning is a
float, every arithmetic thing already built works on it — threshold it, rank by it, weight it,
average it, chart it. No semantic *subsystem* is required; one function returning a value is.

Then one operation covers every level instead of five features:

```
MATCH(note, invoices.description)     cell   ~ column       → best row + score
MATCH(invoices.note, tickets.body)    column ~ column       → the suggested-links engine
MATCH(note, sales)                    cell   ~ arrangement
MATCH(note, contracts.md)             cell   ~ a document
```

**This gives the hierarchy a second job.** §4.3 argued the tree exists for navigation rather than
scope — and now it also *names search scopes*. "Search this department" is passing a node. The tree
earns its place twice instead of being pure UI.

### 8.4 Semantic joins — and the confidence is the point

A semantic join links rows to rows **by meaning, with a confidence attached**. Neither Excel nor
Airtable can express it, and the reason it works here is §6: **the output is a table** — left row,
right row, score — so closure does the rest. It charts, it travels, other tables link to it, and
`IF(score > 0.85, …)` is an ordinary formula. **The score is a cell, not metadata in a tooltip.**

Four things fall out of the score being a value:

**The review queue is a sorted view, not a feature.** Sort ascending and you are looking at exactly
the rows that need a human. High band accepts in bulk, low band rejects, and the middle is where the
judgement actually lives. No review UI gets built.

**The score is provenance.** When a match is promoted (§8.5), record what it scored *at promotion
time* and who promoted it — `{score, by, at}`, the same shape `feed()` already carries for vendor
values. Then "which of my facts came from weak matches?" is answerable after the embedding model
changes, which it otherwise never is.

**Thresholds are per-join, never global.** "Same client, different spelling" needs 0.9+; "related
topic" is useful at 0.6. One global cutoff is precisely what has made fuzzy matching feel broken
everywhere it has been tried.

**Not every semantic edge wants to become a `ref`.** Two kinds, and conflating them pushes people to
promote things that were never meant to be facts:

- **Candidate** — a real relationship awaiting confirmation. Promotion resolves it.
- **Weighted** — "related tickets", "similar clients". The relationship genuinely *is* a score, and
  collapsing it to a hard link destroys the information.

### 8.5 Suggested links — the payoff specific to this app

Blink draws the links you declared. Semantics over the **schema** index lets it propose the ones you
have not: two tables in different arrangements that are plainly about the same thing — matched on
**column descriptions** (§5.1), which is why it can cross a naming boundary that no name-matching
heuristic could. The namesake feature gains an opinion instead of only drawing a map.

> **A proposed edge must never render like a declared one.** A `ref` is a fact; a match is a
> proposal with a score. If they look the same, guesses get treated as facts inside accounting
> numbers, and the damage is silent — a plausible wrong link produces a plausible wrong total.

**Promotion is the ritual.** Semantics proposes, a human or a rated agent promotes, and only then
does the graph treat the edge as exact. That is DIKW in motion rather than as a diagram: information
being promoted, with the wisdom layer doing the promoting.

## 9. Pending values — asynchrony encapsulated at the node

`Sheet.get()` is **synchronous**: every node kind computes inline and memoises. Semantic search is
not the only thing that breaks that — a vendor fetch, an agent-computed cell, a file read and a
remote-storage table are all the same shape. An earlier draft treated this as a semantic special
case; it is the general one.

> **The asynchrony is contained inside the cell.** `get()` always returns something immediately and
> never a promise, so a formula standing on an async cell never has to know what a promise is.

**An async cell is a source that refreshes itself.** The graph already handles values written from
outside — that is exactly what `feed()` does for vendor numbers. So async work is not a new kind of
value; it is something that calls `source()` when it lands, and the existing `_invalidate()` then
does what it already does. Making `get()` async would poison every call site for the one case that
needs it.

**What is genuinely new is that a node gains a STATE, not just a value:**

`fresh` · `stale` · `pending` · `failed`

State propagates the way dirtiness already does — a total standing on a pending cell is itself a
pending total. And the consistency guarantee differs by node kind, which the UI must show rather
than hide:

| | guarantee |
|---|---|
| arithmetic derivation | **exactly** consistent — edit a cell, the total is right immediately |
| semantic view, vendor fetch, agent cell | **eventually** consistent — the refresh lags the write |

If the surface pretends these are the same kind of thing, the first stale result is filed as a bug
and the second as a lie.

### 9.1 MISSING MUST NEVER READ AS ZERO

The dangerous part, and it is present in the code today. `flat()` filters non-numbers and
division-by-zero returns `0` — both correct while every value is a typed literal from a document. A
failed or pending fetch that arrives as nothing would land in a `SUM` as **zero**: a confident wrong
total, with no error anywhere on the screen.

**A failed cell must poison its dependents visibly rather than contribute nothing quietly.** A total
over a failed input is not a smaller total, it is *unknown* — and that is a different value with a
different rendering. This is the one place where the convenience of coercing everything to a number
is actively unsafe.

---

## 10. Ergonomics — costed separately because it is the part people feel

Copy a range. Drag-fill a formula. Resize a column. Move a calculation and have references follow.

This is **UI work, not model work**, and it decides whether the thing gets used at all. It is also
where name-addressing has to prove itself: drag-fill in a positional spreadsheet means "increment
the coordinate," and here it must mean "the same formula, the next row" — which is *already* what a
`column` is. A computed column is drag-fill that never needed dragging.

Moving a calculation is the harder one: with names, a formula that moves keeps working, which is the
advantage — but the user's mental model comes from spreadsheets, where moving is fraught. The
surface should make the safety visible rather than silently be safe.

---

## 11. The node surface — a layout of blocks

Entering a node (a department, a space, whatever the user named it) opens a surface you **compose**:
tables, markdown, charts, arranged. A markdown block might take one full column while two tables
share the column beside it; or four even quarters; or any arrangement.

**Markdown is a block among peers, not the substrate.** It earns its place because *interactive*
markdown renders more than prose — a chart, a sheet, a live value inline — but the node is not a
markdown document and must not be modelled as one.

**Nested rows and columns, not a free canvas.** Everything above is expressible as rows containing
columns containing blocks. Free positioning buys overlap and pixel coordinates, which break the
moment the width changes or the node is embedded somewhere narrower. Rows and columns reflow; a
canvas does not.

**A block is (what it shows, how it shows it, where it sits)** — a saved view, a rendering, a slot.
That is §12's artifact with a position added, which means dropping a chart into a node is the same
act as publishing one anywhere else.

> **One registry, two mounting contexts.** A component can be mounted as a **block** in a node's
> layout, or **inline** inside a markdown block. Same `blink:sheet`, same catalogue. Worth stating
> plainly so nobody builds a block system and an inline system separately and lets them drift.

**And two kinds of document that must not merge.** The **model** document *declares* — tables,
columns, links, formulas (`business.md` today). The **node** document *composes* — which sheets and
prose appear, and how they are laid out. Rearranging a dashboard must never edit a schema: dragging
a table off a page removes the **view**, not the table.

---

## 12. Artifacts, and one scope save

Grid, chart, card are **renderings over a table** — same shape, different tag, already travelling
through RFC-004's component registry.

**Reports and presentations pull toward building a document editor. Do not build one.** The platform
already has interactive markdown. A report is a markdown document with live Blink components
embedded in it — which makes it live (the cells beneath it recompute) and portable (the components
already travel) for free.

**An artifact is therefore: a saved view + a rendering.** Addressable, so it can be embedded
anywhere. `blink:sheet` with a `table=` attribute is the existing proof; a chart is the same
component contract with a different tag.

---

## 13. A space is a folder

A space holds documents **and** data, and the strong version is that it is simply a **directory**.
Then `business.md` is not special — it is one file beside contracts, notes and `invoices.csv` — and
the docs/data distinction that would otherwise need designing stops existing.

**It makes document-level semantic search nearly free.** `docsIndex` already indexes a folder of
markdown into a corpus. If a space is a folder, "search this department" is already a corpus query,
which slots into §8.2 as a third natural target beside schema and data rather than being invented
separately.

**Reuse SystemView's documentation surfaces rather than rebuilding them.** The business is
spreadsheets *and* documentation, and the documentation half already exists. This is the first real
use of RFC-004's registry in the **inward** direction — SystemView as publisher rather than host.

> **Consequence, and it is the first genuine test of the component design:** SystemView's docs panel
> is React bundled into its app, so under the element rule (RFC-004 §3) it cannot be mounted as an
> element in Blink — a cross-app element closes over the *host's* bridge. It has to travel as a
> **frame**: SystemView serves a standalone panel page, Blink embeds it, and the existing
> theme/height handshake carries it. Real work on their side, but whatever makes that panel travel
> makes every SystemView surface travel.

**On remote storage, one sentence of discipline buys the deferral:** keep a space's interface
**file-shaped** — list, read, write, watch — and remote becomes an adapter behind it rather than a
rewrite. Local disk is the first implementation. Nothing above that line may assume a real path.

---

## 14. The MCP — one door for the agent and the user

Blink's surface should **be** an MCP, so an agent can do whatever the user can do: create a table,
declare a link, write a formula, build a view, produce an artifact.

This is the rule already settled for hook authoring (RFC-005 §7): the user's menu and the agent's
tool are **two front doors onto one mechanism**, never two implementations that drift. It composes
with RFC-004 — the capability gate already decides what an app may touch, so the agent's reach
through Blink is bounded by the same grant, with no second policy to keep in sync.

---

## 15. Implementation notes — what changes in the code that exists

**The graph extends; it does not get replaced.** Three existing mechanisms already do most of the
work for cross-table links:

- **Glob deps resolve at read time.** `cost.*` is a standing claim on every matching name, and a new
  cell invalidates it (`source()` calls `_invalidate()` for new cells precisely because a glob might
  match). A `ref` edge is the same idea with a different resolver.
- **`_assertNoCycle` already walks globs**, expanding them to concrete names. Cross-table edges
  extend it in kind, not in principle — and cycle rejection at declaration matters *more* once
  tables reference each other, because the cycles get easy.
- **Laziness already answers the cost question.** A link graph that fans out across a business is
  exactly the recompute storm RFC-006 §4.2 worried about, and the answer is unchanged: mark dirty,
  compute on read, compute nothing nobody looks at.

**A view is a fifth node kind, or better, a derived table.** `tableData()` already assembles a
table's shape from its column cells. A view whose rows are a filtered/grouped projection is
`tableData` over a derived row set — which is why §6's closure is cheap rather than aspirational.

**`business.md` does not scale to a space tree, and should not try.** One document with inline CSV
is right for one model; a space with arrangements and dozens of tables wants a document per table or
per arrangement, with the fenced block unchanged. The parser does not care — `parseDocument` takes a
string. What changes is who assembles the `Sheet` from many documents, and that is `sheetFrom`'s job
today at 20 lines.

**Row identity is done.** `_id`, id-or-index addressing, `_id` not editable, ids surviving deletes —
51 assertions, verified over the live API as well as in unit tests.

---

## 16. Order

1. **Typed columns + descriptions** (§5) — everything downstream needs a column to know what it
   holds, it changes `coerce()`, and descriptions are what schema search and link suggestion are
   *made of*. Cheapest before there is data to migrate.
2. **Links** (§4) — `ref`, declared relations, cross-table edges in the graph.
3. **The link graph view** (§7) — nearly free once step 2 lands, and it is the namesake.
4. **Views** (§6) — filter and group returning tables; the closure everything else rides on.
5. **Pending values** (§9) — the node state machine, *before* anything async is built on it. Small,
   it changes `get()`'s contract, and §9.1 is a correctness fix to code that exists today.
6. **Spaces as folders** (§13) — the tree, and many documents instead of one.
7. **Semantic** (§8) — similarity as a value first, then joins, then suggestion. Last of the model
   work, because it is the only part that needs step 5 already true.
8. **The node surface** (§11), **ergonomics** (§10) and **the MCP** (§14) — in parallel throughout,
   not after. All three are surfaces over whatever exists at the time, and the MCP especially should
   track the model as it grows rather than being retrofitted once.

**The pyramid (§1.1) is not a step.** It reads whatever is true at the time, so it can land as soon
as there is more than one tier to show, and gets more useful with each step above it.

---

## 17. Open questions

1. **Live or materialised views?** Live is obviously right; a 50k-row import is what makes it a real
   question.
2. **Is a derived table editable?** Airtable says no, spreadsheets say sort of. Cheaper to decide
   now than to retrofit.
3. **Does a table belong to exactly one arrangement, or can it appear in several?** One-owner is
   simpler and keeps the tree honest. Many-places is what people want the moment two arrangements
   care about the same invoices — and it is far harder to add later than to allow now.
4. **Does a UI edit ever write back to the document?** Today `/api/cell` deliberately does not: the
   document is the agreed model and a grid edit is working data. That holds while tables are small
   and hand-written; it stops holding when a table is a thousand imported rows. §11's model/node
   split sharpens this rather than settling it — *schema* edits and *data* edits may deserve
   different answers.
5. **Can a semantic edge be promoted in bulk?** §8.4's review queue makes accepting a whole
   high-confidence band trivial, which is either the feature or the hazard depending on whether
   anyone read what they accepted.
6. **Who owns a block's identity in a node?** If a chart is moved between nodes, is it the same
   artifact in two places or a copy — question 3 again, one level up.
