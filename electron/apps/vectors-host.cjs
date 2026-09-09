// IPC seam for the vector capability. vectors.cjs is pure node so it stays testable
// without electron; this half is the only part that knows what a renderer is.
const { ipcMain } = require("electron");
const vectors = require("./vectors.cjs");

function register() {
  ipcMain.handle("vectors:status", () => vectors.status());
  ipcMain.handle("vectors:embed", (_e, texts, opts) => vectors.embed(texts, opts));
  ipcMain.handle("vectors:index", (_e, collection, docs) => vectors.index(collection, docs));
  ipcMain.handle("vectors:upsert", (_e, collection, docs) => vectors.upsert(collection, docs));
  ipcMain.handle("vectors:remove", (_e, collection, ids) => vectors.remove(collection, ids));
  ipcMain.handle("vectors:drop", (_e, collection) => vectors.drop(collection));
  ipcMain.handle("vectors:search", (_e, collection, query, opts) => vectors.search(collection, query, opts));
  ipcMain.handle("vectors:collections", () => vectors.collections());
}

module.exports = { register };
