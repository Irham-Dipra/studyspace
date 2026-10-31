import { useEffect, useRef, useState } from "react";
import { pictureSrc } from "../lib/notePictures";
import { isTyping, matches, type ShortcutId } from "../lib/shortcuts";
import type { Resource, ResourceScope } from "../lib/types";
import { Button, KeyHint, Modal, NumberInput, cx, inputCls } from "./ui";

interface Props {
  picture: Resource;
  /** The page being read, offered as "this page". */
  page: number;
  pageCount: number;
  onSave: (scope: ResourceScope, pageStart: number | null, pageEnd: number | null) => void;
  onRemove: () => void;
  onClose: () => void;
}

const CHOICES: { id: ResourceScope; label: string; key: ShortcutId }[] = [
  { id: "page", label: "One page", key: "pwThis" },
  { id: "range", label: "Pages from … to …", key: "pwRange" },
  { id: "document", label: "Whole PDF", key: "pwAll" },
];

/** Which pages a picture belongs to (one, a range, the whole PDF), or remove it. */
export function PicturePagesDialog({ picture, page, pageCount, onSave, onRemove, onClose }: Props) {
  const [scope, setScope] = useState<ResourceScope>(picture.scope);
  const [start, setStart] = useState(picture.pageStart ?? page);
  const [end, setEnd] = useState(picture.pageEnd ?? page);
  const max = pageCount || undefined;
  const bad = scope !== "document" && (start < 1 || (max !== undefined && start > max) || (scope === "range" && (end < 1 || (max !== undefined && end > max))));

  const save = () => {
    if (bad) return;
    if (scope === "document") onSave("document", null, null);
    else if (scope === "page") onSave("page", start, start);
    else onSave("range", Math.min(start, end), Math.max(start, end));
  };

  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const is = (id: ShortcutId) => matches(e, id);
    const onButton = document.activeElement instanceof HTMLButtonElement;
    // Enter saves from the page boxes too; the digits and Delete would be typing there.
    if (is("pwSave") && !onButton) {
      e.preventDefault();
      return save();
    }
    if (isTyping(e)) return;
    if (is("pwThis")) setScope("page");
    else if (is("pwRange")) setScope("range");
    else if (is("pwAll")) setScope("document");
    else if (is("pwRemove")) onRemove();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const src = pictureSrc(picture);
  return (
    <Modal
      title="Pages of this picture"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-danger" onClick={onRemove}>
            Remove picture <KeyHint id="pwRemove" />
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={bad}>
            Save <KeyHint id="pwSave" className="border-white/40 bg-white/10 text-white/80" />
          </Button>
        </>
      }
    >
      {src && <img src={src} alt="" className="mb-3 max-h-32 rounded border border-line object-contain" />}
      <div className="flex flex-col gap-1.5 text-sm">
        {CHOICES.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2">
            <input type="radio" name="picture-scope" checked={scope === c.id} onChange={() => setScope(c.id)} />
            {c.label} <KeyHint id={c.key} />
          </label>
        ))}
      </div>
      {scope !== "document" && (
        <div className="mt-3 flex items-center gap-2 text-sm text-ink-2">
          <span>{scope === "page" ? "Page" : "From"}</span>
          <NumberInput aria-label={scope === "page" ? "Page" : "First page"} min={1} max={max} className={cx(inputCls, "h-8 w-20")} value={start} onChange={setStart} />
          {scope === "range" && (
            <>
              <span>to</span>
              <NumberInput aria-label="Last page" min={1} max={max} className={cx(inputCls, "h-8 w-20")} value={end} onChange={setEnd} />
            </>
          )}
          {pageCount > 0 && <span className="text-ink-3">of {pageCount}</span>}
        </div>
      )}
    </Modal>
  );
}
