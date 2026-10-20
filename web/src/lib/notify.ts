/**
 * Lets code outside App show a toast (e.g. a copy button deep in a menu). App registers its toast
 * function here once.
 */
export type NotifyKind = "info" | "success" | "error";

let notifier: ((text: string, kind: NotifyKind) => void) | null = null;

export function setNotifier(fn: ((text: string, kind: NotifyKind) => void) | null): void {
  notifier = fn;
}

export function notify(text: string, kind: NotifyKind = "info"): void {
  notifier?.(text, kind);
}
