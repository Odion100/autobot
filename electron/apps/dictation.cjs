// The dictation capability (host-provided, like the terminal — RFC-001's component
// pattern). Why it exists: the Web Speech API is a Chrome *service*, not a Chromium
// feature — webkitSpeechRecognition constructs inside Electron and never produces a
// word, because the recognizer lives on Google's servers and only Chrome gets it.
// Raw mic capture (getUserMedia) is ordinary Chromium and works fine; the page
// records, this host transcribes.
//
// Transcription is LOCAL-FIRST and genuinely built in: whisper.cpp (`brew install
// whisper-cpp`) + the base.en model at ~/.autobot/models/ — no cloud, no account,
// works offline. If either piece is missing, falls back to the OpenAI audio API
// with the project's key.
const { ipcMain } = require("electron");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const MODEL = path.join(os.homedir(), ".autobot", "models", "ggml-base.en.bin");
// draft passes (live preview while still talking) use the tiny model — ~3x faster,
// rougher text; the final pass re-does the whole clip with the base model
const MODEL_DRAFT = path.join(os.homedir(), ".autobot", "models", "ggml-tiny.en.bin");
// Native arm64 + Metal build (in ~/.autobot/bin) — the brew one is x86-under-Rosetta
// and ~20x slower on this machine. Falls back to brew's if the native one is gone.
const WHISPER = [path.join(os.homedir(), ".autobot", "bin", "whisper-cli"), "/usr/local/bin/whisper-cli"]
  .find(fs.existsSync) ?? "/usr/local/bin/whisper-cli";
const FFMPEG = "/usr/local/bin/ffmpeg";

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout)
    )
  );

const localAvailable = () => fs.existsSync(WHISPER) && fs.existsSync(MODEL) && fs.existsSync(FFMPEG);

async function transcribeLocal(bytes, mimeType, { draft = false } = {}) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(os.tmpdir(), "autobot-dictation");
  fs.mkdirSync(dir, { recursive: true });
  const ext = (mimeType.split("/")[1] || "webm").split(";")[0];
  const src = path.join(dir, `${stamp}-src.${ext}`); // "-src" so wav input can't collide with the output
  const wav = path.join(dir, `${stamp}.wav`);
  try {
    fs.writeFileSync(src, bytes);
    // whisper wants 16kHz mono wav; ffmpeg decodes whatever MediaRecorder produced
    await run(FFMPEG, ["-y", "-i", src, "-ar", "16000", "-ac", "1", "-f", "wav", wav]);

    // Energy gate: whisper HALLUCINATES on silence ("you", "Thank you." from empty
    // air) — measure loudness first and never transcribe quiet. Also skips the
    // model entirely for silent draft ticks.
    const stats = await new Promise((resolve) =>
      execFile(FFMPEG, ["-i", wav, "-af", "volumedetect", "-f", "null", "-"], (_e, _o, stderr) => resolve(stderr || ""))
    );
    const mean = Number(stats.match(/mean_volume:\s*(-?[\d.]+) dB/)?.[1] ?? 0);
    if (mean < -45) return { text: "" };

    const model = draft && fs.existsSync(MODEL_DRAFT) ? MODEL_DRAFT : MODEL;
    const out = await run(WHISPER, ["-m", model, "-f", wav, "--no-timestamps", "--no-prints"]);
    // whisper emits markers for non-speech ("[BLANK_AUDIO]", "(silence)", …) — those
    // are metadata, not dictation; one leaked into Odion's chat as literal text
    const text = out
      .replace(/[\[(](?:BLANK_AUDIO|SILENCE|NOISE|MUSIC|INAUDIBLE|typing|clicking)[\])]/gi, "")
      .trim();
    return { text };
  } finally {
    fs.rmSync(src, { force: true });
    fs.rmSync(wav, { force: true });
  }
}

function loadOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, "../../.env"), "utf8");
    const m = env.match(/^OPENAI_API_KEY\s*=\s*"?([^"\n]+)"?/m);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function transcribeOpenAI(bytes, mimeType) {
  const key = loadOpenAIKey();
  if (!key) throw new Error("no OPENAI_API_KEY available to the shell");
  const form = new FormData();
  const ext = (mimeType.split("/")[1] || "webm").split(";")[0];
  form.append("file", new Blob([bytes], { type: mimeType }), `dictation.${ext}`);
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription failed: ${res.status} ${await res.text()}`);
  const { text } = await res.json();
  return { text };
}

async function transcribe(bytes, mimeType = "audio/webm", opts = {}) {
  if (localAvailable()) return transcribeLocal(bytes, mimeType, opts);
  return transcribeOpenAI(bytes, mimeType);
}

function register() {
  // opts.draft = true → fast tiny-model pass, meant for the LIVE PREVIEW while the
  // user is still talking (SystemView sends the growing recording every second or
  // so and paints the rough text as interim; the final press re-transcribes the
  // whole clip on the base model).
  ipcMain.handle("dictation:transcribe", (_e, bytes, mimeType, opts) =>
    transcribe(Buffer.from(bytes), mimeType, opts ?? {})
  );
}

module.exports = { register, transcribe, transcribeLocal, localAvailable };
