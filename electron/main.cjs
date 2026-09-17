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
const registry = require("./apps/registry.cjs");
const { ensureApp, isUp } = require("./apps/launcher.cjs");
const termHost = require("./terminal/host.cjs");
const agentHost = require("./agents/host.cjs");
const supervisor = require("./agents/supervisor.cjs");
// RFC-005 §7.1 — page events. The shell is the only thing that can honestly emit them: it is the
// one looking at the page. `sessions` is already loaded through agents/host.cjs; taking it by name
// here is the same module instance, not a second one.
const pageEvents = require("./apps/pageEvents.cjs");
const jobs = require("./agents/jobs.cjs");
const sessions = require("./agents/sessions.cjs");

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

// ---- SPLIT VIEW (his ask, 2026-09-17: drag a tab out, see two things side by side, resize) ----
// One split, two panes: the ACTIVE tab is always pane A; `split.other` is pane B. side "right"
// puts B beside A, "bottom" puts B under A. `ratio` is A's share of the axis. The 6px gutter
// between them is deliberately UNCOVERED chrome — that gap is where the chrome page shows
// through, which is what makes the divider draggable at all (native views swallow the mouse).
const GUTTER = 6;
let split = null; // { side: "right"|"bottom", ratio, other: tabId }
// While a chip is being dragged, every view hides so the whole window is chrome — the only way
// drop zones over the content area can receive the pointer, because a WebContentsView takes
// OS-level input in its bounds and the chrome page underneath never hears it.
let dragMode = false;

const history = (wc) => wc.navigationHistory ?? wc;

function state() {
  return {
    activeId,
    split: split ? { side: split.side, ratio: split.ratio, other: split.other } : null,
    agentsOpen,
    agentsWidth: agentsW,
    // THE 74px CORNER IS THE WINDOW BANDS' SPACE — and in macOS fullscreen the bands are GONE
    // (they only return on a hover at the top edge). So a fixed reserve holds a hole open for
    // buttons that aren't there, which is the empty corner he reported. Chrome doesn't leave
    // that gap; it reclaims the room. Shipping the state so the CSS can reserve only when the
    // bands actually exist.
    fullScreen: !!(win && !win.isDestroyed() && win.isFullScreen()),
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
    // registry.current(), not the require-time APPS snapshot — a freshly added app has to
    // appear without a restart, or "+ add app" writes a file and looks like it did nothing.
    apps: registry.current().map((a) => {
      const t = tabs.find((x) => x.appId === a.id);
      // `icon` is the app's OWN face, declared in its manifest and served from its own address;
      // `favicon` is whatever its page happens to be showing right now and only exists once a tab
      // is open. The declared icon wins, so an app in the dock looks like itself before you open it.
      return { id: a.id, title: a.title, tabId: t?.id ?? null, favicon: t?.favicon ?? null, icon: a.icon ?? null };
    }),
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("autobot:state", state());
}

// Exported shape so a smoke can assert the math without a window: given the content box and the
// split, where do the panes land?
function paneRects(box, sp) {
  if (!sp) return { a: box, b: null };
  if (sp.side === "right") {
    const aw = Math.round((box.width - GUTTER) * sp.ratio);
    return {
      a: { x: box.x, y: box.y, width: aw, height: box.height },
      b: { x: box.x + aw + GUTTER, y: box.y, width: box.width - aw - GUTTER, height: box.height },
    };
  }
  const ah = Math.round((box.height - GUTTER) * sp.ratio);
  return {
    a: { x: box.x, y: box.y, width: box.width, height: ah },
    b: { x: box.x, y: box.y + ah + GUTTER, width: box.width, height: box.height - ah - GUTTER },
  };
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const dockW = dockOpen ? DOCK_W : 0;
  // The agents panel is chrome, and tabs are NATIVE views drawn over the chrome —
  // so the panel gets reserved space the same way the dock does. (The floating
  // bubble version was invisible behind every page; Odion caught it.)
  const agentsInset = agentsOpen ? agentsW : 0;
  const box = { x: dockW, y: STRIP_H, width: w - dockW - agentsInset, height: h - STRIP_H };
  // A split whose other tab died is no split; drag mode blanks everything (see dragMode above).
  if (split && (split.other === activeId || !tabs.some((t) => t.id === split.other))) split = null;
  const { a, b } = paneRects(box, split);
  for (const t of tabs) {
    const pane = dragMode ? null : t.id === activeId ? a : split && t.id === split.other ? b : null;
    t.view.setVisible(!!pane);
    if (pane) t.view.setBounds(pane);
  }
}

function setActive(id) {
  // In a split, clicking pane B's tab PROMOTES it to A and demotes the old A to B — both stay on
  // screen. Activating a third tab replaces pane A and leaves B standing.
  if (split && id === split.other) split = { ...split, other: activeId };
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
    // ----- RFC-005 §7.1 — WATCH THIS VALUE ---------------------------------------------------
    // His ask, verbatim: *right click on the web page and be able to say listen to this event,
    // listen for this change.* Point at a node, we record a stable locator and what it says right
    // now, and from then on the shell announces when it stops saying that.
    //
    // THE MENU IS ALSO THE SURFACE, for now. A watch you cannot see is a watch you cannot stop, so
    // the existing ones for this origin are listed right here with a way off. That is deliberately
    // the smallest honest thing: a real panel can come later, but shipping the create without the
    // list would leave invisible watchers running on his machine.
    const watching = pageEvents.forUrl(wc.getURL());
    items.push({ type: "separator" });
    items.push({
      label: "Watch this value",
      click: async () => {
        let loc = null;
        try { loc = await wc.executeJavaScript(pageEvents.locatorScript(p.x, p.y), true); } catch {}
        if (!loc || !loc.selector) return;
        pageEvents.save({ label: loc.label, url: loc.url, selector: loc.selector, lastValue: loc.text });
      },
    });
    if (watching.length) {
      items.push({
        label: `Watching on this site (${watching.length})`,
        submenu: watching.map((w) => ({
          label: `${w.label}${w.lastValue != null ? ` — ${String(w.lastValue).slice(0, 24)}` : ""}`,
          submenu: [
            { label: "Stop watching", click: () => pageEvents.remove(w.id) },
            // POINT IT AT A JOB. This is the other half of §7.1, and it needs no new wiring: a job
            // already carries its own trigger, and `page.value-changed` is in the vocabulary, so
            // aiming one at a watch is one field on the job — not a hook, not a rule, not a rung.
            ...(jobs.list().length
              ? [{ type: "separator" }, ...jobs.list().map((j) => ({
                  label: `Run job: ${j.name}`,
                  type: "checkbox",
                  checked: !!(j.trigger && j.trigger.on === "page.value-changed" &&
                              j.trigger.when && j.trigger.when.watch &&
                              j.trigger.when.watch.equals === w.id),
                  click: () => {
                    try {
                      jobs.save({ ...j, doc: j.doc, trigger: { on: "page.value-changed", when: { watch: { equals: w.id } } } });
                    } catch {}
                  },
                }))]
              : []),
          ],
        })),
      });
    }
    items.push({ type: "separator" });
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
  // NAVIGATION IS AMBIENT (RFC-005 §7.1). It belongs to no session, so it fans out to hooks and
  // not to feeds — every agent that carries a hook for it gets the chance to match, and nobody's
  // chat fills up with someone else's browsing.
  wc.on("did-navigate", (_e, url) => {
    try {
      sessions.emitAmbient({ kind: "page.navigated", url, title: wc.getTitle(), from: tab.lastUrl || "", tabId: tab.id });
      tab.lastUrl = url;
    } catch {}
  });
  wc.on("page-favicon-updated", (_e, favicons) => { tab.favicon = favicons[0] ?? null; broadcast(); });
  // target=_blank and friends become tabs, never new windows
  wc.setWindowOpenHandler(({ url: u }) => { addTab({ url: u }); return { action: "deny" }; });
  // ...and tell a freshly-loaded app which theme it is in. The preload also asks synchronously, so
  // this is the belt to that's braces — a reload mid-toggle would otherwise land in the old theme.
  if (kind === "app") wc.on("did-finish-load", () => {
    try { wc.send("autobot:theme", { dark: themeDark }); } catch {}
  });
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

// THE GRANT RESOLVER — RFC-004 §1.1, and the answer to "how does a preload know which app it is".
//
// It cannot know on its own: addTab() hands every kind:"app" view the SAME svPreload.cjs path with
// no arguments. But main already knows — the tab record carries `appId` — so the preload asks and
// this answers. `on` + returnValue rather than `handle`, because the preload needs it synchronously:
// contextBridge.exposeInMainWorld has to run during preload execution.
//
// THE ORIGIN CHECK IS THE POINT, not a detail. A preload stays attached to its WebContentsView
// across navigation, and nothing in this file guards navigation — setWindowOpenHandler only
// redirects popups into tabs. So a registered app that navigates, follows a redirect, or has an
// open redirect would carry its grants to whatever it landed on: files:write, on someone else's
// page, with our bridge attached. Binding the answer to the URL WE ARE BEING ASKED FROM closes
// that: the grant follows the origin, not the view. This handler re-runs on every navigation
// because the preload does.
// THEME IS NOT A CAPABILITY, IT IS THE ENVIRONMENT (his report, 2026-09-14: "why isn't this one
// or both apps responding to light and dark mode coming from the browser").
//
// The toggle in the strip themed the CHROME and nothing else, because an app tab is a separate
// origin that nobody was telling anything. A browser that hosts applications owns the light/dark
// decision the way it owns the mic and the filesystem — but unlike those, theme is not an ACTION,
// so it is not gated. An app can do nothing with it except look right, and an app that must ask
// permission to match its own window is an app that will look foreign by default.
let themeDark = true;
function broadcastTheme() {
  for (const t of tabs) {
    if (t.kind !== "app" || !t.view || t.view.webContents.isDestroyed()) continue;
    try { t.view.webContents.send("autobot:theme", { dark: themeDark }); } catch {}
  }
}

ipcMain.on("app:grants", (e) => {
  // ONE ASSIGNMENT TO returnValue, AT THE END, AND THAT IS NOT STYLE. Electron sends the sync
  // reply on the FIRST assignment — a `deny` default written at the top and refined later never
  // reaches the preload, which receives the denial and exposes nothing. Found by building it that
  // way: the resolver computed the right answer, logged it, and every app still came back empty.
  let answer = { appId: null, origin: null, capabilities: [] };
  try {
    const tab = tabs.find((t) => t.view && !t.view.webContents.isDestroyed() && t.view.webContents === e.sender);
    if (tab && tab.kind === "app" && tab.appId) {
      const app = registry.current().find((a) => a.id === tab.appId);
      if (app && app.url) {
        // getURL() is the page this preload is being created for — the POST-navigation URL, not
        // the one the tab was opened with. Verified: it is already correct at preload time.
        const asking = new URL(e.sender.getURL() || "about:blank");
        const declared = new URL(app.url);
        if (asking.origin === declared.origin) {
          // ABSENT = NONE (RFC-004 §2.1). A manifest entry with no `capabilities` key gets
          // nothing, not everything. The opposite default would preserve the total-grant hole
          // forever and nobody would notice, because everything would keep working.
          answer = {
            appId: app.id,
            origin: declared.origin,
            capabilities: Array.isArray(app.capabilities) ? app.capabilities : [],
          };
        }
      }
    }
  } catch {
    // An unparseable URL is not a reason to hand out the harness. `answer` stays the denial.
  }
  e.returnValue = answer;
});

// THE CROSS-APP COMPONENT CATALOGUE (RFC-004 §3.3). A host asks what it may mount on the surface
// it is drawing; the registry answers with only what apps have declared for that surface. The
// answer carries resolved own-origin URLs, so a host never builds one itself from parts.
ipcMain.handle("apps:components", (e, surface) => {
  // WHICH APP IS ASKING decides more than what it may see — it decides what may be an ELEMENT.
  // Same resolution as the grant handler, and the host cannot state its own identity: a page that
  // could name itself could name someone else and mount an element in their name.
  try {
    const tab = tabs.find((t) => t.view && !t.view.webContents.isDestroyed() && t.view.webContents === e.sender);
    const hostAppId = tab && tab.kind === "app" ? tab.appId : null;
    return registry.componentsFor(String(surface || "app"), hostAppId);
  } catch { return []; }
});

// A preload asks for the CURRENT theme as it loads, because a tab opened later must not sit in the
// wrong one until the next toggle.
ipcMain.on("app:theme", (e) => { e.returnValue = { dark: themeDark }; });

ipcMain.handle("tabs", (_e, action, payload = {}) => {
  // ---- split verbs ----------------------------------------------------------------------------
  if (action === "split") {
    const id = Number(payload.id);
    const side = payload.side === "bottom" ? "bottom" : "right";
    if (!tabs.some((t) => t.id === id)) return state();
    if (id === activeId) {
      // dragging the ACTIVE tab out: it becomes pane B, and the most recent other tab takes A —
      // the gesture means "put this one over there", not "clone it".
      const other = tabs.find((t) => t.id !== id);
      if (!other) return state();
      activeId = other.id;
    }
    split = { side, ratio: 0.5, other: id };
    layout(); broadcast();
    return state();
  }
  if (action === "unsplit") { split = null; layout(); broadcast(); return state(); }
  if (action === "splitRatio") {
    if (split) split.ratio = Math.min(0.85, Math.max(0.15, Number(payload.ratio) || 0.5));
    layout(); broadcast();
    return state();
  }
  if (action === "dragMode") { dragMode = payload.on === true; layout(); return state(); }
  if (action === "theme") {
    themeDark = payload.dark !== false;
    broadcastTheme();
    return { dark: themeDark };
  }
  const tab = tabs.find((t) => t.id === (payload.id ?? activeId));
  switch (action) {
    case "state": return state();
    case "create": addTab({ ...payload, url: payload.url || HOME_URL }); break;
    case "switch": setActive(payload.id); break;
    case "close": closeTab(payload.id); break;
    case "openApp": openApp(payload.appId); break;
    // + add app — writes ~/.autobot/apps.json (the same file an install lands in) and
    // rebroadcasts so the dock shows it immediately. Errors come BACK; a door that fails
    // silently is the shape we keep finding.
    case "addApp": {
      const r = registry.addApp(payload || {});
      broadcast();
      return r;
    }
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
    // THE WINDOW BANDS MUST ACTUALLY BE THERE (his report, 2026-09-09: the 74px corner is
    // reserved and EMPTY — no red/yellow/green). hiddenInset alone should draw them, and
    // nothing here suppressed them, so the position is made EXPLICIT rather than left to a
    // default that something in the window state can move out of view. y:14 centres them in
    // the 44px strip; x:20 is macOS's own inset.
    trafficLightPosition: { x: 20, y: 14 },
    backgroundColor: "#0b0e13",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false },
  });

  // ...and assert it after creation too. setWindowButtonVisibility is the only API that can
  // force them back if some window state (Split View, Stage Manager) hid them; calling it
  // with true is a no-op when they were already visible, so it costs nothing to be sure.
  try { win.setWindowButtonVisibility(true); } catch {}
  // the reserve follows the bands, so the chrome has to hear about the transition
  for (const ev of ["enter-full-screen", "leave-full-screen"]) win.on(ev, broadcast);

  // AND THE BANDS HAVE TO BE RE-ASSERTED, NOT JUST SET ONCE (his report again, 2026-09-12:
  // still an empty 74px corner after the explicit position above). Probed the live chrome —
  // the strip holds the reserve correctly, so this is native, not CSS. With a custom
  // trafficLightPosition macOS drops the buttons out of view across a zoom/fullscreen
  // transition, and the one-shot call at creation is long gone by then. Re-assert on every
  // transition. Skip it IN fullscreen, where macOS hides them deliberately.
  const assertBands = () => {
    if (!win || win.isDestroyed() || win.isFullScreen()) return;
    try { win.setWindowButtonVisibility(true); } catch {}
  };
  for (const ev of ["leave-full-screen", "maximize", "unmaximize", "restore", "show", "focus"]) {
    win.on(ev, assertBands);
  }

  // Smoke mode: one plain page, no chrome, tabs, or hub — keeps the action-lane
  // smoke deterministic about which target it drives.
  if (process.env.AUTOBOT_SMOKE === "1") {
    win.loadURL(process.env.AUTOBOT_START_URL || `file://${path.join(__dirname, "index.html")}`);
    return;
  }

  const uiDist = path.join(__dirname, "ui/dist/index.html");
  if (process.env.AUTOBOT_UI_URL) {
    win.loadURL(process.env.AUTOBOT_UI_URL); // vite dev server
    // THE HEADER THAT NEVER CAME BACK (his report): dev.js starts vite and this shell in the
    // same breath, so this loadURL can fire before vite answers — the chrome stays a blank
    // page forever while the native tab views paint normally ("just showing SystemView").
    // A failed MAIN-frame load of the chrome URL retries until vite is up. -3 (ERR_ABORTED)
    // is a superseded navigation, not a failure — retrying it would fight real reloads.
    win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      if (!url || !url.startsWith(process.env.AUTOBOT_UI_URL)) return;
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.loadURL(process.env.AUTOBOT_UI_URL);
      }, 700);
    });
  }
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
  // WHICH APPLICATION IS USING THIS AGENT — his correction, 2026-08-25: "we're
  // talking about how it's used in the autobot browser, like what application is
  // using it?" That is NOT the cwd (where it runs from); it is the surface that
  // opened it. Only main knows that, because only main owns the tabs — so the
  // agent host is handed a resolver rather than guessing.
  agentHost.register((wc) => {
    if (!wc) return null;
    const t = tabs.find((x) => x.view?.webContents === wc || x.view?.webContents?.id === wc.id);
    if (t) return { id: t.appId || `tab:${t.id}`, title: t.kind === "app" ? t.title : (t.view.webContents.getTitle() || "web"), kind: t.kind };
    // the shell's own chrome is a real consumer too — the agents panel
    if (win && !win.isDestroyed() && win.webContents === wc) return { id: "autobot", title: "autobot", kind: "shell" };
    return null;
  }); // Claude sessions via the Agent SDK, on the user's login (RFC-002)
  require("./apps/files-host.cjs").register(() => win); // projects/files/auth for /ide (RFC-047 seam)
  require("./apps/dictation.cjs").register();
  require("./apps/vectors-host.cjs").register(); // RFC-055 — local semantic retrieval, a harness capability
  require("./apps/context-host.cjs").register(); // RFC-055 — the context management surface (his curate verbs)
  // RFC-005 §7.1 — the watch loop. Only tabs that have a watch are read, and only a value that
  // actually MOVED is announced. It takes `tabs` as a getter rather than the array, so the module
  // never holds a reference to shell state it does not own.
  pageEvents.watchTabs(() => tabs, sessions.emitAmbient);
  require("./apps/jobs-host.cjs").register(); // RFC-005 §10 — the job API an app reads jobs through
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

  // THE CAPABILITY GATE, AS ASSERTIONS (RFC-004 §4's checks 1 and 2). The gate's two hard parts
  // are things you cannot verify by reading: whether sendSync resolves through event.sender for a
  // WebContentsView at preload time, and whether the grant actually dies when the view navigates
  // off-origin. Both are proved here against a real shell.
  //
  // The origin case uses 127.0.0.1 against localhost DELIBERATELY: same server, same content,
  // different origin. If the check ever degrades to a host/port/substring comparison, this is the
  // case that catches it — and it needs nothing running that the app does not already need.
  if (process.env.AUTOBOT_CAPSMOKE === "1") {
    const run = async () => {
      const results = {};
      const before = (() => { try { return fs.readFileSync(registry.USER_APPS, "utf8"); } catch { return null; } })();
      try {
        const sv = tabs.find((x) => x.appId === "systemview");
        if (!sv) { console.log("CAPSMOKE: no systemview tab (hub down?)"); app.exit(2); return; }
        await new Promise((r) => setTimeout(r, 3000));

        const keys = (t) => t.view.webContents.executeJavaScript(
          `(() => { const b = window.systemview; return { present: !!b, ns: b ? Object.keys(b).sort() : [],
             files: b && b.files ? Object.keys(b.files).sort() : null }; })()`);

        // SystemView declares every capability it uses, so the full surface must survive the gate.
        results.systemview = await keys(sv);

        // A NARROW APP. Same origin as SystemView so nothing extra has to be served; a different
        // appId, so it gets its own grant.
        registry.addApp({ title: "Capsmoke", url: "http://localhost:3000", capabilities: ["files:read"] });
        const narrow = addTab({ url: "http://localhost:3000", kind: "app", appId: "capsmoke", activate: false });
        await new Promise((r) => setTimeout(r, 3000));
        results.narrow = await keys(narrow);

        // OFF-ORIGIN: the same page, reached by an origin the app did not declare.
        await narrow.view.webContents.loadURL("http://127.0.0.1:3000");
        await new Promise((r) => setTimeout(r, 2500));
        results.offOrigin = await keys(narrow);

        // `theme` IS NOT A GRANT, so it is excluded from every count below. It is the environment
        // an app is displayed in, not an action it may take — an app that had to ask permission to
        // match its own window would look foreign by default. The earlier version of this check
        // asserted `offOrigin.ns.length === 0` and went red the moment theme shipped; "everything
        // is gone off-origin" was the wrong claim, and someone would have built on it.
        const grants = (ns) => (ns || []).filter((n) => n !== "theme");

        const ok =
          results.systemview.present && grants(results.systemview.ns).includes("agent") &&
          results.narrow.present &&
          results.narrow.files && results.narrow.files.includes("readFile") &&
          !results.narrow.files.includes("writeFile") &&
          grants(results.narrow.ns).join() === "files" &&
          // THE RULE: off-origin drops every GRANT. Theme survives, and must — a component that
          // travels needs one handed to it or it looks foreign (RFC-004 §3.3's named cost).
          grants(results.offOrigin.ns).length === 0 &&
          results.offOrigin.ns.includes("theme");

        console.log("CAPSMOKE:", JSON.stringify(results, null, 2));
        console.log("CAPSMOKE:", ok ? "PASS" : "FAIL");
        app.exit(ok ? 0 : 1);
      } catch (e) {
        console.log("CAPSMOKE error:", e.message);
        app.exit(1);
      } finally {
        // Never leave a test entry in his apps.json.
        try { if (before === null) fs.unlinkSync(registry.USER_APPS); else fs.writeFileSync(registry.USER_APPS, before); } catch {}
      }
    };
    setTimeout(run, 6000);
  }

  if (process.env.AUTOBOT_SPLITSMOKE === "1") {
    const run = async () => {
      try {
        const a = addTab({ url: "http://localhost:3200", kind: "app", appId: "blink", activate: true });
        const b = addTab({ url: "http://localhost:3300", kind: "app", appId: "workers", activate: false });
        await new Promise((r) => setTimeout(r, 2500));
        // the same call the chrome makes
        const { webContents } = require("electron");
        split = { side: "right", ratio: 0.5, other: b.id };
        setActive(a.id);
        await new Promise((r) => setTimeout(r, 400));
        const av = a.view.getBounds(), bv = b.view.getBounds();
        const out = {
          bothVisible: a.view.getVisible() && b.view.getVisible(),
          sideBySide: av.x < bv.x && Math.abs(av.y - bv.y) < 2,
          gutter: bv.x - (av.x + av.width),
          stateCarries: !!state().split && state().split.other === b.id,
        };
        split.ratio = 0.25; layout();
        const av2 = a.view.getBounds();
        out.ratioMoves = av2.width < av.width;
        split = null; layout();
        out.unsplitHides = a.view.getVisible() && !b.view.getVisible();
        const ok = out.bothVisible && out.sideBySide && out.gutter === 6 && out.stateCarries && out.ratioMoves && out.unsplitHides;
        console.log("SPLITSMOKE:", JSON.stringify(out));
        console.log("SPLITSMOKE:", ok ? "PASS" : "FAIL");
        app.exit(ok ? 0 : 1);
      } catch (e) { console.log("SPLITSMOKE error:", e.message); app.exit(1); }
    };
    setTimeout(run, 4000);
  }

  // THE LYNX CAPABILITY, AS ASSERTIONS. Proves the whole chain in a real shell: the gate hands
  // `lynx` only to apps that declared it, the bridge crosses the contextBridge with its nested
  // functions intact, a page loads its own SystemLynx service, and a module EVENT reaches a
  // page-side callback. Needs the blink service up on 3200 (it is the app under test).
  if (process.env.AUTOBOT_LYNXSMOKE === "1") {
    const run = async () => {
      try {
        const tab = addTab({ url: "http://localhost:3200", kind: "app", appId: "blink", activate: false });
        await new Promise((r) => setTimeout(r, 3500));
        const result = await tab.view.webContents.executeJavaScript(`(async () => {
          const out = { hasLynx: !!window.systemlynx?.Client, notUnderSystemview: !window.systemview?.systemlynx,
                        libraryShape: !!(window.systemlynx?.createClient && window.systemlynx?.HttpClient) };
          if (!out.hasLynx) return out;
          const { Client } = window.systemlynx;               // the package's own convention
          const svc = await Client.loadService("http://localhost:3200/blink/api");
          out.modules = Object.keys(svc).filter((k) => svc[k] && typeof svc[k] === "object" && typeof svc[k].on === "function").sort();
          const events = [];
          svc.Tables.on("changed", (d) => events.push(d));
          await new Promise((r) => setTimeout(r, 1500)); // the room-join handshake
          const state = await svc.Tables.setCell({ table: "clients", row: "r2", col: "rate", value: "10%" });
          out.stateReturned = Array.isArray(state.cells);
          await new Promise((r) => setTimeout(r, 900));
          out.eventHeard = events.length > 0 ? events[0] : null;
          return out;
        })()`);
        const ok = result.hasLynx && result.libraryShape && result.notUnderSystemview && result.modules?.includes("Tables") && result.stateReturned && !!result.eventHeard;
        console.log("LYNXSMOKE:", JSON.stringify(result));
        console.log("LYNXSMOKE:", ok ? "PASS" : "FAIL");
        app.exit(ok ? 0 : 1);
      } catch (e) {
        console.log("LYNXSMOKE error:", e.message);
        app.exit(1);
      }
    };
    setTimeout(run, 5000);
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
