// The embedder runs in ITS OWN NODE PROCESS, and that is not a workaround — it is the
// same shape dictation already uses (whisper-cli is a separate process too).
//
// It became non-negotiable on measurement: onnxruntime-node does the identical work in
// plain node in ~10s, and in the ELECTRON MAIN PROCESS it hangs indefinitely. Native
// inference threads inside the process that owns the window is a bad trade even when it
// works — a crash in the model takes the whole browser with it, and a 10s index blocks
// every window. Out here, a crashed embedder is a failed promise and nothing else.
//
// Protocol: newline-delimited JSON on stdin/stdout. The model stays warm between
// requests, so the ~2s load is paid once per harness run, not once per query.
const readline = require("readline");

const MODEL = process.env.VEC_MODEL || "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
let extract = null;

async function ready() {
  if (!extract) {
    const { pipeline, env } = require("@huggingface/transformers");
    env.cacheDir = process.env.VEC_MODELS;
    env.localModelPath = process.env.VEC_MODELS;
    extract = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  }
  return extract;
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  try {
    const run = await ready();
    if (req.op === "ready") return send({ id: req.id, ok: true, model: MODEL });
    const input = req.texts.map((t) => (req.query ? QUERY_PREFIX : "") + String(t == null ? "" : t).slice(0, 4000));
    const vecs = [];
    // Small batches deliberately: this model is tiny, the wins past 8 are noise, and a
    // smaller working set is what keeps a long index from wedging the runtime.
    for (let i = 0; i < input.length; i += 8) {
      const r = await run(input.slice(i, i + 8), { pooling: "mean", normalize: true });
      const [n, dim] = r.dims;
      for (let j = 0; j < n; j++) vecs.push(Array.from(r.data.slice(j * dim, (j + 1) * dim)));
    }
    send({ id: req.id, ok: true, vecs });
  } catch (e) {
    send({ id: req.id, ok: false, error: e.message });
  }
});
