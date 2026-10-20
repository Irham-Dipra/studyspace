import type { Element, ElementContent, Root, RootContent, Text } from "hast";
import type { TextAnchoredHighlight } from "./types";
import { isMathClass, locateQuote, mathToken } from "./noteAnchors";

interface Slot {
  node: Text;
  parent: Element | Root;
  start: number;
}

/** A rendered formula: one piece of the note's text (its `mathToken`). */
interface Atom {
  el: Element;
  start: number;
  end: number;
}

type Placed = { h: TextAnchoredHighlight; range: [number, number] };

const textOf = (n: ElementContent): string => (n.type === "text" ? n.value : n.type === "element" ? n.children.map(textOf).join("") : "");

/** The TeX source KaTeX keeps in its MathML annotation. */
function texOf(el: Element): string {
  let found: string | null = null;
  const visit = (n: ElementContent) => {
    if (found !== null || n.type !== "element") return;
    if (n.tagName === "annotation" && n.properties?.encoding === "application/x-tex") found = textOf(n);
    else n.children.forEach(visit);
  };
  el.children.forEach(visit);
  return found ?? textOf(el);
}

/**
 * rehype plugin: wraps the text covered by each note highlight in
 * `<mark class="ss-note-hl" data-hl="id">`. Runs after KaTeX. A formula inside a highlight gets the
 * same class and attributes on its own element (a <mark> can't hold a display formula).
 * Where highlights overlap, the most recently created one is shown on top.
 */
export function rehypeNoteHighlights(options: { highlights: TextAnchoredHighlight[] }) {
  return (tree: Root) => {
    if (!options.highlights.length) return;

    const slots: Slot[] = [];
    const atoms: Atom[] = [];
    let text = "";
    // The old text, without formulas, and where each of its characters is in `text`.
    let legacy = "";
    const legacyAt: number[] = [];
    const walk = (parent: Element | Root) => {
      for (const child of parent.children) {
        if (child.type === "text") {
          slots.push({ node: child, parent, start: text.length });
          for (let i = 0; i < child.value.length; i++) legacyAt.push(text.length + i);
          legacy += child.value;
          text += child.value;
        } else if (child.type === "element" && isMathClass(child.properties?.className)) {
          const token = mathToken(texOf(child));
          atoms.push({ el: child, start: text.length, end: text.length + token.length });
          text += token;
        } else if (child.type === "element") {
          walk(child);
        }
      }
    };
    walk(tree);

    const fromLegacy = (r: [number, number] | null): [number, number] | null => (r ? [legacyAt[r[0]], legacyAt[r[1] - 1] + 1] : null);
    const placed = options.highlights
      .map((h) => ({ h, range: locateQuote(text, h) ?? fromLegacy(locateQuote(legacy, h)) }))
      .filter((x): x is Placed => x.range !== null);
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
    const markProps = (p: Placed, end: number) => ({
      dataHl: p.h.id,
      style: `--hl:${p.h.color}`,
      ...(p.h.comment ? { dataComment: "", title: p.h.comment } : {}),
      ...(lastEnd.get(p.h.id) === end ? { dataLast: "" } : {}),
    });

    for (const atom of atoms) {
      const p = topAt(atom.start);
      if (!p) continue;
      const cls: unknown = atom.el.properties.className;
      const list = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(/\s+/) : [];
      atom.el.properties = { ...atom.el.properties, ...markProps(p, atom.end), className: [...list, "ss-note-hl"] };
    }

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
          // Line breaks between blocks would show as coloured slivers of their own.
          if (!current || /^\s*\n\s*$/.test(value)) {
            pieces.push({ type: "text", value });
          } else {
            pieces.push({
              type: "element",
              tagName: "mark",
              properties: { className: ["ss-note-hl"], ...markProps(current, pos) },
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
