// smoke:skew — A SHELL HOLDING A NEWER RENDERER THAN THE HUB IT READS.
//
// WHY THIS FILE EXISTS. The hub and the shell are separate processes restarted by separate hands:
// `api/` rides a hub restart, `electron/` rides a shell restart, and nothing coordinates the two.
// So a renderer that reads a field its hub does not send yet is not an edge case — it is the
// NORMAL state of this system for as long as one process is older than the other.
//
// MEASURED 2026-11-07. The `crossed` finding landed in the hub (systemview 02edc313) and its
// renderer in the shell (fd696d1). His shell restarted; his hub had been up since Monday. The
// whole commitLinks door then answered "Cannot read properties of undefined (reading 'length')" —
// not a degraded section, the entire verb, because `say()` dereferenced `.length` on a field the
// older hub had never heard of.
//
// THE RULE UNDER TEST: an absent section reads as NOTHING TO REPORT. That is what an older hub is
// actually saying, and it is the only reading that keeps the rest of the answer legible.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sv = require("../electron/agents/systemview.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };
const said = (r) => (r.content || []).map((c) => c.text).join("");

// What the hub answers is the ONE thing each case varies, so it is a let the stub closes over.
let ANSWER = null;
global.fetch = async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ returnValue: ANSWER }),
});

const commitLinks = () =>
  sv.toolsFor({ projectCode: "skew-test", slot: "skew-tester", laneRuns: async () => [] })
    .find((t) => t.name === "commitLinks");

// THE OLD HUB'S SHAPE, copied from what Monday's build actually returned: four finding lists and
// no `crossed`. Inventing a `crossed: []` here would test the new hub twice and prove nothing.
const OLD_HUB = {
  ok: true,
  checked: 40,
  linked: 12,
  documents: 18,
  agreed: false,
  oneWay: [{ sha: "0896a75cabc", id: "a-report-id", path: ".systemview/report.x.md", subject: "a commit" }],
  dangling: [],
  unclaimed: [{ path: ".systemview/report.y.md", sha: "ef1d477c", id: "another-id" }],
  unlinked: [],
};

// ── 1 · AN OLDER HUB'S ANSWER STILL RENDERS ───────────────────────────────────────────────────
{
  ANSWER = OLD_HUB;
  const out = said(await commitLinks().handler({ projectCode: "skew-test", since: 40 }, {}));
  assert.ok(/40 commits read/.test(out), out);
  assert.ok(/ONE WAY/.test(out), "the sections the old hub DOES send are reported");
  assert.ok(/UNCLAIMED/.test(out), out);
  assert.ok(!/CROSSED/.test(out), "and the one it does not send is simply absent");
  assert.ok(!/undefined/.test(out), out);
  ok("a hub with no `crossed` renders its other findings instead of ending the whole verb");
}

// ── 2 · AND THE AGREED PATH TOO, which reads a list of its own ────────────────────────────────
// `agreed` returns early through a different branch, so it dereferenced `unlinked` on its own
// line. One guard in `say()` would have left this half still throwing.
{
  ANSWER = { ok: true, checked: 40, linked: 12, documents: 18, agreed: true };
  const out = said(await commitLinks().handler({ projectCode: "skew-test" }, {}));
  assert.ok(/the two directions agree/.test(out), out);
  assert.ok(!/undefined/.test(out), out);
  ok("...and an agreeing answer with no `unlinked` list says so instead of throwing");
}

// ── 3 · A NEWER HUB IS UNAFFECTED ─────────────────────────────────────────────────────────────
// The guard must not swallow a finding that IS sent — the failure mode of defending against the
// absent field is reporting nothing at all.
{
  ANSWER = {
    ...OLD_HUB,
    crossed: [{
      sha: "02edc313def", subject: "a crossed pair is ONE finding",
      says: "the-use-pass-found-three", carriedBy: "one-mistake-one-finding",
      path: ".systemview/report.z.md",
    }],
  };
  const out = said(await commitLinks().handler({ projectCode: "skew-test" }, {}));
  assert.ok(/CROSSED — the trailer names one document and another carries the sha \(1\)/.test(out), out);
  assert.ok(out.indexOf("CROSSED") < out.indexOf("ONE WAY"), "and it is still reported FIRST");
  ok("a hub that does send `crossed` still reports it, first, with its count");
}

// ── 4 · THE SAME CLASS, SWEPT — three more renderers that read a list off the hub ─────────────
// Found by sweeping every `r.<field>.length|map|join` in the file: 23 sites, 20 of them already
// inside an `Array.isArray(...)` guard, and these three bare. None of them can crash against
// TODAY's hub — every success path sends its list — which is exactly what the commitLinks site
// looked like until somebody added a field. A latent crash is the one that goes off on a restart
// nobody connected to it.
const CASES = [
  {
    what: "runProofs --dryRun with no `tests` list",
    tool: "runProofs",
    args: { projectCode: "skew-test", dryRun: true },
    answer: { ok: true, projectCode: "skew-test", dryRun: true, passed: 0, failed: 0 },
    says: /would run 0 tests/,
  },
  {
    what: "sendUpdate with no `sent` list",
    tool: "sendUpdate",
    args: { projectCode: "skew-test", path: "RFCs/RFC-1.md", summary: "it moved" },
    // This one does NOT read the hub — the shell injects the announce door — so the stub goes in
    // the identity. Same class of absence, a different supplier.
    identity: { announceUpdate: async () => ({ ok: true, path: "RFCs/RFC-1.md" }) },
    answer: null,
    says: /about RFCs\/RFC-1\.md/,
  },
  {
    what: "documents with no `documents` list",
    tool: "documents",
    args: { projectCode: "skew-test" },
    answer: { ok: true, project: "skew-test", withMembers: 0, withUpdates: 0 },
    says: /no document in skew-test has members/,
  },
];

for (const c of CASES) {
  ANSWER = c.answer;
  const t = sv
    .toolsFor({ projectCode: "skew-test", slot: "skew-tester", laneRuns: async () => [], ...(c.identity || {}) })
    .find((x) => x.name === c.tool);
  assert.ok(t, `${c.tool} is still a tool`);
  const out = said(await t.handler(c.args, {}));
  assert.ok(!/undefined/.test(out), `${c.what} → ${out}`);
  assert.ok(c.says.test(out), `${c.what} → ${out}`);
  ok(`${c.what} renders instead of ending the verb`);
}

console.log(`\n  ${n} claims — the renderer survives a hub older than the shell it answers in`);
