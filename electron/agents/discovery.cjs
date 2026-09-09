// MCP DISCOVERY — one tool that finds the others.
//
// HIS DESIGN (2026-09-08), and it is better than the plugin idea it replaced: not a
// SystemLynx plugin, not a framework concern — a SEPARATE SERVICE IN THE HARNESS whose
// only job is discovery across the other MCP servers an agent is wired to. SystemLynx
// changes nothing, and the result is not SystemLynx-specific: it works for any MCP server.
//
// WHY THE HARNESS IS THE ONLY PLACE THIS CAN LIVE: the harness holds `mcpServers` per
// agent. Nothing else sees the full set, so nothing else can answer a question that spans
// two servers.
//
// WHAT IT FIXES, in RFC-055's own words: "discovery answers what exists; curation is his."
// That sentence made him hand-pick which endpoints an agent gets. Listing fifty per-module
// endpoints is the estate in a new costume. You do not curate the list down — you QUERY it,
// and curation stops being maintained labour.
const vectors = require("../apps/vectors.cjs");
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

const SERVER = "discovery";
const TOOL = "findTool";
const TOOL_NAME = `mcp__${SERVER}__${TOOL}`;
const COLLECTION = "mcp-tools";
// Below this a "match" is noise. Set from the measured distribution rather than taste:
// across the live workbench servers every correct answer scored 0.53-0.69 and an
// off-topic control ("how do I bake sourdough bread") returned nothing at 0.55.
const FLOOR = 0.45;

// The index is DERIVED — rebuilt from tools/list, never hand-authored. Refreshed on a
// timer rather than incrementally: tool counts are in the tens, a full rebuild is about a
// second, and incremental cleverness would buy nothing but a class of staleness bugs.
const TTL_MS = 5 * 60 * 1000;
let _indexedAt = 0;
let _indexing = null;

async function rpc(url, method, params, id) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} }),
  });
  const text = await res.text();
  // Streamable-HTTP servers may answer as SSE even for a single response; take the last
  // data: frame. A JSON body parses directly.
  const body = text.trimStart().startsWith("{")
    ? text
    : (text.match(/^data:\s*(.+)$/gm) || []).map((l) => l.replace(/^data:\s*/, "")).pop();
  if (!body) throw new Error(`no JSON-RPC body from ${url}`);
  const msg = JSON.parse(body);
  if (msg.error) throw new Error(msg.error.message || "rpc error");
  return msg.result;
}

async function toolsOf(name, url) {
  // initialize first — many servers refuse tools/list before the handshake, and a server
  // that does not need it ignores this harmlessly.
  try {
    await rpc(url, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "autobot-discovery", version: "1.0.0" },
    }, 1);
  } catch {}
  const result = await rpc(url, "tools/list", {}, 2);
  return (result?.tools || []).map((t) => ({ server: name, ...t }));
}

// WHAT GETS EMBEDDED, and this is the part that decides whether retrieval works: NOT the
// raw schema JSON. Braces and `"type":"string"` are noise that drags every vector toward
// every other one. A rendered sentence instead — name, description, and PARAMETER NAMES,
// which carry real signal (the same property that made SystemLynx's input-fiction check
// possible: a destructured parameter name is load-bearing, not decoration).
function render(t) {
  const props = t.inputSchema?.properties || {};
  const required = new Set(t.inputSchema?.required || []);
  const params = Object.entries(props).map(([k, v]) => {
    const type = Array.isArray(v?.type) ? v.type.join("|") : v?.type || "any";
    const desc = v?.description ? ` — ${v.description}` : "";
    return `${k} (${type}${required.has(k) ? ", required" : ""})${desc}`;
  });
  return [
    `${t.name} — ${t.description || "no description"}`,
    params.length ? `Parameters: ${params.join("; ")}` : "Takes no parameters.",
  ].join("\n");
}

// THE POINTER IS THE PAYLOAD. `callable` is the WIRE name (mcp__<server>__<Module>_<method>)
// because of a finding from the dogfood that cost real time: the dotted `Repo.findRfc` path
// exists NOWHERE a consumer can see. A discovery tool returning dotted paths would hand back
// names nobody can call.
async function reindex(servers) {
  const found = [];
  const failed = [];
  await Promise.all(
    servers.map(async ({ name, url }) => {
      try {
        found.push(...(await toolsOf(name, url)));
      } catch (e) {
        failed.push(`${name}: ${e.message}`);
      }
    })
  );
  // SCOPED, never index(): this collection is shared with loadService, and a full replace
  // here silently deleted every attached service's methods (measured: 11 records -> 4).
  // Each writer owns its own scope and nothing else.
  if (found.length || failed.length < servers.length)
    await vectors.replaceWhere(
      COLLECTION,
      { kind: "mcp" },
      found.map((t) => ({
        id: `${t.server}::${t.name}`,
        text: render(t),
        meta: {
          kind: "mcp",
          server: t.server,
          tool: t.name,
          // MANGLED, not concatenated. tools/list reports `Repo.findRfc`; the name an agent
          // can actually call is `mcp__wb-repo__Repo_findRfc`. Verified against this very
          // session's tool list. Building the callable by naive concatenation would return a
          // name that looks right and does not exist — the confident-wrong-answer failure,
          // reproduced by the tool built to prevent it.
          callable: `mcp__${t.server}__${t.name.replace(/[^a-zA-Z0-9_]/g, "_")}`,
          description: t.description || "",
        },
      }))
    );
  _indexedAt = Date.now();
  return { indexed: found.length, servers: servers.length, failed };
}

function ensureIndexed(servers, force) {
  if (!force && Date.now() - _indexedAt < TTL_MS) return Promise.resolve(null);
  if (!_indexing) _indexing = reindex(servers).finally(() => (_indexing = null));
  return _indexing;
}

// The server list comes from the SAME record the SDK gets, so discovery can never describe
// a server the agent is not actually wired to — the presence principle from RFC-055 applied
// one layer down: the thing doing the connecting is the thing that reports the connection.
function serversFrom(record) {
  return Object.entries(record || {})
    .filter(([, spec]) => spec && typeof spec.url === "string")
    .map(([name, spec]) => ({ name, url: spec.url }));
}

function serverFor(mcpRecord) {
  const servers = serversFrom(mcpRecord);
  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
      tool(
        TOOL,
        "Find the right MCP tool for a job by describing what you want in plain language. " +
          "Searches the names, descriptions and parameters of every tool on every MCP server " +
          "this agent is connected to, and returns ranked candidates with the exact callable " +
          "name. Use it before assuming a capability does not exist, and instead of reading " +
          "long tool lists. Returns several candidates so YOU choose — it ranks, it does not decide.",
        {
          question: z.string().describe("what you are trying to do, in plain language"),
          server: z.string().optional().describe("narrow to one MCP server by name; omit to search all of them"),
          limit: z.number().optional().describe("how many candidates to return (default 5)"),
          refresh: z.boolean().optional().describe("force a re-read of every server's tool list first"),
        },
        async ({ question, server, limit, refresh }) => {
          if (!servers.length)
            return { content: [{ type: "text", text: "No MCP servers are wired to this agent, so there is nothing to search." }] };
          const built = await ensureIndexed(servers, refresh);
          // THE FLOOR IS NOT OPTIONAL. Without it `min` defaults to 0 and this tool ALWAYS
          // returns candidates — five least-irrelevant tools, labelled "Candidates", for a
          // question nothing matches. That is precisely the failure the dogfood named
          // (MCP's failure mode is not errors, it is confident wrong answers), rebuilt
          // inside the thing meant to answer it. 0.45 comes from the measured spread: real
          // matches landed 0.53-0.69, and the off-topic control scored under it.
          const hits = await vectors.search(COLLECTION, question, {
            k: Math.min(Math.max(limit || 5, 1), 20),
            min: FLOOR,
            where: server ? { server } : undefined,
          });
          const scope = server ? `on ${server}` : `across ${servers.map((s) => s.name).join(", ")}`;
          // An honest empty, and it names the floor — "nothing scored above 0.45" is a fact a
          // caller can act on (rephrase, widen scope, accept the capability is absent);
          // a bare "no results" invites re-asking the same question forever.
          if (!hits.length)
            return {
              content: [{
                type: "text",
                text: `No tool ${scope} matches "${question}" (nothing scored above ${FLOOR}). ` +
                  `The capability may not exist here — say so rather than guessing at a tool name.`,
              }],
            };
          // Scores are reported, not hidden. The GAP between #1 and #2 is information — one
          // strong hit reads differently from five weak ones, and a caller that cannot see
          // the spread cannot tell those apart.
          const lines = hits.map(
            (h) => `${h.score.toFixed(3)}  ${h.meta.callable}\n        ${h.meta.description || "(no description)"}`
          );
          const note = built?.failed?.length ? `\n\n(could not read: ${built.failed.join("; ")})` : "";
          return { content: [{ type: "text", text: `Candidates ${scope}:\n\n${lines.join("\n")}${note}` }] };
        },
        { alwaysLoad: true }
      ),
    ],
  });
}

module.exports = { SERVER, TOOL, TOOL_NAME, COLLECTION, serverFor, reindex, render, serversFrom };
