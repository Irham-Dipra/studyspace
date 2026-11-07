import { useEffect, useState } from "react";
import { ArrowUp, Bot, Database, Folder, FolderPlus, Loader2, LogOut, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { NOTE_COLORS, isHex, loadNoteColors, saveNoteColors, type NoteColor, type NoteColorMap } from "../lib/noteColors";
import type { AppConfigInfo, Directory } from "../lib/types";
import { Button, Field, IconButton, Modal, cx, inputCls } from "./ui";

interface Props {
  directories: Directory[];
  config: AppConfigInfo | null;
  onClose: () => void;
  onChanged: (message?: string) => void;
  onError: (message: string) => void;
}

/** What the hide box accepts, shown under it. */
function HideHelp() {
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
      Comma-separated. A name hides that folder or file anywhere (<code>Offllines</code>, <code>*.md</code>); with a <code>/</code> it is a path from
      this folder (<code>CSE 301/*.md</code>, <code>Old/**</code>); a leading <code>/</code> means this folder only (<code>/*.html</code>).{" "}
      <code>*</code> is anything within a folder, <code>**</code> crosses folders, <code>?</code> is one letter. <code>re:</code> starts a regular
      expression on the path (<code>{"re:\\(old\\)\\.pdf$"}</code>). Hidden files keep their notes and come back when the rule goes.
    </p>
  );
}

const splitExcludes = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function SettingsDialog({ directories, config, onClose, onChanged, onError }: Props) {
  const [path, setPath] = useState("");
  const [excludes, setExcludes] = useState("");
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState<Awaited<ReturnType<typeof api.browse>> | null>(null);

  // Another device (a phone) may read the library but not change its folders.
  const local = config?.local !== false;
  const browse = (p?: string) => api.browse(p).then(setBrowser, (e: Error) => onError(e.message));
  useEffect(() => {
    if (directories.length === 0 && local) void browse();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      window.location.reload();
    }
  };

  if (!local) {
    return (
      <Modal title="Settings" onClose={onClose}>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Library folders</h3>
          <ul className="space-y-1 text-sm">
            {directories.map((d) => (
              <li key={d.id} className={cx("flex items-center gap-2", !d.enabled && "opacity-60")}>
                <Folder className="size-4 shrink-0 text-ink-3" />
                <span className="truncate">{d.label}</span>
                {!d.enabled && <span className="text-xs text-ink-3">(off)</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Folders can be added or changed on the computer itself.</p>
        </section>
        <NoteColorsSection />
        <section className="mt-5 border-t border-line pt-4">
          <Button onClick={() => void logout()}>
            <LogOut className="size-4" /> Log out of this device
          </Button>
        </section>
      </Modal>
    );
  }

  const add = async () => {
    if (!path.trim()) return;
    setBusy(true);
    try {
      const r = await api.addDirectory({ path: path.trim(), excludes: splitExcludes(excludes) });
      setPath("");
      setExcludes("");
      setBrowser(null);
      onChanged(`Added ${r.directory.label}: ${r.scan.scanned} files found`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Library folders</h3>
        <p className="mb-3 text-xs text-ink-3">
          StudySpace reads PDFs directly from these folders (and their subfolders). Files are never copied. Folders and files you hide are left out of the list.
        </p>
        <ul className="space-y-2">
          {directories.map((d) => (
            <DirectoryRow key={d.id} dir={d} onChanged={onChanged} onError={onError} />
          ))}
          {directories.length === 0 && <li className="text-sm text-ink-3">No folders configured yet.</li>}
        </ul>

        <div className="mt-4 rounded-lg border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Field label="Add folder">
              <input className={inputCls} placeholder="/home/you/Courses or D:\Courses" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            </Field>
            <Button className="self-end" onClick={() => browse(path || undefined)}>
              <Folder className="size-4" /> Browse
            </Button>
          </div>
          {browser && (
            <div className="mt-2 rounded-md border border-line">
              <div className="flex items-center gap-2 border-b border-line px-2 py-1.5 text-xs">
                <IconButton label="Up" className="size-6" disabled={!browser.parent} onClick={() => browser.parent && browse(browser.parent)}>
                  <ArrowUp className="size-3.5" />
                </IconButton>
                <span className="truncate font-mono text-ink-2" title={browser.path}>{browser.path}</span>
                <Button size="sm" variant="primary" className="ml-auto shrink-0" onClick={() => setPath(browser.path)}>
                  Use this folder
                </Button>
              </div>
              <ul className="ss-scroll max-h-44 overflow-y-auto py-1">
                {browser.dirs.map((d) => (
                  <li key={d.path}>
                    <button className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[13px] hover:bg-hover" onClick={() => browse(d.path)}>
                      <Folder className="size-3.5 text-ink-3" /> {d.name}
                    </button>
                  </li>
                ))}
                {browser.dirs.length === 0 && <li className="px-2.5 py-1 text-xs text-ink-3">No subfolders</li>}
              </ul>
              {browser.pdfCount > 0 && <p className="border-t border-line px-2.5 py-1 text-[11px] text-ink-3">{browser.pdfCount} PDFs, slides, HTML or Markdown files directly in this folder</p>}
            </div>
          )}
          <div className="mt-2">
            <Field label="Hide folders and files (optional)">
              <input className={inputCls} placeholder="Offllines, Old/Drafts, *.md" value={excludes} onChange={(e) => setExcludes(e.target.value)} />
            </Field>
            <HideHelp />
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={add} disabled={busy || !path.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />} Add &amp; scan
            </Button>
          </div>
        </div>
      </section>

      <NoteColorsSection />

      {config && (
        <section className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-subtle p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><Database className="size-3.5" /> Data</div>
            {config.databasePath && <p className="break-all font-mono text-ink-2">{config.databasePath}</p>}
            <p className="mt-1 text-ink-3">
              The last {config.historyLimit} file edit{config.historyLimit === 1 ? "" : "s"} per PDF can be undone; their previous versions are kept in the
              <span className="font-mono"> history</span> folder next to the database.
            </p>
          </div>
          <div className="rounded-lg bg-subtle p-3 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><Bot className="size-3.5" /> AI provider</div>
            <p className={cx(config.ai.enabled ? "text-emerald-600" : "text-ink-2")}>{config.ai.enabled ? `Enabled (${config.ai.provider})` : "Disabled — fully offline"}</p>
            {!config.ai.enabled && <p className="mt-1 text-ink-3">{config.ai.message}</p>}
          </div>
        </section>
      )}
    </Modal>
  );
}

function DirectoryRow({ dir, onChanged, onError }: { dir: Directory; onChanged: (m?: string) => void; onError: (m: string) => void }) {
  const [label, setLabel] = useState(dir.label);
  const [excludes, setExcludes] = useState(dir.excludes.join(", "));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const dirty = label !== dir.label || excludes !== dir.excludes.join(", ");

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    try {
      const said = await fn();
      onChanged(typeof said === "string" ? `${msg}: ${said}` : msg);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const before = dir.excludes.join(", ");
      const r = await api.updateDirectory(dir.id, { label, excludes: splitExcludes(excludes) });
      return excludes !== before && r.scan.missing ? `${r.scan.missing} file${r.scan.missing === 1 ? "" : "s"} hidden` : undefined;
    }, "Folder updated");

  return (
    <li className={cx("rounded-lg border border-line p-3", !dir.enabled && "opacity-60")}>
      <div className="flex items-center gap-2">
        <input className={cx(inputCls, "h-7 max-w-48 font-medium")} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label" />
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={dir.enabled} onChange={(e) => run(() => api.updateDirectory(dir.id, { enabled: e.target.checked }))} />
          Enabled
        </label>
        <IconButton label="Remove folder" className="size-7 hover:text-danger" onClick={() => setConfirm(true)}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <p className="mt-1 break-all font-mono text-[11px] text-ink-3">{dir.path}</p>
      <label className="mt-2 block text-[11px] font-medium text-ink-2" htmlFor={`hide-${dir.id}`}>Hide folders and files</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`hide-${dir.id}`}
          className={cx(inputCls, "h-7 font-mono text-xs")}
          placeholder="Offllines, Old/Drafts, *.md"
          value={excludes}
          onChange={(e) => setExcludes(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dirty && !busy && save()}
          onFocus={() => setHelp(true)}
        />
        {dirty && (
          <Button size="sm" variant="primary" disabled={busy} onClick={save}>
            Save
          </Button>
        )}
      </div>
      {help && <HideHelp />}
      {confirm && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-subtle px-2 py-1.5 text-xs">
          <span className="flex-1">Remove from library? Files stay on disk; notes are kept and return if you add it again.</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => run(() => api.deleteDirectory(dir.id), "Folder removed")}>Remove</Button>
        </div>
      )}
    </li>
  );
}

function NoteColorsSection() {
  const [colors, setColors] = useState<NoteColorMap>(loadNoteColors);
  const set = (id: string, value: string | null) => {
    const next = { ...colors };
    if (value === null) delete next[id];
    else next[id] = value.toLowerCase();
    setColors(next);
    saveNoteColors(next);
  };
  const changed = Object.keys(colors).length > 0;

  return (
    <section className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Note colours</h3>
        {changed && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setColors({}); saveNoteColors({}); }}>
            <RotateCcw className="size-3.5" /> Reset all
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-3">The highlighter colours notes get on their own. Saved in this browser only.</p>
      <ul className="space-y-1.5">
        {NOTE_COLORS.map((c) => (
          <ColorRow key={c.id} color={c} value={colors[c.id]} onChange={(v) => set(c.id, v)} />
        ))}
      </ul>
    </section>
  );
}

/** The sample uses the real note styles, so it shows the colour as notes will. */
function Sample({ id, text }: { id: string; text: string }) {
  if (id === "title") return <span className="ss-title-hl text-sm font-semibold">{text}</span>;
  if (id === "mark") return <mark className="ss-pdf-hl">{text}</mark>;
  const attrs =
    id === "lead" ? { "data-lead": "1" } : id === "group" ? { "data-group": "" } : { "data-level": id.slice(1) };
  return <span {...attrs}>{text}</span>;
}

function ColorRow({ color, value, onChange }: { color: NoteColor; value?: string; onChange: (v: string | null) => void }) {
  const current = value ?? color.default;
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current]);

  const typed = (text: string) => {
    setDraft(text);
    const hex = text.startsWith("#") ? text : `#${text}`;
    if (isHex(hex)) onChange(hex);
  };

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_1fr_auto]">
      <span className="text-xs text-ink-2">{color.label}</span>
      <div className="ss-md order-3 col-span-2 truncate sm:order-none sm:col-span-1">
        <Sample id={color.id} text={color.sample} />
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          className="h-7 w-9 cursor-pointer rounded border border-line bg-panel p-0.5"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${color.label} colour`}
        />
        <input
          className={cx(inputCls, "h-7 w-[5.5rem] font-mono text-xs")}
          value={draft}
          onChange={(e) => typed(e.target.value.trim())}
          onBlur={() => setDraft(current)}
          aria-label={`${color.label} hex code`}
          spellCheck={false}
        />
        <IconButton
          label="Back to the default colour"
          className={cx("size-7", !value && "invisible")}
          onClick={() => onChange(null)}
        >
          <RotateCcw className="size-3.5" />
        </IconButton>
      </div>
    </li>
  );
}
