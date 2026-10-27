// ATTACHMENTS ON A RUN — RFC-072 §5 and slices 2–3.
//
// THE CLAIM BEING PROVEN: a run carries what it PRODUCED, and the unit is the LIST — not the kind
// of list. Before this, a job run got a report pointer, a lane got a branch, and a skill run got
// nothing at all: nine of his lists could show him steps and no way to reach the thing they made.
// That asymmetry lived in the record, which is why no surface could fix it.
//
// Run: node tests/attachments.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const W = require(path.join(here, "..", "electron", "agents", "worklist.cjs"));

let pass = 0,
  fail = 0;
const t = (name, cond) => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}`);
};

// A real run record on disk, in the real directory, removed at the end — the thing being tested is
// how a WRITE survives other writes, and a mock of the file layer could not show that.
const id = `test${Date.now().toString(36)}`;
const owner = W.runOwner(id);
// The filename rule lives in worklist.cjs and is NOT the obvious slug — it collapses every
// non-alphanumeric run to a dash. Guessing it wrong made this test read a file that was never
// written, which looked like the attachment had not been saved.
const file = path.join(W.DIR, `${owner.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`);
const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
const cleanup = () => {
  try {
    fs.unlinkSync(file);
  } catch {}
};

try {
  fs.mkdirSync(W.DIR, { recursive: true });
  W.writeRun(id, "sess-test", [{ id: "a", text: "a step", state: "active" }], "skill:test-only");

  console.log("\nany list carries one — including a plain skill run");
  const a = W.attach(id, { kind: "report", ref: "the landing order", by: "skill:test-only" });
  t("attaching to a SKILL run works — the unit is the list, not the kind", a && a.kind === "report");
  t("it is on the record", (read().attachments || []).length === 1);

  console.log("\nthe address, never the path");
  const arc = W.attach(id, { kind: "arc", ref: "ARC-004-O2", project: "systemview-test" });
  t("an arc attachment stores the objective address", arc.ref === "ARC-004-O2");
  t("and the repo it lives in, which a derived path cannot survive", arc.project === "systemview-test");

  console.log("\nit refuses what it cannot resolve");
  t("an unknown kind is refused and names the kinds", !!W.attach(id, { kind: "wat", ref: "x" }).error);
  t("an empty ref is refused — an attachment with no address points nowhere", !!W.attach(id, { kind: "report", ref: "  " }).error);
  t("a run that does not exist is refused", !!W.attach("nosuchrun", { kind: "report", ref: "x" }).error);

  console.log("\nattaching the same thing twice is one attachment, re-stamped");
  const before = read().attachments.length;
  W.attach(id, { kind: "report", ref: "the landing order", by: "again" });
  t("the list did not grow", read().attachments.length === before);
  t("but the stamp moved to the latest attacher", read().attachments.find((x) => x.kind === "report").by === "again");

  console.log("\nan attachment can be taken off");
  const hadCount = read().attachments.length;
  const d = W.removeAttachment(id, { kind: "report", ref: "the landing order" });
  t("removing hands back what went", !!d.removed && d.removed.ref === "the landing order");
  t("and the entry is GONE, not stamped", read().attachments.length === hadCount - 1);
  // A MISTAKE IS A TYPO IN THE RECORD, NOT AN EVENT IN THE WORLD. The first build kept a
  // `detached` stamp on the argument that omitting is lying — but a stamp on an attachment that
  // was never true asserts a relationship nobody ever claimed, which is the worse lie.
  t("nothing is left behind saying it was once attached",
    !read().attachments.some((x) => x.ref === "the landing order"));
  t("removing something never attached says so", !!W.removeAttachment(id, { kind: "report", ref: "never" }).error);

  console.log("\nit survives writes that know nothing about it");
  // EVERY KEY A WRITER DOES NOT OWN IS CARRIED BY HAND, and one forgotten there is silently
  // destroyed by the next unrelated write — the lesson the whiteboard already taught this file.
  W.write(owner, [{ id: "a", text: "a step", state: "done" }]);
  // One, not two: the report was REMOVED above and removal actually removes. The arc remains.
  t("a plain list write does not clobber the attachments", (read().attachments || []).length === 1);

  console.log("\nbackward compatible — a run written before this reads as none");
  const legacy = { owner: "run:old", items: [], source: "lane:lane/some-branch" };
  const derived = W.attachmentsOf(legacy);
  t("no attachments key reads as no attachments, not as a crash", Array.isArray(derived));
  // The lane branch WAS a field; it is a kind now, read forward rather than migrated.
  t("a lane's branch is read forward as a branch attachment", derived.some((x) => x.kind === "branch" && x.ref === "lane/some-branch"));
  t("and it is marked derived, so nothing mistakes it for a stored one", derived.find((x) => x.kind === "branch").derived === true);
  t("a run with neither reads as empty", W.attachmentsOf({ owner: "run:x", items: [] }).length === 0);

  console.log("\nthe tool");
  const tools = W.toolsFor(() => {}, () => [], null, () => "", () => ({ id, source: "skill:test-only" }));
  t("attach is one of the worklist tools", W.TOOL_NAMES.includes("mcp__worklist__attach"));
  // BY NAME, NOT BY COUNT. This read `tools.length === 4` and went red the day `status` was added —
  // a true failure about nothing, while the thing worth asserting (every door is actually served)
  // was never asserted at all. A count tells you the number changed; a name tells you which door
  // went missing, which is the only one of the two anybody can act on.
  // `TOOL_NAMES` carries the MCP-prefixed names the harness registers; a served tool carries the
  // bare verb. Comparing the two lists directly is how this assertion would pass for the wrong
  // reason — so the prefix comes off first, and then the two must agree exactly.
  const served = tools.map((x) => x.name);
  const declared = W.TOOL_NAMES.map((n) => n.replace(/^mcp__worklist__/, ""));
  t(
    "every named worklist tool is actually served",
    declared.every((n) => served.includes(n)) && served.length === declared.length,
  );
  t("and status is one of them", served.includes("status"));
} finally {
  cleanup();
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
