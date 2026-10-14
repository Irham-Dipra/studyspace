/**
 * Pure page-number remapping used after structural edits so that notes, resources and
 * annotations keep pointing at the same content. All page numbers are 1-based.
 */

/** Pages after `after` move down by `count` when `count` pages are inserted after page `after` (0 = at start). */
export function mapPageAfterInsert(page: number, after: number, count: number): number {
  return page > after ? page + count : page;
}

/** Range remap for insertion: a range that spans the insertion point grows to include the new pages. */
export function mapRangeAfterInsert(start: number, end: number, after: number, count: number): [number, number] {
  return [mapPageAfterInsert(start, after, count), end > after ? end + count : end];
}

export class DeletionMap {
  private readonly deleted: number[];
  readonly newPageCount: number;

  constructor(
    deletedPages: Iterable<number>,
    readonly oldPageCount: number,
  ) {
    this.deleted = [...new Set(deletedPages)].filter((p) => p >= 1 && p <= oldPageCount).sort((a, b) => a - b);
    this.newPageCount = oldPageCount - this.deleted.length;
  }

  isDeleted(page: number): boolean {
    return this.deleted.includes(page);
  }

  /** New number of a surviving page, or null when the page was deleted. */
  map(page: number): number | null {
    if (this.isDeleted(page)) return null;
    let shift = 0;
    for (const d of this.deleted) {
      if (d < page) shift++;
      else break;
    }
    return page - shift;
  }

  /** Maps any page to the nearest surviving page: the next one after it, else the previous one. */
  nearest(page: number): number {
    if (this.newPageCount <= 0) return 1;
    for (let p = page; p <= this.oldPageCount; p++) {
      const m = this.map(p);
      if (m !== null) return m;
    }
    for (let p = page - 1; p >= 1; p--) {
      const m = this.map(p);
      if (m !== null) return m;
    }
    return 1;
  }

  /**
   * Remaps a range. Returns the surviving span, or null when every page in it was deleted
   * (callers then fall back to `nearest`).
   */
  mapRange(start: number, end: number): [number, number] | null {
    let first: number | null = null;
    let last: number | null = null;
    for (let p = start; p <= end; p++) {
      const m = this.map(p);
      if (m === null) continue;
      if (first === null) first = m;
      last = m;
    }
    return first === null || last === null ? null : [first, last];
  }
}

/**
 * Inverse of an insertion, used by undo: maps a page of the edited document back to the page it was
 * before the insert. Pages that were themselves inserted have no original, so they map to null.
 */
export function unmapPageAfterInsert(page: number, after: number, count: number): number | null {
  if (page <= after) return page;
  if (page <= after + count) return null;
  return page - count;
}

/** Inverse of a deletion, used by undo: the n-th surviving page maps back to its original number. */
export function unmapPageAfterDelete(page: number, deletedPages: Iterable<number>, oldPageCount: number): number | null {
  const deleted = new Set(deletedPages);
  let seen = 0;
  for (let p = 1; p <= oldPageCount; p++) {
    if (deleted.has(p)) continue;
    if (++seen === page) return p;
  }
  return null;
}

/**
 * The new page order after moving `pages` (any set, kept in their order) to just after page `after`
 * (0 = to the start; `after` must not be one of the moved pages). Entry i is the old number of the
 * page that ends up at position i + 1.
 */
export function orderAfterMove(pages: Iterable<number>, after: number, pageCount: number): number[] {
  const moved = [...new Set(pages)].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const set = new Set(moved);
  const rest = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !set.has(p));
  const at = rest.filter((p) => p <= after).length;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/** old page number -> new page number, for a page order as returned by `orderAfterMove`. */
export function inverseOrder(order: number[]): Map<number, number> {
  return new Map(order.map((old, i) => [old, i + 1]));
}
