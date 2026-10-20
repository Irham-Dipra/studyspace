/**
 * Keeps several StudySpace tabs in step. When one tab changes something, the others hear about it
 * and re-read it from the server. It covers notes, highlights, PDF rewrites and library settings.
 * Uses BroadcastChannel (same browser, same origin); without it every tab still works on its own.
 */

import { uuid } from "./uuid";

export interface TabChange {
  /** The document that changed, or null for library-wide changes (folders, rescans). */
  docId: string | null;
  /** True when the PDF file itself was rewritten (page edits, Save to PDF, undo of those). */
  file: boolean;
  from: string;
}

const TAB_ID = uuid();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("studyspace") : null;

export function announceChange(docId: string | null, file: boolean): void {
  channel?.postMessage({ docId, file, from: TAB_ID } satisfies TabChange);
}

export function onRemoteChange(listener: (change: TabChange) => void): () => void {
  if (!channel) return () => undefined;
  const handler = (e: MessageEvent<TabChange>) => {
    if (e.data?.from !== TAB_ID) listener(e.data);
  };
  channel.addEventListener("message", handler);
  return () => channel.removeEventListener("message", handler);
}

/** What a successful write request (method + API path) changed, or null if other tabs needn't care. */
export function classifyMutation(url: string): { scope: "doc" | "library"; file: boolean } | null {
  // Reading position and page counts are per tab / self-healing; AI calls create resources via their own response.
  if (/\/progress$|\/meta$/.test(url)) return null;
  if (/^\/directories|^\/library\/scan|^\/pdf-tools\/|\/(rename|trash|restore)$/.test(url)) return { scope: "library", file: false };
  // OCR runs on a copy; only "Add to PDF" (apply) changes the file.
  if (/^\/ocr\/jobs\/[^/]+\/apply$/.test(url)) return { scope: "doc", file: true };
  if (/^\/ocr\/|\/ocr$/.test(url)) return null;
  const file = /\/pages\/|\/annotations\/save$|\/history\/[^/]+\/undo$/.test(url);
  return { scope: "doc", file };
}
