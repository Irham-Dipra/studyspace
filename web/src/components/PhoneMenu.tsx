import type { ReactNode } from "react";
import { CircleHelp, Library, Menu, Moon, RectangleHorizontal, Settings, StickyNote, Sun, X } from "lucide-react";
import { cx } from "./ui";

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The open file's name (none on the start screen). */
  title: string | null;
  dark: boolean;
  fullscreen: boolean;
  /** Shown beside the menu button while a tool other than Select is on; a tap goes back to Select. */
  toolChip: { label: string; color: string | null } | null;
  onToolOff: () => void;
  onFiles: () => void;
  onNotes: (() => void) | null;
  onLandscape: () => void;
  onTheme: () => void;
  onHelp: () => void;
  onSettings: () => void;
  search: ReactNode;
  /** The tools bar and the page bar themselves: they stay mounted while the menu is closed (their keys). */
  children: ReactNode;
}

/**
 * Phones: the page gets the whole screen, and everything the bars held opens from one button in the
 * corner. No transform or blur on the sheet: the Page tools menu and the search box inside it are
 * `position: fixed`, which those would trap.
 */
export function PhoneMenu(p: Props) {
  const action = (icon: ReactNode, label: string, run: () => void, active?: boolean) => (
    <button
      type="button"
      onClick={run}
      className={cx("flex h-12 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px]", active ? "bg-accent-soft text-accent" : "text-ink-2 active:bg-hover")}
    >
      {icon}
      {label}
    </button>
  );
  const ic = "size-5";
  return (
    <>
      {!p.open && (
        <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1.5">
          {p.toolChip && (
            <button
              type="button"
              onClick={p.onToolOff}
              aria-label={`${p.toolChip.label} is on. Back to Select`}
              className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-panel/90 pl-2.5 pr-2 text-xs font-medium text-ink shadow"
            >
              {p.toolChip.color && <span className="size-3 rounded-full border border-black/10" style={{ background: p.toolChip.color }} />}
              {p.toolChip.label}
              <X className="size-3.5 text-ink-3" />
            </button>
          )}
          <button
            type="button"
            onClick={p.onOpen}
            aria-label="Menu"
            className="flex size-10 items-center justify-center rounded-full border border-line bg-panel/80 text-ink shadow opacity-70 active:opacity-100"
          >
            <Menu className="size-5" />
          </button>
        </div>
      )}
      {p.open && <div className="absolute inset-0 z-30 bg-black/30" onClick={p.onClose} />}
      <div
        role="region"
        aria-label="Menu"
        onKeyDown={(e) => e.key === "Escape" && p.onClose()}
        className={cx("ss-scroll absolute inset-x-0 top-0 z-40 max-h-full overflow-y-auto border-b border-line bg-panel shadow-2xl", !p.open && "hidden")}
      >
        <div className="flex items-center gap-2 py-1 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-2">{p.title ?? "StudySpace"}</span>
          {p.search}
          <button type="button" onClick={p.onClose} aria-label="Close the menu" className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink active:bg-hover">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
          {action(<Library className={ic} />, "Files", p.onFiles)}
          {p.onNotes && action(<StickyNote className={ic} />, "Notes", p.onNotes)}
          {action(<RectangleHorizontal className={ic} />, p.fullscreen ? "Upright" : "Sideways", p.onLandscape, p.fullscreen)}
          {action(p.dark ? <Sun className={ic} /> : <Moon className={ic} />, p.dark ? "Light" : "Dark", p.onTheme)}
          {action(<CircleHelp className={ic} />, "Help", p.onHelp)}
          {action(<Settings className={ic} />, "Settings", p.onSettings)}
        </div>
        {p.children}
      </div>
    </>
  );
}
