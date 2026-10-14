import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { GROUP_ORDER, SHORTCUTS, formatCombo, type Shortcut } from "../lib/shortcuts";
import { Kbd, Modal } from "./ui";

/** Every shortcut, straight from the registry in lib/shortcuts.ts, grouped and searchable. */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(SHORTCUTS) as Shortcut[];
    return GROUP_ORDER.map((title) => ({
      title,
      items: all.filter(
        (s) => s.group === title && (!q || s.label.toLowerCase().includes(q) || title.toLowerCase().includes(q) || s.keys.some((k) => formatCombo(k).toLowerCase() === q)),
      ),
    })).filter((g) => g.items.length);
  }, [query]);

  return (
    <Modal title="Keyboard shortcuts & tips" onClose={onClose} wide>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input
          autoFocus
          className="h-9 w-full rounded-md border border-line bg-subtle pl-8 pr-3 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
          placeholder="Find a shortcut: “split”, “bookmark”, “Shift+R”…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="ss-scroll -mr-2 max-h-[60vh] overflow-y-auto pr-2">
        <div className="columns-1 gap-6 sm:columns-2">
          {groups.map((g) => (
            <section key={g.title} className="mb-5 break-inside-avoid">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{g.title}</h3>
              <dl className="space-y-1">
                {g.items.map((s) => (
                  <div key={s.label} className="flex items-baseline gap-3 text-[13px]">
                    <dt className="flex w-32 shrink-0 flex-wrap gap-1">
                      {s.keys.map((k) => (
                        <Kbd key={k} className="text-[11px] text-ink">
                          {formatCombo(k)}
                        </Kbd>
                      ))}
                    </dt>
                    <dd className="text-ink-2">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {groups.length === 0 && <p className="text-sm text-ink-3">No shortcut matches “{query}”.</p>}
        </div>
      </div>
      <div className="mt-4 space-y-1.5 rounded-lg bg-subtle p-3 text-xs leading-relaxed text-ink-2">
        <p>
          <b className="text-ink">Keys are shown beside every feature:</b> in the Page tools menu, on buttons, and in tooltips. Shortcuts don't fire
          while you're typing in a text box, or while a dialog is open (dialogs have their own keys).
        </p>
        <p>
          <b className="text-ink">Notes follow their pages</b> through page edits, and <b className="text-ink">everything can be undone</b> with Ctrl+Z,
          including page edits and Save to PDF. The full guide is in <span className="font-mono">docs/USER_GUIDE.md</span>.
        </p>
      </div>
    </Modal>
  );
}
