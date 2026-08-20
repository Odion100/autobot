// Launch the autobot Electron shell: `npm run shell`.
// Env knobs: AUTOBOT_START_URL (default about:blank), AUTOBOT_CDP_PORT (default 9223),
// AUTOBOT_SHELL_SHOW=0 to run windowless.
import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const electronBin = require("electron");
const mainEntry = fileURLToPath(new URL("./main.cjs", import.meta.url));

// Agent harnesses export ELECTRON_RUN_AS_NODE=1, which turns the Electron binary into
// plain node and strips the app APIs — scrub it so the shell boots from any terminal.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const shell = spawn(electronBin, [mainEntry], { env, stdio: "inherit" });
shell.on("exit", (code) => process.exit(code ?? 0));
