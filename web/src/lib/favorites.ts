import type { DocumentRecord } from "./types";

/** One file's new place in the favourites, or null to take it out. */
export interface FavoriteChange {
  id: string;
  favorite: number | null;
}

/** The favourites in their order (files the user hid stay out, like in the other lists). */
export function favoriteDocs(documents: DocumentRecord[]): DocumentRecord[] {
  return documents
    .filter((d) => d.favorite !== null && !d.hidden)
    .sort((a, b) => a.favorite! - b.favorite! || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }));
}

/** Places for new favourites: after every file that is one already (hidden ones included). */
export function appendPlaces(documents: DocumentRecord[], ids: string[]): FavoriteChange[] {
  let last = Math.max(0, ...documents.map((d) => d.favorite ?? 0));
  return ids.map((id) => ({ id, favorite: (last = Math.floor(last) + 1) }));
}

/**
 * Moves `list[from]` to index `to` (in the list without it). It goes halfway between its new
 * neighbours, so nothing else changes; only if they share a place (a file that came back to the
 * library, say) is the whole list numbered again. Empty when it wouldn't move.
 */
export function moveFavorite(list: DocumentRecord[], from: number, to: number): FavoriteChange[] {
  const rest = list.filter((_, i) => i !== from);
  to = Math.max(0, Math.min(rest.length, to));
  if (to === from || !list[from]) return [];
  const before = rest[to - 1]?.favorite ?? null;
  const after = rest[to]?.favorite ?? null;
  const place = before === null ? after! - 1 : after === null ? before + 1 : (before + after) / 2;
  if (place !== before && place !== after) return [{ id: list[from].id, favorite: place }];
  rest.splice(to, 0, list[from]);
  return rest.map((d, i) => ({ id: d.id, favorite: i + 1 })).filter((c, i) => rest[i].favorite !== c.favorite);
}
