// One implementation of the vector surface, shared by the shell's preload and the
// app preload — same reason dictationBridge exists: two callers, one contract.
module.exports = (ipcRenderer) => ({
  status: () => ipcRenderer.invoke("vectors:status"),
  embed: (texts, opts) => ipcRenderer.invoke("vectors:embed", texts, opts),
  index: (collection, docs) => ipcRenderer.invoke("vectors:index", collection, docs),
  upsert: (collection, docs) => ipcRenderer.invoke("vectors:upsert", collection, docs),
  remove: (collection, ids) => ipcRenderer.invoke("vectors:remove", collection, ids),
  drop: (collection) => ipcRenderer.invoke("vectors:drop", collection),
  search: (collection, query, opts) => ipcRenderer.invoke("vectors:search", collection, query, opts),
  collections: () => ipcRenderer.invoke("vectors:collections"),
  records: (collection) => ipcRenderer.invoke("vectors:records", collection),
});
