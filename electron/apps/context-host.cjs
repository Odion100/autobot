// IPC seam for the CONTEXT MANAGEMENT surface — his half. The agent-facing tools live in
// electron/agents/context.cjs (remember/context, in-process SDK server); these are the
// human's curate verbs (list/save/delete notes), reached from SystemView's renderer.
// Same module underneath, so a note the agent wrote and a note he edits are one thing.
const { ipcMain } = require("electron");
const context = require("../agents/context.cjs");

function register() {
  ipcMain.handle("context:notes", (_e, scope) => context.listNotes(scope));
  ipcMain.handle("context:save", (_e, scope, id, fields) => context.saveNote(scope, id, fields));
  ipcMain.handle("context:delete", (_e, scope, id) => context.deleteNote(scope, id));
}

module.exports = { register };
