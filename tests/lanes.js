// smoke:lanes — the LANE VERB, through the real tool handler.
//
// WHY THIS FILE EXISTS. These verbs decide two things nothing else can undo: whether work that may
// exist nowhere else gets deleted, and whether the row in his strip tells the truth about where that
// work landed. Both shipped with zero claims on them, because `serverFor` handed its tools straight
// to the SDK and nothing on this side could hold a handler. `toolsFor` is that door (2026-10-09).
//
// THE HUB IS STUBBED, deliberately and narrowly: these claims are about the TOOL's rules — what it
// refuses, what it insists on saying, what it records in the same call — not about git. The hub's own
// behaviour is the hub's suite. What is NOT stubbed is the registration read, because "is this branch
// a lane" is the rule under test.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sv = require("../electron/agents/systemview.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };
const said = (r) => (r.content || []).map((c) => c.text).join("");

// The hub, answering as it does for a project with two lane branches — one registered, one not.
const HUB = {
  lanes: () => ({
    ok: true,
    projectCode: "lanes-test",
    lanes: [
      { branch: "lane/alpha", verdict: "in", committed: false, matching: 3, total: 3, broughtIn: null, status: null },
      { branch: "lane/stray", verdict: "unknown", committed: false, matching: 0, total: 2, broughtIn: null, status: null },
    ],
    notIn: 0,
  }),
  // THE REAL SHAPE, and this line is the whole reason section 6 exists. `gitState` returns no
  // `head` and no `sha` — those were invented by this stub, and inventing them is what let the
  // receipt record a branch name in production while this suite stayed green.
  gitState: () => ({ repo: true, ok: true, branch: "main", log: [{ sha: "abc1234", subject: "x" }] }),
  laneStatus: () => ({ ok: true }),
};
const calls = [];
const receipts = [];
global.fetch = async (url, init) => {
  const [, mod, fn] = String(url).match(/\/([A-Za-z]+)\/([A-Za-z]+)$/) || [];
  const args = JSON.parse(init.body).__arguments;
  calls.push({ fn, args });
  const answer = HUB[fn] ? HUB[fn](...args) : { ok: false, error: `no stub for ${mod}.${fn}` };
  // THE ENVELOPE IS PART OF THE CONTRACT. `hub()` returns `body.returnValue`, so a stub answering
  // the bare object answers `undefined` and every claim below reads "the hub said no" — which is
  // the shape of a test that passes for the wrong reason, or in this case fails for one.
  return { ok: true, status: 200, text: async () => JSON.stringify({ returnValue: answer }) };
};

const lanes = (identity = {}) =>
  sv.toolsFor({
    projectCode: "lanes-test",
    slot: "lanes-tester",
    // REGISTRATION IS THE RULE UNDER TEST, so this is the one door left real in shape: a list of
    // the branches that have a run written against them.
    laneRuns: async () => ["lane/alpha"],
    onLaneBroughtIn: (branch, opts) => { receipts.push({ branch, ...opts }); return { ts: Date.now(), branch, ...opts }; },
    ...identity,
  }).find((t) => t.name === "lanes");

// ── 1 · A BRANCH IS NOT A LANE UNTIL IT IS REGISTERED ─────────────────────────────────────────
{
  const out = said(await lanes().handler({ projectCode: "lanes-test" }, {}));
  assert.ok(/1 lane standing/.test(out), out);
  assert.ok(/lane\/alpha/.test(out), "the registered one is listed as a lane");
  ok("only REGISTERED branches are lanes — the verb read git and his strip read run records, and they disagreed");

  // NAMED, NOT HIDDEN. A branch holding real work that no door mentions is the worse half of the
  // same bug the filter fixes.
  assert.ok(/not registered: lane\/stray/.test(out), out);
  assert.ok(/source "lane:<branch>"/.test(out), "and it says the one call that makes it a lane");
  ok("...and an unregistered lane/* branch is NAMED with the call that would register it");
}

// ── 2 · BRINGING ONE IN REQUIRES SAYING WHAT HAPPENED ─────────────────────────────────────────
// His ask, 2026-10-09. The alternative is a row reading "(nobody has said) · files say: in ·
// committed" — where the only voice is a derivation that has been wrong in both directions.
{
  calls.length = 0;
  const bare = said(await lanes().handler({ projectCode: "lanes-test", broughtIn: "lane/alpha" }, {}));
  assert.ok(/not recorded/.test(bare), bare);
  assert.ok(/Say what happened, in your own words/.test(bare), bare);
  assert.ok(!calls.some((c) => c.fn === "laneStatus"), "and nothing was written");
  ok("a bring-in with nothing said is REFUSED, and records neither receipt nor note");

  calls.length = 0;
  const both = said(
    await lanes().handler(
      { projectCode: "lanes-test", broughtIn: "lane/alpha", status: "brought in as changes, suite green", tone: "ok" },
      {},
    ),
  );
  assert.ok(/recorded: lane\/alpha brought in at abc1234/.test(both), both);
  assert.ok(/you said: "brought in as changes, suite green"/.test(both), both);
  assert.ok(calls.some((c) => c.fn === "laneStatus"), "the statement reached the hub");
  ok("...and ONE call records the receipt and sets the headline — they used to be two, and the second never ran");
}

// ── 3 · THE BUG THAT MADE THEM TWO CALLS ──────────────────────────────────────────────────────
// `status` returned before `broughtIn` was read, so the single most natural call at the moment work
// lands — both together — set the headline and silently recorded no receipt.
{
  calls.length = 0;
  await lanes().handler(
    { projectCode: "lanes-test", broughtIn: "lane/alpha", status: "in, committed", tone: "ok" },
    {},
  );
  assert.ok(calls.some((c) => c.fn === "gitState"),
    "the receipt path ran — gitState is only read when a bring-in is being recorded");
  ok("passing both no longer short-circuits the receipt — the base is read and stamped");
}

// ── 4 · A STATUS HAS ITS OWN BRANCH NOW ───────────────────────────────────────────────────────
// It used to borrow `broughtIn`, which MEANS "I applied this" — so saying "waiting on your review"
// required passing the field that claims the opposite.
{
  calls.length = 0;
  const spoken = said(
    await lanes().handler(
      { projectCode: "lanes-test", branch: "lane/alpha", status: "waiting on your review — NOT landed", tone: "warn" },
      {},
    ),
  );
  assert.ok(/waiting on your review/.test(spoken), spoken);
  assert.ok(!calls.some((c) => c.fn === "gitState"),
    "and no bring-in was recorded — speaking about a lane is not claiming to have applied it");
  ok("`branch` says which lane a statement is about, without claiming the bring-in that `broughtIn` means");

  const nameless = said(await lanes().handler({ projectCode: "lanes-test", status: "something" }, {}));
  assert.ok(/a status is about a lane/.test(nameless), nameless);
  ok("a statement with no lane named is refused, and the standing lanes are listed");

  const wrong = said(await lanes().handler({ projectCode: "lanes-test", branch: "lane/nope", status: "x" }, {}));
  assert.ok(/no lane on lane\/nope/.test(wrong), wrong);
  ok("a statement about a branch that is not a lane is named as such, never a silent no-op");
}

// ── 5 · A FAILED REGISTRATION READ IS NOT AN EMPTY ONE ────────────────────────────────────────
// If the registrations cannot be read, every lane reads unregistered and the list comes back empty.
// That is a false absence about work, which is the one failure this surface exists to prevent.
{
  const blind = said(
    await lanes({ laneRuns: async () => { throw new Error("no host door"); } }).handler(
      { projectCode: "lanes-test" },
      {},
    ),
  );
  assert.ok(/2 lanes standing/.test(blind), blind);
  ok("when registrations cannot be read, every branch is reported rather than none — never a false absence");
}

// ── 6 · THE BASE ON A RECEIPT MUST BE A COMMIT ────────────────────────────────────────────────
// Found 2026-10-10 by stamping a receipt and reading the run file. Every receipt on disk recorded
// `base: "ElementLocator"` / `base: "main"` — a BRANCH NAME, because `gitState` returns neither
// `head` nor `sha` and the chain fell through to `g.branch`. The base exists so a stale receipt is
// still checkable; a name that moves cannot do that, and it reads verifiable while being worthless.
{
  receipts.length = 0;
  const out = said(
    await lanes().handler(
      { projectCode: "lanes-test", broughtIn: "lane/alpha", status: "in, suite green", tone: "ok" },
      {},
    ),
  );
  assert.equal(receipts.length, 1, "one receipt");
  assert.equal(receipts[0].base, "abc1234", `the base is the COMMIT, not the branch — got ${receipts[0].base}`);
  assert.ok(!/brought in at main/.test(out), out);
  ok("the base recorded is a COMMIT read off the log, never the branch name the hub actually returns");

  assert.ok(/on main/.test(out), out);
  ok("...and the branch it landed on is named too, beside the commit rather than instead of it");
}

// A hub that cannot name a commit must produce NO base — and SAY so. An empty base reads
// "unverifiable"; `main` claims to be checkable and is not, which is the worse of the two.
{
  receipts.length = 0;
  const realGitState = HUB.gitState;
  HUB.gitState = () => ({ repo: true, ok: true, branch: "main", log: [] });
  const blind = said(
    await lanes().handler({ projectCode: "lanes-test", broughtIn: "lane/alpha", status: "in", tone: "ok" }, {}),
  );
  HUB.gitState = realGitState;
  assert.equal(receipts[0].base, "", `no commit readable means NO base — got ${JSON.stringify(receipts[0].base)}`);
  assert.ok(/NO BASE RECORDED/.test(blind), blind);
  ok("a hub that cannot name a commit records no base AND says the receipt is a date and nothing more");
}

// ---------------------------------------------------------------------------------------------
// A LANE'S BRANCH MAY LIVE IN A COUPLED REPO (2026-10-13). Registration ran `git rev-parse`
// against the session's cwd and nothing else, so a branch cut in autobot could not be registered
// from a systemview session — and the refusal it printed told the agent to cut a branch it had
// already cut. A proactive run died on exactly that. These claims are about `repoHolding`, the
// resolution that replaced it: real git, real registry, because "where does this branch live" is
// the rule under test and stubbing it would test nothing.
{
  const sessions = require("../electron/agents/sessions.cjs");
  const { execFileSync } = require("node:child_process");
  const fsx = require("node:fs");
  const pathx = require("node:path");
  const osx = require("node:os");

  const here = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const mine = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: here, encoding: "utf8" }).trim();

  assert.equal(sessions.repoHolding(mine, here), here);
  ok("the session's own folder is tried first and wins when it holds the branch");

  assert.equal(sessions.repoHolding("lane/nobody-ever-cut-this", here), null);
  ok("a branch that exists nowhere still resolves to nothing — the refusal still refuses");

  assert.equal(sessions.repoHolding("", here), null);
  assert.equal(sessions.repoHolding(null, here), null);
  ok("an empty or missing branch name is not a lookup, it is a null");

  // THE CASE THAT WAS IMPOSSIBLE. Read the registry the way the resolution does and pick any root
  // that is NOT the cwd — then its own current branch must be found from here. Self-configuring on
  // purpose: hard-coding a repo would make this claim a fact about one machine.
  // A WORKTREE SHARES ITS PARENT'S REFS, which is what made the first version of this claim wrong:
  // autobot's own branch resolved to this worktree, correctly. So the candidate must be a branch
  // genuinely INVISIBLE from here — checked with git directly rather than through the code under test.
  const visibleHere = (b) => {
    try {
      return execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`], { cwd: here, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
    } catch { return false; }
  };
  let other = null;
  try {
    const map = JSON.parse(fsx.readFileSync(pathx.join(osx.homedir(), ".autobot", "projects.json"), "utf8"));
    for (const dir of Object.values(map)) {
      if (typeof dir !== "string" || dir === here || !fsx.existsSync(pathx.join(dir, ".git"))) continue;
      try {
        const b = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
        if (!b || b === "HEAD" || visibleHere(b)) continue;
        other = { dir, b };
        break;
      } catch { /* not a readable repo — not this claim's business */ }
    }
  } catch { /* no registry on this machine */ }

  if (other) {
    assert.equal(sessions.repoHolding(other.b, here), other.dir);
    ok(`a branch living only in a COUPLED repo resolves to that repo (${other.b} -> ${other.dir})`);
  } else {
    ok("no second registry repo on this machine — the coupled-repo claim had nothing to assert against");
  }
}

{
  // A RECEIPT SAYS HOW THE WORK CAME IN. A merge puts the commits into history; an apply-as-changes
  // leaves them uncommitted in his tree — so "is my tree the only copy of this" has two different
  // answers and the receipt recorded both identically. This is the half that decides it.
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autobot-howrcpt-"));
  process.env.AUTOBOT_WORKLISTS_DIR = dir;
  delete require.cache[require.resolve("../electron/agents/worklist.cjs")];
  const wl = require("../electron/agents/worklist.cjs");

  wl.writeRun("h1", "session:sv:1", [{ text: "a", state: "done" }], "lane:lane/x");
  assert.strictEqual(wl.markBroughtIn("h1", { base: "abc123", how: "merge" }).how, "merge");
  assert.strictEqual(wl.markBroughtIn("h1", { base: "abc123", how: "changes" }).how, "changes");

  // AN UNRECOGNISED VALUE BECOMES UNKNOWN rather than being stored — otherwise each surface invents
  // its own synonyms and one fact ends up with three spellings.
  assert.strictEqual(wl.markBroughtIn("h1", { how: "merged" }).how, "");
  assert.strictEqual(wl.markBroughtIn("h1", { how: "applied" }).how, "");
  assert.strictEqual(wl.markBroughtIn("h1", {}).how, "");
  assert.deepStrictEqual(wl.HOW, ["merge", "changes"]);

  // IT RIDES THE ROW, or no surface can say it.
  wl.markBroughtIn("h1", { base: "abc123", how: "changes" });
  const row = wl.all().find((r) => r.owner === "run:h1");
  assert.strictEqual(row.broughtIn.how, "changes");

  // AND IT SURVIVES A WRITE THAT KNOWS NOTHING ABOUT IT — `save()` carries only the keys it names,
  // and `broughtIn` was already in that list, so the whole object rides along. Pinned because the
  // next field added to a receipt will not be.
  wl.markStatus("h1", { text: "waiting on review" });
  assert.strictEqual(wl.all().find((r) => r.owner === "run:h1").broughtIn.how, "changes");

  fs.rmSync(dir, { recursive: true, force: true });
  ok("a receipt records HOW the work came in — merge or changes, unknown when nobody said, and it survives an unrelated write");
}

console.log(`\n${n} claims held — the lane verb`);
