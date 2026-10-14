import type { Element, ElementContent, Root, Text } from "hast";

/** ==text== (the highlight marking used by Obsidian, Typora… and StudySpace's "Get text"). */
const MARK = /==(?=\S)([^\n]*?\S)==/g;

/**
 * rehype plugin that shows ==text== as highlighted text (`<mark class="ss-pdf-hl">`). Text extracted
 * from a PDF marks the passages you highlighted this way. Code and math are left alone.
 */
export function rehypePdfMarks() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      const out: ElementContent[] = [];
      let changed = false;
      for (const child of node.children as ElementContent[]) {
        if (child.type === "element") {
          const cls = child.properties?.className;
          const skip = child.tagName === "code" || child.tagName === "pre" || (Array.isArray(cls) && cls.some((c) => String(c).includes("math") || String(c).includes("katex")));
          if (!skip) walk(child);
          out.push(child);
        } else if (child.type === "text" && child.value.includes("==")) {
          const parts = split(child);
          if (parts[0] !== child) changed = true;
          out.push(...parts);
        } else {
          out.push(child);
        }
      }
      if (changed) node.children = out as typeof node.children;
    };
    walk(tree);
  };
}

function split(t: Text): ElementContent[] {
  const out: ElementContent[] = [];
  let last = 0;
  for (const m of t.value.matchAll(MARK)) {
    if (m.index > last) out.push({ type: "text", value: t.value.slice(last, m.index) });
    out.push({ type: "element", tagName: "mark", properties: { className: ["ss-pdf-hl"] }, children: [{ type: "text", value: m[1] }] });
    last = m.index + m[0].length;
  }
  if (!out.length) return [t];
  if (last < t.value.length) out.push({ type: "text", value: t.value.slice(last) });
  return out;
}
