// smoke:perf — THE BURN DETECTOR'S FIRING RULE, pinned.
//
// perf.hot exists because a CSS animation held the GPU at ~110% for an evening and nothing said so
// (2026-10-28). What this pins is the rule that keeps the event trustworthy: a spike never fires,
// a sustained burn fires EXACTLY ONCE as it crosses the streak line, and cooling resets the count.
// The fold is pure — no clock, no emit — so the whole contract runs here without an app.
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { fold, STREAK } = require("../electron/agents/perf.cjs");

let n = 0;
const claim = (name, fn) => {
  n += 1;
  try {
    fn();
    console.log(`  c${n} ✓ ${name}`);
  } catch (e) {
    console.error(`  c${n} ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
};

const gpu = (pct) => ({ pid: 100, type: "gpu-process", pct });

claim("a single hot sample is a spike, not an event", () => {
  const r = fold({}, [gpu(120)]);
  assert.equal(r.hot.length, 0);
  assert.equal(r.streaks[100], 1);
});

claim(`${STREAK} consecutive hot samples fire exactly once, at the crossing`, () => {
  let streaks = {};
  const fired = [];
  for (let i = 0; i < STREAK + 3; i += 1) {
    const r = fold(streaks, [gpu(110)]);
    streaks = r.streaks;
    fired.push(...r.hot);
  }
  assert.equal(fired.length, 1); // a longer fire does not re-announce — that is the cooldown's job
  assert.equal(fired[0].pid, 100);
});

claim("cooling off resets the streak — the next burn must earn the line again", () => {
  let streaks = {};
  for (let i = 0; i < STREAK - 1; i += 1) streaks = fold(streaks, [gpu(110)]).streaks;
  streaks = fold(streaks, [gpu(5)]).streaks; // one quiet sample
  assert.equal(streaks[100], 0);
  let fired = [];
  for (let i = 0; i < STREAK; i += 1) {
    const r = fold(streaks, [gpu(110)]);
    streaks = r.streaks;
    fired.push(...r.hot);
  }
  assert.equal(fired.length, 1);
});

claim("processes are independent — one burning never carries another across", () => {
  let streaks = {};
  let fired = [];
  for (let i = 0; i < STREAK; i += 1) {
    const r = fold(streaks, [gpu(110), { pid: 200, type: "renderer", pct: 12 }]);
    streaks = r.streaks;
    fired.push(...r.hot);
  }
  assert.equal(fired.length, 1);
  assert.equal(fired[0].pid, 100);
  assert.equal(streaks[200], 0);
});

claim("the threshold is a parameter — below it nothing ever fires", () => {
  let streaks = {};
  let fired = [];
  for (let i = 0; i < STREAK * 2; i += 1) {
    const r = fold(streaks, [gpu(79)]);
    streaks = r.streaks;
    fired.push(...r.hot);
  }
  assert.equal(fired.length, 0);
});

console.log(process.exitCode ? "perf: FAILED" : "perf: all claims hold");
