import type { Resource } from "./types";

/** What a picture note's content is: only the link to the stored picture (see server noteImages). */
const PICTURE = /^!\[[^\]]*\]\((\/api\/images\/[0-9a-f]{64}\.(?:png|jpg|gif|webp))\)$/;

/** The picture's address when this note is only a picture (it then lives in the Pictures section, not the notes). */
export function pictureSrc(r: Pick<Resource, "type" | "content">): string | null {
  return r.type === "note" ? (PICTURE.exec(r.content.trim())?.[1] ?? null) : null;
}

export const isPicture = (r: Pick<Resource, "type" | "content">) => pictureSrc(r) !== null;

/** Page notes first, then ranges, then the whole PDF; the oldest first within each (like the notes). */
const RANK = { page: 0, range: 1, document: 2 } as const;
export function sortPictures<T extends Pick<Resource, "scope" | "createdAt">>(list: T[]): T[] {
  return [...list].sort((a, b) => RANK[a.scope] - RANK[b.scope] || a.createdAt.localeCompare(b.createdAt));
}

/** Pictures shown on a page: its own, those of a range that covers it, and the whole-PDF ones. */
export function picturesOnPage(pictures: Resource[], page: number | null): Resource[] {
  return sortPictures(
    pictures.filter((r) => r.scope === "document" || (page !== null && r.pageStart !== null && r.pageEnd !== null && r.pageStart <= page && page <= r.pageEnd)),
  );
}
