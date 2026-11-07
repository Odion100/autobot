// smoke:text-blocks — ADJACENT TEXT BLOCKS ARE ONE UTTERANCE.
//
// A long reply streams as several content blocks whose boundary lands at a token, mid-word.
// Settled one event per block, the feed drew one markdown island per block, and a ::cue line
// straddling the boundary rendered as two raw halves (four beats died mid-tour, 2026-11-06).
// The transcript reader runs through the same seam, so old transcripts render whole too.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sessions = require("../electron/agents/sessions.cjs");

let n = 0;
const ok = (w) => { n += 1; console.log("  ok  " + w); };

// A fixture transcript: one assistant message whose cue line is split across two text blocks,
// with a tool_use between later texts to prove order survives.
// The reader resolves ~/.claude/projects/<cwd with slashes dashed>/<id>.jsonl, so the fixture is
// written where it actually looks — under a temp CWD of our own, never a real session's folder.
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "textblocks-"));
const dir = path.join(os.homedir(), ".claude", "projects", cwd.replace(/\//g, "-"));
fs.mkdirSync(dir, { recursive: true });
const sid = `textblocks-${process.pid}`;
const file = path.join(dir, `${sid}.jsonl`);
const rec = (o) => JSON.stringify(o);
fs.writeFileSync(file, [
  rec({ type: "assistant", message: { id: "m1", model: "claude-x", content: [
    { type: "text", text: 'before\n\n::cue{at=".hww-ct' },
    { type: "text", text: 'x__card" say="the card"}\n\nafter' },
    { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
    { type: "text", text: "and then a second utterance" },
  ] } }),
].join("\n"));

const msgs = sessions.transcriptMessages(cwd, sid);
const texts = msgs.filter((m) => m.kind === "assistant.text");
assert.equal(texts.length, 2, "adjacent blocks coalesce; the post-tool text stays its own");
ok("two adjacent text blocks settle as ONE event");
assert.equal(texts[0].text, 'before\n\n::cue{at=".hww-ctx__card" say="the card"}\n\nafter');
ok("the cue line split at a token boundary comes back whole");
assert.equal(texts[1].text, "and then a second utterance");
ok("a text block after a tool_use keeps its own event — order preserved");
const kinds = msgs.map((m) => m.kind).filter((k) => k === "assistant.text" || k === "tool.call");
assert.deepEqual(kinds, ["assistant.text", "tool.call", "assistant.text"]);
ok("the tool call still sits between the two utterances");

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(cwd, { recursive: true, force: true });
console.log(`\n${n} claims, all green — adjacent text blocks are one utterance`);
