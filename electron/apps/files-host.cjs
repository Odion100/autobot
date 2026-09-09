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

const PROJECTS_FILE = path.join(os.homedir(), ".autobot", "projects.json");
const readProjects = () => {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8"));
  } catch {
    return {};
  }
};

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
  ipcMain.handle("files:write", (_e, pc, rel, content) =>
    files.writeFile(rootOf(pc), rel, content),
  );
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
