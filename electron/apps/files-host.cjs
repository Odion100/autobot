// IPC wiring for the host-served codebase + projects + auth surfaces that
// SystemView's /ide page fills in from (their ask, 2026-08-23). Project code →
// root resolution stays host-side, same file the terminals and agents use.
const { ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const files = require("./files.cjs");
// the run store and the agent definitions both follow a project rename
const sessions = require("../agents/sessions.cjs");
const definitions = require("../agents/definitions.cjs");
const nudge = require("../agents/nudge.cjs");

const PROJECTS_FILE = path.join(os.homedir(), ".autobot", "projects.json");
const readProjects = () => {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
  } catch {
    return {};
  }
};

const { buildUpdate } = require("./documentUpdate.cjs");

function rootOf(projectCode) {
  const dir = readProjects()[projectCode];
  if (!dir || !fs.existsSync(dir)) throw new Error(`unknown project: ${projectCode}`);
  return path.resolve(dir);
}

function register(getWin) {
  // projects — list / add-by-folder / remove (shared with the setup page's flow)
  ipcMain.handle("files:projects", () => readProjects());
  // The name-first door (Odion, via SystemView 2026-08-24: "choose a name before
  // it's actually in"). pick-folder ONLY opens the dialog — nothing is written
  // until add-project confirms a code the human chose (or accepted).
  ipcMain.handle("files:pick-folder", async () => {
    const r = await dialog.showOpenDialog(getWin?.(), {
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled) return null;
    const dir = r.filePaths[0];
    return { dir, defaultCode: path.basename(dir) };
  });
  ipcMain.handle("files:add-project", (_e, code, dir) => {
    const finalCode = code?.trim();
    if (!finalCode || !dir) return { error: "a project needs a code and a folder" };
    const map = readProjects();
    // a code means ONE folder — refuse a new folder under a code that already
    // means a different directory (re-adding the same folder is a harmless no-op)
    if (map[finalCode] && path.resolve(map[finalCode]) !== path.resolve(dir))
      return {
        error: `"${finalCode}" already means ${map[finalCode]} — pick a different code`,
      };
    map[finalCode] = dir;
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(map, null, 2));
    return { code: finalCode, dir };
  });
  // rename — the identity is his to change, not remove-and-re-add's. Migrates
  // the run store (`code:sessionId` keys + projectCode fields) and the agent
  // definitions that name this project, so saved
  // conversations survive under the new name. Live in-memory sessions keep the
  // old code until reopened — visible, not fatal.
  ipcMain.handle("files:rename-project", (_e, code, next) => {
    const finalNext = next?.trim();
    if (!finalNext) return { error: "a project needs a name" };
    const map = readProjects();
    if (!map[code]) return { error: `unknown project: ${code}` };
    if (finalNext === code) return { code, dir: map[code] };
    if (map[finalNext] && path.resolve(map[finalNext]) !== path.resolve(map[code]))
      return {
        error: `"${finalNext}" already means ${map[finalNext]} — pick a different code`,
      };
    map[finalNext] = map[code];
    delete map[code];
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(map, null, 2));
    // the RUN store, through the substrate — it was ~/.autobot/agents.json and is
    // now sessions.json (RFC-003 §3). Reading it by path here is how a rename
    // quietly stops migrating anything.
    try {
      sessions.saveSessionStore((store) => {
        for (const key of Object.keys(store)) {
          if (store[key]?.projectCode !== code) continue;
          const nextKey = key.startsWith(`${code}:`)
            ? `${finalNext}:${key.slice(code.length + 1)}`
            : key;
          store[nextKey] = { ...store[key], projectCode: finalNext };
          if (nextKey !== key) delete store[key];
        }
      });
    } catch {} // no run store yet is fine
    try {
      definitions.renameProject(code, finalNext);
    } catch {}
    return { code: finalNext, dir: map[finalNext] };
  });
  // legacy one-shot door: dialog + write in one call, code defaulting to the
  // directory name. Kept for compat; the name-first pair above is the real flow.
  ipcMain.handle("files:pick-project", async (_e, code) => {
    const r = await dialog.showOpenDialog(getWin?.(), {
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled) return null;
    const dir = r.filePaths[0];
    const map = readProjects();
    const finalCode = code?.trim() || path.basename(dir);
    // a code means ONE folder — refuse a new folder under a code that already
    // means a different directory (re-adding the same folder is a harmless no-op)
    if (map[finalCode] && path.resolve(map[finalCode]) !== path.resolve(dir))
      return {
        error: `"${finalCode}" already means ${map[finalCode]} — pick a different code`,
      };
    map[finalCode] = dir;
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(map, null, 2));
    return { code: finalCode, dir };
  });
  ipcMain.handle("files:remove-project", (_e, code) => {
    const map = readProjects();
    delete map[code];
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(map, null, 2));
    return map;
  });

  // the codebase surface, every call scoped by projectCode and root-guarded
  ipcMain.handle("files:read", (_e, pc, rel) => files.readFile(rootOf(pc), rel));
  ipcMain.handle("files:write", async (_e, pc, rel, content) => {
    const root = rootOf(pc);
    const out = await files.writeFile(root, rel, content);
    // RFC-073 §3 — his press in the window is not a tool in flight, so the watcher stays quiet on it
    // by design; this door is how the registry hears about a write that came from him.
    sessions.announceDocument(path.join(root, rel)).catch(() => {});
    return out;
  });
  // RFC-073 §3 — the window's documents tab saves through the HUB (a different process), so the
  // shell's own write door never fires for his press. The window calls this right after a
  // successful hub save: same announce the watcher and files:write call, same registry filter.
  ipcMain.handle("documents:note", (_e, pc, rel) => {
    try {
      return sessions.announceDocument(path.join(rootOf(pc), rel));
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
  ipcMain.handle("files:list", (_e, pc, rel) => files.listFiles(rootOf(pc), rel));
  ipcMain.handle("files:search", (_e, pc, pattern, opts) =>
    files.search(rootOf(pc), pattern, opts),
  );
  // git: read + staging. commit/push/discard deliberately absent.
  ipcMain.handle("files:git-state", (_e, pc) => files.gitState(rootOf(pc)));
  ipcMain.handle("files:changed", (_e, pc) => files.changedFiles(rootOf(pc)));
  ipcMain.handle("files:diff", (_e, pc, rel, opts) =>
    files.getDiff(rootOf(pc), rel, opts),
  );
  ipcMain.handle("files:stage", (_e, pc, paths, unstage) =>
    files.stageFiles(rootOf(pc), paths, unstage),
  );
  ipcMain.handle("files:stage-hunk", (_e, pc, rel, hunk, unstage) =>
    files.stageHunk(rootOf(pc), rel, hunk, unstage),
  );

  // auth — read-only mirror of the setup page's status
  // RFC-071 — A DOCUMENT HAS MEMBERS, and this is where a send becomes an EVENT. The window sees
  // the press; the host emits, because a surface that could emit its own trigger could forge a hook
  // it was never granted — the same rule page events live by.
  //
  // `members` goes out PIPE-WRAPPED (`|buapi|systemlynx|`) so a standing hook matches one member
  // exactly: `when: { members: { contains: "|buapi|" } }`. A bare substring would wake `buapi` for
  // a document owned by `bu`, which is the kind of mistake nobody would ever find.
  //
  // THE SHAPE LIVES IN ONE PLACE — `documentUpdate.cjs`. An agent raises this same event from the
  // systemview MCP with no window open, and two constructions of one contract drift.
  ipcMain.handle("documents:send-update", async (_e, payload = {}) => {
    const path_ = String(payload.path || "").trim();
    // Resolving a project code to a folder is this host's job and nobody else's, so the builder is
    // handed an absolute path rather than taught about projects. An unknown project is not a
    // failure here: the window supplies the members itself, so the file is only needed for what it
    // can add (the arc id), and losing that is better than refusing the send.
    let abs = "";
    try {
      abs = path.isAbsolute(path_) ? path_ : path.join(rootOf(String(payload.project || "")), path_);
    } catch {}
    const built = await buildUpdate(payload, abs);
    if (!built.ok) return { ok: false, error: built.error };
    try {
      sessions.emitAmbient(built.event);
    } catch (e) {
      return { ok: false, error: (e && e.message) || "could not announce it" };
    }
    return { ok: true, sent: built.members, path: path_ };
  });

  // AN UNFINISHED RUN NUDGES ITS AGENT — the settings door. The defaults are returned whether or
  // not a file exists, so a surface never has to render "unset"; writing merges, so the cog can
  // send one changed field without having to hold the whole object.
  ipcMain.handle("nudge:settings", () => ({
    ok: true,
    settings: nudge.readSettings(),
    defaults: nudge.DEFAULTS,
    quiet: sessions.quietOf(),
    // WHICH run the selector would pick per project, decided by the same pickNudge that fires —
    // so a countdown is a promise the shell is actually going to keep (his: "I saw two things
    // counting down at the same time… but you only got one nudge"). Older windows ignore it.
    picks: typeof sessions.nudgePicks === "function" ? sessions.nudgePicks() : {},
  }));
  ipcMain.handle("nudge:settings-write", (_e, patch = {}) => nudge.writeSettings(patch));

  ipcMain.handle("files:rauth-status", () => {
    const claude = (() => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8"),
        );
      } catch {
        return {};
      }
    })();
    const auth = (() => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(os.homedir(), ".autobot", "agent-auth.json"), "utf8"),
        );
      } catch {
        return {};
      }
    })();
    return {
      signedIn: !!claude.oauthAccount,
      email: claude.oauthAccount?.emailAddress || null,
      hasApiKey: !!auth.ANTHROPIC_API_KEY,
    };
  });
}

module.exports = { register };
