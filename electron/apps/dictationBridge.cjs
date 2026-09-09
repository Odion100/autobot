// The dictation capability, shared by every preload that offers a mic — the app
// tabs (svPreload) and the browser chrome itself. One implementation; the voice
// behavior (capture, pause segmentation, draft cadence) never forks.
module.exports = (ipcRenderer) => ({
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
      let draftBusy = false, stopped = false, cancelled = false;
      let pipeline = Promise.resolve(); // keeps segment commits ordered

      const startSegment = () => {
        chunks = []; spoke = false; quietSince = null;
        rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.start(250);
      };

      // ends the CURRENT segment; commits its text if it held speech. No restart here.
      const closeSegment = async (forced, silent) => {
        const r = rec;
        if (!r || r.state === "inactive") return "";
        const ended = new Promise((res) => (r.onstop = res));
        r.stop();
        await ended;
        _debug?.("segment-closed");
        if (!spoke && !forced) return ""; // pure silence — nothing to commit
        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        if (blob.size < 2000) return "";
        try {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const res = await ipcRenderer.invoke("dictation:transcribe", bytes, blob.type);
          const text = (res?.text ?? "").trim();
          // A CANCELLED SESSION DELIVERS NOTHING LATE. Send takes the visible words and cancels;
          // a transcription already in flight then finished and handed the SAME words to the input
          // anyway (his repro: "it did send, and then it landed in the input anyway"). `cancelled`
          // — not `stopped` — because stop()'s tail commit is the stop button's whole point.
          if (text && !silent && !cancelled) onSegment?.(text);
          return text;
        } catch {
          // ONE FAILED TRANSCRIPTION MUST NOT WEDGE THE SESSION (found live, systemview-test:
          // this rejection poisoned the pipeline — every later commit silently skipped, the
          // recorder never restarted, drafts repainting the same frozen audio with the light on,
          // words never landing, stop() vaporizing them. His exact symptoms, all four). A lost
          // sentence is recoverable; a dead session is not.
          _debug?.("segment-transcribe-failed");
          return "";
        }
      };

      const levelTimer = setInterval(() => {
        if (stopped || !rec || rec.state === "inactive") return;
        if (rms() > levelThreshold) { spoke = true; quietSince = null; return; }
        if (!spoke) return;
        if (quietSince == null) { quietSince = Date.now(); return; }
        if (Date.now() - quietSince >= pauseMs) {
          quietSince = null;
          pipeline = pipeline
            .then(() => closeSegment(false))
            .catch(() => {})
            .then(() => { if (!stopped) startSegment(); }); // the restart is UNCONDITIONAL on the way through
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
        // send pressed mid-sentence: finish the sentence being said and RETURN its
        // text so the send takes it along (their AgentChat awaits exactly this)
        flush: () => {
          const done = pipeline
            .catch(() => {})
            .then(() => closeSegment(true, true))
            .catch(() => "")
            .then((text) => {
              if (!stopped) startSegment();
              return text || "";
            });
          pipeline = done.then(() => {}, () => {});
          return done;
        },
        stop: async () => {
          stopped = true;
          try {
            await (pipeline = pipeline.catch(() => {}).then(() => closeSegment(true)));
          } catch {}
          release();
        },
        cancel: () => { cancelled = true; stopped = true; release(); },
      };
    },
  });
