import type { Element, ElementContent, Root } from "hast";

/** A colour picked for one element: "#rrggbb", or "none" for no highlighter colour. */
export type NoteStyles = Record<string, string>;

const NO_STYLES: NoteStyles = {};

/** The CSS for a picked colour: the default rules read `--hl`, so overriding it keeps dark mode's mix. */
export const styleValue = (color: string) => `--hl: ${color === "none" ? "transparent" : color}`;

function kindOf(el: Element): string | null {
  const p = el.properties ?? {};
  if (p.dataLevel !== undefined) return "h";
  if (p.dataGroup !== undefined) return "group";
  if (p.dataLead !== undefined) return "lead";
  const cls = p.className;
  if (Array.isArray(cls) && cls.includes("ss-pdf-hl")) return "mark";
  return null;
}

function textOf(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  return node.children.map(textOf).join("");
}

/**
 * rehype plugin, run after rehypeNoteStructure: gives every element with a default highlighter colour
 * (headings, bullet labels and headers, ==marks==) a `data-sk` key, and applies the colour the user
 * picked for it. The key is its kind and text, plus "#n" for the n-th repeat, so it survives edits
 * elsewhere in the note and a change of heading level.
 */
export function rehypeNoteStyles(options: { styles?: NoteStyles } = {}) {
  const styles = options.styles ?? NO_STYLES;
  return (tree: Root) => {
    const seen = new Map<string, number>();
    const walk = (node: Root | Element) => {
      for (const child of node.children) {
        if (child.type !== "element") continue;
        const kind = kindOf(child);
        if (kind) {
          const base = `${kind}:${textOf(child).replace(/\s+/g, " ").trim().slice(0, 120)}`;
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          const key = n ? `${base}#${n}` : base;
          const color = styles[key];
          child.properties = { ...child.properties, dataSk: key, ...(color ? { style: styleValue(color) } : {}) };
        }
        walk(child);
      }
    };
    walk(tree);
  };
}
