// RFC-073 §3.1 — THE GRAMMAR IS THE PLATFORM'S. One parse of interactive markdown, in plain node,
// used by the host and imported by every app that renders it. "Capabilities belong to the browser,
// surfaces belong to the app" (RFC-053): the apps keep their React; the grammar lives here once.
//
// WHY THIS EXISTS AT ALL. `documentUpdate.cjs` grew two regexes to read `::members` and `::arc` off a
// file because the real parser sat inside SystemView's React tree, across a repo seam, as ESM. That
// second dialect was not a smaller copy of the engine — `LINE(name)` matches `::name{…}`, a LEAF,
// and `:::approval` is a CONTAINER, so the host could not see the one block the whole subscribe
// design was argued from. A shared capability that lives inside one app is one every other process
// reaches for a shortcut around. So it moved.
//
// IT MATCHES THE RENDERER'S PARSE OR IT IS WORTHLESS. SystemView runs `remark-gfm → remark-directive
// → remarkSvBlocks` and reads name / kind / attributes / label / line / end / inner source off each
// directive node. This file produces exactly those fields from exactly that pipeline, and
// `directives.js` is to import `walk()` from here rather than carry its own — the claim is one parser,
// and a test in `tests/markdown-parse.js` holds a fixture to the same answers.
//
// The remark packages are ESM-only and this host is CJS, so they are imported lazily and once. The
// parse is therefore async; nothing that needs it is on a hot path, and a sync parser would mean a
// second copy of the grammar, which is the thing being removed.
const TYPES = {
  textDirective: "inline",
  leafDirective: "leaf",
  containerDirective: "container",
};

let pipeline = null;
async function load() {
  if (pipeline) return pipeline;
  const [{ unified }, remarkParse, remarkGfm, remarkDirective, { visit }] = await Promise.all([
    import("unified"),
    import("remark-parse"),
    import("remark-gfm"),
    import("remark-directive"),
    import("unist-util-visit"),
  ]);
  const processor = unified().use(remarkParse.default).use(remarkGfm.default).use(remarkDirective.default);
  pipeline = { processor, visit };
  return pipeline;
}

// The bracketed label (`:ns[Math.add]`) flattened to a plain string — a namespace, a file path.
// INLINE CODE IS TEXT TOO — the renderer's labelOf keeps `inlineCode` values (a claim's statement
// quotes blocks), and this parse matches the renderer or it is worthless.
function labelOf(node, visit) {
  let out = "";
  visit(node, (t) => {
    if (t.type === "text" || t.type === "inlineCode") out += t.value;
  });
  return out;
}

// A container's bracketed label (`:::claim[the statement]{…}`) — remark-directive parses it as a
// first child paragraph marked `directiveLabel`. RFC-075: a container claim is a leaf claim grown a
// body, so the label belongs to the block, not to its inner content — without this, a container
// claim's fire summary would announce an empty statement.
function labelChildOf(node) {
  const first = (node.children || [])[0];
  return first && first.data && first.data.directiveLabel ? first : null;
}

// The text between a container directive's opening and closing fence, verbatim — a `:::run` body is
// instructions to be parsed, not children to be rendered.
function innerSource(source, node) {
  const p = node.position || {};
  if (!source || !p.start || p.start.offset == null || !p.end || p.end.offset == null) return "";
  const whole = source.slice(p.start.offset, p.end.offset);
  const lines = whole.split("\n");
  if (lines.length <= 2) return "";
  return lines.slice(1, lines[lines.length - 1].trim().startsWith(":::") ? -1 : undefined).join("\n");
}

/**
 * Every directive in `source`, in document order, each as
 *   { name, kind: "inline"|"leaf"|"container", attrs, label, line, end, src }
 * — the same seven facts the renderer hangs on its `svblock` element, under the same names minus the
 * `d` prefix. `src` is a container's raw inner source and "" otherwise.
 */
async function parse(source) {
  const text = String(source == null ? "" : source);
  const { processor, visit } = await load();
  const tree = processor.parse(text);
  const blocks = [];
  visit(tree, (node) => {
    const kind = TYPES[node.type];
    if (!kind) return;
    blocks.push({
      name: node.name || "",
      kind,
      attrs: { ...(node.attributes || {}) },
      label:
        kind === "container"
          ? (labelChildOf(node) ? labelOf(labelChildOf(node), visit) : "")
          : labelOf(node, visit),
      line: (node.position && node.position.start && node.position.start.line) || 0,
      end: (node.position && node.position.end && node.position.end.line) || 0,
      src: kind === "container" ? innerSource(text, node) : "",
    });
  });
  return blocks;
}

// FENCE NORMALIZER — ported from SystemView's `Markdown.js`, and the platform's to keep from now on
// because it is part of WRITING a document rather than reading one: the one rule of container
// directives is that an outer fence must be LONGER than every fence inside it, and a writer that
// widens only the thread it is adding misses the enclosing containers. Rebuilds every container's
// fence bottom-up (children + 1, min 3). Fences inside code blocks are examples, not structure. An
// unbalanced document comes back untouched — guessing at repair could eat someone's writing.
//
// NOT applied inside `parse()`: the renderer does not normalize on read either, and two parses that
// differ in a pre-pass are two parses.
function normalizeFences(source) {
  const lines = String(source).split("\n");
  let inCode = false;
  const stack = [];
  const roots = [];
  for (let n = 0; n < lines.length; n++) {
    if (/^\s*(```|~~~)/.test(lines[n])) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (/^\s*:{3,}\s*[a-zA-Z]/.test(lines[n])) {
      const node = { open: n, close: -1, children: [] };
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    } else if (/^\s*:{3,}\s*$/.test(lines[n])) {
      if (!stack.length) return source;
      stack.pop().close = n;
    }
  }
  if (stack.length || inCode) return source;
  const apply = (node) => {
    let maxChild = 0;
    node.children.forEach((c) => {
      maxChild = Math.max(maxChild, apply(c));
    });
    const len = Math.max(3, maxChild + 1);
    lines[node.open] = lines[node.open].replace(/:{3,}/, ":".repeat(len));
    lines[node.close] = lines[node.close].replace(/:{3,}/, ":".repeat(len));
    return len;
  };
  roots.forEach(apply);
  return lines.join("\n");
}

module.exports = { parse, normalizeFences, TYPES };
