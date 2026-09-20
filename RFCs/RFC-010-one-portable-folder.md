# RFC-010 — One portable folder: the harness owns its own configuration

**Status:** design, for Odion's review — 2026-09-19. **Design only — nothing here is built.**
**Owner:** autobot. Everything lands in one function, `sdkOptionsOf()` in `electron/agents/sessions.cjs:242`.
**Depends on:** nothing new. Three doors in `@anthropic-ai/claude-agent-sdk` that we already have and do not use.
**Related:** RFC-003 (an agent is a configured session — the definitions this RFC finishes moving), RFC-001 (the shell hosts the hub).

Odion, verbatim intent: *"This and most of our configurations, if possible, should be stored in one folder so that you'll be able to pull this up on a different computer. This is an application that's going to eventually ship."*

The sentence that matters is the last one. Today the harness's configuration is split across two folders and only one of them is ours. Skills are files in `~/.claude/skills/`. The reasoning effort every agent runs at is a key in `~/.claude/settings.json`. The "defining an agent" page doc is a path into `~/.claude/skills/agent-authoring/SKILL.md`. That folder belongs to the Claude Code CLI: it is 3.3 GB on this machine, it holds someone's login, and **a remote sync writes into it** — `~/.claude/skills/synced/` and `~/.claude/plugins/synced/` are pulled down from the account, with a `manifest.json` and a claims file the CLI manages. An application that ships cannot assume that folder, cannot move it, and cannot version it. It can only be a guest in it, and right now we are a guest that leaves files behind.

---

## 1. Read the doors before designing the folder

Three options on the SDK's `Options` type, all verified against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` in this repo. None of them is set by us today.

**Door one — `agents?: Record<string, AgentDefinition>` (line 1414).** Subagent definitions passed **in process, as objects**. No files, no directory, no discovery. A subagent type can live anywhere we can read JSON from — including `~/.autobot/agents/`, where our definitions already are. This door costs nothing to walk through because RFC-003's whole argument was that we store the SDK's own `AgentDefinition` verbatim; the objects are already the right shape.

**Door two — `plugins?: SdkPluginConfig[]` (line 1818), `{ type: 'local', path }`.** Loads a chosen **absolute directory** that provides commands, agents, skills and hooks. This is the door skills leave through, and the CLI states its own contract plainly — a directory is plugin content if it has `.claude-plugin/plugin.json`, *or* a top-level `commands/`, `skills/`, `agents/`, `hooks/`, `themes/`, `output-styles/`, `monitors/`, `workflows/`, `SKILL.md`, `.mcp.json` or `.lsp.json`. A `skipMcpDiscovery` flag exists for exactly our case: the SDK host already owns its MCP connections and must not have a plugin's `.mcp.json` second-guess them.

**Door three, which was not in the brief and changes the answer — `settings?: string | Settings` (line 1979).** A path to a settings JSON file **or an inline object**, loaded into the flag-settings layer, the highest priority among user-controlled settings. Paired with `settingSources?: SettingSource[]` (line 2014, `'user' | 'project' | 'local'`, where omitting it loads all three and `[]` is isolation mode), this means the `~/.claude/settings.json` half of our configuration has a home too. Without door three, `model` and `effortLevel` and the permission allowlist would have stayed behind and the folder would not have been *one* folder.

**And a correction to check off, because the recorded understanding was right.** `skills?: string[] | 'all'` (line 2037) is documented as **a context filter, not a sandbox**: omitted means *no SDK auto-configuration* — the CLI's defaults still apply, which is explicitly **not** "skills off"; `'all'` enables everything discovered; an array enables only what it lists, and *"unlisted skills are hidden from the model's listing and rejected by the Skill tool, but their files remain on disk and are reachable via Read/Bash."* Confirmed verbatim. `sessions.cjs:264` already relies on this — it forwards `def.skills` only when non-empty, and treats absence as "all discovered," which is the same back-compat the profile's toggle promises.

The filter is a filter over **what was discovered**. So it is not an alternative to door two; it is the thing that becomes *more* important after door two, because the names it matches change. See §7.

## 2. What stays, argued

Two things were handed to me as known. Both hold, and the reasons are worth writing down because they are the reasons the folder can never be *everything*.

**The login stays, and it is not close.** `security find-generic-password -s "Claude Code-credentials"` returns a live entry in the macOS login keychain; the account identity sits in `~/.claude.json` (56 KB, `oauthAccount`), which three files already read as a read-only fact — `sessions.cjs:852`, `main.cjs:467`, `apps/files-host.cjs:148`. The setup page says it out loud: *"Claude login + session transcripts (the claude CLI owns these)."* A shipped application that relocated someone's Claude Code credentials would be doing two indefensible things at once — copying a secret out of an OS keychain into a folder a user is told to sync, and breaking the `claude` CLI for every other thing on that machine that uses it. **The login is not configuration. It is an account, and it is signed into once per computer.** Our existing fallback (`~/.autobot/agent-auth.json`, an API key for a machine with no login) is the right shape already and stays where it is.

**Transcripts stay, which is the less obvious half.** `sessions.cjs:1265` resolves a resume by reading `~/.claude/projects/<cwd with / → ->/<sessionId>.jsonl`. That path is the CLI's storage format, keyed by the **absolute cwd of this machine**. It is history, not configuration, and it is the single largest reason `~/.claude` is 3.3 GB. Moving to a second computer means opening new conversations there, not replaying old ones — which is fine, because a conversation is a run and RFC-003 already separated a run from a definition.

**A repo's `CLAUDE.md` belongs to the repo.** It is a description of *that code*, versioned with it, correct on any machine that clones it, and wrong the moment it is centralized — a central copy would be a second definition of a project's rules, which is the drift the one-definition rule exists to prevent. `docPaths()` (`definitions.cjs:131`) already models this correctly: `CLAUDE.md` and `CLAUDE.local.md` are resolved **from `rec.cwd`**, per placement. Nothing to do; naming it is the point, because "put the configuration in one folder" read carelessly would move it.

The only CLAUDE.md entry that is genuinely ours is the third one — `map["global-claude-md"]`, `~/.claude/CLAUDE.md` (`definitions.cjs:137`). That file does not exist on this machine, which tells you how load-bearing it is. It is a user-level layer that we surface as an editable chip; after this RFC it should point at the portable folder's own copy, and the `~/.claude` one should stop being offered.

**The synced bucket stays, and stays theirs.** `~/.claude/skills/synced/` and `~/.claude/plugins/synced/` are pulled from the account — `docs`, `docx`, `pdf`, `pptx`, `xlsx`, `skill-creator`, `morning`, `import-memory`. They arrive by sync, they are re-fetched by signing in, and they are precisely the part of the skill surface a second computer gets back **for free by logging in**. We do not copy them and we do not list them as ours.

## 3. What moves

Everything we wrote. Concretely, from `~/.claude`:

- **The nine hand-written skills** — `agent-authoring`, `codebase-refinement`, `context-maintenance`, `context-retrieval`, `delegation`, `doc-maintenance`, `skill-authoring`, `skill-maintenance`, `study`. These are the system's own procedures. Every one of them describes *this harness* — its hooks, its context store, its worklist. They have nothing to do with the Claude Code CLI and they are the single most valuable thing on the machine that is not in a git repo.
- **`~/.claude/commands/systemview.md`** — one command file, ours.
- **`~/.claude/settings.json`** — `model: "opus[1m]"`, `effortLevel: "max"`, `switchModelsOnFlag`, and a `Bash(systemview*)` permission. Four values that decide how every agent in this harness thinks, living in a file that belongs to a different program.
- **`~/.claude/CLAUDE.md`** — the user-level doc layer, if and when it is used.

And subagent types move *by not existing as files at all*: there is no `~/.claude/agents/` on this machine, and there never needs to be one. Door one takes them as objects, and `~/.autobot/agents/` is already a directory of them.

**Per-project `.claude/` stays with its project, like `CLAUDE.md`.** Both `autobot/.claude/` and `systemview/.claude/` hold a `settings.json` whose only content is shell hooks (`sv-inbox.sh`, `wiki-check.sh`) pointing at `.claude/hooks/` **relative to the repo**. Those paths are only correct inside the repo. They are versioned, they travel with a clone, and centralizing them would break them.

## 4. The folder: fit `~/.autobot`, do not invent one

`~/.autobot` already exists and already *is* the harness's state folder. RFC-003 put definitions there. The context system put its store there (`context.cjs:52`), and states the discipline this RFC depends on: *"the embedding is rebuildable from it, always."* Hooks are there (`hooks.cjs:26`). Worklists are there (`worklist.cjs:98`). Presence and the system context are there and are read every turn by every agent. Proposing a new greenfield folder would mean two harness folders, which is worse than the one-plus-a-guest-room we have now.

So this is not a new folder. It is **one directory added to the folder we already have**, plus a line drawn through the folder that was never drawn.

```
~/.autobot/
  config/                  ← NEW. A local plugin directory, and the whole of door two.
    .claude-plugin/plugin.json
    skills/<name>/SKILL.md      the nine, moved
    commands/systemview.md      moved
    settings.json               moved from ~/.claude/settings.json (door three)
    CLAUDE.md                   the user-level layer, if used
  agents/<id>.json         definitions (door one) — already here
  hooks/<name>.md          context hooks — already here
  context/<scope>/*.md     the note store, the source of truth — already here
  presence.md              already here
  system-context.md        already here
  projects.json  corpora.json  apps.json  services.json  watches.json
```

**The line, and it is the thing that makes shipping possible.** `~/.autobot` is 396 MB, and almost none of that is configuration: `models/` is 304 MB of embedding weights, `build-whisper/` is 75 MB of a compiled checkout, `bin/` is 10 MB of binaries, `vectors/` is 3.3 MB of rebuildable embeddings, plus `logs/`, `terminals/`, `home/` (a browser profile) and `sessions.json` (resume ids keyed to *this* machine's transcripts). Every one of those is **machine-local**: downloadable, rebuildable, or meaningless elsewhere. The portable set — `config/`, `agents/`, `hooks/`, `context/`, `presence.md`, `system-context.md`, and the small JSONs — is well under a megabyte.

That split should be a **declared list in code, not a convention someone remembers**, because the only two operations that matter here ("what do I copy to the new machine", "what may be deleted to reclaim space") are both answered by it, and a convention answers neither when it is 2am. One exported constant, one place, and the setup page's "where things live" section reads from it instead of hard-coding rows.

**Why `config/` is one plugin rather than four options.** We could hand skills, commands and settings over separately. But a plugin directory is a **single absolute path** that the CLI already knows how to read, so it survives being copied somewhere else wholesale, and adding a `commands/` or `hooks/` folder to it later is a folder, not a code change. The manifest also gives the plugin a **name**, which we need anyway — see the next section.

## 5. It lands in one function

`sdkOptionsOf(def)` at `electron/agents/sessions.cjs:242` is the single place the SDK options are assembled. That is not an accident of this RFC; it is a property the file paid for once already, in the comment at line 981 about the `systemPrompt` key that silently won because it came later in the literal, so *"the two layers we spent a day writing reached nobody, silently, while the files on disk looked perfect and the code read as if it worked."* One composer. Anything added outside it repeats that bug.

What it gains, sketched — not a patch, the shape:

```js
plugins: [{ type: "local", path: CONFIG_DIR, skipMcpDiscovery: true }],
settings: path.join(CONFIG_DIR, "settings.json"),
agents: subagentTypes(),        // door one — definitions as objects
```

`skipMcpDiscovery` is deliberate: the session's `mcpServers` record is composed twenty lines later with the worklist, discovery, services, context and systemview servers merged in a fixed order, and a plugin's `.mcp.json` quietly joining that party is the kind of thing that is discovered three weeks later.

`settingSources` is the one call to make carefully, and **my recommendation is to leave it omitted for now** — that loads `user`, `project` and `local`, and the typing warns that `'project'` must be present for CLAUDE.md files to load at all. Passing `[]` (isolation mode) is what a truly shipped app eventually wants, but it would cut `CLAUDE.md` off from every repo on the same day it moved the skills, which turns one legible change into two tangled ones. Settle the folder first; close the door afterward, on purpose, as its own change.

## 6. Migration: copy, don't move, and never at session open

**The constraint that decides the design:** every layer is frozen at session open. `sdkOptionsOf()` runs once, `plugins` is read once, the system prompt is composed once. A running session does not see edited files — `s.capabilities` comes from the SDK's `init` message and is what the profile draws. So a migration that *moves* files while sessions are live guarantees at least one agent holding a plugin path that no longer resolves, and it will not find out until it tries to use a skill.

Therefore:

1. **Copy, verify, then stop writing to the old place.** `~/.claude/skills/<the nine>` are *copied* into `~/.autobot/config/skills/`. The originals stay exactly where they are. Nothing in `~/.claude` is moved, renamed or deleted by us, ever — not as a nicety, but because a program that deletes from another program's folder is a program you cannot ship.
2. **Both are loaded during the overlap.** The user-level `~/.claude/skills` is still discovered (we are not passing `settingSources: []`), and `config/` is discovered as a plugin. Duplicate names are the price of the overlap and are visible rather than silent, because plugin skills are namespaced — `autobot:context-maintenance` and `context-maintenance` are two rows in the listing, not one row that shadows the other. That visibility is the whole reason to prefer copy-over-move here.
3. **New sessions get the new arrangement; live ones finish on the old one.** There is no flag day because there is no moment when a path stops resolving. An agent mid-session keeps the plugin path it opened with; the path still exists; its next session opens with the new one. This is the same read-both/write-new discipline RFC-003 §3 used to rename the session store, and it worked.
4. **The create door starts writing to the new place** (§7) — so the set at `~/.claude/skills` stops growing the day the migration starts.
5. **Retiring the originals is a separate, later, human act.** A "the old copies are stale" report, run against a diff of the two folders, not an automatic `rm`.

One honest cost: during the overlap, every agent pays for both listings in its system prompt — nine skills' names and descriptions, twice. `weights()` in `sessions.cjs:209` already measures exactly this kind of always-loaded tax and will show it. It is a reason to keep the overlap short, not a reason to flag-day it.

## 7. What breaks, named

**The create door, and it is the reason this section exists.** `definitions.createSkill()` (`definitions.cjs:264`) writes into `skillDirs()` (`:217`), which is hard-coded to `~/.claude/skills` for `where: "user"` and `<cwd>/.claude/skills` for `where: "project"`. The IPC path is `host.cjs:144` → `svPreload.cjs:131` → the profile. So the system's own door for minting a skill **writes into the folder we are leaving**, and the comment above it explains why that matters more than it looks: *"creation outside the system is creation nobody can see"* — six copies of a dead CLI skill happened exactly this way. The fix is one line of `skillDirs`: `user` becomes `~/.autobot/config/skills`. Everything downstream — `skills()`, `saveSkill()`, `removeSkill()` (`:307`) — reads through the same function and follows for free. The `where: "project"` entry does **not** change; a project skill belongs to its repo for the same reason its `CLAUDE.md` does.

**Names become namespaced, and a filter that matches by name is downstream of that.** The typing is exact: an entry matches *"the exact canonical name (e.g. `my-plugin:my-skill`) or a `:name` suffix of it. Display names and aliases do not match"* — for the **main session's** `skills` filter; `AgentDefinition.skills` *"additionally resolves display names and aliases."* Today `def.skills` holds bare names like `context-maintenance`, written by the profile's per-agent carry toggle, and `sessions.cjs:264` forwards them as the main-session filter. Once those skills arrive via a plugin, a bare name risks matching nothing — and the failure mode is the worst kind: an agent that opens fine and quietly has no skills. **Three things must be settled together before this ships:** the stored value in `def.skills`, the value `sdkOptionsOf` forwards, and what the profile writes when a chip is toggled. My lean is to keep bare names in storage (they are what a human reads and edits) and normalize to `:<name>` at the boundary in `sdkOptionsOf`, which is the same "definition stays human-shaped, the SDK call is correct" argument the `mcpServers` mapping in that function already makes. **This needs to be tested against a real session, not reasoned about** — see §9.

**Hook pointers are skill names too.** A hook's `do: skill:<name>` (`~/.autobot/hooks/*.md` — four of them today, all pointing at skills in the moving set) rides into the session as text, and the model then calls the `Skill` tool with that name. If the canonical name gains a prefix, every existing hook file points at a name the tool may reject. Same normalization question, different surface.

**Two validators check the old path and will start lying.**
- `sessions.cjs:931` — the `:skill:<name>` mention check that annotates an agent doc with *"no skill named X exists"*. It calls `definitions.skills()`, so it follows `skillDirs` automatically. Good.
- `context.cjs:819` — `hooksWrite` warns when `do: skill:<x>` names a skill with no `~/.claude/skills/<x>` directory. This one checks the path **directly**, not through `skillDirs`, so it will start warning about every skill the moment they move. It should go through `definitions.skills()` like the other one — which is also the general lesson: one scanner, and nobody writes the path twice.

**Two page docs hold literal `~/.claude` paths.** `PAGE_DOCS["defining-agents"]` (`definitions.cjs:156`) opens `~/.claude/skills/agent-authoring/SKILL.md` — and the comment above it is a whole argument about that row being the *one* artifact both humans and agents read, so it must follow the file rather than become a second copy. And `docPaths()["global-claude-md"]` (`:137`) offers `~/.claude/CLAUDE.md` as an editable chip; it should offer `~/.autobot/config/CLAUDE.md`.

**The setup page's "where things live" section becomes wrong** (`electron/setup.html`, the `#locations` block). It is the user-facing statement of this whole design and it is currently hard-coded rows. It should read from the portable/local list in §4, so the answer to "what do I copy" is generated from the thing that decides it.

**Nothing else in `electron/`, `src/` or `mcp/` writes to `~/.claude`.** A grep across all three turns up only the readers of `~/.claude.json` (the login, §2), the transcript reader (§2), the two validators, the two page docs, and `skillDirs`. That is a short list, and it is short because RFC-003 put definitions in `~/.autobot` rather than in `~/.claude/agents/` — a call that looks better in hindsight than it did at the time.

## 8. The shipping story

On a second computer, in order:

1. **Install the application.** It brings the SDK, which brings the `claude` binary; no separate CLI install and no Node version conversation.
2. **Sign in — once, to Claude.** The keychain entry and `~/.claude.json` are created by that sign-in. The account's synced skills arrive with it. Nothing is copied to make this work, and nothing we ship contains a credential.
3. **Copy the portable set** — the §4 list, under a megabyte. Drop it at `~/.autobot` and the agents are back: their definitions, their skills, their hooks, their notes, presence, the system context. The models and the compiled binaries are **not** copied; the app fetches or builds them, which is what it does on a first run anyway.
4. **Repoint the projects.** And this is the part with real work in it, so it should not be glossed: `projects.json` maps codes to **absolute paths in this user's home** (`/Users/odionedwards/...`), and `corpora.json` stores absolute `root` paths the same way. On a machine with a different username, every one of them is wrong. Agent definitions carry `cwd` too. Three files, one problem: **a project code is portable and an absolute path is not.**

The cleanest answer is that everything which can be expressed as *"project code plus a path inside the project"* should be, and `projects.json` becomes the single machine-local remap point — the one file you fix on a new computer, after which corpora and definitions resolve through it. That is a genuine change to `corpora.json`'s shape and to how `cwd` is stored on a definition, and it is the piece of this RFC most likely to be underestimated. It may deserve its own RFC rather than a paragraph in this one.

What the user does **not** do: install the Claude Code CLI separately, hand-copy skill files into a dotfolder, re-authorize anything per agent, or reconstruct the embedding index (it rebuilds from `context/` and from corpus files on disk, by design).

## 9. What I did not resolve

- **The namespacing of skill names is reasoned, not tested.** I read the typings and they are explicit that a bare name does not match a plugin-qualified canonical name for the main-session filter. I did not open a session with a plugin loaded and observe what the `init` message reports, because this lane does not restart anything. Everything in §7 about `def.skills` and hook pointers rests on that reading. **It is the first thing to verify when this is built, and it should be verified by looking at `s.capabilities`, not by reasoning further.**
- **Whether `settings.json` moving actually takes effect.** Door three is documented as the flag-settings layer, highest priority among user-controlled settings — but `model` is also set explicitly per session in the options literal, and which one wins for a given key is a merge I did not test.
- **The absolute-path problem (§8.4) is described, not designed.** I can see the three files and state the principle; the actual shape of a relocatable `corpora.json` entry and a relocatable definition `cwd` is unresolved and may be its own RFC.
- **Whether `~/.autobot/config/` is the right name.** It is one word inside a folder whose other entries are all plainly-named nouns. `harness/` or `claude/` would each say something slightly different about what the directory *is*. Odion's call.
- **The end state of `settingSources`.** §5 recommends leaving it omitted for now and closing it deliberately later. I did not work out what a fully isolated harness does about repo `CLAUDE.md`, which §2 argues must keep loading — those two wants are in tension and the tension is unresolved.
- **The synced bucket's interaction with a plugin of our own.** Both surfaces provide skills, both are namespaced differently, and I did not check whether a name collision between a synced skill and one of ours resolves predictably or by load order.
- **What a Windows or Linux second computer does.** The keychain in §2 is macOS-specific; the CLI stores credentials differently elsewhere. It does not change this design, but "sign in once" is a sentence I only verified on this machine.

---

**Open — his calls:**

- **Overlap length.** §6 keeps both skill folders live and both listings loaded. Days, or one session?
- **Does the portable set become a git repo?** It is under a megabyte, it is all text, and "pull this up on a different computer" is a sentence `git clone` answers completely. The reason to hesitate is that `context/` is append-only agent-written state, and a machine that is behind would produce merge conflicts in notes nobody is editing by hand. Worth deciding before the folder exists rather than after.
- **Does `agents/` move inside `config/`?** Door one takes definitions as objects, so they need no particular location — but if `config/` is the thing you copy, there is an argument that everything portable belongs under it and the machine-local things stay at the top level. That inverts §4's layout and is cleaner. I left it out of the main proposal because it moves a directory RFC-003 already placed, and moving it is a migration of its own.
