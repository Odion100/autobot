// One implementation of the voice surface, shared by the shell's preload and the app preload —
// same reason dictationBridge and vectorsBridge exist: two callers, one contract.
//
// THE BRIDGE HANDS BACK SAMPLES, NOT SOUND. There are no speakers in the main process and the
// audio belongs to whichever app asked, so playback stays in the renderer. That is also what lets
// a caller do the interesting part: chunk a reply into sentences, play one while the next
// generates, and seek between them. A bridge that played audio itself could offer none of that.
module.exports = (ipcRenderer) => ({
  status: () => ipcRenderer.invoke("voice:status"),
  voices: () => ipcRenderer.invoke("voice:voices"),
  /** `{ sampleRate, audio }` — audio is base64 float32, straight into an AudioBuffer. */
  speak: (text, opts) => ipcRenderer.invoke("voice:speak", text, opts),
  stop: () => ipcRenderer.invoke("voice:stop"),
});
