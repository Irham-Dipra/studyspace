import type { Element, ElementContent, Root } from "hast";

/**
 * rehype plugin that tags a note's structure for its default highlighter colours (see index.css):
 *
 * - Headings get `data-level`, their level *relative to the note*: the highest heading level used is
 *   "1", the next deeper one "2", and so on. Notes pasted from different sources start at `#`, `##`
 *   or `###`; colouring by relative level keeps the hierarchy.
 * - A bold lead-in at the start of a list item ("- **Term:** explanation") gets `data-lead`, "1" in a
 *   top-level list and "2" in a nested one. An italic lead-in counts too when it is a label ending
 *   in a colon ("- *Example:* …"), and so does a short plain label ("- Superblock: checks…"), which
 *   AI answers often lose their bold on. The plain label is wrapped in a `<span>` to be coloured.
 * - A bullet that is only a label ("- **Deductive Learning:**") heads the points under it and gets
 *   `data-group`. AI answers often paste those points at the same level as the header; then the
 *   bullets after it, up to the next header, are moved into a list inside it, so they are indented.
 */
export function rehypeNoteStructure() {
  return (tree: Root) => {
    const headings: { el: Element; level: number }[] = [];
    const walk = (node: Root | Element, listDepth: number) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        const m = /^h([1-6])$/.exec(child.tagName);
        if (m) {
          headings.push({ el: child, level: Number(m[1]) });
          continue;
        }
        const depth = child.tagName === "ul" || child.tagName === "ol" ? listDepth + 1 : listDepth;
        if (child.tagName === "ul") nestUnderHeaders(child);
        if (child.tagName === "li") {
          if (isGroupHeader(child) && child.children.some(isList)) markGroupHeader(child);
          else {
            const lead = leadIn(child);
            if (lead) lead.properties = { ...lead.properties, dataLead: String(Math.min(listDepth, 2)) };
          }
        }
        walk(child, depth);
      }
    };
    walk(tree, 0);
    // Rank the distinct levels in use: e.g. ###/#### → 1/2 even though they are h3/h4.
    const levels = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b);
    for (const h of headings) h.el.properties = { ...h.el.properties, dataLevel: String(levels.indexOf(h.level) + 1) };
  };
}

const meaningful = (nodes: ElementContent[]) =>
  nodes.filter((n) => !(n.type === "text" && !n.value.trim()) && !(n.type === "element" && n.tagName === "input"));

const textOf = (node: ElementContent): string =>
  node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";

// A plain label: up to 8 words and 60 characters, no sentence end before the colon, more text after.
const PLAIN_LABEL = /^(\s*[^\s:.!?;][^:.!?;\n]{0,59}:)(\s+\S[\s\S]*)$/;

/** The bold (or italic "Label:") element a list item starts with, directly or in its first paragraph. */
function leadIn(li: Element): Element | null {
  let box: Element = li;
  let first = meaningful(li.children)[0];
  if (first?.type === "element" && first.tagName === "p") {
    box = first;
    first = meaningful(first.children)[0];
  }
  if (first?.type === "text") return plainLabel(box, first);
  if (first?.type !== "element") return null;
  if (first.tagName === "strong" || first.tagName === "b") return first;
  if ((first.tagName === "em" || first.tagName === "i") && /:\s*$/.test(textOf(first))) return first;
  return null;
}

function plainLabel(box: Element, text: Extract<ElementContent, { type: "text" }>): Element | null {
  const m = PLAIN_LABEL.exec(text.value);
  if (!m || m[1].trim().split(/\s+/).length > 8 || /https?:$|\[[ xX]?\]/.test(m[1])) return null;
  const span: Element = { type: "element", tagName: "span", properties: {}, children: [{ type: "text", value: m[1].trimStart() }] };
  box.children.splice(box.children.indexOf(text), 1, span, { type: "text", value: m[2] });
  return span;
}

const isList = (n: ElementContent): n is Element => n.type === "element" && (n.tagName === "ul" || n.tagName === "ol");

/** The item's own content (not its nested lists), unwrapped from a single paragraph. */
function ownContent(li: Element): { box: Element; nodes: ElementContent[] } {
  const own: ElementContent[] = meaningful(li.children).filter((n) => !isList(n));
  const first = own[0];
  if (own.length === 1 && first.type === "element" && first.tagName === "p") return { box: first, nodes: meaningful(first.children) };
  return { box: li, nodes: own };
}

/** Text with each formula counted as one word, so "Only $D_b$ is written:" stays short. */
const plainText = (node: ElementContent): string =>
  node.type === "text"
    ? node.value
    : node.type === "element"
      ? String(node.properties?.className ?? "").includes("katex")
        ? " x "
        : node.children.map(plainText).join("")
      : "";

/** A bullet that is only a short label ending in a colon, e.g. "**Deductive Learning:**". */
function isGroupHeader(li: Element): boolean {
  const { nodes } = ownContent(li);
  const text = nodes.map(plainText).join("").trim();
  return nodes.length > 0 && text.endsWith(":") && text.length <= 80 && text.split(/\s+/).length <= 10;
}

/** Moves the bullets after a header (up to the next header) into a list inside it. */
function nestUnderHeaders(ul: Element): void {
  const items = ul.children.filter((n): n is Element => n.type === "element" && n.tagName === "li");
  const out: ElementContent[] = [];
  let header: Element | null = null;
  let group: Element[] = [];
  const flush = () => {
    if (header && group.length) {
      header.children.push({ type: "text", value: "\n" }, { type: "element", tagName: "ul", properties: {}, children: group });
    }
    group = [];
  };
  for (const li of items) {
    if (isGroupHeader(li) && !li.children.some(isList)) {
      flush();
      header = li;
      out.push(li);
    } else if (header) {
      group.push(li);
    } else {
      out.push(li);
    }
  }
  flush();
  // A header with nothing after it stays a plain bullet; only rebuild when something moved.
  if (out.length !== items.length) ul.children = out;
}

function markGroupHeader(li: Element): void {
  const { box, nodes } = ownContent(li);
  const only = nodes.length === 1 ? nodes[0] : null;
  if (only?.type === "element" && ["strong", "b", "em", "i"].includes(only.tagName)) {
    only.properties = { ...only.properties, dataGroup: "" };
    return;
  }
  const span: Element = { type: "element", tagName: "span", properties: { dataGroup: "" }, children: nodes };
  box.children = box === li ? [span, ...li.children.filter(isList)] : [span];
}
