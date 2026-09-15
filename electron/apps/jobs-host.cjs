// THE JOB API — RFC-005 §10, the seam stated so it can be checked.
//
// *Workers holds no job state. It reads ~/.autobot/jobs and the event stream. The engine emits the
// same events whether workers is open, closed, or uninstalled. Rating writes through a job API,
// not into a workers-owned store.*
//
// This file is that API. It exists so an app can be the surface for jobs WITHOUT owning them —
// which is the difference between a consumer and a fork. Give workers `files:read` and let it
// parse ~/.autobot/jobs itself and the seam is gone on day one: it would grow its own idea of what
// a job is, and the engine would become the thing that has to keep up.
//
// AND IT IS WHY A `jobs` CAPABILITY EXISTS AT ALL. The alternative was handing workers `files:read`
// over the whole home directory to read four files. A capability that is really "read everything"
// wearing a job's name is the exemption RFC-004 §1 warns about — the first app to need something
// gets an exemption rather than a grant, and the exemption is where the contract quietly dies.
//
// THE READ/WRITE SPLIT MIRRORS `context`, and for the same reason. `jobs:read` is watching.
// `jobs:write` defines what runs unattended and what it may do — it is the surface that, misused,
// runs something at 3am with nobody watching. A surface that shows jobs does not need it.
const { ipcMain } = require("electron");
const jobs = require("../agents/jobs.cjs");
const pageEvents = require("./pageEvents.cjs");
const sessions = require("../agents/sessions.cjs");
const hooks = require("../agents/hooks.cjs");

function register() {
  // ---- reading -------------------------------------------------------------------------------
  ipcMain.handle("jobs:list", () => jobs.list());
  ipcMain.handle("jobs:get", (_e, id) => jobs.get(id));
  ipcMain.handle("jobs:runs", (_e, id) => jobs.runsOf(id));
  // THE VOCABULARY, so a surface can OFFER a trigger instead of asking someone to type one. A
  // picker built from what the harness actually emits is the difference between a job that fires
  // and a job with a typo in it — the same check jobs.save enforces, moved to where the human is.
  ipcMain.handle("jobs:vocabulary", () => ({
    events: hooks.EVENTS.map((e) => ({ ...e })),
    virtual: jobs.VIRTUAL_EVENTS,
  }));

  // ---- writing -------------------------------------------------------------------------------
  ipcMain.handle("jobs:save", (_e, rec) => {
    try { return { job: jobs.save(rec) }; } catch (err) { return { error: String(err?.message || err) }; }
  });
  ipcMain.handle("jobs:remove", (_e, id) => jobs.remove(id));
  // §5 — the rating is the loop, and the constraint is on the VIEW: it must be capturable at the
  // moment the report is read. A rating you have to navigate to is a rating that never gets given,
  // which is why this is one call with no ceremony around it.
  ipcMain.handle("jobs:rate", (_e, id, runId, body) => jobs.rateRun(id, runId, body || {}));

  // ---- watches (RFC-005 §7.1) ----------------------------------------------------------------
  // A watch created from a right-click is invisible until something draws it, and an invisible
  // watcher running on someone's machine is the thing you turn the whole feature off over. This is
  // where it becomes visible — his point, and it is the reason watches are on the job API rather
  // than off in the shell: the surface that shows what fires should show what is watching.
  ipcMain.handle("watches:list", () => pageEvents.list());
  ipcMain.handle("watches:save", (_e, rec) => pageEvents.save(rec || {}));
  ipcMain.handle("watches:remove", (_e, id) => pageEvents.remove(id));

  // ---- the event stream ----------------------------------------------------------------------
  // AMBIENT ONLY. This hands over the events that belong to nobody — page changes, schedules,
  // arrivals — and never a session's traffic. An app that wants to watch an agent asks for the
  // `agents` capability; this one is about things happening in the world.
  ipcMain.handle("jobs:events", (_e, limit) => sessions.ambientHistory(Number(limit) || 100));
  const subs = new Map(); // webContents id -> unsubscribe
  ipcMain.handle("jobs:subscribe", (e) => {
    const wc = e.sender;
    if (subs.has(wc.id)) return true;
    const off = sessions.subscribeAmbient((ev) => {
      try { if (!wc.isDestroyed()) wc.send("jobs:event", ev); } catch {}
    });
    subs.set(wc.id, off);
    // A subscription that outlives its page is a leak that only shows up as a slow shell three
    // hours later. The page going away is the unsubscribe.
    wc.once("destroyed", () => { try { off(); } catch {} subs.delete(wc.id); });
    return true;
  });
}

module.exports = { register };
