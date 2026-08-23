// The Electron spike: proves the action lane attaches to OUR shell over CDP and the
// phase-1 loop (snapshot → ref → act → verify) works against a page the shell owns.
import { spawn } from "child_process";
import { createRequire } from "module";
import { setTimeout as sleep } from "timers/promises";
import { fileURLToPath } from "url";
import { createAxCore } from "../common/driver/axCore.js";

const require = createRequire(import.meta.url);
const electronBin = require("electron");
const mainEntry = fileURLToPath(new URL("./main.cjs", import.meta.url));
const CDP = "http://localhost:9223";

// Agent harnesses (VS Code / Claude Code) export ELECTRON_RUN_AS_NODE=1, which makes the
// Electron binary run as plain node and strips the app APIs — scrub it or the shell never boots.
// AUTOBOT_SMOKE=1 boots one plain page (no chrome/tabs) so the action lane
// deterministically drives the page under test, not the shell's own UI.
const env = { ...process.env, AUTOBOT_SHELL_SHOW: "0", AUTOBOT_SMOKE: "1" };
delete env.ELECTRON_RUN_AS_NODE;

const shell = spawn(electronBin, [mainEntry], { env, stdio: "ignore" });

const ax = createAxCore({ cdpEndpoint: CDP });

try {
  // wait for the shell's CDP port
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    up = await fetch(`${CDP}/json/version`).then((r) => r.ok).catch(() => false);
    if (!up) await sleep(500);
  }
  if (!up) throw new Error("shell CDP port never came up");
  console.log("shell up — CDP answering on 9223");

  await ax.start();
  const landing = await ax.navigate("https://example.com");
  const refMatch = landing.match(/link "Learn more" \[ref=(\w+)\]/);
  if (!refMatch) throw new Error("no ref found in shell-owned page");
  console.log(`snapshot has refs (link ref=${refMatch[1]}) — clicking`);
  await ax.click({ element: 'link "Learn more"', ref: refMatch[1] });

  const check = await ax.verify({ snapshotIncludes: "IANA" });
  console.log("verify:", check.ok ? "OK — the Electron era works" : check.failures);
  if (!check.ok) process.exitCode = 1;
} finally {
  await ax.stop().catch(() => {});
  shell.kill();
}
