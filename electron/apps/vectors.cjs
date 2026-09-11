// RFC-055 — SEMANTIC RETRIEVAL, as a harness capability.
//
// The decided shape, and why each piece is the way it is:
//
//   * A HARNESS capability, not an app feature (decision 1). It runs headless in the main
//     process and is exposed like `files` and `dictation`, so every app in the harness gets
//     it — including ones that don't exist yet. Pure node here; the IPC wiring lives in
//     vectors-host.cjs so this half is testable without electron.
//
//   * LOCAL, no key, no cloud. Same slot as whisper: weights under ~/.autobot/models/,
//     nothing leaves the machine. `allowRemoteModels` is true only long enough to fetch the
//     model once; after that the store answers offline forever.
//
//   * DERIVED, ALWAYS. A record is a POINTER WITH A SEARCHABLE SUMMARY — the embedded text is
//     a summary, the metadata points at the real file. Every collection is rebuildable from
//     its source, which is what stops the vectors from BECOMING the memory. The moment the
//     blob is the only copy, the knowledge lives somewhere nobody can read or delete.
//
//   * A JSON FILE AND A COSINE LOOP. No database, no server, still a file you can delete.
//     At our size that is not a compromise, it is the correct engineering: 227 chunks is
//     341KB of float32 and a brute-force scan is sub-millisecond. Design the store so an
//     ANN index drops over it later without moving anything; build that when it hurts.
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(os.homedir(), ".autobot");
const MODELS = path.join(ROOT, "models", "embed");
const STORE = path.join(ROOT, "vectors");

// bge-small-en-v1.5, chosen by MEASUREMENT against all-MiniLM-L6-v2 and e5-small-v2 over the
// real 227-chunk wiki (2026-09-08). It was the only one that returned all three compaction
// pages for "what breaks when an agent comes back after a compaction", and — the property
// that actually decides it — its scores SPREAD (0.55–0.68) where e5 compressed everything to
// ~0.83. A model whose hits and misses score the same cannot be thresholded, so it can never
// say "I found nothing", and a retriever that cannot say that is the confident-wrong-answer
// failure the MCP pass already taught us to fear.
const MODEL = "Xenova/bge-small-en-v1.5";
const DIM = 384;

// STORE VERSION — bumped when the RECORD shape changes, not just the file shape. v1 records
// carried no `kind`, so when scoped writes arrived nothing claimed them: they survived every
// prune, matched no filter, and would have sat in the index forever answering searches with
// data no writer could correct. Same lesson the tab strip taught — a cache that outlives its
// shape lies — and the same remedy, because the collection is DERIVED: on mismatch, throw it
// away and rebuild. Losing a rebuildable index once is free; believing a stale one is not.
const V = 2;

// bge is trained ASYMMETRICALLY: queries get an instruction prefix, passages get none. Using
// the same text for both costs real accuracy, and it is invisible — nothing errors, the
// ranking is just quietly worse.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

// THE EMBEDDER IS A CHILD PROCESS, and that is a measured decision, not a style choice:
// onnxruntime-node does this exact work in plain node in ~10s and HANGS INDEFINITELY in the
// electron main process. Even where it works, native inference threads inside the process
// that owns the window is the wrong trade — a crash in the model would take the whole
// browser, and a 10s index would block every window. Out of process, a dead embedder is a
// rejected promise. Same shape dictation already uses for whisper-cli.
const { fork } = require("child_process");
const WORKER = path.join(__dirname, "vectors-worker.cjs");

let _child = null;
let _seq = 0;
const _waiting = new Map();

function child() {
  if (_child && !_child.killed) return _child;
  _child = fork(WORKER, [], {
    // The child is plain node, so it must NOT inherit electron's argv/env quirks. ELECTRON_RUN_AS_NODE
    // is what makes the bundled binary behave as node when this runs from a packaged app.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VEC_MODEL: MODEL, VEC_MODELS: MODELS },
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
      try { msg = JSON.parse(line); } catch { continue; }
      const w = _waiting.get(msg.id);
      if (!w) continue;
      _waiting.delete(msg.id);
      msg.ok ? w.resolve(msg) : w.reject(new Error(msg.error || "embed failed"));
    }
  });
  // A dead child must FAIL every in-flight caller, not leave them hanging forever — the
  // silent-hang failure this whole design exists to avoid, reproduced one layer up.
  const die = (why) => {
    _child = null;
    for (const [, w] of _waiting) w.reject(new Error("embedder exited: " + why));
    _waiting.clear();
  };
  _child.on("exit", (code, sig) => die(sig || "code " + code));
  _child.on("error", (e) => die(e.message));
  return _child;
}

function ask(req, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    const c = child();
    const timer = setTimeout(() => {
      _waiting.delete(id);
      try { c.kill(); } catch {}
      _child = null;
      reject(new Error("embedder timed out"));
    }, timeoutMs);
    _waiting.set(id, {
      resolve: (m) => { clearTimeout(timer); resolve(m); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    c.stdin.write(JSON.stringify({ ...req, id }) + "\n");
  });
}

// Let the harness shut the embedder down cleanly rather than leaking a node process.
function stop() {
  if (_child) { try { _child.kill(); } catch {} _child = null; }
}

// True once the weights are on disk — the honest "can I answer offline right now", the same
// question dictation's localAvailable() answers for whisper.
const modelReady = () => fs.existsSync(path.join(MODELS, MODEL, "onnx", "model_quantized.onnx"));

// Batched so a 227-chunk index is ~10s instead of a per-call model round trip each time.
async function embed(texts, { query = false } = {}) {
  const list = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t == null ? "" : t));
  if (!list.length) return [];
  const { vecs } = await ask({ op: "embed", texts: list, query });
  return vecs;
}

const fileOf = (collection) =>
  path.join(STORE, String(collection).replace(/[^a-zA-Z0-9._-]/g, "_") + ".json");

function read(collection) {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(collection), "utf8"));
    // Versioned like every other cache here, for the reason the tab strip taught: a cache
    // that outlives its shape lies. A model change silently invalidates every vector in the
    // file — same dimensions, different meaning — and nothing would ever error.
    if (raw && raw.v === V && raw.model === MODEL && Array.isArray(raw.records)) return raw;
  } catch {}
  return { v: V, model: MODEL, dim: DIM, records: [] };
}

function write(collection, data) {
  // THE VERSION IS STAMPED HERE AND NOWHERE ELSE. It was previously hardcoded at two call
  // sites, so bumping the guard in read() made every write unreadable: records landed on
  // disk, attach reported success, and every read returned empty. Silent, because a write
  // that succeeds and a read that finds nothing never meet. One writer, no drift.
  data.v = V;
  data.model = MODEL;
  data.dim = DIM;
  fs.mkdirSync(STORE, { recursive: true });
  fs.writeFileSync(fileOf(collection), JSON.stringify(data));
  return { collection, count: data.records.length };
}

// A doc is { id, text, meta } — `text` is what gets embedded (the summary), `meta` is the
// pointer that survives into the result. Nothing here interprets meta; that is the caller's
// model of the world, and keeping it opaque is what lets one store serve wiki pages, MCP
// methods and agent memory without knowing which is which.
async function index(collection, docs = []) {
  const list = docs.filter((d) => d && d.text);
  const vecs = await embed(list.map((d) => d.text));
  return write(collection, {
    model: MODEL,
    dim: DIM,
    indexed: new Date().toISOString(),
    records: list.map((d, i) => ({ id: d.id || `d${i}`, text: d.text, meta: d.meta || {}, vec: vecs[i] })),
  });
}

// Upsert by id, so a caller can re-index one changed file without paying for the corpus.
async function upsert(collection, docs = []) {
  const list = docs.filter((d) => d && d.text);
  if (!list.length) return { collection, count: read(collection).records.length };
  const data = read(collection);
  const vecs = await embed(list.map((d) => d.text));
  const byId = new Map(data.records.map((r) => [r.id, r]));
  list.forEach((d, i) =>
    byId.set(d.id, { id: d.id, text: d.text, meta: d.meta || {}, vec: vecs[i] })
  );
  data.records = [...byId.values()];
  data.indexed = new Date().toISOString();
  return write(collection, data);
}

// SCOPED REPLACE — the primitive that makes ONE collection safe for MANY writers.
//
// It exists because of a measured bug, not a hypothetical: discovery and loadService share
// the `mcp-tools` collection, discovery wrote with index() (a FULL replace), and every
// discovery refresh silently deleted all six of loadService's records. 11 -> 4, no error,
// on a 5-minute timer. A tool that had been attached and used would simply stop existing.
//
// It also does the staleness work in the same pass: anything matching the scope that is NOT
// in the new set is dropped. A method deleted from a service, a server removed from an
// agent — both disappear because they are absent from the replacement, never because
// someone remembered to clean up. Derived data should be swept by rebuilding, not by
// maintenance.
async function replaceWhere(collection, where, docs = []) {
  const data = read(collection);
  const scoped = (r) => Object.entries(where || {}).every(([k, v]) => r.meta && r.meta[k] === v);
  const list = docs.filter((d) => d && d.text);
  const vecs = list.length ? await embed(list.map((d) => d.text)) : [];
  const before = data.records.length;
  const kept = data.records.filter((r) => !scoped(r));
  // `dropped` is what the scope REMOVED — a method deleted from a service, a server no longer
  // wired. It is the number that tells a caller pruning actually happened, so it must be
  // measured before the new records land, not inferred after.
  const dropped = before - kept.length;
  data.records = [
    ...kept,
    ...list.map((d, i) => ({ id: d.id, text: d.text, meta: d.meta || {}, vec: vecs[i] })),
  ];
  data.indexed = new Date().toISOString();
  const out = write(collection, data);
  return { ...out, replaced: list.length, dropped, kept: kept.length, scope: where };
}

function remove(collection, ids = []) {
  const data = read(collection);
  const kill = new Set(ids);
  data.records = data.records.filter((r) => !kill.has(r.id));
  return write(collection, data);
}

function drop(collection) {
  try {
    fs.unlinkSync(fileOf(collection));
  } catch {}
  return { collection, count: 0 };
}

const cos = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

// `min` exists because of the spread the model was chosen for: a retriever that always returns
// its top 3 can never say "nothing here matches", and a confident wrong answer costs more than
// an honest empty one. Default 0 keeps that a deliberate choice by the caller, never a silent one.
async function search(collection, query, { k = 5, min = 0, where } = {}) {
  const data = read(collection);
  if (!data.records.length) return [];
  const [qv] = await embed([query], { query: true });
  let rows = data.records;
  if (where && typeof where === "object")
    rows = rows.filter((r) => Object.entries(where).every(([key, val]) => r.meta && r.meta[key] === val));
  return rows
    .map((r) => ({ id: r.id, score: cos(qv, r.vec), text: r.text, meta: r.meta }))
    .filter((r) => r.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// RECORDS — the surface's read path. Search answers "what matches"; this answers "what is IN
// here", which is what a management UI needs (browse, not query). Strips `vec` deliberately:
// 384 floats per record is real payload and nothing a human view uses. Newest first, because a
// store read by a person is a list they scan, and the thing just written is the thing they want.
function records(collection) {
  const d = read(collection);
  return {
    collection,
    model: d.model,
    count: d.records.length,
    indexed: d.indexed || null,
    records: d.records
      .map((r) => ({ id: r.id, text: r.text, meta: r.meta || {} }))
      .sort((a, b) => String((b.meta && b.meta.created) || "").localeCompare(String((a.meta && a.meta.created) || ""))),
  };
}

function collections() {
  try {
    return fs.readdirSync(STORE)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const name = f.replace(/\.json$/, "");
        const d = read(name);
        return { collection: name, count: d.records.length, model: d.model, indexed: d.indexed || null };
      });
  } catch {
    return [];
  }
}

const status = () => ({ model: MODEL, dim: DIM, ready: modelReady(), models: MODELS, store: STORE, collections: collections() });

module.exports = { embed, stop, records, replaceWhere, index, upsert, remove, drop, search, collections, status, modelReady, MODEL, DIM };
