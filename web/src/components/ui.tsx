import { useEffect, useRef, useState, type ButtonHTMLAttributes, type Ref, type FocusEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";
import { keyOf, type ShortcutId } from "../lib/shortcuts";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        variant === "secondary" && "border border-line bg-panel text-ink hover:bg-hover",
        variant === "ghost" && "text-ink-2 hover:bg-hover hover:text-ink",
        variant === "danger" && "bg-danger text-white hover:brightness-110",
        className,
      )}
    />
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={rest.title ?? label}
      aria-pressed={active}
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Subscribed once: re-subscribing whenever the parent re-renders could drop an Esc press (another
  // Esc handler, e.g. the toolbar's, can re-render the app mid-event and detach this listener).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("w-full rounded-xl border border-line bg-panel shadow-2xl", wide ? "max-w-2xl" : "max-w-md")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export const inputCls =
  "h-8 w-full rounded-md border border-line bg-panel px-2.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Clicking into a field selects its contents, so typing replaces the old value. */
export function selectAllOnFocus(e: FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  // Deferred so the click that focused the field doesn't immediately collapse the selection.
  requestAnimationFrame(() => document.activeElement === el && el.select());
}

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "type"> & {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  ref?: Ref<HTMLInputElement>;
};

/**
 * Integer field that can be cleared while typing (a plain controlled number input snaps back to the
 * minimum as soon as it is empty). Valid numbers are reported clamped to [min, max] as you type;
 * the text is tidied up when the field loses focus.
 */
export function NumberInput({ value, onChange, min = -Infinity, max = Infinity, onBlur, onFocus, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  // Follow outside changes (e.g. "From" pulling "To" along), but not while the user is typing.
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      {...rest}
      value={draft}
      onFocus={(e) => {
        focused.current = true;
        selectAllOnFocus(e);
        onFocus?.(e);
      }}
      onChange={(e) => {
        const text = e.target.value.replace(/\D/g, "");
        setDraft(text);
        if (text) onChange(clamp(Number.parseInt(text, 10)));
      }}
      onBlur={(e) => {
        focused.current = false;
        const n = draft ? clamp(Number.parseInt(draft, 10)) : value;
        setDraft(String(n));
        if (n !== value) onChange(n);
        onBlur?.(e);
      }}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export interface ToastMsg {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

export function Toasts({ toasts, onDismiss }: { toasts: ToastMsg[]; onDismiss: (id: number) => void }) {
  return (
    <div data-snap-ignore className="pointer-events-none fixed bottom-14 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cx(
            "pointer-events-auto flex max-w-[90vw] items-center gap-3 rounded-lg px-3.5 py-2 text-sm shadow-lg",
            t.kind === "error" ? "bg-danger text-white" : t.kind === "success" ? "bg-emerald-600 text-white" : "bg-ink text-canvas",
          )}
        >
          <span>{t.text}</span>
          <button className="opacity-70 hover:opacity-100" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A key or key combination as shown beside a feature. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx("whitespace-nowrap rounded border border-line bg-subtle px-1 py-px font-mono text-[10px] font-normal leading-none text-ink-3", className)}>
      {children}
    </kbd>
  );
}

/** The key of a shortcut from the registry (lib/shortcuts.ts). */
export function KeyHint({ id, className }: { id: ShortcutId; className?: string }) {
  return <Kbd className={className}>{keyOf(id)}</Kbd>;
}
