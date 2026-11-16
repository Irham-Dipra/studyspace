import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  Combine,
  Copy,
  Crop,
  Eraser,
  FileMinus2,
  FileOutput,
  FilePlus2,
  FileText,
  Files,
  Highlighter,
  Images,
  Loader2,
  MapPin,
  MousePointer2,
  PenLine,
  Redo2,
  Replace,
  RotateCw,
  Save,
  ScanText,
  Scissors,
  SquareDashed,
  SquareSplitVertical,
  Trash2,
  Type,
  Undo2,
  Wrench,
} from "lucide-react";
import { HIGHLIGHT_COLORS, PEN_COLORS, TEXT_SIZES, type Tool } from "./geometry";
import type { TextPreset } from "../GetTextDialog";
import { isTyping, keyOf, matches, withKey, type ShortcutId } from "../../lib/shortcuts";
import { IconButton, Kbd, KeyHint, cx } from "../ui";
import { canEditFile, isPaged, type DocumentKind } from "../../lib/types";

interface Props {
  /** Collapsed to nothing, but still mounted: it owns the tool, colour and Page tools keys. */
  hidden?: boolean;
  /** Phones: the bar wraps onto more lines instead of scrolling sideways. */
  wrap?: boolean;
  tool: Tool;
  onTool: (t: Tool) => void;
  color: string;
  onColor: (c: string) => void;
  penWidth: number;
  onPenWidth: (w: number) => void;
  /** Font size for new text boxes (one of TEXT_SIZES). */
  textSize: number;
  onTextSize: (s: number) => void;
  dirty: boolean;
  /**
   * Slides can't be edited, so page edits and OCR are left out. HTML and Markdown have no pages, so
   * they get only the text tools (select, highlight).
   */
  kind: DocumentKind;
  annotationCount: number;
  saving: boolean;
  onSaveToFile: () => void;
  onInsertBlank: () => void;
  onInsertFrom: () => void;
  onReplace: () => void;
  onGetText: (preset: TextPreset) => void;
  onDeletePage: () => void;
  onDeletePages: () => void;
  onRotate: () => void;
  onMove: () => void;
  onExtract: () => void;
  onSplit: () => void;
  onMerge: () => void;
  onCopyPage: () => void;
  onHalves: () => void;
  onSavePictures: () => void;
  onSnip: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undoing: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export const TOOLS: { id: Tool; label: string; icon: typeof Highlighter }[] = [
  { id: "select", label: "Select text", icon: MousePointer2 },
  { id: "highlight", label: "Highlight text", icon: Highlighter },
  { id: "area", label: "Highlight area: right-click (two-finger tap) two corners, or drag", icon: SquareDashed },
  { id: "pen", label: "Draw", icon: PenLine },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "ocr", label: "Get text from a region: right-click (two-finger tap) two corners, or drag", icon: ScanText },
  { id: "text", label: "Text box: click (or drag its width) and type", icon: Type },
  { id: "marker", label: "Note marker: click a spot, then write its note", icon: MapPin },
];

const TEXT_SIZE_LABELS = ["Small", "Medium", "Large"];

/** The tools for text that flows (HTML, Markdown): the others draw on pages. */
export const TEXT_TOOLS = new Set<Tool>(["select", "highlight"]);

const PEN_WIDTHS = [
  { w: 0.0015, label: "Fine" },
  { w: 0.003, label: "Medium" },
  { w: 0.006, label: "Bold" },
];

/** Keys the open menu keeps for itself; any other key closes it (and may run that item's shortcut). */
const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "Tab", "Enter", " ", "Shift", "Control", "Alt", "Meta"]);

export function ViewerToolbar(p: Props) {
  // The toolbar scrolls horizontally, which would clip an absolutely positioned dropdown,
  // so the menu is placed in viewport coordinates under its button.
  const [menu, setMenu] = useState<{ top: number; right: number; byKey: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const openMenu = (byKey: boolean) => {
    const r = menuButton.current?.getBoundingClientRect();
    if (!r) return;
    setMenu((m) => (m ? null : { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right), byKey }));
  };
  useEffect(() => {
    if (!menu) return;
    if (menu.byKey) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && !menuButton.current?.contains(e.target as Node) && setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenu(null);
        menuButton.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : items.length - 1 + (i < 0 ? 1 : 0))) % items.length;
        items[next]?.focus();
      } else if (!MENU_KEYS.has(e.key)) {
        setMenu(null); // the app's shortcut for this key (if any) still runs
      }
    };
    // The menu is placed from the button's position, so it closes when the window gets wider or
    // narrower. Not on height changes: a phone's address bar and keyboard change only the height.
    let width = window.innerWidth;
    const dismiss = () => {
      if (window.innerWidth !== width) setMenu(null);
      width = window.innerWidth;
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [menu]);

  const editable = canEditFile(p.kind);
  const paged = isPaged(p.kind);
  const tools = paged ? TOOLS : TOOLS.filter((t) => TEXT_TOOLS.has(t.id));
  const colors = p.tool === "pen" || p.tool === "text" ? PEN_COLORS : HIGHLIGHT_COLORS;
  const showColors = p.tool === "highlight" || p.tool === "area" || p.tool === "pen" || p.tool === "text";

  // Tool keys, colours (1–5), pen widths (Shift+1–3) and the Page tools menu (T).
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e) || document.querySelector('[role="dialog"]')) return;
    if (e.key === "Escape") return p.onTool("select");
    const tool = tools.find((t) => matches(e, t.id));
    if (tool) return p.onTool(tool.id);
    if (paged && matches(e, "pageTools")) {
      e.preventDefault();
      return openMenu(true);
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !/^Digit[1-9]$/.test(e.code)) return;
    const n = Number(e.code.slice(5)) - 1;
    if (!e.shiftKey && showColors && colors[n]) p.onColor(colors[n]);
    else if (e.shiftKey && p.tool === "pen" && PEN_WIDTHS[n]) p.onPenWidth(PEN_WIDTHS[n].w);
    else if (e.shiftKey && p.tool === "text" && TEXT_SIZES[n]) p.onTextSize(TEXT_SIZES[n]);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const item = (id: ShortcutId, icon: React.ReactNode, label: string, run: () => void, danger?: boolean) => (
    <button
      role="menuitem"
      className={cx(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-hover focus-visible:bg-hover",
        danger ? "text-danger" : "text-ink",
      )}
      onClick={() => {
        setMenu(null);
        run();
      }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      <KeyHint id={id} />
    </button>
  );
  const heading = (title: string, hint?: string) => (
    <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
      {title}
      {hint && <span className="ml-1 font-normal normal-case tracking-normal">· {hint}</span>}
    </p>
  );
  const ic = "size-4 shrink-0 text-ink-3";

  return (
    <div className={cx("flex shrink-0 items-center gap-1 bg-panel px-2", p.wrap ? "flex-wrap gap-y-1.5 border-t border-line py-2" : "overflow-x-auto", p.hidden ? "h-0 overflow-y-hidden" : !p.wrap && "h-11 border-b border-line")} aria-hidden={p.hidden || undefined}>
      <IconButton label={withKey(p.undoLabel ? `Undo: ${p.undoLabel}` : "Nothing to undo", "undo")} disabled={!p.canUndo} onClick={p.onUndo}>
        {p.undoing ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
      </IconButton>
      <IconButton label={withKey(p.redoLabel ? `Redo: ${p.redoLabel}` : "Nothing to redo", "redo")} disabled={!p.canRedo} onClick={p.onRedo}>
        <Redo2 className="size-4" />
      </IconButton>
      <div className="mx-1 h-5 w-px shrink-0 bg-line" />
      {tools.map((t) => (
        <IconButton key={t.id} label={withKey(t.label, t.id)} active={p.tool === t.id} onClick={() => p.onTool(t.id)}>
          <t.icon className="size-4" />
        </IconButton>
      ))}
      {showColors && (
        <>
          <div className="mx-1 h-5 w-px shrink-0 bg-line" />
          {colors.map((c, i) => (
            <button
              key={c}
              aria-label={`Colour ${i + 1}`}
              title={`Colour ${i + 1} (${i + 1})`}
              onClick={() => p.onColor(c)}
              className={cx("size-5 shrink-0 rounded-full border transition", p.color === c ? "scale-110 border-ink ring-2 ring-accent/40" : "border-black/10 hover:scale-110")}
              style={{ background: c }}
            />
          ))}
        </>
      )}
      {p.tool === "pen" && (
        <>
          <div className="mx-1 h-5 w-px shrink-0 bg-line" />
          {PEN_WIDTHS.map((w, i) => (
            <button
              key={w.w}
              title={`${w.label} (Shift+${i + 1})`}
              aria-label={`${w.label} pen`}
              onClick={() => p.onPenWidth(w.w)}
              className={cx("grid size-7 shrink-0 place-items-center rounded-md", p.penWidth === w.w ? "bg-accent-soft" : "hover:bg-hover")}
            >
              <span className="rounded-full bg-ink" style={{ width: 4 + w.w * 1600, height: 4 + w.w * 1600 }} />
            </button>
          ))}
        </>
      )}

      {p.tool === "text" && (
        <>
          <div className="mx-1 h-5 w-px shrink-0 bg-line" />
          {TEXT_SIZES.map((s, i) => (
            <button
              key={s}
              title={`${TEXT_SIZE_LABELS[i]} text (Shift+${i + 1})`}
              aria-label={`${TEXT_SIZE_LABELS[i]} text`}
              onClick={() => p.onTextSize(s)}
              className={cx("grid size-7 shrink-0 place-items-center rounded-md font-semibold text-ink", p.textSize === s ? "bg-accent-soft" : "hover:bg-hover")}
              style={{ fontSize: 10 + i * 3 }}
            >
              A
            </button>
          ))}
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {(p.dirty || p.saving) && (
          <button
            onClick={p.onSaveToFile}
            disabled={p.saving}
            className="flex h-8 items-center gap-1.5 rounded-md bg-warn/15 px-2.5 text-xs font-medium text-warn hover:bg-warn/25 disabled:opacity-60"
            title={withKey("Write highlights, drawings and bookmarks into the PDF file itself", "save")}
          >
            {p.saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            <span className="hidden sm:inline">Save to PDF</span>
            <Kbd className="hidden border-warn/30 bg-transparent text-warn lg:inline">{keyOf("save")}</Kbd>
          </button>
        )}
        {editable && !p.dirty && !p.saving && p.annotationCount > 0 && <span className="hidden px-1 text-[11px] text-ink-3 md:inline">Saved in PDF</span>}
        {paged && (
          <IconButton label={withKey("Copy this page as an image", "copyPage")} onClick={p.onCopyPage}>
            <Copy className="size-4" />
          </IconButton>
        )}
        {editable && (
          <IconButton label={withKey("Delete this page", "deletePage")} className="hover:text-danger" onClick={p.onDeletePage}>
            <FileMinus2 className="size-4" />
          </IconButton>
        )}
        {paged && (
          <button
            ref={menuButton}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            title={withKey("Page tools", "pageTools")}
            onClick={() => openMenu(false)}
            className={cx(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium",
              menu ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
            )}
          >
            <Wrench className="size-4" />
            <span className="hidden md:inline">Page tools</span>
            <KeyHint id="pageTools" className="hidden md:inline" />
          </button>
        )}
        {menu && paged && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Page tools"
            className="ss-scroll fixed z-50 max-h-[calc(100dvh-7rem)] w-[min(38rem,calc(100vw-16px))] overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-xl"
            style={{ top: menu.top, right: menu.right }}
          >
            <div className="grid gap-x-2 sm:grid-cols-2">
              <div>
                {!editable ? (
                  <>
                    {heading("Slides")}
                    <p className="px-2 pb-2 text-xs text-ink-3">Slides can't be edited here. Extract pages makes a PDF you can edit.</p>
                  </>
                ) : (
                  <>
                    {heading("Edit this PDF", "Ctrl+Z undoes")}
                    {item("insertBlank", <FilePlus2 className={ic} />, "Insert blank page", p.onInsertBlank)}
                    {item("insertFrom", <Files className={ic} />, "Insert pages from a PDF…", p.onInsertFrom)}
                    {item("replace", <Replace className={ic} />, "Replace this page…", p.onReplace)}
                    {item("turn", <RotateCw className={ic} />, "Turn pages…", p.onRotate)}
                    {item("move", <ArrowDownUp className={ic} />, "Move pages…", p.onMove)}
                    {item("deletePage", <FileMinus2 className="size-4 shrink-0" />, "Delete this page…", p.onDeletePage, true)}
                    {item("deletePages", <Trash2 className="size-4 shrink-0" />, "Delete several pages…", p.onDeletePages, true)}
                  </>
                )}
                {heading("New PDFs", "original unchanged")}
                {item("extract", <FileOutput className={ic} />, "Extract pages…", p.onExtract)}
                {item("split", <Scissors className={ic} />, "Split this PDF…", p.onSplit)}
                {item("merge", <Combine className={ic} />, "Merge PDFs…", p.onMerge)}
              </div>
              <div>
                {heading("Images")}
                {item("snip", <Crop className={ic} />, "Screenshot part of window", p.onSnip)}
                {item("copyPage", <Copy className={ic} />, "Copy page as image", p.onCopyPage)}
                {item("halves", <SquareSplitVertical className={ic} />, "Cut page in half…", p.onHalves)}
                {item("savePictures", <Images className={ic} />, "Save pages as pictures…", p.onSavePictures)}
                {heading("Get text", "PDF's own text")}
                {item("textPage", <FileText className={ic} />, "This page", () => p.onGetText({ mode: "this", method: "text", auto: true }))}
                {item("textPages", <FileText className={ic} />, "Choose pages…", () => p.onGetText({ mode: "range", method: "text" }))}
                {item("textAll", <FileText className={ic} />, "Whole PDF", () => p.onGetText({ mode: "all", method: "text", auto: true }))}
                {item("textSection", <FileText className={ic} />, "A bookmark's section…", () => p.onGetText({ mode: "bookmark", method: "text" }))}
                {editable && (
                  <>
                    {heading("OCR", "for scans")}
                    {item("ocrPage", <ScanText className={ic} />, "This page", () => p.onGetText({ mode: "this", method: "ocr", auto: true }))}
                    {item("ocrPages", <ScanText className={ic} />, "Choose pages…", () => p.onGetText({ mode: "range", method: "ocr" }))}
                    {item("ocrAll", <ScanText className={ic} />, "Whole PDF…", () => p.onGetText({ mode: "all", method: "ocr" }))}
                    {item("ocrSection", <ScanText className={ic} />, "A bookmark's section…", () => p.onGetText({ mode: "bookmark", method: "ocr" }))}
                  </>
                )}
              </div>
            </div>
            <p className="mt-1 border-t border-line px-2 pb-0.5 pt-1.5 text-[11px] leading-snug text-ink-3">
              Edits rewrite this PDF on disk; Ctrl+Z restores it. New PDFs are saved in your library. Press the key shown to run an item.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
