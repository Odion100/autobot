// smoke:board — THE BOARD TOOL, through the real handler out of `toolsFor`.
//
// WHY THIS FILE EXISTS. The board is the only surface he reads between sessions, and its card count
// is the only thing it promises: everything on it is outstanding. That promise is kept by agents
// DELETING cards, and the thing that was missing is the account — one line saying what was done, so
// a deletion needs no re-read. His ask, 2026-10-16: *"it could be saying implemented, it could tell
// me what you did in one status, and whether it's done. Then I could come, see what it is and delete
// all of them."*
//
// WHAT THIS SUITE CAN AND CANNOT CLAIM. These are the TOOL's rules: that `status` and `removeSettled`
// are declared, that the description teaches what a status is FOR (an undescribed parameter is a
// parameter no agent passes), and that both reach the hub unchanged. Whether the hub then writes one
// slot, replaces it, or clears it on an empty string is the HUB's claim and it has its own suite —
// systemview `api/board.test.js`, 17 claims. Nothing here covers the panel.
//
// THE HUB IS STUBBED and answers the shape the real one answers. Inventing a field here is how a
// suite stays green while production reads something else — the lesson `tests/lanes.js` §6 paid for.
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
  const out = fn === "board" ? answer : { ok: false, error: `no stub for ${mod}.${fn}` };
  return { ok: true, status: 200, text: async () => JSON.stringify({ returnValue: out }) };
};

const board = () =>
  sv.toolsFor({ projectCode: "board-test", slot: "board-tester" }).find((t) => t.name === "board");

// ── 1 · BOTH PARAMETERS EXIST, AND THE DESCRIPTION SAYS WHAT THEY ARE FOR ─────────────────────
// An agent only ever learns a parameter from the description — and for this one, learning it exists
// is not enough: a status that reads as a lifecycle state ("done") invites PARKING cards, which is
// the exact opposite of the rule the board runs on.
{
  const t = board();
  assert.ok(t, "the board tool is in toolsFor's output");
  assert.ok(t.inputSchema && t.inputSchema.status, "status is declared on the input schema");
  assert.ok(t.inputSchema.removeSettled, "removeSettled is declared on the input schema");
  assert.ok(/status/i.test(t.description), "and the description names it");
  assert.ok(/delete|remov/i.test(t.description), "...and still says cards get deleted");
  ok("`status` and `removeSettled` are declared AND described — an undescribed parameter is one nobody passes");
}

// ── 2 · A STATUS REACHES THE HUB UNCHANGED, WITH THE CARD IT BELONGS TO ───────────────────────
{
  calls.length = 0;
  answer = { ok: true, card: 1792153875664, status: "implemented — reports are a band tab now", settled: 1 };
  const out = said(
    await board().handler(
      { projectCode: "board-test", at: 1792153875664, status: "implemented — reports are a band tab now" },
      {},
    ),
  );
  const sent = calls.find((c) => c.fn === "board");
  assert.ok(sent, "the hub was called");
  assert.strictEqual(sent.args.status, "implemented — reports are a band tab now", "the account was passed through, not dropped");
  assert.strictEqual(sent.args.at, 1792153875664, "...on the card it was aimed at");
  assert.strictEqual(sent.args.as, "board-tester", "...signed by the caller, like every write here");
  assert.ok(/implemented/.test(out), out);
  ok("a status reaches the hub with its card and its signature intact — a parameter the tool swallows is the version-skew bug");
}

// ── 3 · AN EMPTY STATUS IS A REAL VALUE, NOT A MISSING ONE ───────────────────────────────────
// Clearing is how a wrong account comes off without taking the card with it, so the empty string
// must survive the trip. A tool that treats "" as absent makes that impossible to express.
{
  calls.length = 0;
  answer = { ok: true, card: 1000, status: null };
  await board().handler({ projectCode: "board-test", at: 1000, status: "" }, {});
  assert.strictEqual(calls.find((c) => c.fn === "board").args.status, "", "the empty string reached the hub");
  ok("an empty status survives the trip — it is the only way to take a wrong account off a card you are keeping");
}

// ── 4 · CLEARING THE SETTLED ONES GOES THROUGH, AND THE ANSWER SAYS WHAT WENT ────────────────
{
  calls.length = 0;
  answer = {
    ok: true,
    removed: 2,
    open: 24,
    cleared: [
      { ts: 1000, status: "implemented", text: "the first ask" },
      { ts: 2000, status: "answered — in the gap file", text: "the second ask" },
    ],
  };
  const out = said(await board().handler({ projectCode: "board-test", removeSettled: true }, {}));
  assert.strictEqual(calls.find((c) => c.fn === "board").args.removeSettled, true, "the flag reached the hub");
  // The texts come back because this is a BATCH deletion — the one place a single returned card
  // would hide the others.
  assert.ok(/the first ask/.test(out) && /the second ask/.test(out), out);
  ok("removeSettled reaches the hub and the answer carries every cleared text — a batch deletion must not be the last place those words existed");
}

// ── 5 · NOTHING SETTLED IS NOT A FAILURE ─────────────────────────────────────────────────────
// "removed: 0" and "it broke" must not look the same to the agent that pressed it.
{
  answer = { ok: true, removed: 0, open: 26, cleared: [] };
  const out = said(await board().handler({ projectCode: "board-test", removeSettled: true }, {}));
  assert.ok(/0|nothing/i.test(out), out);
  assert.ok(!/fail/i.test(out), out);
  ok("nothing settled answers removed: 0 rather than reading as a failure");
}

// ── 6 · A REFUSAL CARRIES THE HUB'S OWN REASON ───────────────────────────────────────────────
{
  answer = { ok: false, error: 'no card with id "999" — a status will not take a POSITION' };
  const out = said(await board().handler({ projectCode: "board-test", at: 999, status: "implemented" }, {}));
  assert.ok(/POSITION/.test(out), "the hub's own reason reached the agent");
  ok("a refusal arrives whole — an agent that cannot read why will aim the same wrong id again");
}

console.log(`\n  ${n} claims, all green — the board tool's contract\n`);
