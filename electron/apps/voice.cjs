// VOICE — SPEECH OUT, AS A HARNESS CAPABILITY.
//
// The decided shape, and it is the same argument RFC-055 made for retrieval (decision 1): this is
// a HARNESS capability, not an app feature. It is exposed like `files`, `dictation` and `vectors`,
// so every app in the harness gets it — including ones that do not exist yet. His ruling, and the
// correction that produced it: *"you should be getting the functionality from the harness."* An
// app that shipped its own would mean one model per app, one 86MB download per app, and a product
// that sounds different depending on which window you are in.
//
// IT IS THE MIRROR OF DICTATION. Dictation is speech IN and already lives here; this is speech
// OUT. Same slot for the weights (~/.autobot/models), same local-only promise: no key, no account,
// nothing leaves the machine after the one-time fetch.
//
// WHAT THIS DOES NOT DO: play anything. There are no speakers in the main process, and audio
// belongs to whichever app asked — so this returns SAMPLES and the renderer plays them. That also
// keeps the interesting part where it belongs: the caller chunks a reply into sentences, plays one
// while the next generates, and can seek between them. A capability that played audio itself could
// offer none of that.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { fork } = require("child_process");

const ROOT = path.join(os.homedir(), ".autobot");
const MODELS = path.join(ROOT, "models", "voice");
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const WORKER = path.join(__dirname, "voice-worker.cjs");

// THE MODEL RUNS IN A CHILD PROCESS, and that is measured, not stylistic. onnxruntime-node does
// this work in plain node in a second and HANGS INDEFINITELY in the electron main process — the
// embedder hit it first and wrote it down. Even where it works, native inference threads inside
// the process that owns the window is the wrong trade: a crash in the model would take the whole
// browser, and a long generation would block every window. Out of process, a dead voice is a
// rejected promise.
let _child = null;
let _seq = 0;
const _waiting = new Map();

function child() {
  if (_child && !_child.killed) return _child;
  _child = fork(WORKER, [], {
    // The child is plain node, so it must NOT inherit electron's argv/env quirks.
    // ELECTRON_RUN_AS_NODE is what makes the bundled binary behave as node from a packaged app.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VOICE_MODEL: MODEL, VOICE_MODELS: MODELS },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
  let buf = "";
  _child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const w = _waiting.get(msg.id);
      if (!w) continue;
      _waiting.delete(msg.id);
      msg.ok ? w.resolve(msg) : w.reject(new Error(msg.error || "the voice failed"));
    }
  });
  // A DEAD CHILD MUST FAIL EVERY IN-FLIGHT CALLER rather than leave them hanging forever — the
  // silent-hang failure this whole design exists to avoid, reproduced one layer up.
  const die = (why) => {
    _child = null;
    for (const [, w] of _waiting) w.reject(new Error("the voice exited: " + why));
    _waiting.clear();
  };
  _child.on("exit", (code, sig) => die(sig || "code " + code));
  _child.on("error", (e) => die(e.message));
  return _child;
}

function ask(req, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    const c = child();
    const timer = setTimeout(() => {
      _waiting.delete(id);
      try {
        c.kill();
      } catch {}
      _child = null;
      reject(new Error("the voice timed out"));
    }, timeoutMs);
    _waiting.set(id, {
      resolve: (m) => {
        clearTimeout(timer);
        resolve(m);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    c.stdin.write(JSON.stringify({ ...req, id }) + "\n");
  });
}

/** Let the harness shut the voice down cleanly rather than leaking a node process. */
function stop() {
  if (_child) {
    try {
      _child.kill();
    } catch {}
    _child = null;
  }
}

// THE VOICE LIST IS CACHED because an app asks for it every time a settings panel opens, and the
// answer cannot change without the model changing. It is also the cheapest possible warm-up: the
// first `voices()` loads the model, so a panel opening is what pays for the first sentence.
let _voices = null;
async function voices() {
  if (_voices) return _voices;
  const { voices: list } = await ask({ op: "voices" });
  _voices = list;
  return list;
}

/**
 * ONE SENTENCE IN, SAMPLES OUT. `{ sampleRate, audio }` where audio is base64 float32 — the
 * renderer decodes it straight into an AudioBuffer with no conversion, which is why nothing here
 * encodes a WAV.
 */
async function speak(text, { voice = "af_heart", speed = 1 } = {}) {
  const body = String(text == null ? "" : text).trim();
  if (!body) return { sampleRate: 0, audio: "" };
  const r = await ask({ op: "speak", text: body, voice, speed });
  return { sampleRate: r.sampleRate, audio: r.audio };
}

// TRUE ONCE THE WEIGHTS ARE ON DISK — the honest "can I answer offline right now", the same
// question dictation's localAvailable() answers for whisper and vectors' modelReady() for the
// embedder. A surface uses it to decide whether the first press has a download in front of it.
const modelReady = () => {
  try {
    return fs.existsSync(path.join(MODELS, MODEL.replace("/", path.sep)));
  } catch {
    return false;
  }
};

const status = () => ({ model: MODEL, models: MODELS, ready: modelReady(), running: !!_child });

module.exports = { voices, speak, stop, status, modelReady, MODEL, MODELS };
