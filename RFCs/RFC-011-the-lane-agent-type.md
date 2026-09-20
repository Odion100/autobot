# RFC-011 — The lane agent type: the standing facts stop being retyped

**Status:** design, for Odion's review — 2026-09-20. **Design only — nothing here is built.**
**Owner:** autobot (the harness holds the definitions and spawns the lanes).
**Lands in:** `electron/agents/definitions.cjs` (storage), `sdkOptionsOf()` at `electron/agents/sessions.cjs:242` (one line), `compositionOf()` at `sessions.cjs:157` (one key), and the agent surface in SystemView.
**Related:** RFC-003 (an agent is a configured session — this is that argument applied one level down), RFC-010 (one portable folder — its "door one" is the mechanism this RFC walks through), the `delegation` skill (the procedure that spawns lanes).

---

## 1. The failure this exists to end

Every lane brief written in this system today opens the same way: a paragraph of standing facts,
hand-typed, about a system the lane cannot see. One agent owns one project. You are a subagent and
the parent's context layers do not reach you. The user's index is his. He pulls your work out into
his own tree and deletes the lane, so your job ends at your commit.

None of that is about the work. All of it is true of every lane that will ever run. And it is
**retyped by hand into every brief**, which makes it a definition with as many copies as there are
spawns — the exact shape the one-definition rule exists to forbid, built by the people who quote
the rule, under the one condition that guarantees a bad copy: haste.

It failed three times on 2026-09-19 alone.

- A brief asserted a premise about the codebase that was false. The lane built on it until a later
  lane caught it.
- A brief told a lane a problem was already resolved. It was live in four repos.
- A brief never said *one agent owns one project*, so the lane inferred the agent/repo relationship
  from a UI hint that was itself wrong, and wrote a whole RFC section conceding an objection that
  did not exist.

In none of the three was the agent at fault. **The instruction was.** That is this system's
standing position and it is the position this RFC applies to itself: when an agent does something
wrong, go find the instruction that failed it.

The observation that makes this cheap to fix: *the three facts that failed are the three that were
never about the job.* A brief that carried only the work could not have made any of these mistakes,
because a brief that carries only the work has nothing to get wrong except the work.

## 2. The mechanism — door one, one line, one composer

`@anthropic-ai/claude-agent-sdk` takes subagent definitions **as objects, in process**:

```ts
agents?: Record<string, AgentDefinition>;   // sdk.d.ts:1414
```

Keys are agent names; values are `AgentDefinition` (`sdk.d.ts:38`) — the same type RFC-003 argued
we should adopt rather than parallel, and the same type `~/.autobot/agents/<id>.json` already
stores verbatim. **There is nothing to build a schema for.** RFC-010 already reached this
conclusion from the other side: subagent types move into the portable folder *by not existing as
files at all*, because door one takes them as objects and we already keep a directory of objects.

So the lane type is **a record in the store we have**, marked as what it is:

```json
{ "id": "lane", "name": "lane", "kind": "subagent", "def": { "description": "…", "prompt": "…" } }
```

`normalize()` (`definitions.cjs:43`) gains `kind` in its whitelist and nothing else. That whitelist
is load-bearing — the hooks field's absence from it is what made the profile's enable switch a lie
for a week, and adding a field that `save()` drops is the one failure mode this file has already
had twice.

**It reaches a session through `sdkOptionsOf()` and nowhere else.** One line:

```js
const types = definitions.subagentTypes();            // { lane: { description, prompt } }
if (Object.keys(types).length) o.agents = types;
```

`sdkOptionsOf(def)` at `sessions.cjs:242` is the single composer of query options, and that is not
a convenience — it is a property the file paid for in blood. The comment at `sessions.cjs:973`
records what happened when a second `systemPrompt:` key was written outside it: being later in the
object literal it silently won, and *"the two layers we spent a day writing reached nobody,
silently, while the files on disk looked perfect and the code read as if it worked."* Anything
added outside the composer repeats that bug with a new field.

**And it runs for every session, definition or not.** `sdkOptionsOf({})` is called for ad-hoc runs
too — that is exactly the fix that comment describes. The lane type is not a property of the
*spawning* agent; it is a property of the harness. An ad-hoc session that delegates something must
get the same lane as a configured one, or the fact that briefs stopped carrying the standing facts
becomes conditional on which door the conversation came through, which is the worst of both
designs.

### 2.1 The freeze, and why it forces a second line

`agents` is a **query option**. It is read when `query()` is constructed at session open and never
again — the same freeze that already governs presence, the system context, the agent doc and the
`CLAUDE.md` stack. Edit the lane definition and every running session keeps spawning lanes with the
old one, truthfully and invisibly.

`compositionOf()` (`sessions.cjs:157`) exists for precisely this and already names each input by
the label a human reads, so the panel can say *which* file moved rather than "something changed".
It gains one key:

```js
parts["Lane type"] = t(path.join(definitions.DIR, "lane.json"));
```

Three stat calls became four, on a path the file already accepted as hot. The profile's *"Running
an older definition"* badge then names the lane type when it is the thing that moved, and the
re-init stays a **press** — never automatic, per `sessions.cjs:1169`: saving a shared layer makes
every live session stale at once, and yanking a session out from under a turn to fix a paragraph is
worse than the stale paragraph.

### 2.2 Two fields omitted on purpose, and one of them is a trap

`tools` and `model` are both optional on `AgentDefinition`, and the type states what absence means:
`tools` omitted *"inherits all tools from parent"*; `model` omitted or `'inherit'` *"uses the main
model"*. **The lane definition sets neither**, and the reason for `tools` is sharper than taste.

The worklist's protection does not extend here. `sdkOptionsOf()` appends the harness MCP tool names
to `allowedTools` when a definition pins `tools` — the comment says why: *"a definition that PINS
`tools` would otherwise drop the worklist without saying so — the agent keeps working and quietly
stops being able to plan."* That append builds the **session's** `allowedTools`. A subagent's
`tools` array is its own allowlist inside the SDK and nothing appends to it. So a lane definition
that helpfully listed `["Read","Edit","Bash","Grep"]` would strip `mcp__worklist__set` from every
lane — and the worklist call is the only thing that opens the run, which is the only thing that
draws the bar, which is the only way the user knows the lane exists. The lane would work perfectly
and be invisible, which in this system is the same as not existing.

Omitting the field is not laziness. It is the only form that cannot produce that outcome.

`model` is the same argument at lower stakes: a lane doing the owner's work at a smaller model is a
downgrade nobody chose and nobody can see in the output. Inherit.

## 3. What the definition carries

Three things, and they share one property: **the lane cannot derive any of them from anything it
can see.**

1. **The standing facts** — the shape of the system. One agent, one project. You are a subagent and
   the parent's layers did not come with you. Whose the index is, and what he does with your branch
   afterward. A lane can read every file in the repo and never learn any of this.
2. **The working stance that has proven to matter** — the brief is a *claim*; verify the premises
   your work rests on; say at the end what you could not verify. This is the direct remedy for all
   three failures in §1, and it is not an instruction to be careful in general. It names the
   specific thing that went wrong: a sentence in the brief was believed instead of checked.
3. **One pointer** — `mcp__context__context` answers *"how does this work here"* from what the
   system has already learned. The subagent gets the harness MCP tools but not the `STAMP`
   (`sessions.cjs:187`) that explains them to top-level sessions, so a lane today has a memory it
   does not know it has.

### What it must not carry

**Anything specific to one job.** The branch name, the repo, the worktree path, the deliverable,
the files. Those are the brief's, and the moment one of them appears here the definition has an
expiry date.

**Any rule written to prevent a hypothetical bad act.** This is the user's standing position and it
is not a style preference: a rule presuming bad behaviour poisons judgment, because an agent
handed a list of prohibitions spends its attention proving it is not the thing the list expects.
Mechanism and reasons, never prohibitions in search of a crime.

The distinction is easy to get wrong, so state it as a test. *"Never `git add` in the main repo"* is
a prohibition. *"The user's index is his — staged-but-uncommitted is a workspace he is holding on
purpose"* is a fact, and the behaviour follows from it without being demanded. Same outcome, and
the second one survives the case the first one never imagined, because an agent that knows why does
not need the rule enumerated for every new situation. Every line of the draft below is written in
the second form; if a line can only be written in the first, it does not belong in an always-loaded
layer at all.

**Anything the SDK's own subagent preamble already says.** Verified by reading the prompt a
subagent in this harness actually receives: it already states that messages from the launching
agent are not the user's consent, that the final report is the deliverable and files written as
reports are not, and that file paths in the report must be absolute. Restating those buys nothing
and costs the same attention twice.

## 4. The draft

This is the deliverable. Argue with this, not with §3.

**`description`** (one sentence — see §5 for why it is the expensive half):

> A lane — one scoped piece of work on its own git worktree and branch, ending at a commit the
> owner reviews and lands. Use for any delegated build, investigation or document that should
> proceed while the conversation keeps moving.

**`prompt`:**

> You are a LANE: one scoped piece of work, on your own git worktree and branch, ending at your
> commit.
>
> **HOW THIS SYSTEM IS SHAPED.** These are facts about the world you are working in. Nothing you
> can read in the repo will tell you them.
>
> - One agent owns one project. The repo IS the agent; the agent IS the repo. There is no pool of
>   agents drifting between repos, and nothing you find in a UI overrides this sentence.
> - You are a subagent. You inherit the harness tools — the worklist, the context store, discovery,
>   the SystemView verbs — but none of the parent's context layers: its presence, its system
>   context, its agent doc and its CLAUDE.md never reach you. Your brief plus this is the whole of
>   what you were given.
> - Work only inside the worktree your brief names. The owner's checkout has its owner live in it.
> - The user's index and working tree are his. He pulls a lane's work out into his own tree as
>   uncommitted changes, reviews it there, and then deletes the lane — worktree and branch. He
>   never switches to your branch. Staged-but-uncommitted in a repo is a workspace somebody is
>   holding on purpose.
> - Your job ends at your commit, and a deleted lane stays dead. Anything discoverable only from
>   inside your worktree is lost.
>
> **HOW TO WORK.**
>
> - **Your brief is a claim, not a briefing.** It was written quickly by an agent describing a
>   system from memory. Check the premises your work actually rests on — that a file is shaped the
>   way it says, that a problem it calls solved is solved — before you build on them. Briefs here
>   have been wrong about all three, and the work built on top was wasted.
> - **Ask before you derive.** `mcp__context__context` searches what this system has already
>   learned: conventions, corrections, prior lessons, what a command really does. An empty answer
>   means nothing matches — proceed, and write back what you learn.
> - **Open your run immediately.** `mcp__worklist__set` with `source: "lane:<your-branch>"` and your
>   real steps; one active, each marked done as you finish it. Driving every item to done is what
>   closes the run and completes the progress bar the user is watching — it is how he can see you
>   exist at all.
> - **End by saying what you could not verify.** A lane that separates what it checked from what it
>   took on faith is worth more than one that sounds certain.

**Measured:** the prompt is 2,343 characters, ~586 tokens by the profile's own ~4-chars-per-token
estimate; the description is 39 words. For comparison, on this machine `presence.md` is 1,226
characters and `system-context.md` is 3,904. The lane prompt sits between them and under the system
context, which is the comparison §5 says it has to win.

## 5. Length: two budgets, not one

The always-loaded cost of a definition is **attention, not tokens** — but the two halves of this
definition are charged to different accounts, and conflating them is how a definition gets fat in
the wrong place.

- **`description` is charged to everyone, forever.** Subagent descriptions are listed in the Agent
  tool's own description in every session that could spawn one. It is read by an agent deciding
  *whether* to use a lane, which is a one-second decision. One sentence. Over about forty words it
  is competing for attention with the entire tool surface and losing.
- **`prompt` is charged only to lanes, and it is the first thing a lane reads.** The budget is one
  screen. Past that, an agent starts skimming exactly the paragraph that was added because
  something went wrong.

The discipline that actually cuts lines is a test, applied per line: **would a competent agent do
this anyway, with no instruction?** If yes, the line is buying nothing and spending attention that
the lines around it need. Applied to the draft, every bullet has either a dated failure behind it
(§1) or is a fact the agent provably cannot derive from anything it can see. That is a defensible
floor, and it is also the only kind of line that survives review a year from now, because you can
name what happens if you delete it.

The second test is comparative, and the profile's *"Always loaded — what every turn costs"* table
exists to make it answerable rather than rhetorical: presence and the system context are already
measured there in tokens per turn. A lane prompt that outweighs the system context is claiming that
being a lane is a bigger fact than being in this system, and it is not.

## 6. Visibility: it goes where agent definitions already go

The rule is that nothing runs invisibly and no definition hides in a file only an agent reads. The
lane type is the sharpest possible test of it, because moving the standing facts out of the brief
**removes them from the one place the user currently sees them.** Lane briefs ride their panels —
the spawning `Agent` call's `prompt` is captured by tool-use id and folded at the top of the lane's
panel (`src/organisms/AgentWorkbench/feedRows.js`). Today he can read exactly what a lane was told.
After this RFC, the brief he reads is shorter and the missing half must be legible somewhere or
this change trades a copied definition for a hidden one.

Two precedents exist, and only one of them fits.

`PAGE_DOCS` (`definitions.cjs:153`) holds the layers scoped to no single agent — presence, the
system context, the "defining an agent" skill — tagged `agent` or `human` side, rendered as chips
in the profile's **"Every agent"** section, opening and editing in place. That is the right *scope*
but the wrong *shape*: those entries are markdown files, and the lane type is an `AgentDefinition`.
Making it a page doc would mean a second home for the one type RFC-003 exists to keep in one place.

So it follows the **definitions** precedent, in three places:

1. **In the agent list, under its own heading** — "Subagent types", beside the agents. `list()`
   already returns everything in the store; `kind` is what splits the heading. It must not sit
   unmarked among the openable agents, because you cannot open a conversation with it, and a row
   that looks like an agent and refuses to start is a bug report waiting to be filed.
2. **In the profile, stripped to what applies.** Same renderer, same `▤` file link to
   `~/.autobot/agents/lane.json`, same doc editor on the prompt. Placement and gating are session
   fields and a subagent has neither — it runs at the parent's `cwd` under the parent's
   `permissionMode` — so those controls are absent rather than present-and-inert. Hooks likewise:
   a hook fires into a session, and a lane is not one.
3. **In the "Always loaded" weights table**, as a row. Its `description` really is charged on every
   turn of every session, exactly like the `STAMP` row that is already there precisely because
   *"hiding it would understate the total."* Same reasoning, same table, no new surface.

**Who may edit it.** Whoever may edit an agent doc: the user, in the window, through the editor
that is already there; and an agent through `saveDoc`, which is the same door it already has for
its own doc, with the change readable as a diff. No new permission concept — and per §2.1, the edit
is honest about its reach, because every running session goes stale on "Lane type" and says so.

## 7. What is left in a brief

A brief keeps exactly what is true of **this job and no other**:

- the work itself, and what "done" looks like
- the exact worktree command, with the branch name and the absolute path
- the branch name again for `source: "lane:<branch>"`, because it is the address the run is
  filed under
- the specific files, commands or repos that are already known to be relevant — as pointers, not as
  assertions about what is in them
- what to report back
- anything genuinely unusual about this one job: a constraint, a thing not to restart, a deadline

And it stops carrying: what a lane is, who owns the repo, what a subagent inherits, whose index it
is, what happens to the branch afterward, how to file a worklist, and the instruction to verify
things — all of which are now true by definition rather than by retyping.

### Before / after — this RFC's own brief

The brief that produced this document opened with a fifteen-line block headed *STANDING FACTS ABOUT
THIS SYSTEM*, then a setup command, then a paragraph on the worklist, then the work. Roughly a
third of it was the standing facts and the worklist mechanics. Under this RFC the same lane is
spawned with `subagent_type: "lane"` and:

> Write an RFC — design only, no implementation — at `RFCs/RFC-011-the-lane-agent-type.md`. Verify
> 011 is free; 010 was taken on another branch. Read two or three existing RFCs first and match
> their voice: argued prose with headed sections, not a template.
>
> Your worktree:
> `git -C /Users/odionedwards/autobot worktree add -b lane/rfc-lane-agent-type /Users/odionedwards/Systemly/lanes/autobot/rfc-lane-agent-type HEAD`
>
> THE PROBLEM. Every lane brief in this system re-types the same standing facts by hand. It failed
> three times on 2026-09-19: a false premise about the codebase, a "this is already fixed" that was
> live in four repos, and a missing "one agent owns one project" that let a lane infer the
> agent/repo relationship from a wrong UI hint and concede a false objection in an RFC section.
>
> THE PROPOSAL. A harness-owned lane subagent type carrying the standing facts and the working
> stance, so a brief carries only the work. Settle, argued: the mechanism (`agents?:
> Record<string, AgentDefinition>` in `sdk.d.ts`; options are composed in `sdkOptionsOf()` in
> `electron/agents/sessions.cjs` — note the layers freeze at session open); what the definition
> carries and what it must not (draft the full prompt text in the RFC — it is what people will
> argue about; no job-specifics, and no preemptive rules, per the standing position that rules
> presuming bad behaviour poison judgment); a length discipline, applied to your own draft;
> visibility (follow `definitions.cjs` and SystemView's `AgentProfile`, do not invent a second
> precedent); what a brief still must contain; and how this relates to `general-purpose` and
> `Explore`. Close with what you did not resolve.
>
> Never restart anything, never build, never touch a `.claude/settings.json`. Report back: the
> path, your answers two lines each, the full draft definition, and what you could not verify.

Everything cut was true of every lane. Everything kept is true of this one — and the two premises
that were *checked* rather than assumed (that 011 was free, that the worklist tools were reachable)
would have been checked either way, because the stance says to.

## 8. Beside, not instead of

`general-purpose`, `Explore` and `Plan` are the CLI's own types and they are cut along a different
axis: **what kind of thinking the work needs.** Explore is read-only breadth. Plan returns a
strategy. General-purpose is the catch-all researcher.

A lane is not a kind of thinking. **It is a delivery contract** — isolated worktree, own branch, a
run the user can watch, a commit he pulls out into his own tree. It is orthogonal to the subject
matter, which is why it belongs beside them rather than above or inside them. A lane may do
exploration, planning or building; what makes it a lane is where the work lands.

**Wrapping is not on the table, mechanically.** Door one takes a complete `AgentDefinition`. There
is no inheritance, no composition, no `extends` in the type — so "a lane that wraps Explore" cannot
be expressed, and noticing that is cheaper than arguing about whether it would be nice.

**When a lane is spawned with the wrong type**, it runs. It just runs without the facts, which is
exactly today's behaviour and exactly the failure in §1 — so the wrong type is not a new hazard, it
is the old one surviving in one place. It should be **shown, not blocked**:

- The spawning `tool.call` carries `input.subagent_type` in the same event that already yields the
  brief; the lane's own worklist call carries `source: "lane:<branch>"`. A run sourced `lane:` whose
  spawning call named something else is detectable with data already in the feed, and belongs on
  the lane row as a quiet mark — *"spawned as general-purpose"* — the same way an adopted definition
  is marked "adopted, not yet configured".
- Refusing outright is wrong twice: a read-only sweep legitimately named a lane would be blocked for
  a naming choice, and a hard refusal is a prohibition where a visible fact does the job. Per §3,
  show the mechanism, let the owner judge.

The `delegation` skill is where the default changes: it is the procedure that spawns lanes, so
"spawn with `subagent_type: "lane"` and brief only the work" belongs in its steps. That is a
one-paragraph edit to a skill, not part of this RFC's build.

## 9. What I did not resolve

- **Whether a key in `agents` can shadow a CLI built-in.** If someone names a type `Explore`, I do
  not know whether ours wins, theirs wins, or it is an error. Untested, and not worth guessing at:
  it is one session's experiment to answer, and until it is answered, our key is `lane` and no
  collision exists.
- **Whether `description` is really charged on every turn.** I reason it is, because subagent types
  appear in the Agent tool's type listing in a live session's prompt. I did not measure it. If it
  is charged only when the Agent tool is first described, §5's first budget relaxes and the rest of
  the RFC is unaffected.
- **Whether one lane type is enough.** A read-only investigation lane and a building lane have the
  same standing facts and different contracts — one has no commit at all. I have assumed one type
  and let the brief say "no code"; a second type (`lane-read`?) is a later question and should be
  answered by a lane that was actually confused, not pre-emptively.
- **Where this lands relative to RFC-010.** That RFC moves configuration into `~/.autobot/config/`
  as a local plugin and states that subagent types move by *not being files*. This RFC keeps the
  lane type in `~/.autobot/agents/`, which is consistent with it — but if the plugin directory ends
  up wanting an `agents/` folder for other reasons, the two want reconciling and RFC-010 is the one
  that should decide.
- **Whether the standing facts as drafted are complete.** They are the three that failed on one
  day, plus the ones I was handed. There is no inventory of what lanes have actually gotten wrong,
  because nothing collects it — and the honest version of this RFC says the list is a starting
  set, not a finding. The per-lane "what I could not verify" section is the collection mechanism,
  if anyone reads them in aggregate.
- **I could not verify the three incidents directly.** They were described to me and I have no
  record of them in the repo. I designed against them as reported.
