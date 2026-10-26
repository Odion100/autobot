// smoke:markdown-parse — RFC-073 §3.1, ONE PARSER.
//
// What this pins is that the platform's parse answers exactly what the renderer's does: the same
// seven facts per directive, from the same pipeline. The fixture has all three shapes, a container
// inside a container (the case the retired regexes could not see at all), a label with a path in
// it, and attributes with quoted spaces. If `directives.js` and this ever disagree, the claim "one
// parser" is false and this file is where it shows.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parse, normalizeFences, TYPES } = require("../electron/markdown/parse.cjs");

let n = 0;
const ok = (what) => { n += 1; console.log("  ok  " + what); };

const FIXTURE = `# A plan

::members{who=buapi|systemlynx}

Look at :file[cli/stage.js#L40-70] first, then :ns[Math.add].

::rfc{id=RFC-073 arc=ARC-004}

:::approval{ask="Approve this arc?" subscribe=buapi}
What is being decided, in full.
:::

::::thread{id=t1}
:::reply{by=buapi}
The hub cannot own this one.
:::
::::
`;

const blocks = await parse(FIXTURE);

console.log("the three shapes");
{
  const kinds = blocks.map((b) => b.kind);
  assert.deepStrictEqual(Object.values(TYPES).sort(), ["container", "inline", "leaf"]);
  assert.ok(kinds.includes("inline") && kinds.includes("leaf") && kinds.includes("container"));
  ok("inline, leaf and container all come out — the regex version could only see leaves");
}

console.log("\nleaves and inlines");
{
  const members = blocks.find((b) => b.name === "members");
  assert.strictEqual(members.kind, "leaf");
  assert.strictEqual(members.attrs.who, "buapi|systemlynx");
  assert.strictEqual(members.line, 3);
  ok("::members — a leaf with its attribute and its line");

  const file = blocks.find((b) => b.name === "file");
  assert.strictEqual(file.kind, "inline");
  assert.strictEqual(file.label, "cli/stage.js#L40-70");
  ok(":file — the label is the raw bracket text, path and range intact");

  const rfc = blocks.find((b) => b.name === "rfc");
  assert.deepStrictEqual(rfc.attrs, { id: "RFC-073", arc: "ARC-004" });
  ok("::rfc — id and arc read as two attributes");
}

console.log("\ncontainers");
{
  const approval = blocks.find((b) => b.name === "approval");
  assert.strictEqual(approval.kind, "container");
  assert.strictEqual(approval.attrs.ask, "Approve this arc?");
  assert.strictEqual(approval.attrs.subscribe, "buapi");
  assert.strictEqual(approval.label, "");
  assert.strictEqual(approval.src, "What is being decided, in full.");
  assert.strictEqual(approval.line, 9);
  assert.strictEqual(approval.end, 11);
  ok(":::approval — a quoted attribute with a space survives; src is the inner text verbatim; line and end bracket the fence");

  const thread = blocks.find((b) => b.name === "thread");
  const reply = blocks.find((b) => b.name === "reply");
  assert.strictEqual(thread.kind, "container");
  assert.strictEqual(reply.kind, "container");
  assert.ok(reply.line > thread.line && reply.end < thread.end, "the reply sits inside the thread");
  assert.ok(thread.src.includes(":::reply{by=buapi}"), "the thread's inner source still contains the reply's fence");
  assert.strictEqual(reply.src, "The hub cannot own this one.");
  ok("a container inside a container — both seen, nesting preserved, inner source of each is its own");
}

console.log("\nthe container claim — RFC-075, a leaf grown a body");
{
  // The label belongs to the OPENING LINE, exactly as a leaf's — the body is the proof, never the
  // statement. And inline code inside a label is text: the renderer keeps it, so this parse must.
  const proofed = await parse(
    ':::claim[Write `::rfc{id=X}` at the top → it renders]{id=c8 state=met by=you}\n:::cmd\ntrue\n:::\n:::\n'
  );
  const claim = proofed.find((b) => b.name === "claim");
  assert.strictEqual(claim.kind, "container");
  assert.strictEqual(claim.label, "Write ::rfc{id=X} at the top → it renders");
  assert.deepStrictEqual(claim.attrs, { id: "c8", state: "met", by: "you" });
  assert.ok(proofed.find((b) => b.name === "cmd"), "the proof's cmd is its own block");
  ok(":::claim — the statement reads off the opening line, inline code kept, the proof parses as children");

  const plain = await parse(":::callout\nno label here\n:::");
  assert.strictEqual(plain[0].label, "", "a container without a bracketed label still has none");
  ok("a labelless container stays labelless — the lift only takes what the brackets held");
}

console.log("\nnothing else");
{
  assert.strictEqual(blocks.length, 7, `7 directives expected, got ${blocks.length}: ${blocks.map((b) => b.name)}`);
  assert.deepStrictEqual(await parse(""), []);
  assert.deepStrictEqual(await parse(null), []);
  ok("exactly the directives, in order; empty and null parse to nothing");
}

console.log("\nnormalizeFences — the platform owns the write rule too");
{
  const shallow = ":::col\n:::thread{id=t1}\nhi\n:::\n:::\n";
  const fixed = normalizeFences(shallow);
  assert.strictEqual(fixed.split("\n")[0], "::::col", "the outer fence widened to 4");
  assert.strictEqual(fixed.split("\n")[1], ":::thread{id=t1}", "the inner stays 3");
  assert.strictEqual(fixed.split("\n")[4], "::::", "the outer close matches its open");
  ok("an outer container is rebuilt longer than everything inside it");

  const unbalanced = ":::col\n:::thread\nhi\n:::\n";
  assert.strictEqual(normalizeFences(unbalanced), unbalanced);
  ok("an unbalanced document comes back untouched — no guessing at repair");

  const code = "```md\n:::example\n```\n:::callout\nx\n:::\n";
  assert.strictEqual(normalizeFences(code), code);
  ok("fences inside a code block are examples, not structure");
}

console.log(`\n${n} claims held — the platform's parse`);
