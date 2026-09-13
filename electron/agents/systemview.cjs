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
  "runTests", "projects", "logs", "stats",
  "show", "tv", "reply", "board", "comments",
  "nav", "refresh", "act", "highlight",
  "connect", "disconnect",
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
    throw new Error(
      res.status === 404
        ? `${moduleName}.${fn} is not on the running hub — it is serving old code; restart the hub (systemview start)`
        : `${moduleName}.${fn}: hub answered ${res.status} with non-JSON`
    );
  }
  const body = JSON.parse(raw);
  if (body && body.status >= 400) throw new Error(body.message || `${moduleName}.${fn} returned ${body.status}`);
  return body ? body.returnValue : null;
}

const text = (s) => ({ content: [{ type: "text", text: String(s).slice(0, 40000) }] });
const fail = (e) => ({ content: [{ type: "text", text: e.message || String(e) }], isError: true });

// ---- renderers: the human-readable half of the feed contract ----

function renderRun(r) {
  if (r && r.error) return `${r.projectCode || "?"}: ${r.error}`;
  // DRY RUN IS THE LISTING (his call): what WOULD run, as bullets the feed tables know.
  if (r && r.dryRun) {
    const head = `${r.projectCode}: would run ${r.tests.length} test${r.tests.length === 1 ? "" : "s"}`;
    return [head, "", ...r.tests.map((t) => `• ${t.serviceId}.${t.moduleName}.${t.methodName} — "${t.title}"`)].join("\n");
  }
  const total = (r.passed || 0) + (r.failed || 0);
  const head = `${r.projectCode}: ${total} test${total === 1 ? "" : "s"} — ${r.passed} passed, ${r.failed} failed`;
  const lines = (r.tests || []).map((t) => {
    const ns = `${t.serviceId}.${t.moduleName}.${t.methodName}`;
    if (t.status !== "failed") return `✓ ${ns} — "${t.title}"`;
    // dig the failed evaluations out of whichever section carried them
    const details = [];
    for (const [section, entries] of Object.entries(t)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        for (const f of e.failedEvaluations || []) {
          const v = (f.validations || []).map((x) => x.message || JSON.stringify(x)).join("; ");
          details.push(`    ${section} "${e.title}": ${f.namespace} → ${v || "failed"}`);
        }
      }
    }
    return [`✗ ${ns} — "${t.title}"`, ...details].join("\n");
  });
  // the run's HANDLE — hub memory, no file; the chat row fetches and displays it on demand
  const handle = r.runId ? ["", `run: ${r.runId}`] : [];
  return [head, "", ...lines, ...handle].join("\n");
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
            return text(renderRun(await hub("CLI", "runTests", { projectCode, namespace, bail, dryRun })));
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "projects",
        "List the connected projects and their services — what the hub can reach right now.",
        {},
        async () => {
          try { return text(renderList(await hub("CLI", "listTests", {}))); } catch (e) { return fail(e); }
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
          try { return text(renderLogs(await hub("CLI", "getLogs", a))); } catch (e) { return fail(e); }
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
          try { return text(renderStats(await hub("CLI", "stats", a))); } catch (e) { return fail(e); }
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
            const r = await hub("CLI", "svShow", { projectCode, text: md, reportPath, clear, as: who });
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
            const state = await hub("CLI", "svTv", { projectCode, show });
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
            const r = await hub("CLI", "svReply", { projectCode, report, threadId, text: t, as: who });
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
            const r = await hub("CLI", "svBoard", { ...a, as: who });
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
            const r = await hub("CLI", "svComments", { ...a, as: who });
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
            const r = await hub("CLI", "svDrive", { projectCode, verb: "nav", namespace, file, report, stats, agents, as: who });
            const kind = namespace ? `namespace ${namespace}` : file ? `file ${file}` : report ? `report ${report}` : stats ? `stats${stats === "open" ? "" : ` ${stats}`}` : agents ? "agents" : "";
            return text(r && r.ok ? `navigated → ${kind || "nowhere"}` : "nav failed");
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "refresh",
        "Ask the open window's panes to re-read their data (docs | reports | nav | stats | all) — never a page reload.",
        { projectCode: z.string(), pane: z.string() },
        async ({ projectCode, pane }) => {
          try {
            const r = await hub("CLI", "svDrive", { projectCode, verb: "refresh", a: pane, as: who });
            return text(r && r.ok ? `refreshed ${pane}` : "refresh failed");
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
            const r = await hub("CLI", "svDrive", { projectCode, verb: "act", a: kind, b: target, as: who, say });
            return text(r && r.ok ? `pressed ${kind}: ${target}` : "act failed");
          } catch (e) { return fail(e); }
        }
      ),
      tool(
        "highlight",
        "Point at something in the open window — a row, a region — without navigating.",
        { projectCode: z.string(), target: z.string(), say: z.string().optional() },
        async ({ projectCode, target, say }) => {
          try {
            const r = await hub("CLI", "svDrive", { projectCode, verb: "highlight", a: target, as: who, say });
            return text(r && r.ok ? `highlighted ${target}` : "highlight failed");
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
            const r = await hub("CLI", "svConnect", { url });
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
            const r = await hub("CLI", "svDisconnect", a);
            return text(r && r.ok ? `disconnected ${a.projectCode}${a.serviceId ? `/${a.serviceId}` : ""}` : `disconnect failed${r && r.error ? ` — ${r.error}` : ""}`);
          } catch (e) { return fail(e); }
        }
      ),
    ],
  });
}

module.exports = { SERVER, TOOL_NAMES, serverFor };
