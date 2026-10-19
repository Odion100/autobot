// SYSTEMVIEW AS INTERNAL MCP — RFC-056, the agent face. The CLI was the webpage-era door:
// subprocesses, --as identity flags, a per-terminal cookie jar. This server is the browser-era
// door: tools with the SESSION's identity behind them (no --as anywhere — the harness knows who
// is calling, same principle as the context store's by: stamping), talking to the hub's existing
// API. One implementation, two faces: the hub serves the SAME runners the CLI uses (lib mode),
// so the orchestration never forks; the published CLI keeps working untouched.
//
// EVERY OUTPUT IS WRITTEN FOR A READER (his rule: "our logs come out human"). The same words
// serve the model and the chat feed — the renderer's parseMcpResult knows these shapes, and
// anything unparseable falls through to the raw block so pretty never loses data.
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const shot = require("./shot.cjs");
const { z } = require("zod");

const SERVER = "systemview";
const HUB = () => `http://localhost:${process.env.SV_PORT || 3000}/systemview/api`;
const TOOL_NAME = (t) => `mcp__${SERVER}__${t}`;
const TOOL_NAMES = [
  "runTests", "probe", "projects", "logs", "stats",
  "show", "tv", "reply", "board", "comments",
  "nav", "refresh", "act", "highlight", "lanes",
  "connect", "disconnect",
  "terminal", "terminals",
  "shot",
  "documents",
].map(TOOL_NAME);

async function hub(moduleName, fn, arg) {
  let res;
  try {
    res = await fetch(`${HUB()}/${moduleName}/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // An ARRAY is already the argument list. The Agent module's verbs each take one object, so for
      // a year this only ever needed to wrap one — but every verb on the SystemView module is
      // (projectCode, opts), and wrapping that in a single array sends the opts as nothing at all.
      // That is the exact mistake that cost me an hour today, from the outside, with curl.
      body: JSON.stringify({ __arguments: arg === undefined ? [] : Array.isArray(arg) ? arg : [arg] }),
    });
  } catch (e) {
    throw new Error(`the SystemView hub is not reachable at ${HUB()} — is it running?`);
  }
  const raw = await res.text();
  if (!raw.trimStart().startsWith("{")) {
    // an HTML 404 means the RUNNING hub predates this method — say that, not "Unexpected token <"
    // A 404 HAS TWO CAUSES AND THEY NEED OPPOSITE FIXES. This used to name only one — "the hub is
    // serving old code; restart the hub" — and then the agent face moved from `CLI.*` to `Agent.*`,
    // which made every RUNNING session's tools the stale half. BUApp's agent dutifully reported a
    // stale hub at a hub that was current, and restarting it changed nothing. Say both, and say
    // which one is likelier: this process is older than the hub far more often than the reverse.
    throw new Error(
      res.status === 404
        ? `${moduleName}.${fn} is not on the running hub. Either THIS SESSION's tools predate it ` +
          `(the usual case — restart the desktop shell so the MCP server reloads), or the hub really ` +
          `is serving old code (restart it: systemview start).`
        : `${moduleName}.${fn}: hub answered ${res.status} with non-JSON`
    );
  }
  const body = JSON.parse(raw);
  if (body && body.status >= 400) throw new Error(body.message || `${moduleName}.${fn} returned ${body.status}`);
  return body ? body.returnValue : null;
}

const text = (s) => ({ content: [{ type: "text", text: String(s).slice(0, 40000) }] });
const fail = (e) => ({ content: [{ type: "text", text: e.message || String(e) }], isError: true });

// THE TERMINAL'S ANSWER ARRIVES WRAPPED, the way a cross-session message does — his ask, and the
// reason is the same one: this text came from somewhere else and the boundary has to be visible, or
// a shell's output reads as something the agent itself said. The tag carries the facts that decide
// what to do next: which terminal, and the exit code.
const renderTerminal = (r) => {
  if (!r || r.ok === false) return `the terminal refused: ${(r && r.error) || "no answer"}`;
  // WHERE IT RAN RIDES IN THE TAG. An agent holding two terminals — one local, one SSH'd into a
  // droplet — cannot tell them apart from output alone, and guessing wrong means reading the wrong
  // machine's logs and reporting them as the other's. The shell answers for itself, so on an SSH'd
  // session these are the REMOTE host and cwd.
  const where = `${r.host ? ` host="${r.host}"` : ""}${r.cwd ? ` cwd="${r.cwd}"` : ""}`;
  const head = r.running
    ? `<terminal session="${r.session}"${where} running="true">`
    : `<terminal session="${r.session}"${where} exit="${r.exit == null ? "?" : r.exit}">`;
  const body = String(r.output || "").trim();
  const tail = r.running
    ? `\n</terminal>\nstill running — no exit marker yet. It is working, or waiting for an answer typed into the terminal.`
    : `\n</terminal>`;
  return `${head}\n${body || "(no output)"}${tail}`;
};

// ---- renderers: the human-readable half of the feed contract ----

// PROBE — one call, one answer. The result is the point, so it leads; the resolved namespace rides
// above it so a fuzzy input shows what it actually hit.
function renderProbe(r) {
  if (!r) return "probe: no answer from the hub";
  if (r.error && !r.serviceId) {
    const lines = [`probe: ${r.error}`];
    // Candidates carry WHERE each lives, so choosing is not a retype.
    if (Array.isArray(r.candidates) && r.candidates.length)
      lines.push("", ...r.candidates.slice(0, 8).map((c) => `• ${c.namespace}  ${c.at || ""}`.trimEnd()));
    return lines.join("\n");
  }
  const ns = `${r.projectCode ? r.projectCode + ":" : ""}${r.serviceId}.${r.moduleName}.${r.methodName}`;
  const head = `${ns}(${(r.args || []).map((a) => JSON.stringify(a)).join(", ")})`;
  const body = r.error
    ? `failed — ${r.error}`
    : r.result === undefined
    ? "(no result and no error — the service answered with nothing)"
    : JSON.stringify(r.result, null, 2);

  // THE PART A TERMINAL NEVER GAVE YOU. Where it went, whether it was authenticated and from whose
  // store, and how long it took — one line, under the answer, so the next call is informed and a
  // failure explains itself instead of being re-run blind.
  const meta = [];
  if (r.at) meta.push(r.at);
  if (r.ms != null) meta.push(`${r.ms}ms`);
  meta.push(r.authenticated ? `authenticated (${(r.headers || []).join(", ")})` : "anonymous");
  if (r.headersFrom) meta.push(`headers from ${r.headersFrom}`);

  const out = [head, "", body, "", meta.join("  ·  ")];
  if (r.hint) out.push(r.hint);
  if (r.hint2) out.push(r.hint2);
  if (r.warning) out.push(r.warning);
  // Siblings only when the call FAILED — on success they are noise; on a miss they are the answer.
  if ((r.error || r.result === null) && Array.isArray(r.siblings) && r.siblings.length)
    out.push(`other methods on ${r.moduleName}: ${r.siblings.slice(0, 20).join(", ")}`);
  if (Array.isArray(r.notices) && r.notices.length) out.push(...r.notices);
  return out.join("\n");
}

function renderRun(r) {
  if (r && r.error) return `${r.projectCode || "?"}: ${r.error}`;
  // DRY RUN IS THE LISTING (his call): what WOULD run, as bullets the feed tables know.
  if (r && r.dryRun) {
    const head = `${r.projectCode}: would run ${r.tests.length} test${r.tests.length === 1 ? "" : "s"}`;
    // the capability returns `namespace` as a string now — the three-field shape was the CLI's
    return [head, "", ...r.tests.map((t) => `• ${t.namespace || "(unnamed)"} — "${t.title}"`)].join("\n");
  }
  const total = (r.passed || 0) + (r.failed || 0);
  const head = `${r.projectCode}: ${total} test${total === 1 ? "" : "s"} — ${r.passed} passed, ${r.failed} failed`;
  // ONE ROW PER TEST, and the failing one carries the comparison that failed — expected vs received,
  // at a path — instead of a transcript to read. The capability returns that structured now, so this
  // reads `passed` and `failures` and stops guessing at section shapes.
  const lines = (r.tests || []).map((t) => {
    const ns = t.namespace || "(unnamed)";
    const ms = t.ms != null ? ` ${t.ms}ms` : "";
    if (t.passed) return `✓ ${ns} — "${t.title}"${ms}`;
    const details = (t.failures || []).map((f) => {
      const at = f.namespace || f.path || "";
      const cmp =
        f.expected !== undefined || f.received !== undefined
          ? `expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.received)}`
          : f.message || "failed";
      return `    ${f.phase || "?"} "${f.step || ""}": ${at} → ${cmp}`;
    });
    return [`✗ ${ns} — "${t.title}"${ms}`, ...details].join("\n");
  });
  const foot = [];
  // WHERE IT RAN, ALWAYS — the hub has always returned this (`services[].at`) and this renderer
  // dropped it. An agent reading a failure could see WHAT failed and nothing about WHICH instance
  // answered, so a method missing from a deployed service read as "my registration is broken."
  // That cost buapi-7e a day and three methods declared blocked, one of them abandoned and
  // rebuilt for nothing (2026-09-30). One line would have ended it in one run, so it is one line
  // that is never conditional on the run having failed.
  if (Array.isArray(r.services) && r.services.length)
    foot.push(`ran against: ${r.services.map((s) => `${s.serviceId} ${s.at || "(no url)"}`).join(", ")}`);
  if (r.ms != null) foot.push(`${r.ms}ms`);
  if (Array.isArray(r.unreachable) && r.unreachable.length)
    foot.push(`did not answer: ${r.unreachable.map((u) => `${u.serviceId} (${u.at})`).join(", ")}`);
  if (r.stoppedEarly) foot.push(`stopped early — ${r.notRun} not run`);
  return [head, "", ...lines, ...(foot.length ? ["", foot.join("  ·  ")] : [])].join("\n");
}

// THE URL IS THE POINT, not the service name. A project whose services sit on two different hosts
// is the thing this listing exists to make visible — and DUPLICATES are called out rather than
// left for someone to notice: one serviceId registered twice under one project is how a suite ends
// up running somewhere nobody meant, and the reader should not have to diff the lines themselves.
// WHAT A LANE ROW SAYS, for the agent face. Deliberately the SAME three words the window's chip uses
// (laneVerdict.js in systemview/src) — a tool that invented its own vocabulary would have an agent
// reporting "pending" about a row the user is reading as "in tree", and then neither of them is wrong.
function renderLanes(projectCode, r) {
  if (r && r.error) return r.error;
  const rows = r.lanes || [];
  // A BRANCH THAT IS NOT REGISTERED IS NAMED, NOT HIDDEN. It may hold real work; saying nothing
  // about it is how a branch becomes invisible to every door at once. It is reported as what it
  // is — a branch — with the one call that makes it a lane.
  const stray = Array.isArray(r.unregistered) ? r.unregistered : [];
  const strayLine = stray.length
    ? `\n${stray.length} lane/* branch${stray.length === 1 ? "" : "es"} not registered: ${stray.join(", ")}` +
      `\n   A branch is not a lane until a run is written against it — \`worklist set\` with ` +
      `source "lane:<branch>". Until then it has no row and nobody is watching it.`
    : "";
  if (!rows.length) return `${projectCode}: no lanes standing.${strayLine}`;
  // WHAT SOMEBODY SAID COMES FIRST, and the derived word follows it in brackets as the cross-check.
  // Reversed from how this shipped, because the derivation is a guess about residue and the person
  // who acted knows what they did (2026-10-06, his ruling). A disagreement is PRINTED, not ranked:
  // he can see "brought in, suites green  (files say: can't tell)" and judge it himself.
  const said = (l) =>
    l.status && l.status.text
      ? `${l.status.text}${l.status.by ? ` — ${l.status.by}` : ""}, ${new Date(l.status.ts).toISOString().slice(0, 10)}`
      : "";
  const WORD = {
    in: (l) => (l.committed ? "in · committed" : "in · uncommitted"),
    out: () => "OUT — proven not in this tree",
    unknown: () => "can't tell — files moved on since it was cut",
  };
  const out = [`${projectCode} — ${rows.length} lane${rows.length === 1 ? "" : "s"} standing`];
  for (const l of rows) {
    const word = (WORD[l.verdict] || (() => String(l.verdict || "?")))(l);
    const counts = l.total ? ` ${l.matching}/${l.total} match` : "";
    const statement = said(l);
    // A receipt stays, because it carries something a sentence does not: the BASE it was applied
    // against, which is checkable against history. It is detail under the statement, not the answer.
    const rcpt = l.broughtIn ? `  · applied ${new Date(l.broughtIn.ts).toISOString().slice(0, 10)}${l.broughtIn.base ? ` at ${l.broughtIn.base}` : ""}` : "";
    out.push(
      statement
        ? // SAID FIRST, DERIVED SECOND AND LABELLED AS SUCH. He can see the two disagree and decide;
          // neither is presented as authority over the other.
          `   ${String(l.branch).padEnd(30)} ${statement}\n   ${" ".repeat(30)} files say: ${word}${counts}${rcpt}`
        : // NOBODY HAS SPOKEN, so the derived word is all there is — and it says so, rather than
          // reading as a verdict somebody stands behind.
          `   ${String(l.branch).padEnd(30)} (nobody has said) · files say: ${word}${counts}${rcpt}`
    );
  }
  if (r.notIn) out.push(`\n⚠ ${r.notIn} lane${r.notIn === 1 ? "" : "s"} PROVEN not in this tree — that work exists nowhere else. Bring it in before anyone clears it.`);
  else out.push(`\nnotIn: 0 — no lane's work is provably outside this tree.`);
  if (strayLine) out.push(strayLine);
  return out.join("\n");
}

// WHAT WAS CLEARED, AND WHAT WAS NOT, in one answer. A remove that reported only its successes would
// read as "all your lanes are gone" while the ones holding unrecovered work quietly stayed — the exact
// shape of a log that lies by omission.
function renderCleared(projectCode, cleared, refused) {
  const out = [];
  if (cleared.length) {
    out.push(`cleared ${cleared.length} lane${cleared.length === 1 ? "" : "s"} in ${projectCode}:`);
    for (const c of cleared)
      out.push(`   ${String(c.branch).padEnd(30)} worktree: ${c.worktree} · branch: ${c.branchDeleted} · record: ${c.record} · told ${c.told} session${c.told === 1 ? "" : "s"}`);
  } else out.push(`cleared nothing in ${projectCode}.`);
  if (refused.length) {
    out.push(`\nREFUSED ${refused.length} — their work cannot be shown to be in this tree:`);
    for (const l of refused)
      out.push(
        `   ${String(l.branch).padEnd(30)} ${l.verdict === "out"
          ? "PROVEN not in — deleting this destroys the only copy"
          : `can't tell (${l.matching}/${l.total} match) — it may already be in, or may not`}`
      );
    out.push(`Bring the work in, or delete these yourself on the row where the confirm says what dies.`);
  }
  if (cleared.some((c) => !c.told)) out.push(`\nNote: told 0 sessions — no open session for ${projectCode}, so no strip was listening. The rows will be gone when one opens.`);
  return out.join("\n");
}

function renderProjects(r) {
  if (r && r.error) return r.error;
  const projects = (r && r.projects) || r || {};
  const codes = Object.keys(projects);
  if (!codes.length) return "No connected projects.";
  const out = [];
  for (const pc of codes) {
    const rows = projects[pc] || [];
    const seen = {};
    for (const s of rows) seen[s.serviceId] = (seen[s.serviceId] || 0) + 1;
    const dupes = Object.keys(seen).filter((k) => seen[k] > 1);
    out.push(`${pc}${dupes.length ? `  ⚠ registered twice: ${dupes.join(", ")}` : ""}`);
    for (const s of rows) out.push(`   ${String(s.serviceId).padEnd(14)} ${s.serviceUrl || "(no url)"}`);
  }
  return out.join("\n");
}

function renderList(r) {
  if (r && r.error) return r.error;
  if (r && r.projects) {
    const codes = Object.keys(r.projects);
    if (!codes.length) return "No connected projects.";
    return codes.map((pc) => `${pc} — ${r.projects[pc].map((s) => s.serviceId).join(", ")}`).join("\n");
  }
  const svcs = (r && r.services) || [];
  if (!svcs.length) return "No tests found.";
  return svcs
    .map((s) => {
      if (s.error) return `${s.serviceId} — ${s.error}`;
      const byNs = new Map();
      for (const t of s.tests || []) {
        const ns = `${t.namespace.serviceId}.${t.namespace.moduleName}.${t.namespace.methodName}`;
        byNs.set(ns, (byNs.get(ns) || 0) + 1);
      }
      return [`${s.serviceId} — ${(s.tests || []).length} tests`, ...[...byNs].map(([ns, n]) => `  ${ns} — ${n}`)].join("\n");
    })
    .join("\n");
}

function renderLogs(r) {
  const entries = (r && r.entries) || [];
  if (!entries.length) return `no log entries for ${r && r.projectCode}`;
  // the entry's REAL shape (cli/logs.js formatRow): timestamp, serviceId, moduleMethod, level,
  // scope (the message), duration — a method-call trace has a duration and often no prose.
  return entries
    .map((e) => {
      const ns = [e.serviceId, e.moduleMethod].filter(Boolean).join(" › ");
      const when = e.timestamp ? new Date(e.timestamp).toISOString() : "";
      const msg = typeof e.scope === "string" && e.scope ? e.scope : e.message != null ? (typeof e.message === "string" ? e.message : JSON.stringify(e.message)) : "";
      const dur = e.duration != null ? ` (${e.duration}ms)` : "";
      return `${(e.level || "info").toUpperCase()} ${ns}${when ? ` · ${when}` : ""}${dur}${msg ? `\n  ${msg}` : ""}`;
    })
    .join("\n");
}

function renderStats(r) {
  if (r && r.error) return r.error;
  const svcs = (r && r.services) || [];
  if (!svcs.length) return `no stats for ${r && r.projectCode}`;
  const fmtMs = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);
  const lines = svcs.map((s) => {
    const t = s.totals || {};
    return `${s.status === "bad" ? "✗" : s.status === "watch" ? "▲" : "●"} ${s.serviceId} — ${t.count || 0} calls · ${((t.serverErrorRate || 0) * 100).toFixed(1)}% server err · avg ${fmtMs(t.avgDuration)} · p99 ${fmtMs(t.p99)}`;
  });
  const head = `Stats — ${r.projectCode} · ${r.range === "all" ? "all time" : `last ${r.range}`}`;
  const silent = r.silent && r.silent.length ? `\nnot reporting: ${r.silent.join(", ")}` : "";
  return [head, ...lines].join("\n") + silent;
}

// ---- the server ----

// THE TOOLS, APART FROM THE SERVER THAT CARRIES THEM — the same split context.cjs and worklist.cjs
// already made, and for the reason they made it: a handler only reachable through the SDK is a
// handler nothing can call in a test. The lane verbs decide whether work that exists nowhere else
// can be deleted, and whether a row tells the truth about where work landed, and both shipped with
// no claim on them at all because there was no door to hold.
function toolsFor(identity = {}) {
  const who = identity.slot || identity.projectCode || null;
  // sessions.cjs requires this file, so this file cannot require it back. The git half of clearing a
  // lane is the hub's; the RECORD and the announce are the session host's, and they arrive here as a
  // function rather than an import.
  const onLaneRemoved = typeof identity.onLaneRemoved === "function" ? identity.onLaneRemoved : null;
  const onLaneBroughtIn = typeof identity.onLaneBroughtIn === "function" ? identity.onLaneBroughtIn : null;
  // A FILED REPORT IS AN EVENT THE SESSION CARES ABOUT (2026-10-08). Same shape and same reason as
  // the two above: the host knows whether a JOB's run is open in this session and this file must not
  // require sessions.cjs back to ask. `show` files a document; if that document is a job's account
  // of itself, the run points at it from then on.
  const onReportFiled = typeof identity.onReportFiled === "function" ? identity.onReportFiled : null;
  // WHICH LANES ARE REGISTERED. The hub answers from git — `branch --list lane/*` — and the
  // registrations are run records, which live on this side. Injected rather than imported for the
  // same reason as the three above: sessions.cjs requires this file and cannot be required back.
  const laneRunsFor = typeof identity.laneRuns === "function" ? identity.laneRuns : null;
  const built = [
      tool(
        "runTests",
        "Run the project's saved SystemView tests and get the results. Filter with namespace " +
          "(Service, Service.Module, or Service.Module.method — substring match). dryRun lists " +
          "what WOULD run without running it — that is how you list tests. Run after any code " +
          "change and before reporting; when a test fails, fix and re-run until green.",
        {
          projectCode: z.string().describe("the project whose tests run"),
          namespace: z.string().optional().describe("filter: Service, Module, or Module.method"),
          bail: z.boolean().optional().describe("stop at the first failure"),
          dryRun: z.boolean().optional().describe("list what would run instead of running"),
        },
        async ({ projectCode, namespace, bail, dryRun }) => {
          try {
            return text(renderRun(await hub("Agent", "runTests", { projectCode, namespace, bail, dryRun })));
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "terminal",
        "Run a command in a terminal the human has handed you, and get its output and exit code back " +
          "— the same contract as any shell: one call in, stdout and the real $? out. It is HIS " +
          "terminal, already open and already authenticated, which is the point: if it is SSH'd into " +
          "a remote box, you are on that box. So the state is shared — a `cd` moves his prompt too, " +
          "and anything you export outlives your command. Use `terminals` to see which ones you hold; " +
          "a terminal you were not granted refuses and says so. Long jobs: prefer firing them " +
          "detached to a log file over sitting on them, the same as you would over SSH.",
        {
          session: z.string().describe("the terminal's id, e.g. systemview-test-2 — from `terminals`"),
          command: z.string().describe("the command, exactly as you would type it"),
          timeoutMs: z.number().optional().describe("how long to wait for it to finish (default 120000)"),
        },
        async ({ session, command, timeoutMs }) => {
          try {
            return text(renderTerminal(await hub("Agent", "terminalRun", { session, command, timeoutMs, agent: who })));
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "terminals",
        "Which terminals you may type in right now, and where each one's log is. Granted by the " +
          "human, per terminal, and revocable at any time — so read this rather than remembering.",
        {},
        async () => {
          try {
            const r = await hub("Agent", "terminalGrants", {});
            const all = (r && r.grants) || {};
            const mine = Object.entries(all).filter(([, g]) => g && g.agent === who);
            if (!mine.length) return text("no terminals are granted to you right now.");
            const os = require("os");
            const path = require("path");
            return text(
              mine
                .map(([s]) => `${s}   log: ${path.join(os.homedir(), ".autobot", "terminals")}/*_${s}.log`)
                .join("\n")
            );
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "lanes",
        "Every lane standing in a project — delegated work on its own branch and worktree — with the " +
          "one answer that decides what to do next: is its work in the tree. `in` means present, and " +
          "`committed` says whether history holds it too; `out` means PROVEN absent (the patch applies " +
          "forward cleanly, so there is nothing of it here); `unknown` means the files it touched moved " +
          "on since it was cut, so neither direction is clean and the lane may already be in. Read it " +
          "before reporting delegated work as finished and before telling the user a lane is safe to " +
          "delete. BRINGING ONE IN REQUIRES SAYING WHAT HAPPENED: pass `broughtIn` together with " +
          "`status` in the same call — did it land as a commit or as changes, did the suite run — " +
          "because derivation on its own has read \"in · committed\" for a branch holding nothing. " +
          "Use `branch` with `status` to speak about a lane you are NOT bringing in. " +
          "Pass `remove` with a branch to clear that lane — worktree, branch, run record, and an " +
          "announce so his strip drops the row without him pressing anything — or `remove: \"all\"` for " +
          "every lane whose work is verifiably in. A lane reading `out` or `unknown` is REFUSED and " +
          "named: that is work nothing here can prove exists anywhere else.",
        {
          projectCode: z.string().describe("the project whose lanes to read"),
          remove: z
            .string()
            .optional()
            .describe('a branch to clear, or "all" for every lane whose work is verifiably in'),
          // THE RECEIPT'S DOOR (RFC-063, built 2026-10-03 after BUApp reported the gap from the
          // other side). Derivation DECAYS: a lane is "in" only while its files still match, and the
          // normal flow — apply the diff, then keep working on those files — breaks the match within
          // minutes. BUApp's `lane/post-form` read "can't tell (0/1)" twenty minutes after a verified
          // bring-in; buAPI's two read 0/9 and 0/4 with their features provably live in master. The
          // row's whole job is the delete decision, and a decaying answer cannot make it.
          //
          // So the owner records the ACT at the moment it happens, and file-matching becomes a
          // cross-check rather than the source of truth. It is a RECEIPT, not a settable verdict:
          // laneVerdict only lets it answer `unknown`, never outrank a derived `out`, because `out`
          // is proof and this is a record.
          broughtIn: z
            .string()
            .optional()
            .describe(
              "a branch you have just applied into this tree — records WHEN and against what base, " +
                "so the row still says so after the files move on. Stamp it at the moment you bring " +
                "a lane in; derivation goes blind the moment anyone edits those files again."
            ),
          // SAY WHAT IS HAPPENING, IN YOUR OWN WORDS — his ruling 2026-10-06, and it outranks the
          // derived verdict rather than feeding it. Derivation was never proof: it called a branch
          // with no commits `in · committed`, and a lane that was applied and then reversed
          // `can't tell, 4/11`. The actor knew both exactly and had nothing to say them with.
          status: z
            .string()
            .optional()
            .describe(
              "what is happening in this lane, in your own words — it becomes the row's headline, " +
                "dated and attributed to you, and derivation prints beside it as a cross-check. " +
                "Anything true and useful: \"brought in, suites green\", \"applied then reversed — " +
                "NOT landed\", \"waiting on your review\", \"needs a rebase\". Pass an empty string " +
                "to clear one you got wrong — a statement nobody can retract is worse than none."
            ),
          branch: z
            .string()
            .optional()
            .describe(
              "which lane a `status` is about, when you are not also bringing it in. Say it with " +
                "`branch` whenever the statement is not \"I applied this\" — waiting on review, " +
                "needs a rebase, applied then reversed."
            ),
          tone: z
            .enum(["ok", "warn", "note"])
            .optional()
            .describe("how it should read: ok = safe, warn = needs your eyes, note = neutral (default)"),
        },
        async ({ projectCode, remove, broughtIn, status, tone, branch }) => {
          try {
            const st = await hub("SystemView", "lanes", [projectCode]);
            // ─── A BRANCH IS NOT A LANE UNTIL IT IS REGISTERED (his ruling, 2026-10-08) ───────
            //
            // Two doors used to answer "what lanes exist" from two different stores: this one from
            // `git branch --list lane/*`, and his strip from run records sourced `lane:`. So a
            // branch anybody cut was a lane to every agent and invisible to him, and a record with
            // no branch was a row for him that git knew nothing about. One question, two answers.
            //
            // THE RECORD WINS, and the unregistered branches are NAMED rather than dropped. Hiding
            // them would be the worse half of the same bug — a branch holding real work that no
            // door mentions. So they are listed as what they are: branches, not lanes, one call
            // away from being either.
            if (laneRunsFor && st && Array.isArray(st.lanes)) {
              let registered = null;
              try {
                const rows = await laneRunsFor();
                registered = new Set((Array.isArray(rows) ? rows : []).map(String));
              } catch { registered = null; }
              // A FAILED READ IS NOT AN EMPTY ONE. If the registrations cannot be read, every lane
              // would read unregistered and the list would come back empty — so the filter is
              // skipped and the rows are reported as git saw them, which is the older behaviour and
              // never a false absence.
              if (registered) {
                st.unregistered = st.lanes.filter((l) => !registered.has(l.branch)).map((l) => l.branch);
                st.lanes = st.lanes.filter((l) => registered.has(l.branch));
                st.notIn = st.lanes.filter((l) => l.verdict === "out").length;
              }
            }
            if (!st || st.ok === false) return text(`lanes: ${(st && st.error) || "the hub said no"}`);
            const rows = st.lanes || [];
            // ─── SAYING AND RECORDING ARE ONE CALL NOW, AND BRINGING IN REQUIRES SAYING ──────
            //
            // TWO BUGS LIVED HERE. First, `status` returned before `broughtIn` was ever read — so
            // `{ broughtIn, status }`, the single most natural call at the moment work lands, set
            // the headline and silently recorded no receipt. Second, `status` had no branch of its
            // own: it borrowed `broughtIn`, which MEANS "I applied this", so saying "waiting on your
            // review" required passing the field that claims the opposite.
            //
            // AND HIS ASK, 2026-10-09: *"I prefer the agent to leave a note whether it was brought
            // in and committed."* So a bring-in with nothing said is refused. Not out of ceremony —
            // the alternative is a row reading "(nobody has said) · files say: in · committed",
            // where the only voice is a derivation that has been wrong in both directions: it called
            // a branch with zero commits `in · committed`, and a lane applied-then-reversed
            // `can't tell 4/11`. The actor knew exactly what happened both times. This is the field
            // for it, and the moment work lands is the moment to spend it.
            const about = String(branch || broughtIn || remove || "").trim();
            if (broughtIn && status === undefined)
              return text(
                `${String(broughtIn).trim()}: not recorded. Say what happened, in your own words — ` +
                  `pass \`status\` with the bring-in. Did it land as a COMMIT or as changes? Did the ` +
                  `suite run? Without it the row's only voice is derivation, which has read ` +
                  `"in · committed" for a branch holding nothing and "can't tell" for work that was ` +
                  `applied and reversed. You know which it was; the row cannot work it out.`
              );
            if (status !== undefined) {
              if (!about)
                return text(
                  "a status is about a lane — name it with `branch` (or with `broughtIn`, if you are " +
                    `also recording that you applied it). Lanes standing: ${rows.map((l) => l.branch).join(", ") || "(none)"}`
                );
              if (!rows.find((l) => l.branch === about))
                return text(`no lane on ${about} in ${projectCode}. Standing: ${rows.map((l) => l.branch).join(", ") || "(none)"}`);
            }

            if (broughtIn) {
              const b = String(broughtIn).trim();
              const row = rows.find((l) => l.branch === b);
              if (!row)
                return text(
                  `no lane called ${b} in ${projectCode}. Standing: ${rows.map((l) => l.branch).join(", ") || "none"}`
                );
              if (!onLaneBroughtIn) return text(`cannot record it from here — no host door for ${projectCode}`);
              // The base is the tree the work landed IN, which is the only thing that makes a stale
              // receipt checkable later: "brought in against THIS commit" can be verified; a bare
              // date cannot.
              //
              // AND IT HAS TO BE A COMMIT. For as long as receipts have existed it was a BRANCH
              // NAME: `gitState` returns no `head` and no `sha` — it returns `branch` and
              // `log[0].sha` — so the chain `g.head || g.sha || g.branch` fell through to the
              // branch on every single call. Every receipt on disk reads `base: "ElementLocator"`
              // or `base: "main"`: a name that MOVES, which is the one thing a base must not be,
              // and it reads verifiable while being worthless. Found 2026-10-10 by stamping one and
              // reading the run file — not by reading this code, which looks right — and the test
              // that covered it stubbed `{ head: "abc1234" }`, a field the real hub has never
              // returned. So no base at all is better than a branch name here: an empty base says
              // "unverifiable" out loud, where `main` lies about being checkable.
              const g = await hub("SystemView", "gitState", [projectCode]);
              const base = (g && (g.head || g.sha || (g.log && g.log[0] && g.log[0].sha))) || "";
              const onto = g && g.branch ? String(g.branch) : "";
              const rec = onLaneBroughtIn(b, { base, repo: projectCode });
              if (!rec || !rec.ts)
                return text(
                  `${b}: nothing recorded — no run file for this lane (its record may have been swept). ` +
                    `The branch and worktree are still there; derivation is all the row has.`
                );
              // THE NOTE RIDES THE SAME CALL. It is refused above when absent, so by here there is
              // always something to say — and the row's headline is set in the same breath as the
              // receipt rather than in a second call somebody has to remember.
              const said = await hub("SystemView", "laneStatus", [projectCode, { branch: b, text: status, tone, by: who }]);
              return text(
                [
                  `recorded: ${b} brought in${base ? ` at ${base}` : ""}${onto ? ` on ${onto}` : ""} in ${projectCode}`,
                  ...(base
                    ? []
                    : [`   NO BASE RECORDED — the hub could not name a commit, so this receipt is a date and nothing more.`]),
                  said && said.ok !== false
                    ? `   and you said: "${String(status).trim()}" — that is the row's headline; derivation prints beside it.`
                    : `   BUT THE NOTE DID NOT LAND: ${(said && said.error) || "the hub said no"}. The receipt is there and the row has no voice — say it again.`,
                  `   it is a RECORD, not proof: a derived \`out\` still overrules it, and it dies with the lane.`,
                ].join("\n")
              );
            }

            // A STATUS ON ITS OWN — the lane is not being brought in, it is being spoken about.
            if (status !== undefined) {
              const said = await hub("SystemView", "laneStatus", [projectCode, { branch: about, text: status, tone, by: who }]);
              if (!said || said.ok === false) return text(`status: ${(said && said.error) || "the hub said no"}`);
              return text(
                String(status).trim()
                  ? `${about}: "${String(status).trim()}" — said by ${who}. It is the row's headline now; derivation reads beside it.`
                  : `${about}: status cleared. The row falls back to what the files say.`
              );
            }
            if (!remove) return text(renderLanes(projectCode, st));
            const want = String(remove).trim();
            const targets = want === "all" ? rows : rows.filter((l) => l.branch === want);
            if (!targets.length)
              return text(
                want === "all"
                  ? `no lanes standing in ${projectCode} — nothing to clear`
                  : `no lane called ${want} in ${projectCode}. Standing: ${rows.map((l) => l.branch).join(", ") || "none"}`
              );
            // THE GUARD IS THE VERDICT, NOT GIT'S ANCESTRY. A brought-in lane is unmerged by ancestry
            // — the owner applied its diff rather than merging — so `branch -d` would refuse every
            // lane this is for, and `-D` is correct. What makes -D safe here is that `in` is the DISK
            // saying the work is present, checked one line above the delete. `out` and `unknown` are
            // refused for opposite reasons: out is proof the work is nowhere else, unknown is the
            // honest absence of proof either way. Both are his call, on the row, with the confirm.
            const wts = await hub("SystemView", "worktrees", [projectCode]);
            const wtOf = (b) => ((wts && wts.worktrees) || []).find((w) => !w.main && w.branch === b);
            const cleared = [];
            const refused = [];
            for (const l of targets) {
              // IN, or UNKNOWN WITH A RECEIPT. `out` stays refused — that is proof of absence and a
              // record cannot outrank proof. But refusing a receipt-answered lane is what made
              // BUApp route around this by hand (`git worktree remove` + `rm run-*.json`), which
              // orphans the record and announces nothing to anyone's strip.
              const answered = l.verdict === "unknown" && l.broughtIn;
              if (l.verdict !== "in" && !answered) { refused.push(l); continue; }
              const wt = wtOf(l.branch);
              const wtRes = wt ? await hub("SystemView", "removeWorktree", [projectCode, { path: wt.path, force: true }]) : null;
              const brRes = await hub("SystemView", "deleteBranch", [projectCode, { name: l.branch, force: true }]);
              // the record and the announce — the session host's half, injected at serverFor
              const rec = onLaneRemoved ? onLaneRemoved(l.branch) : null;
              cleared.push({
                branch: l.branch,
                worktree: wt ? (wtRes && wtRes.ok !== false ? "removed" : `FAILED: ${(wtRes && wtRes.error) || "?"}`) : "none",
                branchDeleted: brRes && brRes.ok !== false ? "deleted" : `FAILED: ${(brRes && brRes.error) || "?"}`,
                record: rec ? (rec.record ? "removed" : "already gone") : "not reachable from here",
                told: rec ? rec.told : 0,
              });
            }
            return text(renderCleared(projectCode, cleared, refused));
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "projects",
        "List the connected projects and their services, with the URL each one actually resolves " +
          "to — what the hub can reach right now. Takes no arguments. Read it when a namespace " +
          "resolves somewhere surprising, or before believing a failure that says a method does " +
          "not exist: the same service can be registered under more than one project, and a " +
          "deployed instance legitimately lacks code nobody pushed to it.",
        {},
        async () => {
          // THIS TOOL WAS UNCALLABLE FOR ITS WHOLE LIFE (buapi-7e, 2026-09-30, confirmed first
          // try). It declared no parameters and called `Agent.listTests`, which requires a
          // projectCode — so `projects({})` answered "projectCode required" and
          // `projects({projectCode})` was rejected by the schema for passing an argument it does
          // not accept. No successful invocation existed, and the cost landed on somebody else:
          // with no way to list connections, another project's agent read our connections.json by
          // hand to find out which instance a test had resolved against.
          //
          // `getProjects` is what it always wanted — it is the connection list, serviceUrl
          // included, and it is the same door the window's nav is drawn from.
          try { return text(renderProjects(await hub("SystemView", "getProjects", {}))); } catch (e) { return fail(e); }
        }
      ),
      tool(
        "probe",
        "Call ONE method on a service SystemView has registered, and read the real response. Use " +
          "it before asserting a shape, to check a service is alive, or to reproduce a bug by hand. " +
          "The namespace can be fuzzy (`signIn`, `Users.signIn`, `Profiles.Users.signIn`); prefix " +
          "`projectCode:` to scope it when the same service is connected twice. This is NOT " +
          "mcp__systemlynx__call — that one reaches whitelisted services that publish MCP routes; " +
          "this reaches anything registered here, no whitelist and no MCP needed.",
        {
          namespace: z.string().describe("ServiceId.Module.method — fuzzy, optionally `projectCode:` prefixed"),
          args: z.any().optional().describe("one object for an object-shaped method, or an array for a positional one"),
          projectCode: z.string().optional().describe("scope the resolution to one project"),
          headers: z.record(z.string()).optional().describe('extra request headers, e.g. {"Origin": "http://localhost:3000"}'),
        },
        async (a) => {
          try { return text(renderProbe(await hub("Agent", "probe", a))); } catch (e) { return fail(e); }
        }
      ),
      tool(
        "logs",
        "Read a project's systemview.log entries — the server-side debugging channel. Add " +
          "systemview.log(msg) in service code, exercise it, then read here.",
        {
          projectCode: z.string(),
          level: z.string().optional().describe("error | warn | info"),
          limit: z.number().optional(),
          namespace: z.string().optional().describe("filter entries by Service.Module.method substring"),
        },
        async (a) => {
          try { return text(renderLogs(await hub("Agent", "getLogs", a))); } catch (e) { return fail(e); }
        }
      ),
      tool(
        "stats",
        "The project's live traffic numbers — calls, error rates, latency per service (the same " +
          "data the Stats page shows).",
        {
          projectCode: z.string(),
          service: z.string().optional(),
          range: z.string().optional().describe("15m | 1h | 4h | 24h | all"),
        },
        async (a) => {
          try { return text(renderStats(await hub("Agent", "stats", a))); } catch (e) { return fail(e); }
        }
      ),
      tool(
        "show",
        "File a document in the project's reports panel, and put it on his TV (beside the chat). " +
          "Markdown text or an existing report path. Use for anything long or with choices " +
          "(::question / :::approval blocks) — the chat line stays short. " +
          "PASS `quiet: true` WHEN NOBODY MAY BE IN THE ROOM — an unattended job, a hook that fired " +
          "at 3am, a report he can read when he wants to: the document is filed and the run's " +
          "report pointer is stamped exactly as it would be, and only the screen is left alone. " +
          "Quiet is the right call whenever you are not sure he is watching; a report cannot be " +
          "filed by any other verb, so filing quietly is how an account exists without an " +
          "interruption.",
        {
          projectCode: z.string(),
          text: z.string().optional().describe("the markdown to show"),
          reportPath: z.string().optional().describe("an existing .md file to show instead of text"),
          clear: z.boolean().optional().describe("take the show down"),
          quiet: z
            .boolean()
            .optional()
            .describe("file it and stamp the run, but do NOT put it on his TV — for unattended work"),
        },
        async ({ projectCode, text: md, reportPath, clear, quiet }) => {
          try {
            const r = await hub("Agent", "show", { projectCode, text: md, reportPath, clear, quiet, as: who });
            // THE PATH IS THE POINT. `Agent.show` files the document and answers with where it
            // landed, which until now was thrown away — so a job's own account of itself existed
            // on disk with nothing connecting it to the run that produced it.
            //
            // AND THE STAMP IS NOT PART OF THE SHOW. It rides the FILING, which is why `quiet`
            // changes nothing here: a run that filed its account points at it whether or not
            // anybody's screen was taken. That weld is what made a job card read
            // "finished · no report" for every run that obeyed its own instruction not to
            // interrupt him — his report, 2026-10-14.
            if (r && r.ok && r.path && onReportFiled) {
              try { onReportFiled({ path: r.path, label: r.label || "" }); } catch {}
            }
            return text(
              r && r.ok
                ? clear
                  ? "TV cleared."
                  : r.quiet
                    ? `Filed as ${r.path}. Not on the TV — it is in his reports panel when he wants it.`
                    : `The show is up.${r.path ? ` Filed as ${r.path}.` : ""}`
                : `The show did not go up.${r && r.error ? ` ${r.error}` : ""}`,
            );
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "tv",
        "Read what is on the project's TV — including his answers (::question answer=, " +
          ":::approval verdict=, :::reply threads) written into the document.",
        {
          projectCode: z.string(),
          show: z.string().optional().describe("an older report's title, to read its answers"),
        },
        async ({ projectCode, show }) => {
          try {
            const state = await hub("Agent", "tv", { projectCode, show });
            if (state && state.error) return text(state.error);
            return text(state && state.text ? state.text : "Nothing on the TV.");
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "reply",
        "Answer inside a report's thread — his comments live in the document, and the answer " +
          "belongs next to them (the chat gets at most one pointer line).",
        {
          projectCode: z.string(),
          report: z.string().describe("the report's title or path"),
          threadId: z.string(),
          text: z.string(),
        },
        async ({ projectCode, report, threadId, text: t }) => {
          try {
            const r = await hub("Agent", "reply", { projectCode, report, threadId, text: t, as: who });
            return text(r && r.ok ? `replied in ${threadId}` : "reply failed");
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "board",
        "His board — the notes he accumulates for agents between sessions. Read it, add a note, " +
          "reply to one, set a card's STATUS, or REMOVE one whose account has landed. There is no " +
          "done state on purpose: a card is deleted when its work has been reported somewhere, so " +
          "the number of cards is the number of things still outstanding. A `status` does not change " +
          "that — it is the one line he reads INSTEAD of re-reading the card when he decides to " +
          "delete it (\"implemented — reports are a band tab now\"), which is why `removeSettled` " +
          "exists: set the account as you finish each thing, and the settled ones clear in one " +
          "motion. Remove only once the account exists — a report, a lane, a commit — and if you " +
          "only did part of a card, add the remainder back as its own note rather than deleting the " +
          "whole thing.",
        {
          projectCode: z.string(),
          name: z.string().optional().describe("a named board; default is the main one"),
          add: z.string().optional().describe("a note to add"),
          replyText: z.string().optional().describe("a reply to an existing note"),
          at: z
            .union([z.string(), z.number()])
            .optional()
            .describe(
              "which card the reply or the status targets — its id, its TITLE, or an unambiguous part " +
                "of its title (\"the status picker\"). Never a position: positions shift when anyone adds " +
                "a card. Two cards matching one title is refused with both named rather than resolved to the first."
            ),
          title: z
            .string()
            .optional()
            .describe(
              "name the card — with `add`, or with `at` to name one that already exists. TITLING IS YOURS ON ANY " +
                "CARD, including his: the title is how he says which card he means out loud and how you address " +
                "it later, and his arrive raw from a voice recorder with none. Title his in HIS words, never a " +
                "summary of them."
            ),
          state: z
            .enum(["resolved", "reviewed", "partial", "blocked", "open"])
            .optional()
            .describe(
              "read back only the cards in this state. `open` is an ABSENCE — no account at all, nobody has "
                + "even read it — and it is the group to drain first, because his cards arrive raw from a voice "
                + "recorder. REVIEWING ONE IS TWO ACTS, BOTH REQUIRED: title it in HIS words (titling is your job "
                + "on any card, not his), then stamp `reviewed — <what it actually is>`. A stamp with no title is "
                + "a claim you read something he still cannot point at."
            ),
          status: z
            .string()
            .optional()
            .describe("the card's account, in one line, with `at`. START IT WITH THE STATE — `reviewed`, `partial`, `blocked` or `resolved` — then the line: \"reviewed — he wants a post-commit hook per project\", \"partial — the panel half only\", \"blocked — waiting on his press\", \"resolved — cause written into the gap file\". Each word is a thing HE does next: `reviewed` says you READ his card and understood it (and you title it in the same motion — a stamp with no title claims you read something he still cannot point at), `partial` asks nothing, `blocked` is the only one that is a request, `resolved` means he reads one line and deletes the card. A card with no status is `open` — nobody has even read it, and `open` is the only state nobody writes: every other one is a CLAIM you are making, which is why none of them is derived. The word is not decoration: his board filters and clears by it, and an account that does not start with one is read as UNACCOUNTED and never swept, however well it reads. One slot: a second status replaces the first, an empty string clears it. Never stamp a state on his behalf to tidy the board."),
          removeSettled: z
            .boolean()
            .optional()
            .describe("take off EVERY card carrying a status, in one motion — every text and its account are handed back. Use after a pass that set statuses as it went; nothing settled answers removed: 0 rather than failing."),
          remove: z
            .union([z.string(), z.number()])
            .optional()
            .describe("the ID of a card to take off the board — its id, never its position; the removed text is handed back so it is never lost in the act"),
        },
        async (a) => {
          try {
            const r = await hub("Agent", "board", { ...a, as: who });
            if (r && r.notes) {
              const lines = (r.notes || []).map((n, i) => `${i + 1}. ${typeof n === "string" ? n : n.text || JSON.stringify(n)}`);
              return text([`board — ${r.project}${r.board !== "board" ? ` · ${r.board}` : ""}`, ...lines].join("\n"));
            }
            // A REFUSAL CARRIES THE HUB'S OWN REASON. This read `"board op failed"` and nothing
            // else, so every refusal the door makes — an id that does not exist, a POSITION where
            // an id was required, an unsigned write, a project the hub has never heard of — arrived
            // as one sentence indistinguishable from the hub being down, and the ids the error
            // helpfully lists were thrown away with it. Same bug `show` had and the same fix
            // (tests/show.js §6); caught here by tests/board.js §6 rather than by an agent aiming
            // the same wrong id twice.
            // A REFUSAL IS ONLY USEFUL IF THE WAY OUT IS READABLE. The id list grew titles
            // ({ts, title}) so a caller could choose between them, and this still joined the
            // objects — printing `[object Object]` twenty-eight times, which is a refusal with its
            // own answer removed. Caught by using it, a minute after shipping it.
            if (r && (r.ok === false || r.error)) {
              const idLine = (list) =>
                (list || [])
                  .map((x) => (x && typeof x === "object" ? `${x.ts}${x.title ? ` · ${x.title}` : ""}` : String(x)))
                  .join("\n  ");
              return text(
                `the board refused that: ${r.error || "no reason given"}` +
                  (r.matches ? `\nmatches:\n  ${idLine(r.matches)}` : "") +
                  (r.ids ? `\ncards on it:\n  ${idLine(r.ids)}` : "")
              );
            }
            return text(JSON.stringify(r, null, 2));
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "comments",
        "His code comments — read a file's threads or reply to one (at a line).",
        {
          projectCode: z.string(),
          path: z.string().optional().describe("repo-relative file path; omit to list commented files"),
          replyText: z.string().optional(),
          at: z.union([z.string(), z.number()]).optional().describe("line or range the reply targets"),
        },
        async (a) => {
          try {
            const r = await hub("Agent", "comments", { ...a, as: who });
            return text(typeof r === "object" ? JSON.stringify(r, null, 2) : String(r));
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "nav",
        "Drive the open window to a place, saying WHICH KIND explicitly — exactly one of " +
          "namespace | file | report | stats | agents. The caller always knows what it is " +
          "sending him to; the code never guesses (his rule, after a slash-namespace opened " +
          "an empty stage).",
        {
          projectCode: z.string(),
          namespace: z.string().optional().describe("DOT notation — Service.Module.method"),
          file: z.string().optional().describe("repo-relative code file path; #L10-20 ranges work"),
          report: z.string().optional().describe("a report's .md path; #L ranges work"),
          stats: z.string().optional().describe("the Stats page — 'open', or a tab: state|load|reliability|coverage|change|topology|coupling"),
          agents: z.boolean().optional().describe("the Agents page"),
        },
        async ({ projectCode, namespace, file, report, stats, agents }) => {
          try {
            const r = await hub("Agent", "nav", { projectCode, namespace, file, report, stats, agents, as: who });
            // A REFUSAL SAYS WHY. The old door answered "nav failed" for a namespace that does not
            // exist, one that is ambiguous, a bad stats tab and an unknown service alike — four
            // different problems, one useless sentence. The hub already knows which; say it.
            if (!r || !r.ok) return text(`nav refused — ${(r && r.error) || "no reason given"}${r && r.candidates ? `\n  ${r.candidates.slice(0, 8).join("\n  ")}` : ""}`);
            return text(`navigated → ${r.label}`);
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "refresh",
        "Ask the open window's panes to re-read their data (docs | reports | nav | stats | all) — never a page reload.",
        { projectCode: z.string(), pane: z.string() },
        async ({ projectCode, pane }) => {
          try {
            const r = await hub("Agent", "refresh", { projectCode, scope: pane, as: who });
            return text(r && r.ok ? r.label : `refresh refused — ${(r && r.error) || "no reason given"}`);
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "act",
        "Press things in the OPEN window where he can watch: run a saved test visibly " +
          "(kind=test, target=Module.method|all) or press a :::run block's play (kind=run, " +
          "target=the block's title). The demo-what-works muscle.",
        { projectCode: z.string(), kind: z.enum(["test", "run"]), target: z.string(), say: z.string().optional() },
        async ({ projectCode, kind, target, say }) => {
          try {
            const r = await hub("Agent", "act", { projectCode, [kind]: target, as: who, say });
            return text(r && r.ok ? r.label : `act refused — ${(r && r.error) || "no reason given"}`);
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "highlight",
        "Point at something in the open window — a row, a region — without navigating.",
        {
          projectCode: z.string(),
          target: z.string().optional().describe("Service.Module.method — fuzzy, resolved against the live tree"),
          file: z.string().optional().describe("a repo-relative file path, instead of a namespace"),
          say: z.string().optional(),
        },
        async ({ projectCode, target, file, say }) => {
          try {
            const r = await hub("Agent", "highlight", { projectCode, ...(file ? { file } : { namespace: target }), as: who, say });
            if (!r || !r.ok) return text(`highlight refused — ${(r && r.error) || "no reason given"}${r && r.candidates ? `\n  ${r.candidates.slice(0, 8).join("\n  ")}` : ""}`);
            return text(r.label);
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "connect",
        "Register a running SystemLynx service (and its whole project manifest) with the hub by " +
          "URL — e.g. right after starting a test service. Its tests, logs and stats become " +
          "reachable through the other tools.",
        { url: z.string().describe("the service's connection URL, e.g. http://localhost:4100/bu/api/profiles") },
        async ({ url }) => {
          try {
            const r = await hub("Agent", "connect", { url });
            const got = (r && r.connected) || [];
            return text(got.length ? `connected: ${got.map((s) => `${s.projectCode}/${s.serviceId}`).join(", ")}` : `nothing registered from ${url} — is it running?`);
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "disconnect",
        "Deregister a service (or a whole project) from the hub.",
        { projectCode: z.string(), serviceId: z.string().optional() },
        async (a) => {
          try {
            const r = await hub("Agent", "disconnect", a);
            return text(r && r.ok ? `disconnected ${a.projectCode}${a.serviceId ? `/${a.serviceId}` : ""}` : `disconnect failed${r && r.error ? ` — ${r.error}` : ""}`);
          } catch (e) { return fail(e); }
        }
      ),
      // LOOKING AT THE WINDOW — the one tool here that calls NO hub method. A capture is the
      // harness's own capability (this server runs inside the main process, so `BrowserWindow` is
      // simply in scope), which also means a stale or stopped hub cannot take it away: when
      // something is wrong enough that the agent needs to see the screen, the hub is exactly what
      // is most likely to be down.
      //
      // IT RETURNS THE PICTURE, NOT A PATH TO ONE. An MCP result can carry an image block, so the
      // model receives the pixels in the same turn it asked for them — a path would mean a second
      // hop through a file reader, and an agent that has to ask twice to look will stop looking.
      // The text line beside it is for the chat feed, which only ever sees text.
      // RFC-071 — WHAT AM I ON? A document carries its members in its own `::members` line, so this
      // asks the hub to walk the project and answer two questions with one read: which documents
      // name me, and which of those have changed since whoever is on them was last told. An agent
      // woken by a `document.updated` hook uses it to see the rest of what it is sitting on.
      tool(
        "documents",
        "The documents in a project that carry MEMBERS — who is on each one, and who has not been told about the current version. " +
          "Pass `member` to ask only about one (usually yourself: \"what am I on?\"). Membership lives in the document itself as a " +
          "`::members{who=a|b}` line, so it is his to edit and yours to read — never a registry somewhere else. A document with no " +
          "members is not listed at all.",
        {
          projectCode: z.string(),
          member: z.string().optional().describe("only documents this project code is on — usually your own"),
        },
        async (a) => {
          try {
            const r = await hub("Agent", "documents", { ...a });
            if (!r || r.error) return text(`no answer: ${(r && r.error) || "the hub said nothing"}`);
            if (!r.documents.length)
              return text(a.member ? `${a.member} is not on any document in ${r.project}` : `no document in ${r.project} has members`);
            const lines = r.documents.map(
              (d) => `${d.behind.length ? "•" : " "} ${d.path} — ${d.who.join(", ")}${d.behind.length ? ` (behind: ${d.behind.join(", ")})` : ""}`
            );
            return text(
              [`${r.withMembers} document${r.withMembers === 1 ? "" : "s"} with members · ${r.withUpdates} with unsent updates`, ...lines].join("\n")
            );
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "shot",
        "PHOTOGRAPH HIS WINDOW and look at it. Returns the picture itself, plus where it was " +
          "filed. Use it whenever you have changed a surface and are about to CLAIM something " +
          "about how it looks or reads — a field that renders, a control that appears, a layout " +
          "that holds — because tests and source cannot see any of that, and he should not have " +
          "to be your eyes. Captures the FOCUSED window, whatever page is in it. Put the file in " +
          "your reply as a ::file block if he should see what you saw.",
        {
          label: z
            .string()
            .optional()
            .describe("a few words for the filename — what you are looking at, e.g. \"board after the chip landed\""),
          title: z
            .string()
            .optional()
            .describe("photograph the window whose title contains this instead of the focused one"),
        },
        async ({ label, title }) => {
          try {
            const { BrowserWindow } = require("electron");
            const r = await shot.capture({ windows: BrowserWindow.getAllWindows(), label, title });
            if (!r || r.error)
              return text(
                `no photograph — ${(r && r.error) || "the capture did not happen"}` +
                  (r && r.titles ? `\nopen windows: ${r.titles.map((t) => `"${t}"`).join(", ")}` : ""),
              );
            return {
              content: [
                {
                  type: "text",
                  text:
                    `photographed "${r.window}" (${r.why}) — ${r.width}×${r.height}, ${Math.round(r.bytes / 1024)}kb\n` +
                    `filed as ${r.path}` +
                    (r.pruned ? `\npruned ${r.pruned} older shot${r.pruned === 1 ? "" : "s"}` : ""),
                },
                { type: "image", data: r.png.toString("base64"), mimeType: "image/png" },
              ],
            };
          } catch (e) { return fail(e); }
        }
      ),
    ];
  return built;
}

// ONE DEFINITION, TWO READERS: `serverFor` wraps these for the SDK, and a test holds the handler and
// calls it. Built fresh per call because each carries this identity's injected doors.
function serverFor(identity = {}) {
  return createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: toolsFor(identity) });
}

module.exports = { SERVER, TOOL_NAMES, serverFor, toolsFor };
