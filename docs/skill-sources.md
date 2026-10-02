# Skill sources — where skills come from, and which ones you can edit

Skills are discovered from a **list of sources**, configuration rather than two paths in a function:
`~/.autobot/skill-sources.json`, defaults in `electron/agents/skillSources.cjs`. Every provenance is
one entry, and ours is simply the entry that happens to be writable.

That shape is what makes a skill set **transferable** — open the harness with nothing, point at a
folder (or one you downloaded) and you have its skills. No special case for "built in", in either
direction. Hardcoding the vendor's directory was the same mistake one level up from the one it caused.

## Two truths per source, and they are not the same truth

- **`writable`** — can this be edited? A shipped skill is readable and not editable.
- **`discoverable`** — will a skill here actually **fire**? The Skill tool discovers from the CLI's own
  directories, so a folder merely pointed at is visible and readable today and its skills cannot fire
  until they live where the CLI looks. **Visible-but-inert must say so**; looking armed while being
  inert is the failure this field exists to prevent.

Both default to **true** when a source does not say, so an older harness never silently reads as
read-only.

## A source is a pattern, not a path

The shipped skills extract to `/private/tmp/claude-<uid>/bundled-skills/<cli-version>/<content-hash>/`
— a directory that moves on every upgrade and is simply **absent** between versions. A fixed path would
contribute zero skills and look perfectly healthy, so sources glob, and a source that resolves to
nothing is reported **unresolved** rather than counted as empty. "No skills here" and "this folder is
not there" are different facts.

Two gotchas the globbing exists for: a `*` never matches a dotfile, because the synced folder keeps a
`.bucket-<uuid>` twin that would list every account skill twice; and `ours` **excludes** `synced`,
which is nested inside it and would otherwise be claimed as locally authored.

## Read-only is enforced, not labelled

`saveSkill` and `createSkill` refuse a read-only source, and the refusal names the source and why.
Letting the write succeed would be worse than refusing — it would work, once, and then evaporate on
the next CLI upgrade, having taught the agent that editing these is a thing that works.

The point of reading them anyway: you cannot edit a shipped skill, but you can **learn from it** and
know what is in the kit — and a shipped skill you can read is one you can write a `Do NOT use it to…`
clause against. Skills you do not control can otherwise steal turns from yours undetectably.

## Carrying is still the human's

An agent carries a skill the way it carries a hook: `def.skills` on the agent's definition is the
opt-in, and the SDK treats it as a **filter over what was discovered** — unlisted skills are hidden
from the listing and rejected by the Skill tool, though their files remain on disk. Absence of the
field means "all discovered", not "none". That tick is the only lever over a skill nobody here can
edit, which makes it matter more for shipped skills than for our own.
