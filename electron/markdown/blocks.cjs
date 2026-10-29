// RFC-073 §3.1 — WHAT THE GRAMMAR IS, as data. Which blocks register a document, and which attribute
// is a block's ANSWER. This is the list RFC-053 said there must be one of; it lived in SystemView's
// `registry.js` beside the React components, and the components are rightly the app's while this is
// not. An app's `registry.js` maps a name to a component. This maps a name to what it MEANS.
//
// Declarative on purpose: a fourth kind of document, or a sixth firing block, is a line here and
// nowhere else. Nothing below is a function of anything but the name.

// A REGISTRATION LEAF makes a document self-describing (RFC-072 for `::arc`; this RFC adds the other
// two). `id` is the identity — the number travels, the kebab title after it is cosmetic. `arc=` on
// an RFC is the one relationship the registry holds, because "what is being built for this arc" is
// a question the system should answer without a grep.
const REGISTRATION = {
  arc: { kind: "arc", id: "id" },
  rfc: { kind: "rfc", id: "id", relation: "arc" },
  report: { kind: "report", id: "id" },
  // A gap is written INTO ANOTHER PROJECT'S repo by the agent who hit it there — a bug, or a
  // feature that project is missing, found doing work that needed it. Not the owner's own note
  // (that is the board); a message from outside, filed where the fix lives. The body may be one
  // line: a gap needs only its leaf and its completion (`resolved=`).
  gap: { kind: "gap", id: "id" },
};

// WHAT DONE MEANS, PER KIND (RFC-073 §1.4). The parse yields done-ness like any other answer;
// nothing in the registry says it.
//
// THE FOUR WINDOWS ARE GONE — arc 30, rfc 30, gap 14, report 7 — and RFC-076 §4.6 is why.
//
// They were *"days a completed document stays findable in the lists before the sweep writes
// `retired`"*, and under this design that sweep must never exist: **a timer that retires a document
// is a decision nobody made, attributed to nobody, with no reason attached.** Retirement is a hand
// with a reason now, from a closed list, and the reason is the whole point — a clock cannot give
// one. Nothing imported `LIFECYCLE` at any time, so the numbers described a sweep that was never
// built; deleting them is removing a promise the code had already failed to keep, not a feature.
//
// **This amends RFC-073 §2**, which committed to "the sweep job of §4.2" writing `retired`. That
// half is withdrawn. The sweep's OTHER job — re-parsing documents nobody has open — stands.
//
// THE ONE CLOCK THAT SURVIVES IS NOT HERE and is not a window: a report may carry `retain=14d` on
// its own leaf, started by your FIRST OPEN rather than at filing, surfaced by the document itself,
// and divertable by a press. That is per-document and gated on your attention, so it measures
// whether you read the thing rather than what the calendar says. It is slice 6 and it is not built.
const LIFECYCLE = {
  arc: {}, // done when every objective is state=done (and there is at least one)
  rfc: {}, // done at verdict=; built at a `## STATUS` heading; settled= declared when it stops moving
  gap: { done: "resolved" }, // done when its leaf carries resolved= AND the document carries a proof (§4.5)
  report: {}, // never done — it is a view, it only gets old
};

// A FIRING BLOCK records a decision in the document by writing one attribute. `answer` names it;
// `done` is the value that counts as fired where the attribute is a state rather than a verdict.
// `summary` is the one line a subscriber receives — a block that announces itself knows what it is,
// which is what replaces "412 lines, 3 threads, 1 reply". Result blocks (`cmd`, `run`, `test`,
// `branch`) are NOT here: they write nothing into the document, so there is nothing to detect.
const FIRING = {
  question: {
    answer: "answer",
    summary: (b) => `answered "${b.attrs.answer}" — ${b.label}`,
  },
  approval: {
    answer: "verdict",
    summary: (b) => `${b.attrs.verdict} — ${b.attrs.ask || ""}`.trim(),
  },
  objective: {
    answer: "state",
    done: "done",
    summary: (b) => `${b.attrs.id || "objective"} is done — ${firstLine(b.src)}`,
  },
  commit: {
    answer: "sha",
    summary: (b) => `committed ${b.attrs.sha} — ${b.label || b.attrs.message || ""}`.trim(),
  },
  reply: {
    // a reply has no answer attribute: the block existing is the decision
    answer: null,
    summary: (b) => `${b.attrs.by || "somebody"} replied — ${firstLine(b.src)}`,
  },
  // A claim's mark is news for its audience (c14: `cN met — <statement>`) — met or not met, both
  // are answers; unchecked is the absence this block exists to make visible, so it never fires.
  claim: {
    answer: "state",
    summary: (b) => `${b.attrs.id || "claim"} ${b.attrs.state === "unmet" ? "not met" : b.attrs.state} — ${b.label}`,
  },
  // The registration leaf is also a firing block for ONE kind: a gap completing is news for whoever
  // filed it (c29: `gap resolved — <title>`).
  gap: {
    answer: "resolved",
    summary: (b) => `gap resolved — ${b.attrs.title || b.attrs.id || ""}`.trim(),
  },
};

const firstLine = (src) =>
  String(src || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0] || "";

/**
 * EVERY registration leaf among `blocks`, in document order — a document may carry several
 * identities, and each one registers its own row (his design, 2026-10-29: a spec fixture holds a
 * spec leaf as its identity AND the mock leaf it exercises, pressable because the mock has a row).
 * The old rule here — "the first one wins; a document is one thing" — was never a ruling: it was a
 * brainstorm question of his, answered mid-work and mistakenly baked in as doctrine.
 */
function registrationsOf(blocks) {
  const out = [];
  for (const b of blocks || []) {
    const def = REGISTRATION[b.name];
    if (!def || b.kind !== "leaf") continue;
    const id = String((b.attrs || {})[def.id] || "").trim();
    if (!id) continue;
    const reg = { kind: def.kind, id };
    if (def.relation && b.attrs[def.relation]) reg[def.relation] = String(b.attrs[def.relation]).trim();
    out.push(reg);
  }
  return out;
}

/** The PRIMARY identity — the first leaf: what the document is when one answer is needed (fires,
 * audiences, teardown-by-identity). The further leaves register too; see registrationsOf. */
function registrationOf(blocks) {
  return registrationsOf(blocks)[0] || null;
}

/** True when a firing block carries its answer — the thing a subscriber would be told about. */
function hasFired(block) {
  const def = FIRING[block.name];
  if (!def) return false;
  if (def.answer === null) return true;
  const v = String((block.attrs || {})[def.answer] || "").trim();
  if (!v) return false;
  return def.done ? v === def.done : true;
}

// ─── WHAT COUNTS AS EVIDENCE — ONE DEFINITION, AND IT IS CONFIGURABLE ──────────────────────────
//
// Every condition in the system that requires evidence reads THIS, so there is one answer to "is
// there proof here" and no kind gets its own private version of it. A gap's `resolved` was the
// first to need it (RFC-076 §4.5); a claim's `met` is the second; a
// report's `spec` subtype will be the third. Configurable because the two halves answer different
// obligations and different conditions demand different halves.
//
// - **spec** — something PRESSES it and it answers, so it can go red on its own. This is what
//   rides the change loop: it keeps being true, or stops being true out loud.
// - **shown** — evidence a human READS. It makes the check easy now and nothing re-runs it, which
//   is exactly right for a claim only an eye can settle and never enough for one a machine can.
const PROOF_KINDS = {
  spec: ["test", "run", "cmd"],
  shown: ["image", "file", "diff", "logs", "branch"],
};

/** Every proof block sitting INSIDE a container's own body, counted by half. */
function proofInside(blocks, owner) {
  const from = Number(owner.line) || 0;
  const to = Number(owner.end) || from;
  // A LEAF CLAIM HAS NO BODY, so `from === to` and this is 0 of each — which is the point: a
  // one-line `::claim[…]` cannot carry its proof, so it cannot be met until somebody grows it.
  const inside = (blocks || []).filter((b) => b !== owner && Number(b.line) > from && Number(b.end || b.line) <= to);
  return {
    spec: inside.filter((b) => PROOF_KINDS.spec.includes(b.name)).length,
    shown: inside.filter((b) => PROOF_KINDS.shown.includes(b.name)).length,
  };
}

/** Marked met by somebody — and an agent's mark carries a statement or it is not a mark. */
function isMarkedMet(claim) {
  const a = claim.attrs || {};
  if (String(a.state || "").trim() !== "met") return false;
  const by = String(a.by || "").trim();
  const note = String(a.note || "").trim();
  // RFC-075's rule: `by=<projectCode>` with no `note=` counts as UNCHECKED. A human's press is its
  // own evidence, so only an agent's mark owes the statement — and `by` naming a project code is
  // how you tell them apart.
  return by ? !!note : true;
}

/**
 * WHAT A CLAIM'S PROOF OWES, by its own declaration.
 *
 * `kind=experiential` stopped being an exemption from PROOF and became an exemption from SPEC
 * only (his ruling): a claim the human's eye settles still owes evidence — a cmd, a shot, the
 * branch — it just does not owe something that re-runs. Everything else, silence included, is
 * behavioural and owes a spec, which may be an existing test, an edited one, or a new one.
 */
function proofOwed(claim) {
  return String((claim.attrs || {}).kind || "").trim() === "experiential" ? "shown" : "spec";
}

/** True when this claim carries the proof its kind owes. */
function claimProved(claim, blocks) {
  const got = proofInside(blocks, claim);
  return proofOwed(claim) === "spec" ? got.spec > 0 : got.spec + got.shown > 0;
}

/**
 * THE CLAIMS THAT ARE ACTUALLY MET — marked met AND carrying their proof.
 *
 * MARKED IS NOT MET. Measured on RFC-076 the day this landed: 24 of 41 claims marked met, 21 of
 * them with nothing embedded at all, while a green suite that proved most of them ran on every
 * change. The marks were honest and the evidence existed; it simply never became addressable, so
 * every reader had to take one agent's word for something a machine already checked. A rule in a
 * skill could not stop that — it had already been written there — so the CONDITION stops it.
 */
function metClaims(claims, blocks) {
  return (claims || []).filter((c) => isMarkedMet(c) && claimProved(c, blocks));
}

/**
 * THE DERIVED `state` A REGISTRY ROW CARRIES (RFC-073 §1.4) — what the last parse saw, at that
 * time. Never truth: a list of forty documents cannot open forty files per paint, so the row keeps
 * done-ness, verdict, objective counts, approvals waiting and `parsed` — and anything reading it
 * knows it may lag, because `parsed` says when. Wipe it and the next parse rebuilds it.
 */
function deriveState(blocks, kind, source) {
  const all = blocks || [];
  const approvals = all.filter((b) => b.name === "approval");
  // EVERY APPROVAL BLOCK, AND THE WEAKEST ANSWER WINS (RFC-076 §4.1). This read `approvals[0]` —
  // the first block in the file and no other — so a document carrying a design approval and a
  // claims-completeness approval reported whichever happened to be typed first. RFC-075 carries
  // two, RFC-076 carries two, and RFC-076's own row read `verdict: approved` beside
  // `approvals: 1` — approved off one block while another waited. Not a preference: a defect.
  //
  // A REJECTION ANYWHERE IS THE ANSWER, because one reviewer saying no is the decision; and
  // `approved` needs them ALL to carry one, which is what "every approval block approved" means.
  // `verdicts.length` is the floor — every-of-nothing is true, so without it a document with no
  // approval block at all would read approved for free. That empty set is the case this gets
  // wrong by default, which is why the floor is written before the `every`.
  // ONE DEPARTURE FROM §4.1's SNIPPET, AND IT IS §2's TABLE THAT DECIDES IT. The snippet reads
  // `verdicts.every(Boolean)` — every block carrying SOMETHING — while §2's RFC table and §9's
  // commitment both say *"every approval block carries `verdict=approved`"*. Under `Boolean` a
  // hand-written `verdict=deferred` reads as APPROVED, which is the exact thing the problem
  // section arbitrates against: a surface saying something the document does not support. The
  // control only ever writes `approved` or `rejected`, so for every verdict a press can produce
  // these two readings are identical; they differ only where somebody typed a third word, and
  // there the strict one is the honest answer.
  const verdicts = approvals.map((b) => String((b.attrs || {}).verdict || "").trim());
  const rejected = verdicts.some((v) => v === "rejected");
  const approved = verdicts.length > 0 && verdicts.every((v) => v === "approved");
  const verdict = rejected ? "rejected" : approved ? "approved" : "";
  const waiting = verdicts.filter((v) => !v).length;
  const objectives = all.filter((b) => b.name === "objective");
  const objDone = objectives.filter((b) => String((b.attrs || {}).state || "").trim() === "done").length;
  // THE LEAF OF THIS DERIVATION'S OWN KIND — a document can carry several leaves now, and a row's
  // state must read its own: the spec row reads the report leaf's retain=, the mock RFC row reads
  // the rfc leaf's settled=, out of one file. Falls back to the first leaf of any kind so a derive
  // asked about a kind with no leaf still answers rather than throwing.
  const leaf =
    all.find((b) => REGISTRATION[b.name] && REGISTRATION[b.name].kind === kind && b.kind === "leaf") ||
    all.find((b) => REGISTRATION[b.name] && b.kind === "leaf");
  const retired = !!(leaf && String((leaf.attrs || {}).retired || "").trim());
  // THE RETIREMENT CARRIES ITS REASON ONTO THE ROW (RFC-076 §4.2) — raw, ungrouped, unvalidated.
  //
  // NOTHING BRANCHES ON IT HERE, and that is the design: `retired` is true with or without a
  // reason, so a document with an unreadable one is still retired rather than half-in-half-out.
  // The GROUPING — ending leaves the lists, pause stays in them showing why — is the renderer's
  // (`lifecycleState.js`: RETIRE_REASONS, GROUP_OF), because that is where the lists are. One
  // vocabulary, and the host does not get a second copy of it to drift from.
  //
  // `retiredAs=`, which is its own attribute because a retirement can land on any kind and both
  // shorter names are already spent: `as=` is a report's SUBTYPE and `why=` is a gap's REJECTION
  // reason, so either would put two meanings in one slot on a line that really does carry both.
  const retiredAs = retired ? String((leaf.attrs || {}).retiredAs || "").trim() : "";
  const supersededBy = retired ? String((leaf.attrs || {}).supersededBy || "").trim() : "";
  // RFC-075 round two (his): between built and retired a spec SETTLES — the modification stopped
  // because there is nothing left to modify. A declaration (`settled=<date>` on the leaf), never
  // derived from quiet: a document nobody touched because nobody cared would read as settled.
  // ─── THE EMPTY-SET FLOOR FOR AN RFC (RFC-076 §5) ────────────────────────────────────────────
  //
  // `built` and `settled` BOTH NEED AT LEAST ONE CLAIM, and this is the floor §5's table names:
  // *"an RFC with no claims reading as built and settled"*. Measured before landing it, an RFC
  // with zero claim blocks, a verdict and a STATUS heading read `built: true, settled: true` —
  // "there is nothing left to satisfy" about a document that never said what it would satisfy.
  // That is the empty set taking the whole trail for free, which is what every floor here stops.
  //
  // THE FLOOR ONLY, NOT §2's FULL CONDITION. §2's table also requires the claims to be all MET and
  // co-signed before `settled`; that is a bigger change and §6 assigns it to no slice, so it is
  // not built. The count is kept on the row so a surface can say which half is missing.
  //
  // §6 ASSIGNS THIS FLOOR TO NO SLICE EITHER — §9 commits to §5 and the six slices never carry it.
  // It lands here because it is one line, it is approved, and leaving it out would mean shipping
  // the states with the hole §5 exists to close. Verified against the repo first: both RFCs that
  // read settled carry claims, so no live document changes state.
  const claims = all.filter((b) => b.name === "claim");
  // MARKED IS NOT MET. A claim counts as met when it is marked met AND it carries its proof INSIDE
  // ITSELF — see `metClaims`. *"All of these needed proofs before they could be said that they were
  // met… whether it was behavioral or experiential, they both need to have some type of proof
  // inside of it, one requiring a spec."*
  const claimsMet = metClaims(claims, all).length;
  const claimsMarked = claims.filter((b) => isMarkedMet(b)).length;
  const settled = !!(leaf && String((leaf.attrs || {}).settled || "").trim()) && claims.length > 0;
  // ─── A GAP'S TWO ENDINGS, AND THE ONE THAT NEEDS EVIDENCE (RFC-076 §4.5) ────────────────────
  //
  // `resolved=` USED TO BE A DECLARATION WITH NOTHING BEHIND IT, which made the one state in the
  // system that should be hardest to claim the easiest. It now needs a PROOF in the document — a
  // `:::run`, a `:::cmd` or a `::test` — so writing `resolved=` into a gap with nothing runnable
  // in it does not reach the state, and the control says what is missing instead of refusing.
  //
  // THE PROOF BLOCK ITSELF IS NOT RESTRICTED. A gap takes whatever actually closed it: if the fix
  // landed in the suite the test chip IS the evidence; if it changed something the suite cannot
  // see, a run block is the only thing that can answer. Any preference beyond that belongs in the
  // skill that writes gaps, not in an enforcement rule somebody has to bend.
  // READS THE ONE VOCABULARY (PROOF_KINDS), not a private list of three names. A gap's evidence is
  // the whole DOCUMENT's rather than one block's body, which is the only difference — a gap is
  // closed by what is in it, a claim by what is in itself.
  const hasProof = all.some((b) => PROOF_KINDS.spec.includes(b.name));
  const resolvedDeclared = !!(leaf && String((leaf.attrs || {}).resolved || "").trim());
  // THE SECOND ENDING, AND IT IS A FORK RATHER THAN A STEP. `rejected` shares no term with
  // `resolved`: declined on purpose, carrying its reason in `why=`. Without the reason a rejected
  // gap is indistinguishable from a gap nobody looked at, which is the exact failure a gap exists
  // to prevent — so the reason is carried onto the row for the surfaces to insist on.
  const rejectedGap = !!(leaf && String((leaf.attrs || {}).rejected || "").trim());
  const rejectedWhy = rejectedGap ? String((leaf.attrs || {}).why || "").trim() : "";
  const done =
    kind === "arc"
      ? objectives.length > 0 && objDone === objectives.length
      : kind === "rfc"
        ? !!verdict
        : kind === "gap"
          ? resolvedDeclared && hasProof
          : false; // a report is never done — it is a view, it only gets old
  const state = { done, approvals: waiting, parsed: Date.now() };
  if (verdict) state.verdict = verdict;
  if (objectives.length) state.objectives = { done: objDone, total: objectives.length };
  // A REPORT'S SUBTYPE RIDES THE ROW. `as=` picks what done means for a report (an OPEN vocabulary
  // — nothing branches on it), and the band fans reports out by it, so the row has to carry the
  // word: a surface that had to open every file to group a list would not group it.
  if (kind === "report" && leaf) {
    const subtype = String((leaf.attrs || {}).as || "").trim();
    if (subtype) state.subtype = subtype;
    // REQUIRED, BOTH OF THEM (RFC-076 §2 amendment, 2026-10-29): a report declares its subtype
    // AND its ending — `retain=<window>` or `retain=permanent` — or the row SAYS what is missing.
    // Surfaced, never refused: a registration that silently failed is a document the system
    // denies exists, and a bare leaf lumped under the kind label is how six "reports" turned out
    // to be one notice, one plan, one spec and three nobody could name.
    const retain = String((leaf.attrs || {}).retain || "").trim();
    if (retain) state.retain = retain;
    const missing = [!subtype && "no subtype", !retain && "no retention"].filter(Boolean);
    if (missing.length) state.invalid = missing.join(", ");
  }
  if (retired) state.retired = true;
  if (retiredAs) state.retiredAs = retiredAs;
  if (supersededBy) state.supersededBy = supersededBy;
  // THE TWO HALVES OF `resolved` ARE KEPT SEPARATELY, not just their conjunction in `done`. A
  // surface that can only see `done: false` has to say "not resolved" and stop; one that can see
  // `resolvedDeclared: true, hasProof: false` can say *what is missing* — which is the whole
  // difference between a control that refuses and a control that offers to fix it (§4.5).
  if (kind === "gap") {
    if (resolvedDeclared) state.resolvedDeclared = true;
    if (hasProof) state.hasProof = true;
    if (rejectedGap) state.rejected = true;
    if (rejectedWhy) state.rejectedWhy = rejectedWhy;
  }
  if (settled) state.settled = true;
  // And `built` carries the same floor — a STATUS heading over no claims says a design landed
  // without ever saying what landing would mean.
  if (kind === "rfc" && claims.length > 0 && /^##\s*STATUS/m.test(String(source || ""))) state.built = true;
  // THE ROW SAYS WHICH HALF IS MISSING. `met` is the real count; `marked` is how many somebody
  // SAID were met. When they differ, the gap between them is the number of claims resting on
  // testimony with nothing embedded — which is the one thing nobody could see before.
  if (kind === "rfc" && claims.length) {
    state.claims = { total: claims.length, met: claimsMet };
    if (claimsMarked !== claimsMet) state.claims.unproved = claimsMarked - claimsMet;
  }
  return state;
}

// ─── THE OBJECTIVE'S ADDRESS (RFC-076 §4.4, slice 4) ───────────────────────────────────────────
//
// WHAT WAS MISSING: nothing anywhere knew which plan serves which objective. An arc was "done"
// when every `::objective` carried `state=done` — a flag an agent writes by hand — so "the arc is
// finished" rested on somebody remembering to tick a box in the arc's own file.
//
// THE ATTACHMENT IS THE OBJECTIVE'S ADDRESS, not the arc's: a plan's leaf carries
// `arc=ARC-004-O2`. THIS COSTS NO NEW STORAGE — `REGISTRATION.rfc` already declares
// `relation: "arc"`, so whatever string sits in `arc=` is already kept on the row and already
// filterable. What changes is what we write into it and what reads it.
//
// SLICE 4 IS DELIBERATELY STATE-FREE. `planned` lands on the row so a surface can say *"O3 has no
// plan attached"*, and NOTHING derives differently because of it — an arc's `done` still comes off
// `::objective state=done`. That is what lets this land without a flag day: every arc in the repo
// keeps the state it had, and slice 5 is the one that changes what the states mean.

/**
 * `ARC-004-O2` → `ARC-004`. The arc an objective address belongs to.
 *
 * IT STRIPS THE OBJECTIVE, it does not match the arc. An address is `<whatever the arc's id is>-O<n>`,
 * so the only part with a fixed shape is the objective suffix — and that is the part to read. A
 * matcher anchored on `ARC-\d+` quietly decides that every arc in the system is numbered, which is
 * a rule nothing else enforces: `registrationOf` takes any non-empty `id`. An id that says what it
 * is (`MOCK-ARC`) would attach plans that no arc could ever claim, and the failure is silent —
 * `planned` just stays 0 and the arc reads honestly unplanned forever.
 *
 * An address with no objective suffix is not an address: a plan carrying `arc=ARC-004` names the
 * arc at large and claims no objective, which is the answer, not a parse failure.
 */
const arcOfAddress = (addr) => {
  const m = /^(.+)-O\d+$/i.exec(String(addr || "").trim());
  return m ? m[1].toUpperCase() : "";
};

/**
 * THE UPWARD FOLD (RFC-076 §4.4) — what this arc's objectives can say about the plans serving them.
 *
 * Pure, and it takes the registry rows rather than reading them — `deriveState` sees one document
 * and this is the first thing in the system that cannot, so the dependency is a parameter and the
 * caller that has both supplies it.
 *
 * Two counts, and each is a floor against the empty set:
 *
 * - **planned** — objectives with at least one plan pointed at them. AN OBJECTIVE WITH NO PLAN IS
 *   INCOMPLETE (his ruling): this counts objectives that ARE served, never attachments that exist,
 *   so two plans on one objective is one objective planned, and a plan attached to an objective
 *   the arc does not have counts for nothing.
 * - **complete** — objectives whose every plan is SETTLED, read off the plan rows' own derived
 *   state. The settling happened in the plan's document; the arc never stores it and cannot fake
 *   it, which is what makes `settled` the one state on this kind nothing can press into place. A
 *   plan that is attached and unsettled — including one retired mid-flight — holds its objective
 *   open, because a cancelled plan on a live objective is a question for a hand, not a completion.
 *
 * @param {Array} blocks the ARC's own blocks
 * @param {string} arcId e.g. `ARC-004`
 * @param {Array} rows every registry row
 * @returns {{planned: number, complete: number}}
 */
function deriveArc(blocks, arcId, rows) {
  const objectives = (blocks || []).filter((b) => b.name === "objective");
  if (!objectives.length || !arcId) return { planned: 0, complete: 0 };
  // The plans grouped by the address each one claims. A plan whose `arc=` names only the ARC (the
  // old way) lands under `ARC-004`, which matches no objective address — so it plans nothing, and
  // that is the honest answer rather than crediting it to all of them.
  const plansAt = new Map();
  for (const r of rows || []) {
    const addr = String((r && r.arc) || "").trim().toUpperCase();
    if (!addr) continue;
    if (!plansAt.has(addr)) plansAt.set(addr, []);
    plansAt.get(addr).push(r);
  }
  let planned = 0;
  let complete = 0;
  for (const o of objectives) {
    const id = String((o.attrs || {}).id || "").trim();
    if (!id) continue;
    const plans = plansAt.get(`${String(arcId).toUpperCase()}-${id.toUpperCase()}`) || [];
    if (!plans.length) continue;
    planned += 1;
    if (plans.every((p) => !!(p.state && p.state.settled))) complete += 1;
  }
  return { planned, complete };
}

module.exports = {
  REGISTRATION,
  LIFECYCLE,
  FIRING,
  registrationOf,
  registrationsOf,
  hasFired,
  deriveState,
  firstLine,
  deriveArc,
  arcOfAddress,
  PROOF_KINDS,
  proofInside,
  proofOwed,
  claimProved,
  isMarkedMet,
  metClaims,
};
