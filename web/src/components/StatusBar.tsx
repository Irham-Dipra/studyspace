import { useEffect, useState } from "react";
import { withKey } from "../lib/shortcuts";
import { ChevronLeft, ChevronRight, Maximize, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-react";
import { IconButton, selectAllOnFocus } from "./ui";

interface Props {
  /** False for HTML / Markdown: no pages, so only the zoom (text size) is shown. */
  paged?: boolean;
  page: number;
  pageCount: number;
  zoom: number;
  onPage: (p: number) => void;
  onZoom: (z: number) => void;
  onFitWidth: () => void;
  onFitPage: () => void;
}

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export function StatusBar({ paged = true, page, pageCount, zoom, onPage, onZoom, onFitWidth, onFitPage }: Props) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);

  const commit = () => {
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n) && pageCount) onPage(Math.min(pageCount, Math.max(1, n)));
    else setDraft(String(page));
  };
  const zoomIn = () => onZoom(STEPS.find((s) => s > zoom + 0.001) ?? zoom);
  const zoomOut = () => onZoom([...STEPS].reverse().find((s) => s < zoom - 0.001) ?? zoom);

  return (
    <footer className="flex h-11 shrink-0 items-center gap-2 border-t border-line bg-panel px-2 text-sm sm:px-3">
      {paged && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="hidden text-ink-3 sm:inline">Page</span>
            <input
              aria-label="Current page"
              title={withKey("Go to page", "goToPage")}
              className="h-7 w-12 rounded-md sm:w-14 border border-line bg-subtle text-center tabular-nums outline-none focus:border-accent"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
              onFocus={selectAllOnFocus}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), commit())}
              inputMode="numeric"
              disabled={!pageCount}
            />
            <span className="whitespace-nowrap tabular-nums text-ink-3">/ {pageCount || "–"}</span>
          </div>

          <div className="mx-auto flex items-center gap-1">
            <button
              className="flex h-8 items-center gap-1 rounded-md px-2 text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              onClick={() => onPage(page - 1)}
              disabled={page <= 1}
              title={withKey("Previous page", "prevPage")}
            >
              <ChevronLeft className="size-4" />
              <span className="hidden md:inline">Previous Page</span>
            </button>
            <button
              className="flex h-8 items-center gap-1 rounded-md px-2 text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              onClick={() => onPage(page + 1)}
              disabled={!pageCount || page >= pageCount}
              title={withKey("Next page", "nextPage")}
            >
              <span className="hidden md:inline">Next Page</span>
              <ChevronRight className="size-4" />
            </button>
          </div>
        </>
      )}

      <div className={`flex items-center gap-0.5${paged ? "" : " ml-auto"}`}>
        <IconButton label={withKey("Zoom out", "zoomOut")} onClick={zoomOut}>
          <ZoomOut className="size-4" />
        </IconButton>
        <select
          aria-label="Zoom"
          className="h-7 rounded-md border border-line bg-subtle px-1 text-xs tabular-nums outline-none"
          value={STEPS.includes(zoom) ? zoom : "custom"}
          onChange={(e) => onZoom(Number(e.target.value))}
        >
          {!STEPS.includes(zoom) && <option value="custom">{Math.round(zoom * 100)}%</option>}
          {STEPS.map((s) => (
            <option key={s} value={s}>
              {Math.round(s * 100)}%
            </option>
          ))}
        </select>
        <IconButton label={withKey("Zoom in", "zoomIn")} onClick={zoomIn}>
          <ZoomIn className="size-4" />
        </IconButton>
        {paged && (
          <>
            <IconButton label={withKey("Fit width", "fitWidth")} onClick={onFitWidth}>
              <MoveHorizontal className="size-4" />
            </IconButton>
            <IconButton label={withKey("Fit page", "fitPage")} onClick={onFitPage} className="hidden sm:inline-flex">
              <Maximize className="size-4" />
            </IconButton>
          </>
        )}
      </div>
    </footer>
  );
}

export { STEPS as ZOOM_STEPS };
