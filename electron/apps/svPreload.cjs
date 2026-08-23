// Preload for local-app tabs (SystemView first): the host side of RFC-001's frozen
// transport contract. A plain browser has no window.systemview.terminal — its absence
// is how the <Terminal> component knows to say "no terminal host here".
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("systemview", {
  // The Web Speech API doesn't work in Electron (no Google speech service behind
  // webkitSpeechRecognition) — the host provides dictation instead. Per the dividing
  // rule (RFC-001): CAPABILITIES belong to the browser, SURFACES belong to the app.
  dictation: {
    // low-level: transcribe bytes you recorded yourself. opts.draft = fast rough pass.
    transcribe: (bytes, mimeType, opts) => ipcRenderer.invoke("dictation:transcribe", bytes, mimeType, opts),

    // The whole voice-recognition BEHAVIOR, host-owned: capture, pause detection,
    // per-sentence segmentation, draft cadence. The app only supplies surfaces:
    //   onDraft(text)   — rough live text of the sentence in progress
    //   onSegment(text) — final-quality text, committed at each pause
    // Returns { flush, stop, cancel }: flush force-finishes the current sentence and
    // keeps recording (send while hot); stop finishes and releases; cancel discards.
    async listen({ onDraft, onSegment, pauseMs = 1500, draftMs = 1200, levelThreshold = 0.023, _stream, _debug } = {}) {
      const stream = _stream ?? (await navigator.mediaDevices.getUserMedia({ audio: true }));
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const rms = () => {
        analyser.getByteTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
        return Math.sqrt(s / buf.length);
      };

      const wanted = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      const mime = (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported &&
        wanted.find((m) => MediaRecorder.isTypeSupported(m))) || "";

      let rec = null, chunks = [], spoke = false, quietSince = null;
      let draftBusy = false, stopped = false;
      let pipeline = Promise.resolve(); // keeps segment commits ordered

      const startSegment = () => {
        chunks = []; spoke = false; quietSince = null;
        rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.start(250);
      };

      // ends the CURRENT segment; commits its text if it held speech. No restart here.
      const closeSegment = async (forced) => {
        const r = rec;
        if (!r || r.state === "inactive") return;
        const ended = new Promise((res) => (r.onstop = res));
        r.stop();
        await ended;
        _debug?.("segment-closed");
        if (!spoke && !forced) return; // pure silence — nothing to commit
        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        if (blob.size < 2000) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const res = await ipcRenderer.invoke("dictation:transcribe", bytes, blob.type);
        const text = (res?.text ?? "").trim();
        if (text) onSegment?.(text);
      };

      const levelTimer = setInterval(() => {
        if (stopped || !rec || rec.state === "inactive") return;
        if (rms() > levelThreshold) { spoke = true; quietSince = null; return; }
        if (!spoke) return;
        if (quietSince == null) { quietSince = Date.now(); return; }
        if (Date.now() - quietSince >= pauseMs) {
          quietSince = null;
          pipeline = pipeline.then(() => closeSegment(false)).then(() => { if (!stopped) startSegment(); });
        }
      }, 100);

      const draftTimer = setInterval(async () => {
        if (stopped || draftBusy || !spoke || !chunks.length) return;
        draftBusy = true;
        try {
          const blob = new Blob(chunks, { type: mime || "audio/webm" });
          if (blob.size >= 2000) {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const res = await ipcRenderer.invoke("dictation:transcribe", bytes, blob.type, { draft: true });
            const t = (res?.text ?? "").trim();
            if (t && !stopped) onDraft?.(t);
          }
        } catch { /* a failed draft is just a skipped repaint */ } finally { draftBusy = false; }
      }, draftMs);

      const release = () => {
        clearInterval(levelTimer);
        clearInterval(draftTimer);
        try { if (rec && rec.state !== "inactive") rec.stop(); } catch {}
        if (!_stream) stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
      };

      startSegment();

      return {
        // send pressed mid-sentence: commit what's being said, mic stays hot
        flush: () => (pipeline = pipeline.then(() => closeSegment(true)).then(() => { if (!stopped) startSegment(); })),
        stop: async () => {
          stopped = true;
          await (pipeline = pipeline.then(() => closeSegment(true)));
          release();
        },
        cancel: () => { stopped = true; release(); },
      };
    },
  },
  terminal: {
    // Every live session on the machine — including survivors from previous shell
    // runs, which is the point: nothing runs invisibly. Each entry: { projectCode,
    // sessionId, key, pid }. Kill any of them with killSession, view open or not.
    sessions: () => ipcRenderer.invoke("term:list"),
    killSession: (projectCode, sessionId = "main") =>
      ipcRenderer.invoke("term:kill", `${projectCode}:${sessionId}`),

    // open({ projectCode, sessionId?, cwd, cols?, rows? }) -> Promise<Transport>
    async open(opts) {
      const { key, history } = await ipcRenderer.invoke("term:open", opts);
      return {
        onData(cb) {
          const l = (_e, chunk) => cb(chunk);
          ipcRenderer.on(`term:data:${key}`, l);
          return () => ipcRenderer.removeListener(`term:data:${key}`, l);
        },
        onExit(cb) {
          const l = (_e, info) => cb(info);
          ipcRenderer.on(`term:exit:${key}`, l);
          return () => ipcRenderer.removeListener(`term:exit:${key}`, l);
        },
        write: (data) => ipcRenderer.send("term:write", key, data),
        resize: (cols, rows) => ipcRenderer.send("term:resize", key, cols, rows),
        history: () => ipcRenderer.invoke("term:history", key),
        // ⌘K semantics: truncates the host-side scrollback so a remount stays clear —
        // pair with xterm.clear() in the component
        clear: () => ipcRenderer.send("term:clear", key),
        // detaches this view; the session keeps running (kill is separate + deliberate)
        dispose: () => ipcRenderer.send("term:dispose", key),
        kill: () => ipcRenderer.invoke("term:kill", key),
        initialHistory: history,
      };
    },
  },
});
