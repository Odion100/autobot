// The claim, as a test instead of an argument (systemview-test's discipline, and
// my own corollary turned back on me: "we happen to be immune" is a fact that
// rots — write the test that says WHY, not WHICH).
//
// THE CLAIM: nothing that can reach the panel's one-line COOKING status is
// unbounded. Our structure earns this by giving each consumer its own field —
// tool.call ships `summary` (a bounded LABEL) and `input` (the whole RECORD) —
// so a flood in the record can never widen the label. This floods every input
// field of every tool name, including ones nobody has written yet, and asserts
// the label holds its bound.
//
// Run: npm run smoke:status
// ESM per the project rule (package.json "type": "module") — createRequire is how
// an ES module loads the .cjs substrate, which is .cjs because Electron needs it so.
import assert from "node:assert";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { toolSummary } = require("../electron/agents/sessions.cjs");

const BOUND = 120; // generous: the implementation clamps to 70
const FLOOD = "x".repeat(5000);
const PARAGRAPH = ("a long agent-written narration that keeps going. ").repeat(200);

// every tool the summariser names, plus ones it has never seen
const TOOLS = [
  "Bash", "Edit", "Write", "NotebookEdit", "Read", "Grep", "Glob", "WebFetch",
  "WebSearch", "TodoWrite", "Task", "Agent",
  "mcp__systemview__say", "SomeToolInventedNextYear", "", undefined,
];
// every field name any branch reads, all flooded at once, so a new branch
// reaching for a new field is covered before it is written
const FLOODED_INPUT = {
  description: PARAGRAPH, command: FLOOD, file_path: FLOOD, notebook_path: FLOOD,
  pattern: FLOOD, url: FLOOD, query: FLOOD, prompt: FLOOD, content: FLOOD,
  title: FLOOD, text: FLOOD, message: FLOOD,
};

let checked = 0;
for (const tool of TOOLS) {
  for (const input of [FLOODED_INPUT, {}, undefined]) {
    const out = toolSummary(tool, input);
    assert.strictEqual(typeof out, "string", `${tool}: summary must be a string`);
    assert.ok(
      out.length <= BOUND,
      `UNBOUNDED STATUS: toolSummary(${JSON.stringify(tool)}) returned ${out.length} chars ` +
      `(bound ${BOUND}). A flood reached the one-line cooking status — the label and the ` +
      `record have started sharing a field again.`
    );
    assert.ok(!out.includes("\n"), `${tool}: a status is ONE line`);
    checked++;
  }
}
console.log(`status-bound: ok — ${checked} label/flood combinations, all <= ${BOUND} chars, single-line`);
