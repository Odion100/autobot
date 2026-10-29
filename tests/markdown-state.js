// smoke:markdown-state — RFC-076 §4.1 and §4.2, THE FACTS A REGISTRY ROW CARRIES ABOUT A DECISION.
//
// `deriveState` read `approvals[0]` — the first approval block in the file and no other — and
// NOTHING tested it. So a document carrying a design approval and a claims-completeness approval
// reported its verdict off whichever happened to be typed first, and RFC-076's own registry row
// read `verdict: approved` sitting beside `approvals: 1`: approved off one block while another
// waited. That is the defect this file pins shut, and it is the one the RFC calls slice 1.
//
// The four claims below are RFC-076's c1–c4, and the fourth is the one a blind pass added because
// the mechanism gets it wrong by default: every-of-nothing is TRUE, so without a floor a document
// with no approval block at all reads approved for free. The floor is tested before the fold.
//
// Everything runs through the platform's real parse rather than hand-built block objects — a test
// that constructs its own blocks cannot catch a grammar that stopped producing them.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse } = require("../electron/markdown/parse.cjs");
const { deriveState } = require("../electron/markdown/blocks.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

// An RFC with however many approval blocks, each carrying the verdict given (null = unanswered) —
// the shape of every real document in the repo: a design approval, then a claims one.
const rfc = (...verdicts) =>
  `# A plan\n\n::rfc{id=RFC-999}\n\n` +
  verdicts
    .map((v, i) => `:::approval{ask="question ${i + 1}?"${v ? ` verdict=${v}` : ""}}\nthe commitment\n:::\n`)
    .join("\n");

// The verdicts in, the derived row out — through the real parse, so the grammar is on trial too.
const stateOf = async (...verdicts) => {
  const src = rfc(...verdicts);
  return deriveState(await parse(src), "rfc", src);
};

// THE STATE A ROW CARRIES IS NOT THE WORD A SURFACE SHOWS. `deriveState` answers with facts —
// `verdict`, `approvals`, `done` — and `lifecycleState.js` turns those into "draft"/"approved".
// So the check is on the facts: no verdict IS draft, because every state above draft needs one.
{
  // c1 — two blocks, one approved. The original defect, in the order that hid it: the answered
  // block is FIRST, so `approvals[0]` found an approval and reported the document approved.
  const st = await stateOf("approved", null);
  assert.strictEqual(st.verdict, undefined, "no verdict on the row at all — which is draft");
  assert.strictEqual(st.approvals, 1, "and it says one block is still waiting");
  assert.strictEqual(st.done, false);
  ok("c1 · two approval blocks with one approved → no verdict; the document reads draft");

  // And the other order, because the defect was positional: if this passed and the above failed,
  // the fix would be reading the LAST block instead of the first, which is the same bug mirrored.
  const flipped = await stateOf(null, "approved");
  assert.strictEqual(flipped.verdict, undefined);
  assert.strictEqual(flipped.approvals, 1);
  ok("c1 · and the same with the unanswered block first — order cannot decide a verdict");
}

{
  // c2 — a rejection ANYWHERE is the answer, because one reviewer saying no is the decision. Put
  // it last, behind two approvals, where a short-circuit on the first block would never see it.
  const st = await stateOf("approved", "approved", "rejected");
  assert.strictEqual(st.verdict, "rejected", "one no outweighs any number of yeses");
  assert.strictEqual(st.approvals, 0, "nobody is waiting — every block answered");
  ok("c2 · one rejection among approvals → the document reads rejected");

  const first = await stateOf("rejected", "approved");
  assert.strictEqual(first.verdict, "rejected");
  ok("c2 · and a rejection in front of an approval reads the same way");
}

{
  // c3 — ONLY when every block carries approved.
  const st = await stateOf("approved", "approved", "approved");
  assert.strictEqual(st.verdict, "approved");
  assert.strictEqual(st.approvals, 0);
  assert.strictEqual(st.done, true, "an RFC is done at its verdict");
  ok("c3 · every block approved → only then does it read approved");

  const one = await stateOf("approved");
  assert.strictEqual(one.verdict, "approved", "one block, approved, is still every block");
  ok("c3 · and a document with a single approval block still works");
}

{
  // c4 — THE EMPTY-SET FLOOR (§5). `[].every(…)` is true, so without `verdicts.length > 0` a
  // document with no approval block takes the verdict for free. This is the case the mechanism
  // gets wrong by default, which is why the floor is written before the fold and tested here.
  const st = await stateOf();
  assert.strictEqual(st.verdict, undefined, "no blocks, no verdict — never approved");
  assert.strictEqual(st.approvals, 0, "and nothing is waiting, because there is nothing");
  assert.strictEqual(st.done, false);
  ok("c4 · an RFC with no approval block at all → draft, and never approved");
}

{
  // NOT IN THE CLAIMS LIST, AND IT IS WHY THIS BUILD DEPARTS FROM §4.1's SNIPPET. The snippet
  // reads `verdicts.every(Boolean)` — every block carrying SOMETHING — while §2's table and §9
  // both say "every approval block carries `verdict=approved`". Under Boolean, a hand-written
  // third word reads as APPROVED, which is a surface saying what the document does not support.
  // The control can only write approved or rejected, so the two readings differ nowhere a press
  // can reach — only where somebody typed, and there the strict answer is the honest one.
  const st = await stateOf("approved", "deferred");
  assert.strictEqual(st.verdict, undefined, "an unrecognised verdict is not an approval");
  ok("a verdict nobody recognises does not read as approved — §2's table over §4.1's snippet");
}

{
  // THE REGRESSION GUARD FOR THE DOCUMENT THAT FOUND THIS. RFC-076 carries a design approval
  // (approved) and a completeness approval (unpressed), and its row read approved. It must now
  // read draft until the second one is pressed — the defect, reproduced as the shape it came in.
  const st = await stateOf("approved", null);
  assert.strictEqual(st.verdict, undefined);
  assert.ok(st.approvals > 0, "and the row says how many are still waiting, so a surface can ask");
  ok("RFC-076's own shape — design approved, completeness unpressed → draft, with 1 waiting");
}

// ─── RFC-076 §4.2 — THE RETIREMENT'S REASON REACHES THE ROW ────────────────────────────────────
//
// The host's job here is deliberately small: carry `as=` and `supersededBy=` onto the row, RAW.
// It does not group them and it does not validate them, because the grouping (ending leaves the
// lists, pause stays in them) lives in the renderer where the lists are — one vocabulary, and the
// host does not get a second copy to drift from. What these hold is that the facts arrive, that
// `retired` does not depend on them, and that a LIVE document's `as=` is not mistaken for one.
{
  const leaf = (attrs) => `# A doc\n\n::rfc{id=RFC-999${attrs}}\n`;
  const rowOf = async (src, kind = "rfc") => deriveState(await parse(src), kind, src);

  const r = await rowOf(leaf(" retired=2026-10-28 retiredAs=shelf"));
  assert.strictEqual(r.retired, true);
  assert.strictEqual(r.retiredAs, "shelf", "the reason rides along with the retirement");
  ok("a retirement's reason lands on the row");

  const sup = await rowOf(leaf(" retired=2026-10-28 retiredAs=superseded supersededBy=RFC-081"));
  assert.strictEqual(sup.retiredAs, "superseded");
  assert.strictEqual(sup.supersededBy, "RFC-081", "and the one reason with a pointer carries it");
  ok("superseded carries the document that replaced it");

  // NOTHING BRANCHES ON `as=` FOR THE STATE. A reason nobody recognises still retires the
  // document — half-in-half-out would be the worst of both, and the renderer is where "neither an
  // ending nor a pause" gets said.
  const odd = await rowOf(leaf(" retired=2026-10-28 retiredAs=binned"));
  assert.strictEqual(odd.retired, true, "still retired — the reason qualifies, it does not gate");
  assert.strictEqual(odd.retiredAs, "binned", "carried through unjudged, for the renderer to place");
  ok("an unrecognised reason still retires, and is carried through unjudged");

  const bare = await rowOf(leaf(" retired=2026-10-28"));
  assert.strictEqual(bare.retired, true);
  assert.strictEqual(bare.retiredAs, undefined, "no reason, no field — absence stated");
  ok("a retirement with no reason says nothing rather than guessing one");

  // EACH REASON HAS A NAME NO OTHER MEANING HAS SPENT, which is why `retiredAs=` is its own
  // attribute rather than either short name. A document really can carry all three at once, and
  // every one of them has to survive the others being there.
  const live = await rowOf(`# R\n\n::report{id=some-id as=planning retain=14d}\n`, "report");
  assert.strictEqual(live.retiredAs, undefined, "a live report has no retirement reason to read");
  ok("a live report carries a subtype and no reason");

  // A RETIRED REPORT KEEPS BOTH: `as=` is still the subtype that says what done meant for it, and
  // `retiredAs=` is why it was taken out. One slot per meaning, so neither answer is lost.
  const both = await rowOf(
    `# R\n\n::report{id=some-id as=planning retain=14d retired=2026-10-28 retiredAs=shelf}\n`,
    "report"
  );
  assert.strictEqual(both.retiredAs, "shelf", "the reason is the reason");
  assert.strictEqual(both.retired, true);
  ok("a retired report keeps its subtype AND its reason — two names, two meanings, one line");

  // REQUIRED, BOTH (RFC-076 §2 amendment, c42/c43): a report declares its subtype AND its ending,
  // and a leaf missing either wears what is missing on the row — surfaced, never lumped under the
  // bare kind. A fully-declared leaf wears nothing.
  const noSub = await rowOf(`# R\n\n::report{id=r-bare retain=14d}\n`, "report");
  assert.strictEqual(noSub.invalid, "no subtype", "a bare as= is named, not lumped");
  const noEnd = await rowOf(`# R\n\n::report{id=r-open as=notice}\n`, "report");
  assert.strictEqual(noEnd.invalid, "no retention", "an undeclared ending is named");
  const neither = await rowOf(`# R\n\n::report{id=r-naked}\n`, "report");
  assert.strictEqual(neither.invalid, "no subtype, no retention", "both absences, both named");
  const declared = await rowOf(`# R\n\n::report{id=r-full as=account retain=permanent}\n`, "report");
  assert.strictEqual(declared.invalid, undefined, "a declared leaf wears no invalid");
  assert.strictEqual(declared.retain, "permanent", "the explicit forever rides the row");
  ok("a report leaf declares as= and retain= or the row says which is missing (c42, c43)");

  // The same line on a GAP, where `why=` is already spent on the rejection's reason. All three
  // coexist: the ending it took, why it was declined, and why it was then taken out of service.
  const gap = await rowOf(
    `# G\n\n::gap{id=G-12 rejected=2026-10-28 why=wontfix retired=2026-10-28 retiredAs=out-of-service}\n`,
    "gap"
  );
  assert.strictEqual(gap.rejectedWhy, "wontfix", "the rejection keeps its own reason");
  assert.strictEqual(gap.retiredAs, "out-of-service", "and the retirement keeps its own");
  ok("a gap carries a rejection reason and a retirement reason at once, neither overwriting the other");
}

// ─── RFC-076 §4.6 — NOTHING RETIRES ON A CLOCK ─────────────────────────────────────────────────
//
// c41 and c33. `LIFECYCLE` held four windows — arc 30, rfc 30, gap 14, report 7 — described as days
// before "the sweep writes `retired`". That sweep never existed (nothing ever imported LIFECYCLE),
// and under this design it must never exist: a timer that retires a document is a decision nobody
// made, attributed to nobody, with no reason attached. These hold that the numbers are gone and
// that age writes nothing.
{
  const { LIFECYCLE } = require("../electron/markdown/blocks.cjs");
  const windows = Object.entries(LIFECYCLE).filter(([, v]) => v && v.window != null);
  assert.deepStrictEqual(windows, [], "no kind carries a retirement window any more");
  ok("c41 · the four per-kind windows are gone — no number anywhere says when to retire something");

  // c33 — the parse over a document far older than any window that used to exist. Age is not an
  // input to `deriveState` at all, which is the structural reason this can never regress: there is
  // nothing to compare a date against.
  // It carries a claim because §5's floor needs one for `settled` to read at all — which is the
  // point of the fixture: the document is fully settled AND seven years old, and nothing retires it.
  const ancient =
    `# An old plan\n\n::rfc{id=RFC-001 settled=2019-01-01}\n\n:::approval{ask="a?" verdict=approved}\nx\n:::\n\n` +
    `::claim[do a thing → it happens]{id=c1 state=met by=x note="saw it, in 2019"}\n`;
  const st = deriveState(await parse(ancient), "rfc", ancient);
  assert.strictEqual(st.retired, undefined, "nothing wrote a retirement onto it");
  assert.strictEqual(st.retiredAs, undefined, "and there is no reason, because nobody gave one");
  assert.strictEqual(st.settled, true, "it is still exactly what it says it is");
  ok("c33 · a document older than every window that used to exist is not retired by anything");

  const oldGap = `# old gap\n\n::gap{id=G-1 resolved=2019-01-01}\n\n:::cmd\nyarn test\n:::\n`;
  const g = deriveState(await parse(oldGap), "gap", oldGap);
  assert.strictEqual(g.retired, undefined);
  assert.strictEqual(g.done, true, "a seven-year-old resolved gap is resolved, not swept");
  ok("c33 · and the same for a gap resolved years ago — done does not decay into retired");
}

// ─── RFC-076 §5 — THE EMPTY-SET FLOOR FOR AN RFC'S CLAIMS ───────────────────────────────────────
//
// c12. §5's table: `rfc | claims.length > 0 | an RFC with no claims reading as built and settled`.
// It was not enforced — measured 2026-10-28, an RFC with a verdict, a STATUS heading and zero claim
// blocks read `built: true, settled: true`. "There is nothing left to satisfy" about a document
// that never said what it would satisfy. §6 gives this floor no slice; §9 commits to it anyway.
{
  const base = (claims) =>
    `# x\n\n::rfc{id=RFC-900 settled=2026-10-28}\n\n:::approval{ask="a?" verdict=approved}\nx\n:::\n\n` +
    claims +
    `## STATUS — built 2026-10-28\n`;
  const rowOf = async (src) => deriveState(await parse(src), "rfc", src);

  const bare = await rowOf(base(""));
  assert.strictEqual(bare.settled, undefined, "no claims, no settled — whatever the leaf says");
  assert.strictEqual(bare.built, undefined, "and a STATUS heading over nothing is not built either");
  ok("c12 · an RFC with no claims reads neither built nor settled, however it is declared (§5)");

  // THE FLOOR IS ABOUT EXISTENCE, NOT ABOUT MET-NESS — one claim is enough to clear it whatever
  // its mark says, which is why this fixture's claim is bare and still clears `built`/`settled`.
  const one = await rowOf(base(`::claim[do a thing → a thing happens]{id=c1 state=met by=x note="saw it"}\n\n`));
  assert.strictEqual(one.settled, true);
  assert.strictEqual(one.built, true);
  // AND IT IS NOT MET: marked met with nothing embedded is UNPROVED, which is what the next block
  // is about. The floor and the mark answer two different questions and this fixture separates
  // them — one claim is enough to exist, and no claim is met for free.
  assert.deepStrictEqual(one.claims, { total: 1, met: 0, unproved: 1 }, "marked is not met");
  ok("c12 · one claim clears the floor however it is marked — and a bare mark is not met");

  // DELETE EVERY CLAIM AND IT STOPS READING SETTLED — the claim as written, as a transition.
  assert.strictEqual((await rowOf(base(""))).settled, undefined);
  ok("c12 · delete every claim from a settled RFC and it stops reading settled");

  // The floor is a FLOOR, not §2's full condition: §2 also wants the claims all met before
  // `settled`, and §6 slices that nowhere, so an unmet claim still clears the floor. Pinned so the
  // difference is visible rather than discovered later as a surprise.
  const unmet = await rowOf(base(`::claim[do a thing → a thing happens]{id=c1 state=unmet by=x note="it does not"}\n\n`));
  assert.strictEqual(unmet.settled, true, "the floor is presence, not met-ness — §2's full gate is unbuilt");
  assert.deepStrictEqual(unmet.claims, { total: 1, met: 0 });
  ok("the floor is presence and not met-ness — §2's full settled condition is NOT built, and says so");
}

// ─── c23's SECOND HALF — THE STATE COMES BACK FROM A FRESH PARSE, WITH NOTHING STORED ─────────
//
// THE FIRST HALF MOVED, and a blind review of this RFC's claims is why. It used to be a hand-typed
// list of eight attribute bags asserted not to contain state words — and the test's own comment
// admitted the list was a transcription of what `pressTo` produces. A transcription keeps passing
// after the code starts writing a state word, which is the one thing it was there to catch. That
// half now lives in systemview's `lifecycleState.test.js`, where it enumerates every kind, station
// and reason and inspects what the REAL function returns.
//
// What belongs here is the half only the host can answer: that the state is DERIVED back out of
// the fact, by a parse that has never seen the document before, with nothing stored.
{
  const leafLine = (kind, attrs) =>
    `::${kind}{id=X-1 ${Object.entries(attrs).map(([k, v]) => `${k}=${String(v).includes(" ") ? `"${v}"` : v}`).join(" ")}}`;

  const retired = `# a doc\n\n${leafLine("rfc", { retired: "2026-10-28", retiredAs: "shelf" })}\n`;
  const back = deriveState(await parse(retired), "rfc", retired);
  assert.strictEqual(back.retired, true, "the state is derived, from the fact alone");
  assert.strictEqual(back.retiredAs, "shelf");
  assert.ok(!("state" in back), "and nothing called `state` was ever stored to be read back");
  ok("c23 · the state comes back from a fresh parse of the fact, with nothing stored");

  const declined = `# a gap\n\n${leafLine("gap", { rejected: "2026-10-28", why: "wontfix" })}\n`;
  const g = deriveState(await parse(declined), "gap", declined);
  assert.strictEqual(g.rejected, true);
  assert.strictEqual(g.rejectedWhy, "wontfix");
  assert.strictEqual(g.done, false, "and the OTHER ending is false, from the same one fact");
  ok("c23 · a gap's rejection round-trips the same way, and its fork stays a fork");

  // The leaf line carries a DATE and a REASON and no state word — asserted on the bytes that
  // actually went into the file, which is the thing a reader of the document would see.
  const line = leafLine("rfc", { retired: "2026-10-28", as: "superseded", supersededBy: "RFC-081" });
  for (const w of ["draft", "approved", "built", "settled", "open", "resolved", "filed", "done"]) {
    assert.ok(!new RegExp(`=${w}\\b`).test(line), `the leaf line carries no =${w}`);
  }
  ok("c23 · and the leaf line as written to disk carries no state word as any value");
}

// ─── c31 — SAVED FROM OUTSIDE THE WINDOW, THE REASON COMES WITH IT ──────────────────────────────
//
// This whole file IS the host with no window: plain node, no renderer, no session. The reason is
// carried by the derivation itself, so there is no path where a save lands the retirement and
// loses the word that qualifies it.
{
  const src = `# a doc\n\n::rfc{id=RFC-950 retired=2026-10-28 retiredAs=superseded supersededBy=RFC-951}\n`;
  const st = deriveState(await parse(src), "rfc", src);
  assert.strictEqual(st.retired, true);
  assert.strictEqual(st.retiredAs, "superseded");
  assert.strictEqual(st.supersededBy, "RFC-951");
  ok("c31 · derived with no window anywhere — the retirement and its reason arrive together");
}

// ─── MARKED IS NOT MET ─────────────────────────────────────────────────────────────────────────
//
// *"All of these needed proofs before they could be said that they were met… whether it was
// behavioral or experiential, they both need to have some type of proof inside of it, one requiring
// a spec."*
//
// WHY THIS IS A CONDITION AND NOT A RULE IN A SKILL. The rule was already written in
// `rfc-execution`, and RFC-076 still came out with 24 of 41 claims marked met and 21 of those
// carrying nothing — while a green suite that proved most of them ran on every change. The marks
// were honest; the evidence simply never became addressable. An instruction an agent has to
// remember had already failed once, measurably, so the state stopped depending on remembering.
{
  const doc = (claims) =>
    `# R\n\n::rfc{id=RFC-888}\n\n:::approval{ask="a?" verdict=approved}\nx\n:::\n\n` + claims;
  const claimsOf = async (c) => (await (async () => deriveState(await parse(doc(c)), "rfc", doc(c)))()).claims;

  // A leaf claim has no body, so it has nowhere to PUT its proof — it cannot be met until grown.
  const bare = await claimsOf(`::claim[press it → it happens]{id=c1 state=met by=sv note="saw it"}\n`);
  assert.deepStrictEqual(bare, { total: 1, met: 0, unproved: 1 });
  ok("a one-line claim marked met is UNPROVED — there is nowhere in it for evidence to live");

  // Behavioural (the default, and silence counts as it) owes a SPEC: something that presses.
  const spec = await claimsOf(
    `::::claim[press it → it happens]{id=c1 state=met by=sv note="saw it"}\n::test[systemview/lifecycleState]{ns=Specs.run}\n::::\n`
  );
  assert.deepStrictEqual(spec, { total: 1, met: 1 });
  ok("a behavioural claim with an embedded test is met, and the row stops reporting an unproved one");

  // THE CASE THAT SEPARATES THE TWO HALVES. A picture is real evidence and it is not a spec, so it
  // settles a claim only an eye can settle and never one a machine can.
  const shownOnly = await claimsOf(
    `::::claim[press it → it happens]{id=c1 state=met by=sv note="saw it"}\n::image[RFCs/proofs/x.png]{caption="it happened"}\n::::\n`
  );
  assert.deepStrictEqual(shownOnly, { total: 1, met: 0, unproved: 1 });
  ok("a behavioural claim backed only by a picture is NOT met — shown evidence is not a spec");

  const experiential = await claimsOf(
    `::::claim[the badge reads as an invitation]{id=c1 kind=experiential state=met by=sv note="looked"}\n::image[RFCs/proofs/x.png]{caption="the badge"}\n::::\n`
  );
  assert.deepStrictEqual(experiential, { total: 1, met: 1 });
  ok("an experiential claim IS met on shown evidence — kind exempts the spec, never the proof");

  // AND `kind=experiential` IS NO LONGER AN EXEMPTION FROM PROOF. This is the half of his ruling
  // that changed what was already written: the old rule exempted experiential claims from owing
  // anything, so declaring one was a way out of the work.
  const experientialBare = await claimsOf(
    `::claim[the badge reads as an invitation]{id=c1 kind=experiential state=met by=sv note="looked"}\n`
  );
  assert.deepStrictEqual(experientialBare, { total: 1, met: 0, unproved: 1 });
  ok("an experiential claim with NOTHING in it is unproved too — the exemption is spec-only");

  // RFC-075's rule, now load-bearing: an agent's mark with no statement was never a mark, so it is
  // not even in the unproved count — it is unchecked, which is a different and honest answer.
  const noStatement = await claimsOf(`::claim[press it → it happens]{id=c1 state=met by=sv}\n`);
  assert.deepStrictEqual(noStatement, { total: 1, met: 0 });
  ok("an agent's mark with no note is UNCHECKED, not unproved — it never counted as a mark");

  // A run block and a cmd block both press, so both are specs. His words: *"embedded, run blocks,
  // whatever, we already know."*
  for (const [block, label] of [
    [":::run{ns=Math.add}\nx\n:::", "a run block"],
    [":::cmd\nyarn test --testPathPattern=lifecycle\n:::", "a cmd block"],
  ]) {
    const r = await claimsOf(`::::claim[press it → it happens]{id=c1 state=met by=sv note="ran it"}\n${block}\n::::\n`);
    assert.deepStrictEqual(r, { total: 1, met: 1 }, label);
  }
  ok("a run block and a cmd block each count as a spec — anything that presses and answers");

  // The mixed document, which is the real shape: the row has to say how many are testimony.
  const mixed = await claimsOf(
    `::::claim[a → b]{id=c1 state=met by=sv note="x"}\n::test[t]{ns=Specs.run}\n::::\n\n` +
      `::claim[c → d]{id=c2 state=met by=sv note="x"}\n\n` +
      `::claim[e → f]{id=c3 state=unmet by=sv note="it does not"}\n\n` +
      `::claim[g → h]{id=c4}\n`
  );
  assert.deepStrictEqual(mixed, { total: 4, met: 1, unproved: 1 });
  ok("the row counts met, and says how many MARKS are resting on nothing — the number nobody could see");
}


// ─── A REPORT'S SUBTYPE RIDES THE ROW ───────────────────────────────────────────────────────────
//
// The band fans reports out by subtype — a spec tab, a notice tab — so the word has to be on the
// row; grouping a list by opening every file is not grouping a list. Open vocabulary: whatever the
// leaf says is what the row says, and no subtype is no field, never a guessed default.
{
  const rowOf = async (src) => deriveState(await parse(src), "report", src);
  assert.strictEqual((await rowOf("::report{id=r1 as=spec}\n")).subtype, "spec");
  assert.strictEqual((await rowOf("::report{id=r2 as=nonsense}\n")).subtype, "nonsense", "open means open");
  assert.strictEqual((await rowOf("::report{id=r3}\n")).subtype, undefined, "absent is absent");
  // And it survives retirement beside the reason — two names, two meanings, one line.
  const both = await rowOf("::report{id=r4 as=notice retired=2026-10-28 retiredAs=shelf}\n");
  assert.strictEqual(both.subtype, "notice");
  assert.strictEqual(both.retiredAs, "shelf");
  ok("a report's subtype rides the row — open vocabulary, absent when absent, intact through retirement");
}

console.log(`\n${n} claims held — what a row says about a decision, and what a mark rests on`);
