# RFC-008 — The Accounting Service

**Status: draft, for discussion**

Blink is a dynamic-table engine with built-in business features — and the foundation of that
business layer is an official accounting ledger. Today the ledger is a *picture*: the equation
table renders groups, kinds, a check column and running totals over an ordinary editable table.
This RFC makes the books real: a journal that is the truth, a posting door that refuses an
unbalanced entry, an append-only history, a chart of accounts — as an **Accounting module in
Blink's SystemLynx service**, with the table you already approved becoming exactly what it wanted
to be all along: the *view* of the books.

---

## 1 · What exists today, honestly

Read from the code, not the pitch:

| Piece | Where | What it actually is |
|---|---|---|
| The equation table | `components/sheet.js` `_equationGrid` | presentation: four blocks across, signed amounts, red for down |
| `kind ledger transaction` | `model/reactive.js` `setKind` | a flag that activates machinery — no semantics of its own |
| groups (assets/liabilities/equity) | `reactive.js` `group()` | declared membership; Σ column per group |
| the check column | `reactive.js` `balanceCheck` | **arithmetic**: `assets − liabilities − equity` per row. It *shows* a broken entry; nothing *refuses* one |
| running_cash | `CUMSUM(cash)` | a prefix sum over an editable column |
| storage | `spaces/stellar-house/ledger.md` | a CSV block in a markdown doc — every cell editable forever, `removeRow` deletes history |
| the write path | `Blink/Tables/methods.js` `setCell/addRow/removeRow` | generic table mutation; no invariant at the door |

What is missing is everything that makes books *books*: entry identity, the balanced-or-refused
invariant, immutability, a chart of accounts as a real thing, periods, statements, an audit trail.

**Design stance:** none of the table machinery gets replaced. The journal becomes the truth
underneath; the Sheet machinery (groups, kinds, check, CUMSUM, views, derives) becomes the
projection layer standing on it. RFC-007's closure principle carries the whole design: *the books
are tables too.*

## 2 · The chart of accounts — declared in the doc, like everything else

A space opens its books by declaring accounts, in the `business` fence, beside its types and
groups. New grammar, one line per account:

```
account cash     asset      Cash — on hand and in the bank
account ar       asset      Receivables — invoiced, not yet collected
account equip    asset      Equipment — at cost
account loan     liability  Loans — financing outstanding
account capital  equity     Capital — owner contributions
account retained equity     Retained earnings — closed periods accumulate here
account revenue  revenue    Revenue — recognised
account expense  expense    Expenses — operating costs
```

- **Five types**: `asset`, `liability`, `equity`, `revenue`, `expense`. The type fixes the
  **normal balance** (assets and expenses are debit-normal; liabilities, equity and revenue are
  credit-normal) and the account's place in the equation.
- The description convention from the ledger table carries over: first clause is the display
  label, the whole line is the tooltip and the agent-tool description (§5.1 doing triple duty).
- **Declaring a chart IS opening the books.** No separate switch: a space whose docs declare
  accounts keeps a journal; a space without them is plain tables, untouched.
- Parser: one more keyword in `model/document.js`'s line grammar, applied in its own phase
  (after types). The chart is *declaration*, so it lives in markdown — the human's half.

## 3 · The journal — append-only, machine-owned, cents

`spaces/<name>/books/journal.jsonl` — one JSON entry per line, appended, never rewritten:

```json
{"seq":14,"id":"e_9f2k","date":"2026-09-12","memo":"Acme paid",
 "lines":[{"account":"cash","debit":300000},{"account":"ar","credit":300000}],
 "postedAt":"2026-09-17T18:04:11Z","by":"odion","reverses":null}
```

- **Split storage, on purpose.** The chart is markdown (human-declared, like types and groups);
  the journal is jsonl (machine-owned, append-only). A ledger you can open in a text editor and
  *edit* is the exact thing this RFC exists to end — so posted entries do not live in a doc.
- **Amounts are integer cents.** The current model coerces to floats and the check forgives
  `0.005` of drift (`components/sheet.js`, `reactive.js`). Books do not get an epsilon: a journal
  that stores cents balances *exactly* or is refused. Conversion to display units happens at the
  wire, where `wire()` already translates UNKNOWN.
- `Blink/common/books.js` owns loading/appending, per space, mirroring `common/model.js`'s
  per-space cache: keyed on the journal file's mtime+size, so every module reads one implementation.
- `seq` is the total order; `id` is the handle; `reverses` links a correcting entry to its target.

## 4 · The posting door — where the invariant lives

`Blink/Accounting/{index.js, methods.js}` — the fifth module, the established pattern
(`this.method`, `after("$all", wireReturn)`, emits).

**`Accounting.post({space, date, memo, lines})`** — the strict door. Validates *before* touching
disk, refuses with the exact failure:

- every line names a **declared account** and carries **exactly one** of `debit`/`credit`, positive;
- **Σ debits === Σ credits, in cents** — or the entry is refused and the error carries the
  imbalance size (the check column's "the mistake, at its exact size" aesthetic, moved to the door);
- `date` valid; on or before a closed date → refused (§7).

Accepted: append, `emit("posted", {space, entry, epoch})`, return the entry plus fresh state —
the mutation-returns-state convention every module already follows.

**`Accounting.postSigned({space, date, memo, amounts})`** — the table's language. The equation
grid speaks signed-per-account (`{cash:+3000, ar:-3000}`); this door converts by account type
(asset/expense: positive→debit; the credit-normal types: positive→credit), then runs through the
same validation as `post`. One invariant, two dialects. This is the door the grid's composer uses,
so writing a row IS writing an entry.

**`Accounting.reverse({space, id, date, memo?})`** — the only "delete". Posts the mirror entry
with `reverses: id`. There is no removeRow on books, ever — the audit trail is the point.

**`Accounting.importTable({space, table})`** — migration. Replays an existing doc-table ledger
(stellar-house's five seed rows) through `postSigned`, one entry per row, **refusing** any row
that does not balance and reporting exactly which. The doc table can then retire or stay as
scratch paper — drafts are still a thing; *books* are not drafts.

## 5 · Projection — the books surface as tables (closure, §6 of RFC-007)

When a space keeps books, `common/model.js` `sheet()` injects the journal into the space's Sheet
as a **read-only table** after `sheetFromDocs`:

- `journal`: one row per entry — `date`, `memo`, then a signed column per account
  (`debit − credit` for debit-normal accounts, `credit − debit` for the rest). With that
  convention his seed data projects **identically** to today's table — capital in shows
  `+10,000` under capital, an expense shows negative under expense — nothing he has approved
  changes shape.
- Groups come **from the chart**: asset accounts → `assets`, liability → `liabilities`,
  equity+revenue+expense → `equity` (exactly the membership `ledger.md` declares by hand today).
  `kind transaction` + those three groups means the existing `balanceCheck` machinery lights up
  unchanged — except every check is now ✓ *by construction*, because the door refused anything else.
- The cache stamp in `sheet()` extends to cover `books/journal.jsonl`, so a post is a model
  change like any other.
- **Closure is the payoff**: `view september = journal WHERE date >= "2026-09-01"`,
  `column journal.running_cash CUMSUM(cash)`, `derive total_assets SUM(journal.assets)` — every
  RFC-007 mechanism stands on the books without knowing they are books. Statements fall out
  of the same move.
- `Tables.setCell/removeRow` on a books-backed table: **refused**, with the pointer —
  "post through Accounting". The read-only guard already exists for views (`derived`); books
  reuse it with a better message.

## 6 · Statements — derived, never stored

- **`Accounting.trialBalance({space, asOf?})`** — per account: debits, credits, balance on its
  normal side; totals prove Σdebit = Σcredit. The classic first proof the books are real.
- **`Accounting.balanceSheet({space, asOf?})`** and **`incomeStatement({space, from, to})`** —
  groupings of the same numbers by account type; income statement is revenue − expense over a
  window.
- v1 ships these as service methods (and therefore as agent tools through the systemlynx bridge,
  for free). The follow-on — statements *as tables* in the Sheet (`trial_balance` as a block on
  a node) — is the same projection mechanism as §5 and can wait for the pull.

## 7 · Periods and closing (staged — the door comes first)

`Accounting.close({space, through, date})`: posts one closing entry rolling revenue and expense
balances into `retained` (which the chart must declare), records the lock in
`books/closed.json`, emits `"closed"`. Posting dated on or before a closed date → refused;
corrections go through `reverse` + repost in the open period, which is how real books work.
Nothing else in the design depends on this, so it lands after the door and the projection prove out.

## 8 · The UI — the grid keeps its shape, changes its truth

- The equation grid binds to `journal`. Posted rows render as today but **read-only** — the
  click-to-edit becomes click-to-inspect (the entry: its lines, id, postedAt, what it reverses).
- **The composer row** is the new bottom row: type signed amounts across the account columns,
  date and memo in the center; its check cell shows the running imbalance red *while composing*;
  commit calls `postSigned`. Balanced → posted → the row joins history. Unbalanced → the door
  refuses and the row stays yours. The ✕ on a posted row becomes ↩ (reverse).
- Live updates ride the existing `svc.Accounting.on("posted")` exactly like Tables/Scalars today.

## 9 · Events, jobs, agents

`posted` / `reversed` / `closed` are emitted from the module, which means (read from what is
already built, not assumed): SystemView specs can assert them, the jobs system can watch them
(RFC-005 — "when an entry over $5,000 posts…"), and every Accounting method is an agent tool
through the systemlynx bridge with the chart's descriptions as its documentation. An agent that
keeps books goes through the same refusing door a human does — that is the whole point of putting
the invariant in the service.

## 10 · Layout and specs

```
Blink/
  Accounting/
    index.js        # module ctor: methods + after("$all", wireReturn)
    methods.js      # post, postSigned, reverse, importTable, trialBalance, balanceSheet, incomeStatement, close
  common/
    books.js        # per-space journal: load/append/cache — every module reads this one implementation
  specs/
    docs/Accounting.md
    tests/Accounting.post.json      # Before/Main/Events/After — asserts the refusal AND the emit
spaces/<name>/
  *.md              # chart lives here, in the business fence (declaration — the human's half)
  books/
    journal.jsonl   # append-only (the machine's half)
    closed.json     # period locks (§7)
```

Placement by coupling: `books.js` is common to the service, so it lives in the service's common.
The seam is clean — if accounting ever outgrows Blink, the module and `common/books.js` lift out
as their own SystemLynx service along exactly this line.

## 11 · Implementation order

1. **Chart grammar** — `account` keyword in `document.js`, its own apply phase; chart exposed on state.
2. **`common/books.js` + `Accounting.post`/`reverse`** — journal, cents, the refusing door, events. Tests prove refusal, append-only, reversal.
3. **Projection** — journal injected as read-only table with groups-from-chart; stamp covers the journal; `Tables` mutations refused on it.
4. **`postSigned` + `importTable`** — the table dialect; migrate stellar-house's seed rows into real books.
5. **Grid: composer row + inspect + reverse** — the UI flips from editing storage to posting entries.
6. **`trialBalance`**, then balance sheet / income statement.
7. **Periods and closing.**

Each step lands green before the next; 1–4 are the service being *real*, 5 is the face, 6–7 are
the payoff.

## 12 · Open questions

- **One chart per space, or shared?** v1: per space (a space is a folder is a business). A
  shared chart across spaces is a real future (departments posting to one book) — likely a
  `books` pointer in the space doc rather than a merge.
- **Multi-currency** — journal stores cents of *a* currency per space for v1; currency as a
  first-class column is a §12-sized RFC of its own.
- **Drafts**: does the composer support parking an unbalanced draft (not posted, saved locally)?
  v1 says the doc-table is the scratch pad; the journal takes only finished entries.
- **`by` attribution** — v1 records what the caller claims; real identity arrives when the
  harness passes attributed calls through the service door.
