// smoke:show — THE SHOW TOOL, through the real handler out of `toolsFor`.
//
// WHY THIS FILE EXISTS. `show` is the only verb that stamps a run's report pointer, and it was also
// the only verb that takes his screen. So a job doing the considerate thing — filing its account
// without interrupting him — left its own card reading "finished · no report" while the document
// sat on disk. His report, 2026-10-14: *"the fucking fact that it says no report."*
//
// WHAT THIS SUITE CAN AND CANNOT CLAIM. These are the TOOL's rules: that `quiet` is declared, that
// it reaches the hub unchanged, that the run's pointer rides the FILING rather than the show, and
// that the answer tells an agent which of the two just happened. Whether the hub then skips the TV
// is the HUB's claim, and `api/index.js` exports nothing, so it has none — that gap is on his board
// and it is named here so nobody reads this file as covering it.
//
// THE HUB IS STUBBED, and it answers the shape the real one answers: `{ ok, label, path }`, plus
// `quiet: true` echoed back when it filed quietly. Inventing a field here is how a suite stays
// green while production reads something else — the lesson `tests/lanes.js` §6 paid for.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sv = require("../electron/agents/systemview.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };
const said = (r) => (r.content || []).map((c) => c.text).join("");

const calls = [];
let answer = null;
global.fetch = async (url, init) => {
  const [, mod, fn] = String(url).match(/\/([A-Za-z]+)\/([A-Za-z]+)$/) || [];
  const args = JSON.parse(init.body).__arguments;
  calls.push({ fn, args: args[0] });
  const out = fn === "show" ? answer : { ok: false, error: `no stub for ${mod}.${fn}` };
  return { ok: true, status: 200, text: async () => JSON.stringify({ returnValue: out }) };
};

const filed = [];
const show = () =>
  sv
    .toolsFor({
      projectCode: "show-test",
      slot: "show-tester",
      onReportFiled: (p) => filed.push(p),
    })
    .find((t) => t.name === "show");

// ── 1 · THE PARAMETER EXISTS, AND SAYS WHEN TO USE IT ─────────────────────────────────────────
// A flag an agent cannot see is a flag that is never passed: the description is the only place an
// unattended run learns that filing without an interruption is available at all.
{
  const t = show();
  assert.ok(t, "the show tool is in toolsFor's output");
  assert.ok(t.inputSchema && t.inputSchema.quiet, "quiet is declared on the input schema");
  assert.ok(/quiet/i.test(t.description), "and the description names it");
  assert.ok(/3am|unattended|nobody/i.test(t.description), t.description);
  ok("`quiet` is declared AND described — an unattended run can tell that filing without the TV exists");
}

// ── 2 · IT REACHES THE HUB UNCHANGED ──────────────────────────────────────────────────────────
{
  calls.length = 0;
  filed.length = 0;
  answer = { ok: true, label: "A quiet account", path: ".systemview/report.show-test.A-quiet-account.md", quiet: true };
  const out = said(await show().handler({ projectCode: "show-test", text: "# A quiet account", quiet: true }, {}));

  const sent = calls.find((c) => c.fn === "show");
  assert.ok(sent, "the hub was called");
  assert.strictEqual(sent.args.quiet, true, "quiet was passed through, not dropped");
  ok("a quiet show reaches the hub with the flag intact — a parameter the tool swallows is the version-skew bug");

  // ── 3 · AND THE RUN IS STILL STAMPED ────────────────────────────────────────────────────────
  // THE WHOLE POINT. The pointer rides the filing, not the display, so the considerate call and the
  // loud one leave the same record. This is the claim that would have caught the card he saw.
  assert.strictEqual(filed.length, 1, "the report pointer was stamped exactly once");
  assert.strictEqual(filed[0].path, ".systemview/report.show-test.A-quiet-account.md");
  assert.strictEqual(filed[0].label, "A quiet account");
  ok("...and the run's report pointer is stamped ANYWAY — \"finished · no report\" was the stamp riding the screen");

  // ── 4 · AND THE AGENT IS TOLD WHICH HAPPENED ────────────────────────────────────────────────
  assert.ok(/Filed as \.systemview\/report\.show-test/.test(out), out);
  assert.ok(/[Nn]ot on the TV/.test(out), out);
  ok("...and the answer says it was filed and NOT shown, so the next line to him can be honest");
}

// ── 5 · THE LOUD PATH IS UNCHANGED ────────────────────────────────────────────────────────────
// `quiet` is an opt-out, not a new default: a report that needs his attention once must still get it.
{
  calls.length = 0;
  filed.length = 0;
  answer = { ok: true, label: "Look at this", path: ".systemview/report.show-test.Look-at-this.md" };
  const out = said(await show().handler({ projectCode: "show-test", text: "# Look at this" }, {}));

  assert.strictEqual(calls.find((c) => c.fn === "show").args.quiet, undefined, "nothing was invented");
  assert.ok(/The show is up/.test(out), out);
  assert.strictEqual(filed.length, 1, "and it stamps, as it always did");
  ok("a show with no flag still goes up and still stamps — quiet is an opt-out, never the new default");
}

// ── 6 · A REFUSAL SAYS WHY ────────────────────────────────────────────────────────────────────
// It read "The show did not go up." and nothing else. The hub's refusals are specific — an
// unreadable path, a report it could not file, a missing projectCode — and all of them arrived as
// that one sentence, which is indistinguishable from the hub being down. Found 2026-10-13 by an
// agent that worked around a refusal it could not read.
{
  answer = { ok: false, error: "could not read /tmp/nope.md in show-test — no such file" };
  const out = said(await show().handler({ projectCode: "show-test", reportPath: "/tmp/nope.md" }, {}));
  assert.ok(/did not go up/.test(out), out);
  assert.ok(/no such file/.test(out), "the hub's own reason reached the agent");
  ok("a refusal carries the hub's reason — \"The show did not go up\" alone reads the same as a dead hub");
}

console.log(`\n${n} claims held — the show tool`);
