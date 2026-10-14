import type { Element, ElementContent, Root } from "hast";

/**
 * rehype plugin that tags a note's structure for its default highlighter colours (see index.css):
 *
 * - Headings get `data-level`, their level *relative to the note*: the highest heading level used is
 *   "1", the next deeper one "2", and so on. Notes pasted from different sources start at `#`, `##`
 *   or `###`; colouring by relative level keeps the hierarchy.
 * - A bold lead-in at the start of a list item ("- **Term:** explanation") gets `data-lead`, "1" in a
 *   top-level list and "2" in a nested one. An italic lead-in counts too when it is a label ending
 *   in a colon ("- *Example:* …").
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
        if (child.tagName === "li") {
          const lead = leadIn(child);
          if (lead) lead.properties = { ...lead.properties, dataLead: String(Math.min(listDepth, 2)) };
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

/** The bold (or italic "Label:") element a list item starts with, directly or in its first paragraph. */
function leadIn(li: Element): Element | null {
  let first = meaningful(li.children)[0];
  if (first?.type === "element" && first.tagName === "p") first = meaningful(first.children)[0];
  if (first?.type !== "element") return null;
  if (first.tagName === "strong" || first.tagName === "b") return first;
  if ((first.tagName === "em" || first.tagName === "i") && /:\s*$/.test(textOf(first))) return first;
  return null;
}
