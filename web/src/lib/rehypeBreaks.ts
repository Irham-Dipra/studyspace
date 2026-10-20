import type { Root } from "hast";

const BR = /^<br\s*\/?>$/i;

type Node = { type: string; value?: string; tagName?: string; properties?: object; children?: Node[] };

/**
 * rehype plugin that turns `<br>` written in Markdown into a line break. Notes don't render HTML (it
 * is shown as text), but AI answers put `<br>` in table cells for line breaks, where Markdown has no
 * other way to break a line. Only this one tag is let through. Must run before react-markdown turns
 * the remaining raw HTML into text, i.e. among the rehype plugins.
 */
export function rehypeBreaks() {
  return (tree: Root) => {
    const walk = (node: Node) => {
      const children = node.children;
      if (!children) return;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child.type === "raw" && BR.test(child.value?.trim() ?? "")) {
          children[i] = { type: "element", tagName: "br", properties: {}, children: [] };
        } else {
          walk(child);
        }
      }
    };
    walk(tree as unknown as Node);
  };
}
