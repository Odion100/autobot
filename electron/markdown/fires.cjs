// RFC-073 §3 — THE PARSE IS THE FIRE. A fire is a state a block is in: it has an ANSWER, an
// AUDIENCE, and no `told=` covering that audience. This module detects that state off one parse and
// says who is still owed the news. It never delivers — the engine emits one thing and the host
// routes it (sessions.cjs), exactly as it routes `document.updated` today.
//
// Idempotent by construction: the receipt (`told=`) lives in the block's own line, so parsing the
// same approved block a hundred times — render, watcher, sweep — fires only for whoever the stamp
// does not yet cover. There is no "already handled" list anywhere.
const fs = require("fs");
const { parse } = require("./parse.cjs");
const { FIRING, registrationOf, hasFired, firstLine } = require("./blocks.cjs");

const splitList = (raw) =>
  String(raw == null ? "" : raw)
    .replace(/^"|"$/g, "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);

// §2.1 — WHO HEARS A FIRE, in order:
//   1. the block's own `subscribe=` — the override, and it may name a non-member (c13)
//   2. the enclosing thread's audience — its `subscribe=`, or its legacy `members=` read AS
//      `subscribe=` (c21: nobody lost their audience to the rename)
//   3. the document's `::members{who=}` — membership is the default subscription
// A `:::reply` is the one exception: THE THREAD DECIDES who hears a reply, and a reply carrying its
// own `subscribe=` is ignored (c20) — otherwise one voice in a conversation could re-aim it.
//
// And a CLAIM's declared reviewers always hear it (RFC-075 round two, his: "the claim knows who the
// reviewer is"): `reviewers=` is UNIONED onto whatever the ladder resolves — being named a reviewer
// is an obligation, and an obligation nobody is told about is not one.
function audienceOf(block, threads, docMembers) {
  const inner = threads
    .filter((t) => t.line < block.line && block.end <= t.end)
    .sort((a, b) => b.line - a.line)[0];
  const threadAudience = inner
    ? splitList(inner.attrs.subscribe != null ? inner.attrs.subscribe : inner.attrs.members).length
      ? splitList(inner.attrs.subscribe != null ? inner.attrs.subscribe : inner.attrs.members)
      : docMembers
    : null;
  if (block.name === "reply") return threadAudience || docMembers;
  const reviewers = block.name === "claim" ? splitList(block.attrs.reviewers) : [];
  const own = splitList(block.attrs.subscribe);
  const base = own.length ? own : threadAudience || docMembers || [];
  if (!reviewers.length) return base;
  return [...base, ...reviewers.filter((r) => !base.includes(r))];
}

/**
 * Every fired block in `blocks`, with who is still owed it:
 *   { name, line, end, attrs, summary, thread, audience, pending }
 * `pending` is the audience minus `told=` — empty means fully delivered, and such blocks are not
 * returned at all (c17: a covered block is silence). A block with no audience anywhere does not
 * fire and does not error (c15).
 */
function firesOf(blocks, source) {
  const all = blocks || [];
  const membersLine = all.find((b) => b.name === "members" && b.kind === "leaf");
  const docMembers = membersLine ? splitList(membersLine.attrs.who) : [];
  const threads = all.filter((b) => b.name === "thread" && b.kind === "container");
  const out = [];
  for (const b of all) {
    if (!FIRING[b.name] || !hasFired(b)) continue;
    const audience = audienceOf(b, threads, docMembers);
    if (!audience || !audience.length) continue;
    const told = splitList(b.attrs.told);
    const pending = audience.filter((a) => !told.includes(a));
    if (!pending.length) continue;
    const inner = threads
      .filter((t) => t.line < b.line && b.end <= t.end)
      .sort((x, y) => y.line - x.line)[0];
    const thread = inner ? String(inner.attrs.id || "") : "";
    // c29 — a reply's summary names its thread when it has one.
    const summary =
      b.name === "reply" && thread
        ? `${b.attrs.by || "somebody"} replied in ${thread} — ${firstLine(b.src)}`
        : FIRING[b.name].summary(b);
    out.push({ name: b.name, line: b.line, end: b.end, attrs: b.attrs, summary, thread, audience, pending, told });
  }
  return out;
}

/**
 * One parse, three answers: the registration leaf (for the registry), the blocks, and the fires.
 * The door the host's announce path calls — `source` may be handed in to save the read.
 */
async function scan(absPath, source) {
  const text = source != null ? String(source) : readFile(absPath);
  if (text == null) return { ok: false, error: `cannot read ${absPath}` };
  const blocks = await parse(text);
  return { ok: true, text, blocks, registration: registrationOf(blocks), fires: firesOf(blocks, text) };
}

function readFile(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

module.exports = { firesOf, audienceOf, scan, splitList };
