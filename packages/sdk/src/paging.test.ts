import { describe, expect, it } from 'vitest';

import { itemsOf, nextOffsetPages, totalPages } from './paging';

/**
 * Walking a listing (2026-09-19).
 *
 * The failure worth guarding is a walk that never ends: a page that repeats
 * its own offset, a total the pages never reach, an empty page with a
 * `nextOffset` still on it. Each of those must stop, and every other walk
 * must make exactly as many requests as there are pages.
 */
describe('nextOffsetPages', () => {
  it('follows nextOffset and stops when it is absent', async () => {
    const pages = [
      { items: ['a', 'b'], nextOffset: 2 },
      { items: ['c', 'd'], nextOffset: 4 },
      { items: ['e'] },
    ];
    const offsets: number[] = [];
    const seen: string[] = [];
    for await (const page of nextOffsetPages(async (offset) => {
      offsets.push(offset);
      return pages[offsets.length - 1]!;
    })) {
      seen.push(...page.items);
    }
    expect(offsets).toEqual([0, 2, 4]);
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('starts where it is told and stops on an empty page or a nextOffset that does not move', async () => {
    const offsets: number[] = [];
    for await (const _page of nextOffsetPages(async (offset) => {
      offsets.push(offset);
      return { items: [], nextOffset: offset + 10 };
    }, 30)) {
      // nothing
    }
    expect(offsets).toEqual([30]);

    const stuck: number[] = [];
    for await (const _page of nextOffsetPages(async (offset) => {
      stuck.push(offset);
      return { items: ['x'], nextOffset: offset };
    })) {
      // nothing
    }
    expect(stuck).toEqual([0]);
  });

  it('makes no further request when the caller stops early', async () => {
    let requests = 0;
    for await (const page of nextOffsetPages(async (offset) => {
      requests += 1;
      return { items: [offset], nextOffset: offset + 1 };
    })) {
      if (page.items[0] === 1) break;
    }
    expect(requests).toBe(2);
  });
});

describe('totalPages', () => {
  it('steps by the rows each page held and stops at the total', async () => {
    const offsets: number[] = [];
    const seen: number[] = [];
    for await (const page of totalPages(async (offset) => {
      offsets.push(offset);
      // The API capped a limit of 4 at 2 rows; the walk must not skip.
      const items = [offset, offset + 1].filter((n) => n < 5);
      return { items, total: 5 };
    })) {
      seen.push(...page.items);
    }
    expect(offsets).toEqual([0, 2, 4]);
    expect(seen).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops on an empty page even when the total says there is more', async () => {
    const offsets: number[] = [];
    for await (const _page of totalPages(async (offset) => {
      offsets.push(offset);
      return { items: [], total: 100 };
    })) {
      // nothing
    }
    expect(offsets).toEqual([0]);
  });

  it('yields the one page of a listing that fits in it', async () => {
    let requests = 0;
    const pages = [];
    for await (const page of totalPages(async () => {
      requests += 1;
      return { items: ['only'], total: 1 };
    })) {
      pages.push(page);
    }
    expect(requests).toBe(1);
    expect(pages).toHaveLength(1);
  });
});

describe('itemsOf', () => {
  it('flattens pages into rows in order', async () => {
    async function* pages() {
      yield { items: [1, 2] };
      yield { items: [] };
      yield { items: [3] };
    }
    const rows: number[] = [];
    for await (const row of itemsOf(pages())) rows.push(row);
    expect(rows).toEqual([1, 2, 3]);
  });
});
