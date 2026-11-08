// THE JUDGES — RFC-078 §2.2. A judge is a pure function over a document's PARSED blocks:
// `(blocks, {path, project}) → violations[]`, each violation `{nudge, path, project, line, detail}`.
//
// THEY LIVE HERE, BESIDE THE PARSE, AND THAT IS THE WHOLE POINT. The first cut put them in the hub
// behind a `GET /judges` door that the shell dialled at both clocks, on the premise that "the parsed
// state already lives there". It does not: the SHELL owns `~/.autobot/documents.json` and its parse
// writes the derived state (api/documentsRegistry.js says so in its own second line) — the hub reads
// the shell's file. So the shell was asking an app it HOSTS about state the shell itself produced,
// which is the dependency inverted: the harness must run with SystemView closed, and the proof that
// it was wrong was the degradation ladder the dial needed (hub down · 404 · junk shape → nothing
// fires), pinned seven ways. A host tolerating the absence of its guest is a dependency papered
// over. The hub may rely on the shell; never the reverse.
//
// AND NOTHING HAD TO BE GROWN TO MOVE THEM. blocks.cjs already derives, on every document write,
// every fact both first judges need — `proofOwed` (experiential owes shown, everything else owes a
// spec), `insideOf` (what sits in a claim's own fold), `SPECS` held apart from `PROOF_KINDS.spec`
// which carries `cmd` (the met-versus-settled line, his ruling: *"the CMDs are not really specs"*),
// and `isMarkedMet`. The hub-side version had to babel-compile the window's ESM claims parser off
// disk to see the same fields; that loader was not plumbing, it was the price of the crossing.
//
// DERIVED ON EVERY ASK, STORED NOWHERE: a violation exists only while the work it names is unfixed.
// Fix the fold and the next ask simply does not produce it — there is no record to clear, and that
// is the design, not an optimisation.
//
// NO GATING, NO SCOPING, NO DELIVERY HERE. This file answers only "what is wrong in these blocks".
// Whether a nudge is on, in scope, on this clock and outside its debounce window is nudges.cjs's,
// and the delivery is sessions.cjs's. A judge that needs session or run state is not a document
// judge and does not belong in this file (the chaser and `run-untouched-for-days` live in
// nudges.cjs for exactly that reason).
const fs = require("fs");
const path = require("path");
const { parse } = require("./parse.cjs");
const { SPECS, insideOf, proofInside, proofOwed } = require("./blocks.cjs");

const claimsIn = (blocks) => (blocks || []).filter((b) => b && b.name === "claim" && (b.attrs || {}).id);

// ── JUDGE 1 · behavioural-claim-cmd-only ────────────────────────────────────────────────────────
// A claim that is not `kind=experiential` carries EVIDENCE in its fold but no `::test` and no
// `:::run` — so it reads met and has nothing that re-runs on its own. The narrow case on purpose:
// a claim with an EMPTY fold is merely unproved (the claims bar already says so and the host
// already refuses to count it met), while this one looks settled and is not. `cmd` is the usual
// occupant, which is where the name comes from.
const cmdOnly = (blocks, { path: p = "", project = "" } = {}) =>
  claimsIn(blocks)
    .filter((c) => {
      if (proofOwed(c) !== "spec") return false; // experiential — the eye settles it, no spec owed
      const got = proofInside(blocks, c);
      if (got.spec + got.shown === 0) return false; // nothing in the fold at all — unproved, not this
      return !insideOf(blocks, c).some((b) => SPECS.includes(b.name));
    })
    .map((c) => ({
      nudge: "behavioural-claim-cmd-only",
      path: p,
      project,
      line: Number(c.line) || 0,
      detail: `${c.attrs.id} holds evidence but no ::test or :::run — a cmd is evidence, never the spec`,
    }));

// ── JUDGE 2 · met-without-note ──────────────────────────────────────────────────────────────────
// A mark saying `met` by an AGENT with no statement beside it. `isMarkedMet` already encodes the
// rule (`by ? !!note : true` — a human's press is its own evidence, only an agent's mark owes the
// word); this is the same condition stated as the violation, for the historical marks written where
// the verb could not yet refuse. Marks with no `by` are a human's and are left alone.
const metWithoutNote = (blocks, { path: p = "", project = "" } = {}) =>
  claimsIn(blocks)
    .filter((c) => {
      const a = c.attrs || {};
      if (String(a.state || "").trim() !== "met") return false;
      if (!String(a.by || "").trim()) return false; // a human's press — its own evidence
      return !String(a.note || "").trim();
    })
    .map((c) => ({
      nudge: "met-without-note",
      path: p,
      project,
      line: Number(c.line) || 0,
      detail: `${c.attrs.id} is marked met with no note — a mark carries a statement or it is not a mark`,
    }));

const JUDGES = [cmdOnly, metWithoutNote];
const names = ["behavioural-claim-cmd-only", "met-without-note"];

/** Every document judge over blocks already in hand — the write-time shape, zero extra parsing. */
const violationsIn = (blocks, where = {}) => JUDGES.flatMap((j) => j(blocks, where));

/**
 * Judge one document by absolute path.
 *
 * Reads and parses, because a per-claim violation needs the BLOCKS and the registry row carries
 * only counts (`deriveState` keeps done-ness and tallies, never a claim list). Silent on an
 * unreadable file: a document that cannot be read has nothing to report, never a throw into a clock.
 */
async function forFile(abs, { path: rel = "", project = "" } = {}) {
  let text;
  try {
    text = fs.readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  try {
    const blocks = await parse(text);
    return violationsIn(blocks, { path: rel || abs, project });
  } catch {
    return [];
  }
}

/**
 * Judge every registered document of one project — the sweep question, answered locally.
 *
 * Rows come from the shell's own registry, deduped BY PATH: a two-leaf document has a row per leaf
 * carrying the same file, and judging it twice would report every violation twice.
 */
async function forProject(projectCode, { registry = null } = {}) {
  const pc = String(projectCode || "").trim();
  if (!pc) return [];
  const docs = registry || require("./registry.cjs");
  let rows;
  try {
    rows = (docs.read() || []).filter((r) => r && String(r.project || "") === pc);
  } catch {
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const abs = docs.absPathOf(row);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push(...(await forFile(abs, { path: String(row.path || ""), project: pc })));
  }
  return out;
}

module.exports = { names, violationsIn, forFile, forProject, cmdOnly, metWithoutNote };
