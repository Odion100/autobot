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

// WHAT DONE MEANS, PER KIND — and how long a done document stays in the lists (RFC-073 §1.4).
// The parse yields done-ness like any other answer; nothing in the registry says it. `window` is
// days a completed document stays findable in the lists before the sweep writes `retired` — one
// number per kind, here, beside the meaning of done. A report is never done: it is a view, it only
// gets old — its window bounds its AGE instead.
const LIFECYCLE = {
  arc: { window: 30 }, // done when every objective is state=done (and there is at least one)
  rfc: { window: 30 }, // done at verdict=; built at a `## STATUS` heading; settled= declared when it stops moving
  gap: { done: "resolved", window: 14 }, // done when its leaf carries resolved=
  report: { window: 7 }, // never done — the window is how long a view stays worth listing
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

/** The registration leaf among `blocks`, or null. The first one wins; a document is one thing. */
function registrationOf(blocks) {
  for (const b of blocks || []) {
    const def = REGISTRATION[b.name];
    if (!def || b.kind !== "leaf") continue;
    const id = String((b.attrs || {})[def.id] || "").trim();
    if (!id) continue;
    const out = { kind: def.kind, id };
    if (def.relation && b.attrs[def.relation]) out[def.relation] = String(b.attrs[def.relation]).trim();
    return out;
  }
  return null;
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

/**
 * THE DERIVED `state` A REGISTRY ROW CARRIES (RFC-073 §1.4) — what the last parse saw, at that
 * time. Never truth: a list of forty documents cannot open forty files per paint, so the row keeps
 * done-ness, verdict, objective counts, approvals waiting and `parsed` — and anything reading it
 * knows it may lag, because `parsed` says when. Wipe it and the next parse rebuilds it.
 */
function deriveState(blocks, kind, source) {
  const all = blocks || [];
  const approvals = all.filter((b) => b.name === "approval");
  const verdict = String(((approvals[0] || {}).attrs || {}).verdict || "").trim();
  const waiting = approvals.filter((b) => !String((b.attrs || {}).verdict || "").trim()).length;
  const objectives = all.filter((b) => b.name === "objective");
  const objDone = objectives.filter((b) => String((b.attrs || {}).state || "").trim() === "done").length;
  const leaf = all.find((b) => REGISTRATION[b.name] && b.kind === "leaf");
  const retired = !!(leaf && String((leaf.attrs || {}).retired || "").trim());
  // RFC-075 round two (his): between built and retired a spec SETTLES — the modification stopped
  // because there is nothing left to modify. A declaration (`settled=<date>` on the leaf), never
  // derived from quiet: a document nobody touched because nobody cared would read as settled.
  const settled = !!(leaf && String((leaf.attrs || {}).settled || "").trim());
  const done =
    kind === "arc"
      ? objectives.length > 0 && objDone === objectives.length
      : kind === "rfc"
        ? !!verdict
        : kind === "gap"
          ? !!(leaf && String((leaf.attrs || {}).resolved || "").trim())
          : false; // a report is never done — it is a view, it only gets old
  const state = { done, approvals: waiting, parsed: Date.now() };
  if (verdict) state.verdict = verdict;
  if (objectives.length) state.objectives = { done: objDone, total: objectives.length };
  if (retired) state.retired = true;
  if (settled) state.settled = true;
  if (kind === "rfc" && /^##\s*STATUS/m.test(String(source || ""))) state.built = true;
  return state;
}

module.exports = { REGISTRATION, LIFECYCLE, FIRING, registrationOf, hasFired, deriveState, firstLine };
