/**
 * Walking a listing (2026-09-19).
 *
 * HEY pages two ways. `/api/projects` and `/api/ships` say where the next
 * page starts (`nextOffset`, absent when the listing ends). `/api/signals`
 * and `/api/builders` say only how many there are (`total`), so the walk
 * steps by the number of items each page actually held — the API caps
 * `limit`, and stepping by what was asked for would skip rows past the cap.
 *
 * Both are async iterables, so a caller can stop at any page without
 * fetching the rest. Neither retries: a rate limit ends the walk with the
 * `HeyApiError` a single call would have thrown.
 */

/** Pages that carry `nextOffset`; the walk ends when it is absent or a page is empty. */
export async function* nextOffsetPages<P extends { items: unknown[]; nextOffset?: number }>(
  fetchPage: (offset: number) => Promise<P>,
  start = 0,
): AsyncGenerator<P, void, undefined> {
  let offset = start;
  for (;;) {
    const page = await fetchPage(offset);
    yield page;
    if (page.nextOffset === undefined || page.items.length === 0 || page.nextOffset <= offset) return;
    offset = page.nextOffset;
  }
}

/** Pages that carry only `total`; the walk ends at the total or on an empty page. */
export async function* totalPages<P extends { items: unknown[]; total: number }>(
  fetchPage: (offset: number) => Promise<P>,
  start = 0,
): AsyncGenerator<P, void, undefined> {
  let offset = start;
  for (;;) {
    const page = await fetchPage(offset);
    yield page;
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return;
  }
}

/** The rows of every page, one by one. */
export async function* itemsOf<T>(pages: AsyncIterable<{ items: T[] }>): AsyncGenerator<T, void, undefined> {
  for await (const page of pages) {
    for (const item of page.items) yield item;
  }
}

/**
 * Pages that carry an opaque `nextCursor` (2026-09-26): the change ledger and
 * a project's timeline. The walk ends when the cursor is null, when the page
 * says there is no more (`hasMore: false`), or when a cursor repeats — so a
 * sync that has reached the head stops instead of polling in a loop.
 */
export async function* cursorPages<P extends { items: unknown[]; nextCursor: string | null; hasMore?: boolean }>(
  fetchPage: (cursor: string | undefined) => Promise<P>,
  start?: string,
): AsyncGenerator<P, void, undefined> {
  let cursor = start;
  for (;;) {
    const page = await fetchPage(cursor);
    yield page;
    if (page.nextCursor === null || page.hasMore === false || page.items.length === 0 || page.nextCursor === cursor) return;
    cursor = page.nextCursor;
  }
}
