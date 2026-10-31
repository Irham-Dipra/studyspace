import { memo, useLayoutEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMath } from "../lib/math";
import { rehypeNoteStructure } from "../lib/rehypeNoteStructure";
import { rehypeNoteHighlights } from "../lib/rehypeNoteHighlights";
import { rehypeNoteStyles, type NoteStyles } from "../lib/rehypeNoteStyles";
import { rehypePdfMarks } from "../lib/rehypePdfMarks";
import { rehypeBreaks } from "../lib/rehypeBreaks";
import { repairTables } from "../lib/tableRepair";
import type { TextAnchoredHighlight } from "../lib/types";

const NO_HIGHLIGHTS: TextAnchoredHighlight[] = [];

/** A link or picture address that points at a file next to the document (not a web address). */
const isRelative = (src: string) => !!src && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src);

const safeDecode = (s: string) => {
  try {
    return decodeURI(s); // "my%20pic.png" → "my pic.png"
  } catch {
    return s;
  }
};

/** Smallest scale a display equation is shrunk to before it scrolls sideways instead. */
const MIN_FIT = 0.6;

/** Scales display equations that are wider than the panel down to fit (sets `--ss-fit`). */
function fitEquations(root: HTMLElement) {
  for (const box of root.querySelectorAll<HTMLElement>(".katex-display")) {
    box.style.removeProperty("--ss-fit");
    if (box.clientWidth === 0) continue;
    // Shrink, re-measure, repeat: widths don't scale exactly with font size (padding, rounding).
    let fit = 1;
    for (let i = 0; i < 4 && box.scrollWidth > box.clientWidth + 1 && fit > MIN_FIT; i++) {
      fit = Math.max(MIN_FIT, Math.floor(fit * (box.clientWidth / box.scrollWidth) * 100) / 100 - 0.01);
      box.style.setProperty("--ss-fit", String(fit));
    }
  }
}

interface Props {
  children: string;
  highlights?: TextAnchoredHighlight[];
  /** Notes get their headings and lead-ins coloured (rehypeNoteStructure); whole documents don't. */
  structure?: boolean;
  /** Colours the user picked for single headings, labels or marks (rehypeNoteStyles); notes only. */
  styles?: NoteStyles;
  /** Where a picture next to the file is loaded from (Markdown documents); notes have none. */
  assetUrl?: (src: string) => string;
}

/**
 * Renders note content as GitHub-flavoured Markdown with math: $…$, $$…$$, \(…\) and \[…\].
 * Raw HTML is shown as text, except `<br>` (rehypeBreaks). Tables broken over several lines, as
 * copied from Gemini, are mended first (repairTables). `highlights` are drawn as <mark>s over the
 * rendered text.
 */
export const Markdown = memo(function Markdown({ children, highlights = NO_HIGHLIGHTS, structure = true, styles, assetUrl }: Props) {
  const rehypePlugins = useMemo(
    () =>
      [
        rehypeBreaks,
        rehypePdfMarks,
        [rehypeKatex, { throwOnError: false, strict: "ignore" }],
        ...(structure ? [rehypeNoteStructure, [rehypeNoteStyles, { styles }]] : []),
        [rehypeNoteHighlights, { highlights }],
      ] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"],
    [highlights, structure, styles],
  );
  const components = useMemo<Parameters<typeof ReactMarkdown>[0]["components"]>(
    () => ({
      // Links within the page stay in the tab; everything else opens a new one.
      a: ({ node: _n, ...p }) => (p.href?.startsWith("#") ? <a {...p} /> : <a {...p} target="_blank" rel="noreferrer noopener" />),
      img: ({ node: _n, src, ...p }) => {
        const img = <img {...p} src={assetUrl && typeof src === "string" && isRelative(src) ? assetUrl(safeDecode(src)) : src} loading="lazy" />;
        // A picture kept as a note opens full size in a new tab.
        return typeof src === "string" && src.startsWith("/api/images/") ? (
          <a href={src} target="_blank" rel="noreferrer noopener" title="Open the picture full size">
            {img}
          </a>
        ) : (
          img
        );
      },
    }),
    [assetUrl],
  );
  const ref = useRef<HTMLDivElement>(null);
  // Refit after every render, whenever the panel is resized, and when fonts finish loading.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitEquations(el);
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitEquations(el);
    });
    ro.observe(el);
    // Widths change once KaTeX's fonts arrive (first load), so measure again then.
    const refit = () => fitEquations(el);
    let alive = true;
    void document.fonts?.ready.then(() => alive && refit());
    document.fonts?.addEventListener("loadingdone", refit);
    return () => {
      alive = false;
      ro.disconnect();
      document.fonts?.removeEventListener("loadingdone", refit);
    };
  });
  return (
    <div className="ss-md" ref={ref}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalizeMath(repairTables(children))}
      </ReactMarkdown>
    </div>
  );
});
