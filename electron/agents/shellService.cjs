// THE SHELL AS A SERVICE — the window's own state, served through the front door.
//
// Everything else in `electron/agents/` is an MCP server: tools for the session running inside this
// shell, carrying that session's identity. This file is the other kind of door, and it exists
// because of a gap the proof doctrine kept hitting: **a saved spec can only call a service method.**
// An agent-facing MCP tool cannot be a claim's living spec — nothing but an agent can press it — so
// every claim about what the WINDOW does had to be defended by jsdom, one altitude below the thing
// it claimed.
//
// So the shell hosts a SystemLynx service IN THIS PROCESS. In-process is the whole point: a separate
// `node` has no `BrowserWindow` and no `webContents`, which is why `systemview/service.js` (ping,
// echo, info) could never grow into this. These methods close over the live window.
//
// AND THE SAME MODULES ARE PUBLISHED AS MCP TOOLS, through SystemLynx's mounted MCP server — one
// artifact, two readers: `::test[AutobotShell.Window.read]` for a claim's defence, and an HTTP MCP
// endpoint for an agent that is not this session (another agent, another machine, eventually a
// visiting one). Publication is DECLARED, never inferred: a method is a tool only when it has a
// schema AND `expose` names it, which is why there is no `evaluate` anywhere below.
//
// READ-ONLY, DELIBERATELY. Nothing here clicks, navigates, reloads or writes. The window is his
// instrument; a door that could take it is not a proof door. `executeJavaScript` is used INTERNALLY
// to read the page and is never exposed — and every selector crosses that boundary as a JSON
// argument, never interpolated into the script body.
const path = require("path");

const docs = require("./docs.cjs");

const PORT = Number(process.env.AUTOBOT_SHELL_SERVICE_PORT) || 6110;
const HUB = process.env.SYSTEMVIEW_HOST || "http://localhost:3000/systemview/api";
const ROOT = path.resolve(__dirname, "..", "..");
const SERVICE_ID = "AutobotShell";

// A reader's answer is capped. A selector that matches `body` should not hand back a megabyte of
// markup — the cap is stated in the answer (`truncated`) rather than silently applied, because a
// truncated read that looks complete is the same lie a stale surface tells.
const MAX_NODES = 40;
const MAX_TEXT = 2000;

/**
 * @param deps.tabsNow  () => the shell's tab list, already in its reporting shape
 * @param deps.webContentsFor (appId) => the live webContents for that app's tab, or null
 */
module.exports = function startShellService({ tabsNow, webContentsFor } = {}) {
  const tabs = typeof tabsNow === "function" ? tabsNow : () => [];
  const wcFor = typeof webContentsFor === "function" ? webContentsFor : () => null;

  // THE ONE PLACE THE PAGE IS TOUCHED. `fn` is a function serialized to source and handed its
  // arguments as JSON — so a selector carrying a quote is data, never code. Returns an honest shape
  // when there is no window rather than throwing into the service.
  async function inPage(app, fn, args = []) {
    const wc = wcFor(app);
    if (!wc || wc.isDestroyed()) return { open: false, app, error: `no open ${app} tab in this shell` };
    try {
      const value = await wc.executeJavaScript(`(${fn.toString()}).apply(null, ${JSON.stringify(args)})`, true);
      return { open: true, app, ...value };
    } catch (err) {
      // The page refusing is a fact about the page, not an outage of this service.
      return { open: true, app, error: String((err && err.message) || err).slice(0, 300) };
    }
  }

  const Window = {
    // What this shell has open right now. The shell is the only thing that can answer honestly —
    // every other surface is reporting what it was last told.
    async tabs() {
      const list = tabs();
      return { ok: true, count: list.length, tabs: list };
    },

    // READ THE LIVE DOM. The defence a window-altitude claim could never have: not jsdom, not a
    // mock — the rendered page in the window he is looking at.
    async read({ selector, app = "systemview", limit = 10 } = {}) {
      if (!selector || typeof selector !== "string") return { ok: false, error: "selector is required" };
      const cap = Math.max(1, Math.min(MAX_NODES, Number(limit) || 10));
      const res = await inPage(
        app,
        (sel, n, maxText) => {
          const found = Array.from(document.querySelectorAll(sel));
          return {
            found: found.length,
            truncated: found.length > n,
            nodes: found.slice(0, n).map((el) => ({
              tag: el.tagName.toLowerCase(),
              className: typeof el.className === "string" ? el.className : "",
              text: (el.textContent || "").trim().slice(0, maxText),
              hidden: !!(el.offsetParent === null && getComputedStyle(el).display === "none"),
            })),
          };
        },
        [selector, cap, MAX_TEXT],
      );
      return { ok: !res.error, selector, ...res };
    },

    // Just the number. Cheaper than `read` and it is what most assertions actually want: "is there
    // exactly one `no spec` chip on this document".
    async count({ selector, app = "systemview" } = {}) {
      if (!selector || typeof selector !== "string") return { ok: false, error: "selector is required" };
      const res = await inPage(app, (sel) => ({ found: document.querySelectorAll(sel).length }), [selector]);
      return { ok: !res.error, selector, ...res };
    },

    // IS THE WINDOW RUNNING THE CODE ANYBODY JUST BUILT? The window self-updates but HOLDS the swap
    // until it costs him nothing (a hidden tab, or 90s idle) — correct behaviour that reads exactly
    // like a stale bundle, and the confusion once cost him his tabs six times in one session. This
    // makes the hold OBSERVABLE: what the page is running, what the server is serving, and whether
    // a swap is therefore waiting. Nothing here causes one.
    async bundle({ app = "systemview" } = {}) {
      const res = await inPage(app, async () => {
        const running = {
          js: Array.from(document.querySelectorAll("script[src]")).map((s) => s.src.split("/").pop()),
          css: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.href.split("/").pop()),
        };
        let served = null;
        try {
          const r = await fetch("/asset-manifest.json", { cache: "no-store" });
          const m = await r.json();
          const files = m && m.files ? m.files : {};
          served = {
            js: String(files["main.js"] || "").split("/").pop() || null,
            css: String(files["main.css"] || "").split("/").pop() || null,
          };
        } catch (e) {
          served = { error: String((e && e.message) || e).slice(0, 160) };
        }
        const holding =
          !!served && !served.error && !!served.js && !running.js.includes(served.js);
        return { running, served, holding };
      });
      return { ok: !res.error, ...res };
    },
  };

  // THE DOCUMENTATION HALF OF THE STORE, and only that half. Notes are agent-scoped lessons —
  // `context.search` takes the session's allowed scopes precisely so one agent cannot read
  // another's — and an HTTP endpoint has no session behind it. So an unauthenticated door must
  // never reach them. The corpora are the shared, retrievable half; this is what lets a claim about
  // retrieval ("`context("proof doctrine")` answers with the chapter") carry a real spec instead of
  // a note saying it was checked once by hand.
  const Docs = {
    async search({ q, corpus, source, limit = 5 } = {}) {
      if (!q || typeof q !== "string") return { ok: false, error: "q is required" };
      try {
        const hits = await docs.search({ q, corpus, source, limit: Math.max(1, Math.min(20, Number(limit) || 5)) });
        const list = Array.isArray(hits) ? hits : (hits && hits.results) || [];
        return {
          ok: true,
          q,
          count: list.length,
          hits: list.map((h) => ({
            corpus: h.corpus || h.collection || null,
            source: h.source || null,
            heading: h.heading || h.headingPath || null,
            score: typeof h.score === "number" ? Number(h.score.toFixed(3)) : null,
            text: String(h.text || h.chunk || "").slice(0, 600),
          })),
        };
      } catch (err) {
        // "COULD NOT SEARCH" IS NOT "NO HITS" — the store's own scar, and it applies to every
        // caller. An empty list would read as "nothing is written down", which licenses an agent to
        // proceed on a guess.
        return { ok: false, q, error: String((err && err.message) || err).slice(0, 300) };
      }
    },
    async corpora() {
      try {
        return { ok: true, corpora: docs.corpora().map((c) => ({ name: c.name, kind: c.kind, root: c.root })) };
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err).slice(0, 200) };
      }
    },
  };

  let app = null;
  try {
    const { createApp, createMCPServer } = require("systemlynx");
    const plugin = require("systemview-plugin");

    app = createApp();
    app.module("Window", Window);
    app.module("Docs", Docs);

    // MOUNTED on the service, not standing beside it: calls arrive through this service's own front
    // door, so middleware and auth apply to the agent exactly as to the spec.
    const mcp = createMCPServer(app);
    mcp.schema("Window", {
      tabs: {
        description:
          "What the autobot shell has open right now — every tab's kind, title, URL and loading state. " +
          "Use it to find out whether an app is open at all before trying to read its page.",
        input: {},
        required: [],
      },
      read: {
        description:
          "Read matching elements out of a LIVE app window in the shell — tag, class, trimmed text and whether " +
          "the node is hidden. This is the real rendered page, not a test renderer, so use it to confirm that " +
          "something actually drew: a badge, a row, a chip, an empty state. Read-only.",
        input: {
          selector: { type: "string", description: "a CSS selector, e.g. '.md-claim__owes'" },
          app: { type: "string", description: "which app's tab to read — defaults to 'systemview'" },
          limit: { type: "number", description: "how many matching nodes to return (1-40, default 10)" },
        },
        required: ["selector"],
      },
      count: {
        description:
          "How many elements match a selector in a live app window. Cheaper than `read` and usually what an " +
          "assertion wants: is there exactly one of these on screen right now.",
        input: {
          selector: { type: "string", description: "a CSS selector" },
          app: { type: "string", description: "which app's tab — defaults to 'systemview'" },
        },
        required: ["selector"],
      },
      bundle: {
        description:
          "Which bundle an app window is actually RUNNING versus what its server is now serving, and whether a " +
          "swap is therefore being held. Use this before concluding a fresh build 'did not land': the window " +
          "holds its own swap until it costs the human nothing, and holding is correct. Never forces a reload.",
        input: { app: { type: "string", description: "which app — defaults to 'systemview'" } },
        required: [],
      },
    });
    mcp.schema("Docs", {
      search: {
        description:
          "Search the indexed DOCUMENTATION corpora (the handbooks and the how-we-work chapters) and get the " +
          "matching sections back with their headings. Use it to check whether something is written down before " +
          "deriving it. This is the documentation half only — agent notes are not reachable here.",
        input: {
          q: { type: "string", description: "the question, in plain language — full sentences match better" },
          corpus: { type: "string", description: "narrow to one corpus by name" },
          source: { type: "string", description: "narrow to one document" },
          limit: { type: "number", description: "how many sections (1-20, default 5)" },
        },
        required: ["q"],
      },
      corpora: {
        description: "Which documentation corpora exist here — name, kind and root folder.",
        input: {},
        required: [],
      },
    });

    // EXACTLY WHAT IS NAMED, and nothing by accident. There is no `evaluate` in this list because
    // there is no `evaluate` in this file: a general code-execution door into his window would not
    // be a proof door, it would be a way to take the window.
    mcp.serve("shell-mcp", {
      expose: ["Window.tabs", "Window.read", "Window.count", "Window.bundle", "Docs.search", "Docs.corpora"],
    });

    app.use(
      plugin({
        connection: HUB,
        specs: path.join(ROOT, "specs"),
        root: ROOT,
        projectCode: "autobot",
        serviceId: SERVICE_ID,
      }),
    );

    app.startService({ route: "autobotshell/api", port: PORT, host: "localhost" });
    console.log(
      `[autobot] shell service on :${PORT}/autobotshell/api (MCP at /autobotshell/api/shell-mcp) → hub ${HUB}`,
    );
  } catch (err) {
    // THE SHELL MUST NOT DIE FOR THIS. It is a door onto the window, not the window — if systemlynx
    // or the hub is absent, say so once and carry on, because an unopenable door is strictly better
    // than a shell that will not start.
    console.log(`[autobot] shell service did not start: ${(err && err.message) || err}`);
    return { ok: false, error: String((err && err.message) || err) };
  }

  return {
    ok: true,
    port: PORT,
    serviceId: SERVICE_ID,
    stop: () => new Promise((r) => (app && app.close ? app.close(r) : r())),
  };
};
