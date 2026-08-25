// The autobot shell — milestone A+ : a real browser frame that OWNS its local apps.
// The window's own page is the React chrome (electron/ui); every tab is a
// WebContentsView positioned beside it. RFC-001 lane 1 lives here too: the shell
// adopts a running SystemView hub or launches its own (stdout filed — an unread
// pipe blocks the child at ~64KB; and we never call SystemView.shutdown(), SIGTERM
// on our own child only).
// .cjs on purpose: the repo is ESM, but Electron's entry resolves the builtin
// `electron` module reliably only through CommonJS.
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, clipboard, session, systemPreferences, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { APPS } = require("./apps/registry.cjs");
const { ensureApp, isUp } = require("./apps/launcher.cjs");
const termHost = require("./terminal/host.cjs");
const agentHost = require("./agents/host.cjs");
const supervisor = require("./agents/supervisor.cjs");

const CDP_PORT = process.env.AUTOBOT_CDP_PORT || "9223";
app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);

// One shell per profile: a second launch focuses the first instead of fighting it
// for the CDP port and the storage dbs ("Database IO error"). Headless test runs
// (smoke, CDP checks) opt out — they use their own ports and die quickly.
const headless = process.env.AUTOBOT_SHELL_SHOW === "0" || process.env.AUTOBOT_SMOKE === "1";
if (!headless && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (!headless) {
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
}

const HOME_URL = `file://${path.join(__dirname, "home.html")}`;
const isHome = (url) => url && url.startsWith("file:") && url.endsWith("home.html");
const SETUP_URL = `file://${path.join(__dirname, "setup.html")}`;
const isSetup = (url) => url && url.startsWith("file:") && url.endsWith("setup.html");

// ---- chrome geometry -----------------------------------------------------------
const DOCK_W = 188;
const STRIP_H = 44;
const AGENTS_W = 380; // default; drag-to-resize updates agentsW
let dockOpen = false;
let agentsOpen = false;
let agentsW = AGENTS_W;

let win = null;
const tabs = []; // { id, kind: "web" | "app", appId?, title, favicon, view }
let activeId = null;
let nextId = 1;

const history = (wc) => wc.navigationHistory ?? wc;

function state() {
  return {
    activeId,
    agentsOpen,
    agentsWidth: agentsW,
    tabs: tabs.map((t) => ({
      id: t.id,
      kind: t.kind,
      appId: t.appId ?? null,
      title: t.kind === "app" ? t.title : t.view.webContents.getTitle() || t.view.webContents.getURL(),
      url: t.view.webContents.getURL(),
      favicon: t.favicon ?? null,
      loading: t.view.webContents.isLoading(),
      canGoBack: history(t.view.webContents).canGoBack(),
      canGoForward: history(t.view.webContents).canGoForward(),
    })),
    apps: APPS.map((a) => {
      const t = tabs.find((x) => x.appId === a.id);
      return { id: a.id, title: a.title, tabId: t?.id ?? null, favicon: t?.favicon ?? null };
    }),
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("autobot:state", state());
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const dockW = dockOpen ? DOCK_W : 0;
  // The agents panel is chrome, and tabs are NATIVE views drawn over the chrome —
  // so the panel gets reserved space the same way the dock does. (The floating
  // bubble version was invisible behind every page; Odion caught it.)
  const agentsInset = agentsOpen ? agentsW : 0;
  for (const t of tabs) {
    t.view.setVisible(t.id === activeId);
    if (t.id === activeId)
      t.view.setBounds({ x: dockW, y: STRIP_H, width: w - dockW - agentsInset, height: h - STRIP_H });
  }
}

function setActive(id) {
  activeId = id;
  layout();
  broadcast();
}

function wireContextMenu(wc) {
  wc.on("context-menu", (_e, p) => {
    const items = [];
    if (p.linkURL) {
      items.push(
        { label: "Open Link in New Tab", click: () => addTab({ url: p.linkURL }) },
        { label: "Copy Link", click: () => clipboard.writeText(p.linkURL) },
        { type: "separator" }
      );
    }
    if (p.editFlags.canCopy) items.push({ role: "copy" });
    if (p.editFlags.canPaste) items.push({ role: "paste" });
    if (items.length && items[items.length - 1].type !== "separator") items.push({ type: "separator" });
    items.push(
      { label: "Back", enabled: history(wc).canGoBack(), click: () => history(wc).goBack() },
      { label: "Forward", enabled: history(wc).canGoForward(), click: () => history(wc).goForward() },
      { label: "Reload", click: () => wc.reload() },
      { type: "separator" },
      { label: "Inspect Element", click: () => { wc.inspectElement(p.x, p.y); } }
    );
    Menu.buildFromTemplate(items).popup();
  });
  // F12 / ⌥⌘I — devtools for the page under the pointer, detached so the layout holds
  wc.on("before-input-event", (_e, input) => {
    const combo = input.type === "keyDown" &&
      (input.key === "F12" || (input.meta && input.alt && input.key.toLowerCase() === "i"));
    if (!combo) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: "detach" });
  });
}

function addTab({ url, kind = "web", title = "", appId = null, activate = true }) {
  // Local-app tabs get the host bridge (window.systemview.terminal per RFC-001's
  // frozen transport contract); the landing page gets its few verbs; plain web
  // tabs get nothing extra.
  // sandbox: false on OUR preloads only — a sandboxed preload can require nothing
  // but "electron", and the shared dictation module needs a real require. Context
  // isolation stays on; plain web tabs stay fully sandboxed (they get no preload).
  const view = new WebContentsView(
    kind === "app"
      ? { webPreferences: { preload: path.join(__dirname, "apps/svPreload.cjs"), sandbox: false } }
      : isHome(url)
        ? { webPreferences: { preload: path.join(__dirname, "home-preload.cjs"), sandbox: false } }
        : isSetup(url)
          ? { webPreferences: { preload: path.join(__dirname, "setup-preload.cjs"), sandbox: false } }
          : {}
  );
  const tab = { id: nextId++, kind, appId, title, favicon: null, view };
  tabs.push(tab);
  win.contentView.addChildView(view);
  const wc = view.webContents;
  for (const ev of ["page-title-updated", "did-navigate", "did-navigate-in-page", "did-start-loading", "did-stop-loading"])
    wc.on(ev, broadcast);
  wc.on("page-favicon-updated", (_e, favicons) => { tab.favicon = favicons[0] ?? null; broadcast(); });
  // target=_blank and friends become tabs, never new windows
  wc.setWindowOpenHandler(({ url: u }) => { addTab({ url: u }); return { action: "deny" }; });
  wireContextMenu(wc);
  wc.loadURL(url);
  if (activate) setActive(tab.id);
  else { layout(); broadcast(); }
  return tab;
}

function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id);
  if (i === -1) return;
  const [tab] = tabs.splice(i, 1);
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  if (activeId === id) activeId = tabs[Math.min(i, tabs.length - 1)]?.id ?? null;
  layout();
  broadcast();
}

// Apps are AVAILABLE, not running — nothing spawns until you open it (Odion's t1
// note on RFC-001, "unless configured that way" → registry autostart flag).
async function openApp(appId, { activate = true } = {}) {
  const existing = tabs.find((t) => t.appId === appId);
  if (existing) return activate ? setActive(existing.id) : undefined;
  const a = APPS.find((x) => x.id === appId);
  if (!a) return;
  if (a.start) {
    const how = await ensureApp(a);
    if (how === "failed") return broadcast();
  }
  addTab({ url: a.url, kind: "app", title: a.title, appId: a.id, activate });
}

ipcMain.handle("tabs", (_e, action, payload = {}) => {
  const tab = tabs.find((t) => t.id === (payload.id ?? activeId));
  switch (action) {
    case "state": return state();
    case "create": addTab({ ...payload, url: payload.url || HOME_URL }); break;
    case "switch": setActive(payload.id); break;
    case "close": closeTab(payload.id); break;
    case "openApp": openApp(payload.appId); break;
    case "navigate": tab?.view.webContents.loadURL(payload.url); break;
    case "back": history(tab?.view.webContents ?? {}).goBack?.(); break;
    case "forward": history(tab?.view.webContents ?? {}).goForward?.(); break;
    case "reload": tab?.view.webContents.reload(); break;
    case "dock": dockOpen = !!payload.open; layout(); break;
    case "agents": {
      agentsOpen = !!payload.open;
      // no invented ceiling — the clamp MUST match the renderer's or the column
      // draws under the native views ("off to the left, you can't see it at all")
      if (payload.width) {
        const maxW = (win ? win.getContentBounds().width : 4000) - 160;
        agentsW = Math.max(180, Math.min(maxW, Math.round(payload.width)));
      }
      layout(); broadcast(); break;
    }
    case "openSetup": {
      const existing = tabs.find((t) => isSetup(t.view.webContents.getURL()));
      if (existing) setActive(existing.id); else addTab({ url: SETUP_URL });
      break;
    }
  }
  return state();
});

// The setup page's verbs — his "section in the browser I go to NOW": Claude login
// state (read-only — the claude CLI owns the credential), the API-key fallback,
// and add-a-project-by-folder writing the same ~/.autobot/projects.json that
// terminals and agent sessions resolve cwd from.
const os = require("os");
const AUTOBOT_DIR = path.join(os.homedir(), ".autobot");
const PROJECTS_FILE = path.join(AUTOBOT_DIR, "projects.json");
const AUTH_FILE = path.join(AUTOBOT_DIR, "agent-auth.json");
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };

ipcMain.handle("setup:auth-status", () => {
  const claude = readJson(path.join(os.homedir(), ".claude.json"), {});
  const auth = readJson(AUTH_FILE, {});
  return {
    signedIn: !!claude.oauthAccount,
    email: claude.oauthAccount?.emailAddress || null,
    hasApiKey: !!auth.ANTHROPIC_API_KEY,
  };
});
ipcMain.handle("setup:save-key", (_e, key) => {
  const auth = readJson(AUTH_FILE, {});
  if (key) auth.ANTHROPIC_API_KEY = key; else delete auth.ANTHROPIC_API_KEY;
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
  return true;
});
ipcMain.handle("setup:projects", () => readJson(PROJECTS_FILE, {}));
ipcMain.handle("setup:pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("setup:add-project", (_e, code, dir) => {
  const map = readJson(PROJECTS_FILE, {});
  // same rule as the IDE picker: a code means one folder, refuse a silent re-point
  if (map[code] && path.resolve(map[code]) !== path.resolve(dir))
    return { error: `"${code}" already means ${map[code]}` };
  map[code] = dir;
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(map, null, 2));
  return map;
});
ipcMain.handle("setup:remove-project", (_e, code) => {
  const map = readJson(PROJECTS_FILE, {});
  delete map[code];
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(map, null, 2));
  return map;
});

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    show: process.env.AUTOBOT_SHELL_SHOW !== "0",
    title: "autobot",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0b0e13",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false },
  });

  // Smoke mode: one plain page, no chrome, tabs, or hub — keeps the action-lane
  // smoke deterministic about which target it drives.
  if (process.env.AUTOBOT_SMOKE === "1") {
    win.loadURL(process.env.AUTOBOT_START_URL || `file://${path.join(__dirname, "index.html")}`);
    return;
  }

  const uiDist = path.join(__dirname, "ui/dist/index.html");
  if (process.env.AUTOBOT_UI_URL) win.loadURL(process.env.AUTOBOT_UI_URL); // vite dev server
  else if (fs.existsSync(uiDist)) win.loadFile(uiDist);
  else win.loadFile(path.join(__dirname, "index.html")); // pre-build placeholder

  win.on("resize", layout);

  // Voice in local apps: grant mic/media to pages, and ask macOS for the mic
  // up front so SystemView's push-to-talk works inside the shell.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(["media", "audioCapture", "clipboard-read", "notifications", "fullscreen"].includes(permission));
  });
  if (process.platform === "darwin") systemPreferences.askForMediaAccess("microphone").catch(() => {});

  termHost.register();
  agentHost.register(); // Claude sessions via the Agent SDK, on the user's login (RFC-002)
  require("./apps/files-host.cjs").register(() => win); // projects/files/auth for /ide (RFC-047 seam)
  require("./apps/dictation.cjs").register();
  supervisor.boot(); // hosted agent sessions from ~/.autobot/hosted.json (none by default)

  // Every start lands on the landing page — his call ("for now, I need to be in
  // this space"). Apps that adopt or autostart load in the BACKGROUND; the home
  // tab keeps the front until he goes somewhere.
  addTab({ url: process.env.AUTOBOT_START_URL || HOME_URL });
  for (const a of APPS) {
    if (a.autostart) openApp(a.id, { activate: false });
    else isUp(a.health ?? a.url).then((up) => { if (up) openApp(a.id, { activate: false }); else broadcast(); });
  }

  // End-to-end terminal-lane smoke: prove the preload bridge inside the REAL app tab.
  if (process.env.AUTOBOT_TERMSMOKE === "1") {
    const check = async () => {
      const t = tabs.find((x) => x.appId === "systemview");
      if (!t) { console.log("TERMSMOKE: no systemview tab (hub down?)"); app.exit(2); return; }
      await new Promise((r) => setTimeout(r, 4000)); // let the page settle
      try {
        const result = await t.view.webContents.executeJavaScript(`(async () => {
          if (!window.systemview?.terminal) return { bridge: false };
          const tr = await window.systemview.terminal.open({ projectCode: "autobot", sessionId: "e2e", cwd: "${process.cwd()}" });
          let got = "";
          tr.onData((c) => (got += c));
          tr.write("echo E2E-$((6*7))" + String.fromCharCode(13));
          await new Promise((r) => setTimeout(r, 2000));
          const hist = await tr.history();
          await tr.kill();
          return { bridge: true, stream: got.includes("E2E-42"), history: hist.includes("E2E-42") };
        })()`);
        console.log("TERMSMOKE:", JSON.stringify(result));
        app.exit(result.bridge && result.stream && result.history ? 0 : 1);
      } catch (e) {
        console.log("TERMSMOKE error:", e.message);
        app.exit(1);
      }
    };
    setTimeout(check, 8000);
  }

  // End-to-end agent-lane smoke: a real Claude session through the preload bridge,
  // riding the user's login. Proves the event vocabulary arrives in a page.
  if (process.env.AUTOBOT_AGENTSMOKE === "1") {
    const check = async () => {
      const t = tabs.find((x) => x.appId === "systemview");
      if (!t) { console.log("AGENTSMOKE: no systemview tab (hub down?)"); app.exit(2); return; }
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const result = await t.view.webContents.executeJavaScript(`(async () => {
          if (!window.systemview?.agent) return { bridge: false };
          const tr = await window.systemview.agent.open({ projectCode: "autobot", sessionId: "e2e" });
          const kinds = {};
          let text = "";
          tr.onEvent((ev) => { kinds[ev.kind] = (kinds[ev.kind] || 0) + 1; if (ev.kind === "assistant.text" && ev.done) text += ev.text; });
          tr.send("Reply with exactly: HARNESS-OK");
          for (let i = 0; i < 60 && !kinds.usage; i++) await new Promise((r) => setTimeout(r, 1000));
          const enveloped = (await tr.history()).every((ev) => ev.sessionId && ev.projectCode && ev.worktree);
          await tr.kill();
          return { bridge: true, ok: text.includes("HARNESS-OK"), enveloped, kinds };
        })()`);
        console.log("AGENTSMOKE:", JSON.stringify(result));
        app.exit(result.bridge && result.ok ? 0 : 1);
      } catch (e) {
        console.log("AGENTSMOKE error:", e.message);
        app.exit(1);
      }
    };
    setTimeout(check, 8000);
  }
});

app.on("window-all-closed", () => app.quit());
// The hub OUTLIVES the shell (Odion's call on RFC-001 q2) — agents keep their hub
// when the window closes. We never kill the child; it was spawned to be the hub,
// not to be ours.

// The word on quit (his review): sessions surviving is the feature AND the hazard,
// so quitting with live terminals says so — keep them (default) or end them all.
// Headless runs (smoke, CI) skip the dialog.
let quitResolved = false;
app.on("before-quit", (e) => {
  if (quitResolved || process.env.AUTOBOT_SHELL_SHOW === "0" || process.env.AUTOBOT_SMOKE === "1") return;
  e.preventDefault();
  (async () => {
    const terminalSessions = require("./terminal/sessions.cjs");
    const live = await terminalSessions.list().catch(() => []);
    if (live.length) {
      const { response } = await dialog.showMessageBox({
        type: "question",
        buttons: ["Keep Them Running", "End All Sessions"],
        defaultId: 0,
        message: `${live.length} terminal session${live.length === 1 ? "" : "s"} will keep running after the browser closes`,
        detail: live.map((s) => `${s.projectCode} · ${s.sessionId}`).join("\n") +
          "\n\nThe SystemView hub also keeps running, by design — agents stay connected.",
      });
      if (response === 1) for (const s of live) await terminalSessions.kill(s.key).catch(() => {});
    }
    quitResolved = true;
    app.quit();
  })();
});
