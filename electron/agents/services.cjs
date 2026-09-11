// THE THIRD TIER — SystemLynx services, attachable at runtime.
//
// His model, and the distinction is real rather than cosmetic:
//
//   tools           fixed at build time      the harness's own
//   MCP servers     fixed at session start   anyone's, standard, shallow
//   services        ATTACHABLE ANY TIME      ours, catalog + schemas + reach
//
// Only the third row can change mid-session, and it is the only one where we own both
// ends. That is why it gets its own tier instead of being folded into MCP.
//
// WHY THIS DOESN'T NEED `notifications/tools/list_changed` (uneven client support, a bet
// we would rather not place): THE TOOL LIST NEVER CHANGES. It is always attach/list/call.
// What changes is what is INDEXED and what `call` can reach — so an agent gains real reach
// mid-session while the protocol surface sits perfectly still. Dynamic where it matters,
// static where the standard is brittle.
//
// NAMING: `loadService`, the framework's own verb, and deliberately so. The first pass
// avoided it to keep the wrapper from claiming to BE `Client.loadService` — but naming the
// SERVER `systemlynx` already solved that: `mcp__systemlynx__loadService` reads as the
// SystemLynx tier's load verb, not as the client method. His call, and the reasoning is
// that in this context it is not lying — attaching a handle IS loading the service.
// Familiarity wins: anyone in this ecosystem already knows the word.
const fs = require("fs");
const path = require("path");
const os = require("os");
const vectors = require("../apps/vectors.cjs");
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");

// NAMED FOR THE PROTOCOL IT SPEAKS, not the generic thing it resembles. "services" would
// promise any service and deliver one framework — this tier reads `connectionData`, sends
// `__arguments`, and assumes SystemLynx's route shape, so nothing else can be attached
// through it. It also has to survive the dogfood's own finding: this harness hands the model
// tool NAMES before descriptions, so `mcp__services__loadService` says nothing while
// `mcp__systemlynx__loadService` says exactly which protocol is about to be spoken.
// No collision with SystemLynx's own MCP servers — those are named per service in the
// whitelist (workbench, wb-repo), never this.
const SERVER = "systemlynx";
const TOOL_NAME = (t) => `mcp__${SERVER}__${t}`;
const COLLECTION = "mcp-tools"; // ONE index — discovery searches services and MCP servers together
const WHITELIST = path.join(os.homedir(), ".autobot", "services.json");

// THE WHITELIST IS THE WHOLE SECURITY MODEL, and it is a file so it is trivial to edit —
// his requirement: "just make it easy for me to whitelist. Very easy."
//
//   [{ "name": "workbench", "url": "http://localhost:6420/workbench" }]
//
// AGENTS PASS A NAME, NEVER A URL. `loadService(anyUrl)` would be a privilege-escalation
// primitive — an agent granting itself reach to anything routable — and it is the same
// concern SystemLynx refused a remote `serve()` over. A name can only resolve to something
// he already approved, so the worst an agent can do is attach a service he chose to list.
function whitelist() {
  try {
    const raw = JSON.parse(fs.readFileSync(WHITELIST, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.services || [];
    return list.filter((s) => s && s.name && s.url).map((s) => ({ name: String(s.name), url: String(s.url) }));
  } catch {
    return [];
  }
}

const attached = new Map(); // name -> { url, modules, indexed, mcp }

async function getJSON(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text.trimStart().startsWith("{")
    ? text
    : (text.match(/^data:\s*(.+)$/gm) || []).map((l) => l.replace(/^data:\s*/, "")).pop();
  if (!body) throw new Error(`no JSON from ${url}`);
  return JSON.parse(body);
}

const rpc = (url, method, params, id) =>
  getJSON(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params || {} }),
  }).then((m) => {
    if (m.error) throw new Error(m.error.message || "rpc error");
    return m.result;
  });

// TWO READS, ONE ATTACH — and his correction is the reason for the second one:
// connectionData gives 661 method NAMES and nothing about how to use them. Schemas and
// descriptions live on the MCP surface. Indexing the manifest alone would produce a
// searchable list of names with nothing behind them.
function sameOrigin(candidate, trusted) {
  if (!candidate || typeof candidate !== "string") return false;
  try {
    const a = new URL(candidate);
    const b = new URL(trusted);
    return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
  } catch {
    return false;
  }
}

async function attach(name) {
  const entry = whitelist().find((s) => s.name === name);
  if (!entry) throw new Error(`"${name}" is not a whitelisted service`);

  // 1 — the catalog, and the reach. Every SystemLynx service publishes this by construction.
  const conn = await getJSON(entry.url);
  // SAME-ORIGIN OR NOTHING. `conn.serviceUrl` arrives in the RESPONSE BODY, and it becomes the
  // base for every MCP handshake and every later `call()`. Trusting it means the whitelist pins
  // the door and not the destination: a compromised or simply mistaken entry could redirect all
  // subsequent traffic to an arbitrary host, and nothing would look wrong.
  //
  // This is the SAME CLASS as the Host-header SSRF found in SystemLynx's MCP during the dogfood —
  // a value off the wire deciding where the next request goes. Caught there, then written here.
  // Found by autobot on review, 2026-09-08.
  //
  // A service may still refine its own URL (a path, a port it actually bound); it may not move
  // to another origin. Mismatch is not an error — we simply keep the address he whitelisted.
  const serviceUrl = sameOrigin(conn.serviceUrl, entry.url) ? conn.serviceUrl : entry.url;
  const modules = (conn.modules || []).map((m) => ({
    name: m.name,
    route: m.route,
    methods: (m.methods || []).map((x) => x.fn).filter(Boolean),
  }));

  // 2 — the schemas. `mcp` is published in connectionData (SystemLynx added it during the
  // MCP pass) so this is discovered, never configured. `kind: "served"` is a CURATED surface
  // and `kind: "module"` is the mechanical per-module one — prefer the curated route when a
  // service offers both, which is the exposure-filter distinction the field exists for.
  const routes = Array.isArray(conn.mcp) ? conn.mcp : [];
  const preferred = routes.filter((r) => r.kind === "served");
  const use = preferred.length ? preferred : routes;
  const schemas = new Map();
  for (const r of use) {
    const url = `${serviceUrl.replace(/\/+$/, "")}/${String(r.path).replace(/^\/+/, "")}`;
    try {
      await rpc(url, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "autobot", version: "1.0.0" } }, 1).catch(() => {});
      for (const t of (await rpc(url, "tools/list", {}, 2))?.tools || []) schemas.set(t.name, t);
    } catch {}
  }

  // 3 — index. EVERY method is indexed, whether or not it has a schema; a method with no
  // MCP entry is still findable by name and module, it just carries less. Schemas are the
  // spine, prose is enrichment — absence degrades a hit, it never breaks the index.
  const docs = [];
  for (const m of modules)
    for (const fn of m.methods) {
      const ns = `${m.name}.${fn}`;
      const t = schemas.get(ns) || schemas.get(fn);
      const props = t?.inputSchema?.properties || {};
      const req = new Set(t?.inputSchema?.required || []);
      const params = Object.entries(props).map(([k, v]) => {
        const type = Array.isArray(v?.type) ? v.type.join("|") : v?.type || "any";
        return `${k} (${type}${req.has(k) ? ", required" : ""})${v?.description ? " — " + v.description : ""}`;
      });
      docs.push({
        id: `${name}::${ns}`,
        text: [
          `${ns} on the ${name} service — ${t?.description || "no description"}`,
          params.length ? `Parameters: ${params.join("; ")}` : t ? "Takes no parameters." : "",
        ].filter(Boolean).join("\n"),
        // THE POINTER IS WHAT MAKES A HIT USABLE: everything `callService` needs, so a
        // found method is callable without a second lookup.
        meta: {
          kind: "service",
          service: name,
          serviceUrl,
          module: m.name,
          fn,
          namespace: ns,
          route: m.route,
          callable: `${TOOL_NAME("call")} with service="${name}", namespace="${ns}"`,
          described: !!t,
          description: t?.description || "",
        },
      });
    }

  // Replace this service's records only — attaching one service must not blow away another's.
  // Scoped to THIS service: a method removed upstream vanishes because it is absent from
  // the replacement, and no other service's records are touched.
  await vectors.replaceWhere(COLLECTION, { kind: "service", service: name }, docs);
  const rec = {
    url: serviceUrl,
    modules: modules.map((m) => m.name),
    methods: docs.length,
    methodList: docs.map((d) => ({ namespace: d.meta.namespace, module: d.meta.module, described: !!d.meta.described })),
    described: docs.filter((d) => d.meta.described).length,
    mcpRoutes: use.map((r) => r.path),
    indexed: new Date().toISOString(),
  };
  attached.set(name, rec);
  return { service: name, ...rec };
}

// THE INVOKER. One tool routes every method on every attached service, which is the whole
// context argument: two tool names, flat, whether the estate is 6 methods or 661. It is also
// the single place per-method policy, call recording and audit can ever live — 661 declared
// tools would be 661 places.
async function call(service, namespace, args) {
  const rec = attached.get(service);
  if (!rec) throw new Error(`"${service}" is not attached — attach it first`);
  const [moduleName, fn] = String(namespace).split(".");
  if (!moduleName || !fn) throw new Error(`namespace must be Module.method, got "${namespace}"`);
  const url = `${rec.url.replace(/\/+$/, "")}/${moduleName}/${fn}`;
  // SystemLynx methods are VARIADIC and `req.arguments` is an ARRAY — a caller that sends one
  // object as the whole shape mislabels every multi-arg method. Accept either, send an array.
  const list = Array.isArray(args) ? args : args === undefined ? [] : [args];
  return getJSON(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ __arguments: list }),
  });
}

function serverFor() {
  return createSdkMcpServer({
    name: SERVER,
    version: "1.0.0",
    tools: [
      tool(
        "services",
        "List the SystemLynx services you can attach and the ones already attached. " +
          "Attached services have all their methods searchable through the findTool tool.",
        {},
        async () => {
          const wl = whitelist();
          if (!wl.length)
            return { content: [{ type: "text", text: `No services are whitelisted. They are listed in ${WHITELIST}.` }] };
          const lines = wl.map((s) => {
            const a = attached.get(s.name);
            return a
              ? `  ${s.name} — ATTACHED · ${a.methods} methods across ${a.modules.join(", ")} (${a.described} with schemas)`
              : `  ${s.name} — available · ${s.url}`;
          });
          return { content: [{ type: "text", text: `Services:\n${lines.join("\n")}` }] };
        },
        { alwaysLoad: true }
      ),
      tool(
        "loadService",
        "Attach a whitelisted SystemLynx service so every one of its methods becomes " +
          "searchable through findTool and callable through the call tool. Reads the service's " +
          "own catalog and MCP schemas — nothing needs to be configured. Takes a service NAME " +
          "from the services tool, never a URL.",
        { name: z.string().describe("the service name, as listed by the services tool") },
        async ({ name }) => {
          try {
            const r = await attach(name);
            return {
              content: [{
                type: "text",
                text:
                  `Attached ${r.service}: ${r.methods} methods across ${r.modules.join(", ")} (${r.described} carry schemas).\n\n` +
                  (r.methodList || []).map((m) => `${m.namespace}${m.described ? " [schema]" : ""}`).join("\n"),
              }],
            };
          } catch (e) {
            return { content: [{ type: "text", text: `Could not attach "${name}": ${e.message}` }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
      tool(
        "call",
        "Call a method on an attached SystemLynx service. Use findTool first to find the " +
          "right namespace. Returns the service's own response, including its status.",
        {
          service: z.string().describe("the attached service name"),
          namespace: z.string().describe("Module.method, e.g. Repo.findRfc"),
          arguments: z.any().optional().describe("one object for an object-shaped method, or an array for a variadic one"),
        },
        async ({ service, namespace, arguments: args }) => {
          try {
            const r = await call(service, namespace, args);
            // WRITTEN FOR A READER — status first as a sentence (never flattened to ok/failed: an
            // in-method 400 usually means THE CALLER SENT THE WRONG SHAPE, which is the finding),
            // then the return value alone. The envelope's plumbing fields stay out of the log.
            const head = `${namespace} returned ${r.status}${r.status >= 400 && r.message ? ` — ${r.message}` : ""}`;
            const payload = r.returnValue !== undefined ? JSON.stringify(r.returnValue, null, 2) : JSON.stringify(r, null, 2);
            return { content: [{ type: "text", text: `${head}\n\n${payload}`.slice(0, 40000) }] };
          } catch (e) {
            return { content: [{ type: "text", text: `${namespace} failed: ${e.message}` }], isError: true };
          }
        },
        { alwaysLoad: true }
      ),
    ],
  });
}

module.exports = { SERVER, COLLECTION, WHITELIST, serverFor, attach, call, whitelist, attached, TOOL_NAMES: ["services", "loadService", "call"].map(TOOL_NAME) };
