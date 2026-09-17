// THE CAPABILITY MAP — RFC-004 §1. One table, required by both sides of the gate: main resolves
// WHICH app is asking, this file decides WHAT that answer exposes.
//
// Before this existed, `svPreload.cjs` handed one fixed bag to every app page — context, files,
// git, agents, dictation, terminal — without consulting the app or anything else. Registration was
// the grant, and the grant was total: any URL in apps.json could read and write the filesystem.
//
// ABSENT, NOT DENIED. An app that never asked for `files:write` does not have the method. There is
// no function to call and no error to catch, which is the same rule the component surfaces already
// use (RFC-001's capabilities.js). A denied-but-present method invites retry logic; an absent one
// is simply not part of that app's world.
//
// A namespace with no granted members is dropped ENTIRELY rather than left as an empty object —
// `window.systemview.files` existing-but-empty would read as "supported, currently broken".

// capability -> { namespace: "*" | [member, ...] }. "*" means the whole namespace.
//
// The read/write split is not symmetry for its own sake. `context:write` reaches `remember()` and
// the vector index — what every agent later retrieves AS FACT — so it is the poisoning surface and
// the one grant a third-party app should almost never hold. Same logic puts git staging under
// files:write: it mutates the index, even though nothing leaves the machine.
const GRANTS = {
  dictation: { dictation: "*" },
  terminal: { terminal: "*" },
  projects: { projects: "*" },
  auth: { auth: "*" },
  agents: { agent: "*" },
  // Reading the catalogue is its own grant: an app that hosts travelling components needs it, an
  // app that merely publishes them does not. Nothing here is secret — names and own-origin URLs —
  // but a grant that is free to hand out is still a grant that was asked for.
  components: { components: "*" },
  // window.systemlynx IS systemlynx: the library's client side, INJECTED into the page world
  // (svPreload) rather than bridged — so it maps no systemview namespace here. Still a grant,
  // not ambient: a page holding the library can call every method any reachable service
  // publishes (the one-tier reach flag applies).
  systemlynx: {},

  "context:read": {
    context: ["notes"],
    vectors: ["status", "search", "collections", "records", "embed"],
  },
  "context:write": {
    context: ["save", "remove"],
    vectors: ["index", "upsert", "remove", "drop"],
  },

  // RFC-005 §10 — the job API. The read/write split is the same argument as context's: `jobs:read`
  // is watching, and `jobs:write` defines what runs UNATTENDED and what it may do. A surface that
  // shows jobs does not need the second one, and the app that proves the seam (workers) asks for
  // both only because defining a job is half of what it is for.
  //
  // `watches` rides with jobs deliberately rather than getting a capability of its own: a watch is
  // a trigger with no job yet, and splitting them would let an app arm triggers it cannot show.
  "jobs:read": {
    jobs: ["list", "get", "runs", "events", "subscribe", "vocabulary"],
    watches: ["list"],
  },
  "jobs:write": {
    jobs: ["save", "remove", "rate"],
    watches: ["save", "remove"],
  },

  "files:read": {
    files: ["readFile", "listFiles", "search", "gitState", "changedFiles", "getDiff"],
  },
  "files:write": {
    files: ["writeFile", "stageFiles", "stageHunk"],
  },
};

const ALL = Object.keys(GRANTS);

// Build the exposed object from the full surface and a granted list. Unknown capability names are
// ignored rather than throwing: a manifest written against a LATER version of this contract must
// still register (RFC-004 §2), and a capability we do not have yet is not an error in their file.
function build(full, granted = []) {
  const want = new Set(Array.isArray(granted) ? granted : []);
  const out = {};
  for (const cap of want) {
    const spec = GRANTS[cap];
    if (!spec) continue;
    for (const [ns, members] of Object.entries(spec)) {
      const src = full[ns];
      if (!src) continue;
      if (members === "*") {
        out[ns] = src;
        continue;
      }
      // Whole namespace already granted by another capability — nothing to narrow. Without this
      // guard, a "*" grant followed by a member-list grant on the same namespace would REPLACE the
      // full surface with the shorter list, silently removing methods the app was granted.
      if (out[ns] === src) continue;
      // Merge, because two capabilities can each contribute part of one namespace —
      // files:read and files:write both land in `files`.
      const acc = out[ns] || {};
      for (const m of members) if (m in src) acc[m] = src[m];
      if (Object.keys(acc).length) out[ns] = acc;
    }
  }
  return out;
}

module.exports = { GRANTS, ALL, build };
