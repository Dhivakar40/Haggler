/**
 * Cursor pagination helpers.
 *
 * Why cursors and not OFFSET? With OFFSET 1000 the database still walks 1000 rows, and
 * rows inserted while the user scrolls shift every page. A cursor encodes "the last row
 * I saw" (sort key + id) so the next query is `WHERE (sort, id) < (cursor)`, which uses
 * the index and stays stable.
 */
export interface CursorPayload {
  /** ISO timestamp or numeric sort key of the last row on the previous page. */
  k: string;
  /** Tie-breaker id of the last row. */
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as CursorPayload).k === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return { k: (parsed as CursorPayload).k, id: (parsed as CursorPayload).id };
    }
    return null;
  } catch {
    return null;
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Fetch `limit + 1` rows, then call this: if we got the extra row there is a next page.
 * Trace: limit=2, rows fetched=[a,b,c] -> items=[a,b], nextCursor=cursor(b).
 */
export function toPage<T>(
  rowsPlusOne: T[],
  limit: number,
  keyOf: (row: T) => CursorPayload,
): Page<T> {
  const hasMore = rowsPlusOne.length > limit;
  const items = hasMore ? rowsPlusOne.slice(0, limit) : rowsPlusOne;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null };
}
