import type { ReactNode } from "react";
import { CircleHelp, Library, Menu, Moon, RectangleHorizontal, Settings, StickyNote, Sun, X } from "lucide-react";
import { cx } from "./ui";
import type { Tool } from "./viewer/geometry";

/** A tool as the quick buttons and their picker show it. */
export interface QuickTool {
  id: Tool;
  /** One or two words. */
  name: string;
  icon: (p: { className?: string }) => ReactNode;
}

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
  /** The tools this file has (none on the start screen), the one that is on, and those kept on the page. */
  tools: QuickTool[];
  tool: Tool;
  onTool: (t: Tool) => void;
  pins: Tool[];
  onPins: (pins: Tool[]) => void;
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
  const quick = p.tools.filter((t) => p.pins.includes(t.id));
  return (
    <>
      {/* Quick tools: small and see-through, so the page under them can still be read. */}
      {!p.open && quick.length > 0 && (
        <div className="absolute right-1.5 top-14 z-20 flex flex-col gap-1">
          {quick.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => p.onTool(t.id)}
              aria-label={t.name}
              aria-pressed={p.tool === t.id}
              className={cx(
                "flex size-8 items-center justify-center rounded-full border shadow-sm",
                p.tool === t.id ? "border-accent bg-accent-soft/80 text-accent opacity-90" : "border-line bg-panel/60 text-ink opacity-50 active:opacity-100",
              )}
            >
              <t.icon className="size-4" />
            </button>
          ))}
        </div>
      )}
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
        {p.tools.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-2">
            <span className="w-full text-[11px] text-ink-3">Quick buttons kept on the page (tap to add or remove):</span>
            {p.tools.map((t) => {
              const on = p.pins.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${t.name}: ${on ? "on the page" : "only in this menu"}`}
                  onClick={() => p.onPins(on ? p.pins.filter((x) => x !== t.id) : [...p.pins, t.id])}
                  className={cx("flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs", on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2")}
                >
                  <t.icon className="size-3.5" />
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
