import { memo, useLayoutEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMath } from "../lib/math";
import { rehypeNoteStructure } from "../lib/rehypeNoteStructure";
import { rehypeNoteHighlights } from "../lib/rehypeNoteHighlights";
import { rehypePdfMarks } from "../lib/rehypePdfMarks";
import type { NoteHighlight } from "../lib/types";

const NO_HIGHLIGHTS: NoteHighlight[] = [];

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

/**
 * Renders note content as GitHub-flavoured Markdown with math: $…$, $$…$$, \(…\) and \[…\].
 * Raw HTML is not rendered. `highlights` are drawn as <mark>s over the rendered text.
 */
export const Markdown = memo(function Markdown({ children, highlights = NO_HIGHLIGHTS }: { children: string; highlights?: NoteHighlight[] }) {
  const rehypePlugins = useMemo(
    () => [
      rehypePdfMarks,
      [rehypeKatex, { throwOnError: false, strict: "ignore" }],
      rehypeNoteStructure,
      [rehypeNoteHighlights, { highlights }],
    ] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"],
    [highlights],
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
        components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
});
