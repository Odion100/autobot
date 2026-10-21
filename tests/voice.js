// VOICE, AS ASSERTIONS — the harness capability for speech OUT.
//
// What is testable without a shell is the part that keeps breaking: the GRANT (an app that did not
// ask for voice must not be handed it), the worker PROTOCOL, and the cache location — which is the
// one that failed silently three times while appearing to work.
//
// Run: node tests/voice.js
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const apps = path.join(here, "..", "electron", "apps");
const { build, GRANTS } = require(path.join(apps, "capabilities.cjs"));

let pass = 0,
  fail = 0;
const t = (name, cond) => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}`);
};

// ---- the grant ------------------------------------------------------------------------------
console.log("\nthe voice grant — its own capability, not dictation's");
const FULL = {
  dictation: { listen: 1 },
  voice: { status: 1, voices: 1, speak: 1, stop: 1 },
};

t("voice is a capability in its own right", !!GRANTS.voice);
const none = build(FULL, []);
t("an app granted nothing cannot speak", !("voice" in none));

// HEARING THE USER AND SPEAKING BACK ARE DIFFERENT POWERS. An app that transcribes must not
// thereby get to make the machine talk, which is why this is not folded into `dictation`.
const hears = build(FULL, ["dictation"]);
t("dictation alone does NOT grant voice", !("voice" in hears));
t("dictation alone still grants dictation", !!hears.dictation);

const speaks = build(FULL, ["voice"]);
t("voice grants the whole namespace", !!speaks.voice && !!speaks.voice.speak && !!speaks.voice.stop);
t("voice alone does NOT grant dictation — the microphone is a separate power", !("dictation" in speaks));

// ---- the IDE's own declaration --------------------------------------------------------------
console.log("\nthe built-in registry");
const registrySrc = fs.readFileSync(path.join(apps, "registry.cjs"), "utf8");
t("SystemView declares voice, like every other grant it takes", /"voice"/.test(registrySrc));

// ---- the bridge contract ----------------------------------------------------------------------
console.log("\nthe bridge — one contract, both preloads");
const bridge = require(path.join(apps, "voiceBridge.cjs"));
const calls = [];
const surface = bridge({ invoke: (ch, ...rest) => (calls.push([ch, ...rest]), Promise.resolve(null)) });
t("exposes exactly status, voices, speak, stop", JSON.stringify(Object.keys(surface).sort()) === JSON.stringify(["speak", "status", "stop", "voices"]));
surface.speak("hello", { voice: "af_heart", speed: 1.2 });
t("speak carries the text and the options through", calls[0][0] === "voice:speak" && calls[0][1] === "hello" && calls[0][2].voice === "af_heart");
surface.stop();
t("stop is its own channel", calls[1][0] === "voice:stop");

// ---- the weights live in the HARNESS, not in node_modules -------------------------------------
//
// THIS IS THE ONE THAT FAILED SILENTLY. transformers.js defaults its cache to a directory INSIDE
// node_modules, which any install deletes — and three different ways of setting `env.cacheDir`
// looked correct while configuring a module nothing read. The capability must name the harness
// slot, and the worker must be the thing that sets it.
console.log("\nthe weights");
const voice = require(path.join(apps, "voice.cjs"));
t("the model lives under ~/.autobot/models", voice.MODELS === path.join(os.homedir(), ".autobot", "models", "voice"));
const workerSrc = fs.readFileSync(path.join(apps, "voice-worker.cjs"), "utf8");
// COMMENTS STRIPPED BEFORE ASSERTING ON CODE. The worker's comments quote the wrong call on
// purpose — it is the trap that cost three silent failures and is worth naming — and a source
// scan that cannot tell prose from code fails on its own documentation.
const workerCode = workerSrc.replace(/^\s*\/\/.*$/gm, "");
t("the worker sets cacheDir from VOICE_MODELS", /cacheDir\s*=\s*process\.env\.VOICE_MODELS/.test(workerCode));
// Resolving from kokoro's own directory is what pins the instance it will actually load; resolving
// the bare specifier gets the HOISTED copy, which is a different module AND a second onnxruntime.
t("it resolves transformers from kokoro's own directory", /require\.resolve\("kokoro-js"\)/.test(workerCode));
t("it reaches the ESM build, not the CJS one — they are different instances", /transformers\.node\.mjs/.test(workerCode));
t("it does not require the hoisted transformers", !/require\("@huggingface\/transformers"\)/.test(workerCode));

// ---- the model runs out of process ------------------------------------------------------------
console.log("\nout of process");
const voiceSrc = fs.readFileSync(path.join(apps, "voice.cjs"), "utf8");
t("inference is forked, never run in the main process", /fork\(WORKER/.test(voiceSrc));
t("a dead worker rejects every in-flight caller rather than hanging them", /the voice exited/.test(voiceSrc));
t("there is a timeout, so a wedged model cannot hang a window forever", /the voice timed out/.test(voiceSrc));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
