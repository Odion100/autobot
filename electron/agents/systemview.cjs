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
const { z } = require("zod");

const SERVER = "systemview";
const HUB = () => `http://localhost:${process.env.SV_PORT || 3000}/systemview/api`;
const TOOL_NAME = (t) => `mcp__${SERVER}__${t}`;
const TOOL_NAMES = [
  "runTests", "probe", "projects", "logs", "stats",
  "show", "tv", "reply", "board", "comments",
  "nav", "refresh", "act", "highlight",
  "connect", "disconnect",
  "terminal", "terminals",
].map(TOOL_NAME);

async function hub(moduleName, fn, arg) {
  let res;
  try {
    res = await fetch(`${HUB()}/${moduleName}/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ __arguments: arg === undefined ? [] : [arg] }),
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
  if (r.ms != null) foot.push(`${r.ms}ms`);
  if (Array.isArray(r.unreachable) && r.unreachable.length)
    foot.push(`did not answer: ${r.unreachable.map((u) => `${u.serviceId} (${u.at})`).join(", ")}`);
  if (r.stoppedEarly) foot.push(`stopped early — ${r.notRun} not run`);
  return [head, "", ...lines, ...(foot.length ? ["", foot.join("  ·  ")] : [])].join("\n");
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

function serverFor(identity = {}) {
  const who = identity.slot || identity.projectCode || null;
  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
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
        "projects",
        "List the connected projects and their services — what the hub can reach right now.",
        {},
        async () => {
          try { return text(renderList(await hub("Agent", "listTests", {}))); } catch (e) { return fail(e); }
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
        "Put a document on the project's TV (beside the chat). Markdown text or an existing " +
          "report path; it is filed as a report automatically. Use for anything long or with " +
          "choices (::question / :::approval blocks) — the chat line stays short.",
        {
          projectCode: z.string(),
          text: z.string().optional().describe("the markdown to show"),
          reportPath: z.string().optional().describe("an existing .md file to show instead of text"),
          clear: z.boolean().optional().describe("take the show down"),
        },
        async ({ projectCode, text: md, reportPath, clear }) => {
          try {
            const r = await hub("Agent", "show", { projectCode, text: md, reportPath, clear, as: who });
            return text(r && r.ok ? (clear ? "TV cleared." : "The show is up.") : "The show did not go up.");
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
        "His board — the notes he accumulates for agents between sessions. Read it, or add a " +
          "note / reply to one.",
        {
          projectCode: z.string(),
          name: z.string().optional().describe("a named board; default is the main one"),
          add: z.string().optional().describe("a note to add"),
          replyText: z.string().optional().describe("a reply to an existing note"),
          at: z.union([z.string(), z.number()]).optional().describe("which note the reply targets"),
        },
        async (a) => {
          try {
            const r = await hub("Agent", "board", { ...a, as: who });
            if (r && r.notes) {
              const lines = (r.notes || []).map((n, i) => `${i + 1}. ${typeof n === "string" ? n : n.text || JSON.stringify(n)}`);
              return text([`board — ${r.project}${r.board !== "board" ? ` · ${r.board}` : ""}`, ...lines].join("\n"));
            }
            return text(r && r.ok === false ? "board op failed" : JSON.stringify(r, null, 2));
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
    ],
  });
}

module.exports = { SERVER, TOOL_NAMES, serverFor };
