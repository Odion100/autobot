// THE CORRECTIONS DOOR — RFC-078 §2.8, slices 3.9/3.10. The agent face of the audit queue.
//
// WHY THE QUEUE IS NOT THE BOARD, which decides what belongs here: his division, 2026-11-08 —
// "the board is about FEATURES, the queue is about WORK, like doctrine, architecture", and
// "the queue is gonna evoke the agents, is gonna fire or nudge the agents, corrections." A card
// waits to be read. A correction reaches out, is owed by somebody, and goes away when the work is
// done. So this door is deliberately small: submit one, clear one, read your own, drop an entry.
//
// THE RULES ARE NOT HERE. They live in nudges.cjs's verbs, which refuse — one definition, so the
// door cannot disagree with the drain about what a correction is. This file is transcription plus
// one thing the module cannot do: SAY the refusal out loud. nudges.cjs has no session to speak
// into; the host does, and `onRefused` is how it gets there.
const { createSdkMcpServer, tool } = require("@anthropic-ai/claude-agent-sdk");
const { z } = require("zod");
const nudges = require("./nudges.cjs");

const SERVER = "corrections";
const TOOL_NAMES = ["submit", "clear", "mine", "drop"];

const say = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });

// A REFUSAL IS SAID, NOT RETURNED AND FORGOTTEN (his: "you should probably propagate the message
// back to the agent's chat, just like we do with some things that have failed"). The door hands
// the reason to the host, which emits it into this session's own feed the way a dropped steer
// already does — and still returns it, so the calling turn reads it too. Both, because the return
// value is read by the model and the feed is read by him.
function toolsFor({ slot = "", projectCode = "", onRefused = null } = {}) {
  const me = String(slot || projectCode || "");
  const refused = (verb, r) => {
    try { if (onRefused) onRefused({ verb, reason: r.reason }); } catch {}
    return say({ ok: false, refused: verb, reason: r.reason });
  };

  return [
    tool(
      "submit",
      "Submit a CORRECTION into the audit queue — work somebody owes, about doctrine or " +
        "architecture. It is words: what was claimed, what you found instead, and what would make " +
        "it true. It reaches the agent you address it to, and it stays in the queue until somebody " +
        "OTHER than that agent clears it. Use it for a finding you judged; a feature idea is a " +
        "board card, not a correction.",
      {
        for: z.string().describe("the agent that owes this — their slot, e.g. systemview-test. Required: a correction nobody owes reaches nobody"),
        text: z.string().describe("the correction itself, in words"),
        target: z.string().optional().describe("what it is about — a claim address like RFCs/RFC-078.md#c18, a file, a repo, a practice, an agent's own behaviour. Free on purpose: most doctrine has no claim to sit on"),
        path: z.string().optional().describe("the ABSOLUTE path of the document it is about, when there is one — the correction joins that document's queue entry instead of making its own"),
        project: z.string().optional().describe("the project it belongs to; defaults to yours"),
      },
      async (a) => {
        const r = nudges.submitCorrection({
          project: a.project || projectCode, path: a.path || "", by: me,
          for: a.for, target: a.target || "", text: a.text,
        });
        return r.ok ? say({ ok: true, id: r.correction.id, for: r.correction.for, joined: r.joined }) : refused("submit", r);
      }
    ),
    tool(
      "clear",
      "Clear a correction once you have checked the work that answers it. You cannot clear one " +
        "addressed to you — somebody else closes yours, which is what keeps the loop honest.",
      { id: z.string().describe("the correction's id, as `mine` or the queue reports it") },
      async (a) => {
        const r = nudges.clearCorrection({ id: a.id, by: me });
        return r.ok ? say({ ok: true, cleared: r.cleared }) : refused("clear", r);
      }
    ),
    tool(
      "mine",
      "The corrections addressed to YOU and nothing else — what you owe, read off the same queue " +
        "the auditor drains. Reading never changes it.",
      {},
      async () => {
        const list = nudges.correctionsFor(me);
        return say(list.length ? { owed: list.length, corrections: list } : { owed: 0, note: `nothing is owed by ${me || "you"}` });
      }
    ),
    tool(
      "drop",
      "Take a checked entry off the audit queue. It REFUSES while the entry holds an open " +
        "correction — checked is no longer out, corrected is.",
      {
        path: z.string().describe("the entry's absolute path, exactly as the queue carries it"),
        at: z.number().describe("the entry's stamp, exactly as the queue carries it"),
        project: z.string().optional().describe("the entry's project; defaults to yours"),
      },
      async (a) => {
        const r = nudges.removeEntry({ project: a.project || projectCode, path: a.path, at: a.at });
        return r.ok ? say({ ok: true, removed: r.removed }) : refused("drop", r);
      }
    ),
  ];
}

function serverFor(identity = {}) {
  return createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: toolsFor(identity) });
}

module.exports = { SERVER, TOOL_NAMES, serverFor, toolsFor };
