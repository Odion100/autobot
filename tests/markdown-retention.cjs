// RFC-076 §4.6 — the retention sweep: the one clock-written state, and every way it must refuse.
// c35 (unread never retires), c36 (the clock starts at first open), the expiry write itself, the
// permanent/undeclared silences, and the surgical leaf edit (an example leaf is never stamped).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { retireExpired, parseRetain } = require("../electron/markdown/retention.cjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-retention-"));
const D = 86400000;
const file = (name, text) => {
  const abs = path.join(tmp, name);
  fs.writeFileSync(abs, text);
  return abs;
};
const row = (id, abs, state) => ({ id, kind: "report", path: abs, state });
const absPathOf = (r) => r.path;

test("parseRetain: windows parse, permanent and junk mean no clock", () => {
  assert.strictEqual(parseRetain("14d"), 14 * D);
  assert.strictEqual(parseRetain("permanent"), null);
  assert.strictEqual(parseRetain(""), null);
  assert.strictEqual(parseRetain("fortnight"), null);
});

test("an expired, read report gets retired= retiredAs=expired written into its leaf", () => {
  const abs = file("r1.md", "::report{id=r1 as=notice retain=3d}\n\nbody\n");
  const now = 1000000 + 9 * D;
  const done = retireExpired([row("r1", abs, { retain: "3d" })], {
    now,
    absPathOf,
    opened: { r1: 1000000 },
  });
  assert.deepStrictEqual(done, ["r1"]);
  const text = fs.readFileSync(abs, "utf8");
  assert.match(text, /::report\{id=r1 as=notice retain=3d retired=\d{4}-\d{2}-\d{2} retiredAs=expired\}/);
});

test("unread never retires — the report is still owed to its reader (c35)", () => {
  const abs = file("r2.md", "::report{id=r2 as=notice retain=3d}\n");
  const done = retireExpired([row("r2", abs, { retain: "3d" })], { now: Date.now(), absPathOf, opened: {} });
  assert.deepStrictEqual(done, []);
  assert.doesNotMatch(fs.readFileSync(abs, "utf8"), /retired=/);
});

test("the clock counts from first open, not filing — the anchors DISCRIMINATE (c36)", () => {
  // filed 100 days ago, opened 5 days ago, window 14d: file-time anchoring would retire this
  // (100d > 14d); open-time anchoring waits. It waits — and `at` (filing) is not even an input
  // the sweep reads, which is the structural half of the same fact.
  const abs = file("r3.md", "::report{id=r3 as=notice retain=14d}\n");
  const now = 1000000 + 100 * D;
  const ancient = { id: "r3", kind: "report", path: abs, at: 1000000, state: { retain: "14d" } };
  const waits = retireExpired([ancient], { now, absPathOf, opened: { r3: now - 5 * D } });
  assert.deepStrictEqual(waits, [], "100 days since filing, 5 since first open — open anchors, so it waits");
  // and the mirror: filed five minutes ago but FIRST OPENED 20 days ago (a re-registration) —
  // open-time anchoring retires it even though filing is fresh
  const fresh = { id: "r3", kind: "report", path: abs, at: now - 1, state: { retain: "14d" } };
  const fires = retireExpired([fresh], { now, absPathOf, opened: { r3: now - 20 * D } });
  assert.deepStrictEqual(fires, ["r3"], "fresh filing does not shield an old first-open past its window");
});

test("permanent and undeclared windows never expire, and an already-retired row is left alone", () => {
  const perm = file("r4.md", "::report{id=r4 as=account retain=permanent}\n");
  const bare = file("r5.md", "::report{id=r5 as=notice}\n");
  const done = retireExpired(
    [
      row("r4", perm, { retain: "permanent" }),
      row("r5", bare, {}),
      row("r6", perm, { retain: "3d", retired: true }),
    ],
    { now: Date.now() + 100 * D, absPathOf, opened: { r4: 1, r5: 1, r6: 1 } }
  );
  assert.deepStrictEqual(done, []);
});

test("the edit is surgical — an example leaf without the row's id is never stamped", () => {
  const abs = file(
    "r7.md",
    "::report{id=some-other-example as=planning retain=1d}\n\n…and later the real one:\n\n::report{id=r7 as=notice retain=1d}\n"
  );
  const done = retireExpired([row("r7", abs, { retain: "1d" })], {
    now: 1000000 + 9 * D,
    absPathOf,
    opened: { r7: 1000000 },
  });
  // the FIRST leaf is not r7's, so the surgical rule refuses rather than stamping the wrong line
  assert.deepStrictEqual(done, []);
  assert.doesNotMatch(fs.readFileSync(abs, "utf8"), /retired=/);
});
