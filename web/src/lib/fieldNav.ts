/**
 * Keyboard moves between text fields: in a dialog or form, ↓ jumps to the next *empty* field (or
 * simply the next one when all are filled) and ↑ goes back to the previous field. One listener
 * for the whole app, installed once.
 *
 * Starts only from one-line text fields (in a multi-line box ↑/↓ move between lines). A field can
 * opt out with `data-arrow-nav="off"` (e.g. a search box whose ↑/↓ pick a suggestion). Fields are
 * looked for in the nearest dialog, form or `[data-field-group]` only, never across the whole app.
 */

const TEXT_TYPES = new Set(["", "text", "search", "url", "email", "tel", "number", "password"]);
const TARGETS =
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])';

const isTextField = (el: Element | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && TEXT_TYPES.has(el.getAttribute("type") ?? "") && !el.disabled && !el.readOnly;

const visible = (el: HTMLElement) => el.offsetParent !== null || el.getClientRects().length > 0;

function onKeyDown(e: KeyboardEvent) {
  if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || e.defaultPrevented) return;
  const el = e.target as Element | null;
  if (!isTextField(el) || el.closest('[data-arrow-nav="off"]') || el.getAttribute("role") === "combobox" || el.list) return;
  const group = el.closest('[role="dialog"], form, [data-field-group]');
  if (!group) return;
  const fields = [...group.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TARGETS)].filter(
    (f) => visible(f) && !f.closest('[data-arrow-nav="off"]') && (f instanceof HTMLTextAreaElement || TEXT_TYPES.has(f.getAttribute("type") ?? "")),
  );
  const i = fields.indexOf(el);
  if (i < 0) return;
  const next = e.key === "ArrowDown" ? (fields.slice(i + 1).find((f) => !f.value.trim()) ?? fields[i + 1]) : fields[i - 1];
  if (!next) return;
  e.preventDefault();
  next.focus();
  // Put the caret at the end (fields that select everything on focus keep doing so).
  if (next instanceof HTMLTextAreaElement || TEXT_TYPES.has(next.getAttribute("type") ?? "")) {
    requestAnimationFrame(() => {
      if (document.activeElement !== next || next.selectionStart !== next.selectionEnd) return;
      try {
        next.setSelectionRange(next.value.length, next.value.length);
      } catch {
        /* number inputs don't support selections */
      }
    });
  }
}

let installed = false;

export function installFieldArrowNav(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Capture phase, so this runs first; later handlers see the key as handled (defaultPrevented).
  window.addEventListener("keydown", onKeyDown, true);
}
