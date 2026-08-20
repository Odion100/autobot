// The autobot shell — minimal spike version (see report: browser-loop-assessment §plan,
// pulled forward on Odion's call 2026-08-20). One window, one content page, and the one
// thing the spike exists to prove: a CDP port our Playwright-MCP action lane can attach to.
// Phase 3 grows this into the real shell: native sidebar, tabs, the SystemView-styled UI.
// .cjs on purpose: the repo is ESM, but Electron's default-app entry resolves the builtin
// `electron` module reliably only through CommonJS.
const { app, BrowserWindow } = require("electron");

const CDP_PORT = process.env.AUTOBOT_CDP_PORT || "9223";
app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: process.env.AUTOBOT_SHELL_SHOW !== "0",
    title: "autobot",
  });
  if (process.env.AUTOBOT_START_URL) win.loadURL(process.env.AUTOBOT_START_URL);
  else win.loadFile(`${__dirname}/index.html`);
});

app.on("window-all-closed", () => app.quit());
