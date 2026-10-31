import { ChevronLeft, ChevronRight, Files, ImagePlus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { pictureSrc } from "../lib/notePictures";
import { keyOf, withKey } from "../lib/shortcuts";
import { scopeLabel, type Resource } from "../lib/types";
import { cx } from "./ui";

interface Props {
  /** The pictures for the page being read (its own, ranges that cover it, whole-PDF ones), in show order. */
  pictures: Resource[];
  index: number;
  page: number;
  paged: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Pictures dropped on the slide. */
  onAdd: (file: Blob) => void;
  onPick: () => void;
  /** Opens the "pages of this picture / remove it" window. */
  onWhere: () => void;
  onRemove: (r: Resource) => void;
}

const hasPicture = (e: React.DragEvent) => [...e.dataTransfer.items].some((i) => i.kind === "file" && i.type.startsWith("image/"));

/**
 * The Pictures section: one picture at a time over the whole notes column, nothing else on it. The
 * buttons only show when the pointer is over the slide (always on touch screens).
 */
export function PicturePanel({ pictures, index, page, paged, onIndex, onClose, onAdd, onPick, onWhere, onRemove }: Props) {
  const [tall, setTall] = useState(false);
  const cur = pictures[Math.min(index, pictures.length - 1)];
  const src = cur && pictureSrc(cur);
  const n = pictures.length;
  const at = cur ? pictures.indexOf(cur) : 0;
  const chrome = "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";
  const btn = cx(
    "pointer-events-auto flex size-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
    chrome,
  );

  return (
    <div
      className="group relative h-full min-h-0 w-full bg-neutral-950 text-white"
      onDragOver={(e) => hasPicture(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasPicture(e)) return;
        e.preventDefault();
        for (const f of e.dataTransfer.files) if (f.type.startsWith("image/")) onAdd(f);
      }}
    >
      {src ? (
        <div className={cx("h-full w-full", tall ? "overflow-auto" : "overflow-hidden")}>
          <img
            key={src}
            src={src}
            alt=""
            draggable={false}
            onClick={() => setTall((t) => !t)}
            title={tall ? "Click to fit the whole picture" : "Click to fill the width (scroll to see the rest)"}
            className={cx("block", tall ? "w-full cursor-zoom-out" : "h-full w-full cursor-zoom-in object-contain")}
          />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-sm text-white/60">
          <ImagePlus className="size-8" />
          <p>{paged ? `No pictures for page ${page}.` : "No pictures for this file."}</p>
          <p className="text-xs">
            Paste one (<kbd className="font-sans">{keyOf("pastePicture")}</kbd>), drop one here, or press <kbd className="font-sans">{keyOf("addPicture")}</kbd> to choose a file.
          </p>
        </div>
      )}

      {/* Over the picture, only while the pointer is on it. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-2">
        {cur && (
          <span className={cx("pointer-events-auto rounded-full bg-black/60 px-2.5 py-1 text-xs tabular-nums backdrop-blur", chrome)}>
            {at + 1} / {n}
            {paged && ` · ${scopeLabel(cur).toLowerCase()}`}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          {cur && paged && (
            <button className={btn} onClick={onWhere} title={withKey("Pages of this picture", "pictureWhere")} aria-label="Pages of this picture">
              <Files className="size-4" />
            </button>
          )}
          {cur && (
            <button className={btn} onClick={() => onRemove(cur)} title="Remove this picture (Ctrl+Z brings it back)" aria-label="Remove this picture">
              <Trash2 className="size-4" />
            </button>
          )}
          <button className={btn} onClick={onPick} title={withKey("Add a picture", "addPicture")} aria-label="Add a picture">
            <ImagePlus className="size-4" />
          </button>
          <button className={btn} onClick={onClose} title={withKey("Back to the notes", "viewPictures")} aria-label="Back to the notes">
            <X className="size-4" />
          </button>
        </span>
      </div>

      {n > 1 && (
        <>
          <button
            className={cx(btn, "absolute left-2 top-1/2 -translate-y-1/2")}
            onClick={() => onIndex((at - 1 + n) % n)}
            title={withKey("Previous picture", "picturePrev")}
            aria-label="Previous picture"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            className={cx(btn, "absolute right-2 top-1/2 -translate-y-1/2")}
            onClick={() => onIndex((at + 1) % n)}
            title={withKey("Next picture", "pictureNext")}
            aria-label="Next picture"
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      )}
    </div>
  );
}
