// THE VOICE RUNS IN ITS OWN NODE PROCESS, and that is measured rather than stylistic — the vectors
// embedder learned it first and wrote it down: onnxruntime does this work in plain node in seconds
// and HANGS INDEFINITELY in the electron main process. Even where it works, native inference
// threads inside the process that owns the window is the wrong trade: a crash in the model would
// take the whole browser, and a long generation would block every window. Out here, a dead voice
// is a rejected promise and nothing else.
//
// ONE SENTENCE PER REQUEST, DELIBERATELY. The caller does the chunking, because the caller is the
// one that knows what it wants to do between sentences — SystemView plays sentence N while
// generating N+1, and can seek to any of them. A worker that generated a whole reply would make
// the first word wait for the last, which is the one property that makes speech usable at all.
//
// Protocol: newline-delimited JSON on stdin/stdout, same shape as vectors-worker.cjs. The model
// stays warm between requests, so the load is paid once per harness run and not once per sentence.
const readline = require("readline");
const path = require("path");

const MODEL = process.env.VOICE_MODEL || "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null;

// CONFIGURING THE CACHE MEANS REACHING THE EXACT TRANSFORMERS INSTANCE KOKORO WILL USE, and
// getting there took two wrong turns worth recording because both failed SILENTLY.
//
//   1. `require("@huggingface/transformers")` gets autobot's HOISTED 4.3.1 — the embedder's copy,
//      not kokoro's. kokoro-js asks for ^3.5.1 and yarn gave it a nested 3.8.1, so setting `env`
//      there configured a module nobody in this path reads AND pulled a SECOND onnxruntime-node
//      into the process. The result was not an error: `from_pretrained` simply never returned and
//      nothing was ever downloaded. Two native ORT copies in one process is a hang, not a throw.
//   2. `import("kokoro-js").env` looks like the answer and is not — kokoro re-exports an `env`
//      with exactly one field (`wasmPaths`). Assigning `cacheDir` to it writes a property nothing
//      reads, so the weights quietly went to transformers' default location while the code said
//      otherwise.
//
// Resolving from kokoro's OWN directory gets the instance it will actually load, whatever yarn
// did with hoisting — one runtime, and an `env` that is really consulted.
const { pathToFileURL } = require("url");

// THE ESM FILE, BY PATH — because CJS and ESM are DIFFERENT MODULE INSTANCES with different
// `env` objects. `require.resolve("@huggingface/transformers")` hands back the package's CJS
// build; kokoro-js is ESM and imports the `.mjs`. Setting `cacheDir` on the CJS copy therefore
// configured a module nothing in this path would ever consult — the third silent miss in a row,
// and the one that left 88MB of weights inside node_modules where a `yarn install` wipes them.
//
// Resolving `package.json` and joining the ESM entry is what pins the instance kokoro will
// actually load, whatever yarn did with hoisting.
async function transformersEnv() {
  const from = path.dirname(require.resolve("kokoro-js"));
  // RESOLVE THE MAIN ENTRY AND SWAP THE FILENAME. Asking for the package's `package.json`
  // THROWS — its `exports` map does not expose it — and a catch around that turned the whole
  // thing into a silent no-op, which is how this missed three times in a row. Both builds live
  // side by side in `dist/`, so the CJS path is a reliable address for the ESM one.
  const cjs = require.resolve("@huggingface/transformers", { paths: [from] });
  const mod = await import(pathToFileURL(path.join(path.dirname(cjs), "transformers.node.mjs")).href);
  return mod.env;
}

async function ready() {
  if (!tts) {
    // THE WEIGHTS ARE THE HARNESS'S, not an app's — one copy under ~/.autobot/models/voice serves
    // every app that ever asks, the same slot whisper and the embedder already use. An app that
    // fetched its own would pay 86MB per app and keep it in a browser cache nobody can clear.
    // NOT GUARDED, DELIBERATELY. If this cannot be set the weights land inside node_modules —
    // where the default points, and where any `yarn install` deletes them — so the failure is
    // worth hearing about rather than absorbing. Measured: transformers' default cacheDir really
    // is `node_modules/.../@huggingface/transformers/.cache/`, and 88MB sat there until this was
    // fixed.
    if (process.env.VOICE_MODELS) (await transformersEnv()).cacheDir = process.env.VOICE_MODELS;
    const { KokoroTTS } = await import("kokoro-js");
    tts = await KokoroTTS.from_pretrained(MODEL, { device: "cpu", dtype: "q8" });
  }
  return tts;
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

// THE VOICE TABLE COMES OUT OF THE MODEL, never out of a list somebody typed. An earlier version
// of this feature ranked voices by a hand-written preference order and put a voice the model rates
// D at the top of it.
const tableOf = (model) =>
  Object.entries(model.voices)
    .filter(([, m]) => String(m.language).startsWith("en"))
    .map(([id, m]) => ({
      id,
      name: m.name,
      lang: m.language,
      gender: m.gender,
      grade: m.overallGrade,
    }));

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const model = await ready();
    if (req.op === "ready") return send({ id: req.id, ok: true, model: MODEL });
    if (req.op === "voices") return send({ id: req.id, ok: true, voices: tableOf(model) });
    if (req.op === "speak") {
      const text = String(req.text == null ? "" : req.text).trim();
      if (!text) return send({ id: req.id, ok: true, sampleRate: 0, audio: "" });
      const out = await model.generate(text, {
        voice: req.voice || "af_heart",
        speed: Number(req.speed) || 1,
      });
      // BASE64 OVER THE PIPE because the transport is newline-delimited JSON and raw bytes would
      // end the line. The samples stay float32 — the renderer hands them straight to an AudioBuffer
      // with no conversion, which is the point of not encoding a WAV here.
      return send({
        id: req.id,
        ok: true,
        sampleRate: out.sampling_rate,
        audio: Buffer.from(out.audio.buffer, out.audio.byteOffset, out.audio.byteLength).toString("base64"),
      });
    }
    return send({ id: req.id, ok: false, error: `unknown op "${req.op}"` });
  } catch (e) {
    send({ id: req.id, ok: false, error: String((e && e.message) || e) });
  }
});
