// PERF.HOT — THE SHELL ANNOUNCES ITS OWN BURNING. Measured 2026-10-28: one CSS animation on one
// page held the GPU process at ~110% and a renderer at ~58% for a whole evening, the machine
// crawled through two reboots, and NOTHING said so — the human diagnosed it by feel and the agent
// by hand-run probes. The cost was real and invisible, which is exactly the class of moment the
// event vocabulary exists for: the host emits it, a hook points whoever carries it at the triage
// procedure, and "my machine feels slow" stops being the detector.
//
// Ambient on purpose (same class as page.*): it belongs to no session, fans out to hooks and
// never into anybody's feed. And the HOST samples its own processes — a page that could report
// its own performance could also lie about it.
//
// The fold is pure so the firing rule is testable without an app: a process must be hot for
// STREAK consecutive samples (transients like a build or a video seek never fire), the event
// fires ONCE as the streak crosses the line, and a per-pid cooldown keeps a long fire from
// re-announcing every sample.

const HOT_PCT = 80; // of one core — a renderer or GPU process pinned past this is paying for something
const STREAK = 3; // consecutive samples before it is a fact rather than a spike
const SAMPLE_MS = 15000; // 3 × 15s = a burn has to live ~45s to be announced
const COOLDOWN_MS = 10 * 60 * 1000; // one announcement per process per ten minutes

/** One step of the detector: previous per-pid streaks + this sample's rows → the next streaks and
 * whichever processes JUST crossed the line. Pure — the clock and the emit stay outside. */
function fold(streaks, rows, { hotPct = HOT_PCT, streak = STREAK } = {}) {
  const next = {};
  const hot = [];
  for (const r of rows) {
    const n = r.pct >= hotPct ? (streaks[r.pid] || 0) + 1 : 0;
    next[r.pid] = n;
    if (n === streak) hot.push(r); // exactly at the crossing — a longer fire does not re-announce
  }
  return { streaks: next, hot };
}

/** Start sampling. Returns a stop function. */
function start({ app, sessions, sampleMs = SAMPLE_MS, hotPct = HOT_PCT, streak = STREAK, cooldownMs = COOLDOWN_MS }) {
  let streaks = {};
  const lastFired = {};
  const t = setInterval(() => {
    let metrics = [];
    try {
      metrics = app.getAppMetrics();
    } catch {
      return;
    }
    const rows = metrics.map((m) => ({
      pid: m.pid,
      type: (m.type || "").toLowerCase() || "process",
      pct: Math.round((m.cpu && m.cpu.percentCPUUsage) || 0),
    }));
    const r = fold(streaks, rows, { hotPct, streak });
    streaks = r.streaks;
    for (const h of r.hot) {
      const now = Date.now();
      if (lastFired[h.pid] && now - lastFired[h.pid] < cooldownMs) continue;
      lastFired[h.pid] = now;
      try {
        sessions.emitAmbient({
          kind: "perf.hot",
          pct: h.pct,
          type: h.type,
          pid: h.pid,
          sustainedSec: Math.round((streak * sampleMs) / 1000),
        });
      } catch {}
    }
  }, sampleMs);
  if (t.unref) t.unref();
  return () => clearInterval(t);
}

module.exports = { fold, start, HOT_PCT, STREAK, SAMPLE_MS };
