// Phase 1 of the modernization (see report: browser-loop-assessment).
// AX-grounded action core: drives a browser through Playwright MCP over stdio.
// This lives UNDER the driver boundary — consumers still talk to driver, and when
// agentci ships `this.mcp()` this client can be swapped out without touching callers.
import { readFile } from "fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const text = (result) =>
  (result.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

// Recent @playwright/mcp versions write the aria snapshot to a file and return a
// link to it. Inline it so callers always get the refs in the returned text.
async function inlineSnapshot(t) {
  const m = t.match(/\[Snapshot\]\(([^)]+\.yml)\)/);
  if (!m) return t;
  try {
    return `${t}\n### Snapshot (inlined)\n${await readFile(m[1], "utf8")}`;
  } catch {
    return t;
  }
}

// cdpEndpoint attaches the action lane to an EXISTING Chromium (the Electron shell)
// instead of launching one — the seam that makes the shell and the MCP lane one browser.
export function createAxCore({ headless = false, browser = "chrome", cdpEndpoint = null } = {}) {
  let client = null;

  const call = async (name, args = {}) => {
    if (!client) throw new Error("axCore not started — call start() first");
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`${name} failed: ${text(result)}`);
    return inlineSnapshot(text(result));
  };

  return {
    async start() {
      const args = ["@playwright/mcp"];
      if (cdpEndpoint) args.push("--cdp-endpoint", cdpEndpoint);
      else {
        args.push("--browser", browser);
        if (headless) args.push("--headless");
      }
      const transport = new StdioClientTransport({ command: "npx", args });
      client = new Client({ name: "autobot-driver", version: "1.0.0" });
      await client.connect(transport);
      return this;
    },

    async stop() {
      if (!client) return;
      try {
        await call("browser_close");
      } catch {
        // browser may already be gone; transport close below is what matters
      }
      await client.close();
      client = null;
    },

    // Every navigation/action response embeds the page snapshot — stable [ref=...]
    // ids per load. The snapshot IS the observation; no vision call in this path.
    navigate: (url) => call("browser_navigate", { url }),
    snapshot: () => call("browser_snapshot"),

    // target = the [ref=...] id from the snapshot (or a unique selector);
    // element = human-readable description, kept for the audit trail.
    click: ({ element, ref, target }) =>
      call("browser_click", { element, target: target ?? ref }),
    type: ({ element, ref, target, text: t, submit = false }) =>
      call("browser_type", { element, target: target ?? ref, text: t, submit }),
    pressKey: (key) => call("browser_press_key", { key }),

    // The piece the 2024 loop never had: assert the ACTION'S EFFECT, not the selection.
    // Every skill step will carry one of these; mismatch means retry-then-replan.
    async verify({ urlIncludes, snapshotIncludes } = {}) {
      const snap = await this.snapshot();
      const failures = [];
      if (urlIncludes && !snap.includes(urlIncludes))
        failures.push(`url/page missing "${urlIncludes}"`);
      if (snapshotIncludes && !snap.includes(snapshotIncludes))
        failures.push(`snapshot missing "${snapshotIncludes}"`);
      return { ok: failures.length === 0, failures, snapshot: snap };
    },

    listTools: async () => {
      const { tools } = await client.listTools();
      return tools.map((t) => t.name);
    },
  };
}
