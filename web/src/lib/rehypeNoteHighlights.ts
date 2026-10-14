import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import type { NoteHighlight } from "./types";
import { isMathClass, locateQuote } from "./noteAnchors";

interface Slot {
  node: Text;
  parent: Element | Root;
  start: number;
}

/**
 * rehype plugin: wraps the text covered by each note highlight in
 * `<mark class="ss-note-hl" data-hl="id">`. Runs after KaTeX and never touches formula output.
 * Where highlights overlap, the most recently created one is shown on top.
 */
export function rehypeNoteHighlights(options: { highlights: NoteHighlight[] }) {
  return (tree: Root) => {
    if (!options.highlights.length) return;

    const slots: Slot[] = [];
    let text = "";
    const walk = (parent: Element | Root) => {
      for (const child of parent.children) {
        if (child.type === "text") {
          slots.push({ node: child, parent, start: text.length });
          text += child.value;
        } else if (child.type === "element" && !isMathClass(child.properties?.className)) {
          walk(child);
        }
      }
    };
    walk(tree);

    const placed = options.highlights
      .map((h) => ({ h, range: locateQuote(text, h) }))
      .filter((x): x is { h: NoteHighlight; range: [number, number] } => x.range !== null);
    if (!placed.length) return;
    // Later highlights win where they overlap.
    const topAt = (pos: number) => {
      for (let i = placed.length - 1; i >= 0; i--) {
        const [a, b] = placed[i].range;
        if (pos >= a && pos < b) return placed[i];
      }
      return null;
    };
    const lastEnd = new Map(placed.map((p) => [p.h.id, p.range[1]]));

    for (const slot of slots) {
      const { node, parent, start } = slot;
      const end = start + node.value.length;
      if (!placed.some((p) => p.range[0] < end && p.range[1] > start)) continue;

      // Split this text node wherever the covering highlight changes.
      const pieces: (Text | Element)[] = [];
      let segStart = start;
      let current = topAt(start);
      for (let pos = start + 1; pos <= end; pos++) {
        const next = pos < end ? topAt(pos) : undefined;
        if (pos === end || next !== current) {
          const value = node.value.slice(segStart - start, pos - start);
          if (!current) {
            pieces.push({ type: "text", value });
          } else {
            const isLast = lastEnd.get(current.h.id) === pos;
            pieces.push({
              type: "element",
              tagName: "mark",
              properties: {
                className: ["ss-note-hl"],
                dataHl: current.h.id,
                style: `--hl:${current.h.color}`,
                ...(current.h.comment ? { dataComment: "", title: current.h.comment } : {}),
                ...(isLast ? { dataLast: "" } : {}),
              },
              children: [{ type: "text", value }],
            });
          }
          segStart = pos;
          current = next ?? null;
        }
      }
      const siblings = parent.children as (RootContent | ElementContent)[];
      const index = siblings.indexOf(node);
      siblings.splice(index, 1, ...pieces);
    }
  };
}
