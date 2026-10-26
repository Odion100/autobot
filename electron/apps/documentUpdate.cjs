// ONE BUILDER FOR `document.updated`, because there are now two callers.
//
// The window's press comes through `documents:send-update`; an agent's comes through the systemview
// MCP, with no window open anywhere. The SHAPE of this event is a contract — standing hooks match
// on its fields and the harness delivers by its `members` — so two constructions of it would be two
// copies of one rule, each agreeing with its own caller and drifting apart unnoticed. That is the
// exact failure RFC-072 §3 argues from, one level down.
//
// Pure on purpose: it builds the event and never emits. Emitting belongs to whoever owns the
// session host, and a module that could both build and announce would let a surface forge an event
// it was never granted.

const fs = require("fs");
// RFC-073 §3.1 — THE REGEX DIALECT IS RETIRED. `LINE(name)` matched only a leaf, so this file could
// never see a container, and a second grammar beside the real one drifts (c42). The platform's own
// parse reads the head now — same pipeline every renderer runs.
const { parse } = require("../markdown/parse.cjs");

const headOf = (abs) => {
  try {
    // The head is enough for both lines and bounds the read — this can be called for any document
    // in any project, and the expensive version of that is why nobody builds this feature.
    return fs.readFileSync(abs, "utf8").slice(0, 4000);
  } catch {
    return "";
  }
};

const listOf = (raw) =>
  String(raw || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);

// One bounded parse of the head answers both questions below.
const headLeaf = async (abs, name) => {
  const head = headOf(abs);
  if (!head.includes(`::${name}`)) return null; // cheap first — most documents carry neither
  const blocks = await parse(head);
  return blocks.find((b) => b.name === name && b.kind === "leaf") || null;
};

/**
 * WHO IS ON IT, ACCORDING TO THE DOCUMENT. Membership lives in the file as a `::members` line — his
 * to edit, everyone else's to read — so an agent sending an update never passes a member list and
 * therefore cannot invent one. The window still passes its own, because it also knows the `sent=`
 * hashes and is mid-edit.
 */
const membersIn = async (abs) => {
  const leaf = await headLeaf(abs, "members");
  return leaf ? listOf(leaf.attrs.who) : [];
};

/**
 * THE ARC ADDRESS, NOT THE PATH. A document carrying `::arc{id=ARC-001 …}` is self-describing, so
 * the event can say WHICH arc moved rather than only which file did — and a hook becomes aimable at
 * one arc (`when: { arc: "ARC-001" }`) instead of at a whole folder.
 *
 * The id travels and the path does not, for the reason RFC-072 §5 gives about attachments: the
 * number is the identity and the kebab title after it is cosmetic, renamed the first time somebody
 * sharpens the wording. A hook matching a path breaks silently on that rename, and the breakage
 * reads as "no arc" rather than "the arc moved".
 */
const arcIn = async (abs) => {
  const leaf = await headLeaf(abs, "arc");
  return leaf ? String(leaf.attrs.id || "") : "";
};

/**
 * Build the ambient event, or say why it cannot be built. `absPath` is resolved by the caller —
 * only the caller knows how a project code becomes a folder.
 *
 * `members` goes out PIPE-WRAPPED (`|buapi|systemlynx|`) so a standing hook matches one member
 * exactly: `when: { members: { contains: "|buapi|" } }`. A bare substring would wake `buapi` for a
 * document owned by `bu`, which is the kind of mistake nobody would ever find.
 */
async function buildUpdate(payload = {}, absPath = "") {
  const path_ = String(payload.path || "").trim();
  if (!path_) return { ok: false, error: "no document path" };

  const given = Array.isArray(payload.members)
    ? payload.members.map((m) => String(m || "").trim()).filter(Boolean)
    : null;
  const members = given && given.length ? given : await membersIn(absPath);
  if (!members.length)
    return { ok: false, error: "nobody to send to — the document has no members" };

  const arc = String(payload.arc || "") || (await arcIn(absPath));

  return {
    ok: true,
    members,
    event: {
      kind: "document.updated",
      path: path_,
      project: String(payload.project || ""),
      members: `|${members.join("|")}|`,
      by: String(payload.by || "you"),
      summary: String(payload.summary || "").slice(0, 400),
      threads: Number(payload.threads) || 0,
      // WHICH SUBSCRIPTION THIS IS. A thread reply names its thread; a document send does not — so
      // a hook can tell "somebody answered you" from "the file moved" with one field, and an agent
      // woken by the first knows where to read before it opens anything.
      ...(payload.thread ? { thread: String(payload.thread) } : {}),
      // Only when the document actually is an arc. An empty field on every other document would
      // make `exists` useless as a way to ask "is this an arc update?".
      ...(arc ? { arc } : {}),
      // RFC-073 c28 — A FIRE POINTS BACK AT THE THING. When the payload came from the fire scan it
      // carries the registry kind and id, the block's name and line — enough to open the document
      // at the block without a search. A receiver holding only a sentence is holding a
      // notification it cannot act on. Absent on a plain send, so `exists` still answers
      // "is this a block firing?".
      ...(payload.docKind ? { docKind: String(payload.docKind) } : {}),
      ...(payload.docId ? { docId: String(payload.docId) } : {}),
      ...(payload.block ? { block: String(payload.block) } : {}),
      ...(payload.line ? { line: Number(payload.line) } : {}),
    },
  };
}

module.exports = { buildUpdate, membersIn, arcIn };
