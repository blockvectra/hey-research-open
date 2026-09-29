/**
 * Where the market chart's event callouts go (founder brief §21A, 2026-09-29).
 *
 * Pure and deterministic: the same events at the same width always give the
 * same layout, on the server, in the browser and in the tests. The inputs are
 * an event's place on the TIME axis, its research rank and its label width —
 * never a price. A callout's vertical position is a layout band above the
 * plot, chosen by collision alone, so an event can never read as having a
 * price of its own, and its stem ends at the event lane, never at a candle.
 *
 * The algorithm:
 *
 * 1. Each item's anchor is its time on the axis, in px (`x × plotWidth`).
 * 2. Density: a run of `denseCount` or more events whose neighbours sit
 *    within `denseGap` px of each other is ONE mark — a busy week reads as a
 *    busy week, not as a wall of labels. The run keeps its most important
 *    member's title as a callout and counts the rest as its "+N"; only when
 *    that callout has no place does the run become a "+N changes" chip.
 * 3. Everything is placed in rank order (the caller ranks by research
 *    importance — releases, deployments, ships, then the rest — and then the
 *    newest first; never by price impact), a dense run at its best member's
 *    rank, so the newest and most important events take their places before
 *    older ones can. At most `maxCallouts` callouts. Each tries the band
 *    furthest from the plot first and takes the free place closest to
 *    "centred on its time", shifted at most `tolerance` px and never so far
 *    that its time leaves its edges: the stem starts under the callout it
 *    belongs to. A stem never runs down behind a mark nearer the plot, where
 *    it would read as that mark's.
 * 4. What does not fit is counted beside its neighbour in time: folded into
 *    the nearest callout as its "+N", or into the nearest chip. An event with
 *    no neighbour keeps a callout of its own even past `maxCallouts` (a lone
 *    event is not a crowd); a chip is never drawn for one event.
 * 5. A chip with no place at all takes one by absorbing the least important
 *    callouts in its way. Every absorption moves an item into the chip, so the
 *    loop ends; and every item is in exactly one callout or one chip — nothing
 *    is hidden without a count.
 * 6. A chip left holding one event becomes that event's callout — over its
 *    time, else beside it (joined by a connector, like a chip), else folded
 *    into the nearest mark's count. "+1 change" is never drawn.
 *
 * Everything stays inside `[0, plotWidth]`: the band sits over the plot, not
 * over the price scale, so no callout can cover the axis or the latest price.
 */

export type AnnotationPrecision = 'EXACT' | 'DATE' | 'WEEK' | 'WINDOW' | 'OBSERVED' | 'SCHEDULED';

/** One event as the layout sees it. There is deliberately no price field. */
export type AnnotationItem = {
  id: string;
  /** The event's time on the axis, as a fraction of the plot width (0–1). */
  x: number;
  /** A week or a window: its start and end on the axis, as fractions. */
  span?: readonly [number, number];
  /** Lower is placed first. */
  rank: number;
  /** The callout's width in px (see `calloutWidth`). */
  width: number;
};

export type LayoutOptions = {
  plotWidth: number;
  /** Rows above the plot; band 0 is the one nearest the plot. */
  bands: number;
  /** At most this many callouts are expanded; the rest are clustered. */
  maxCallouts: number;
  /** Space kept between two neighbours in a band, px. */
  gap?: number;
  /** How far a callout may move off its time, px. */
  tolerance?: number;
  /** Items this close in time (px) share one chip when they do not fit. */
  clusterRadius?: number;
  /** A run this dense — neighbours within `denseGap` px — is a chip from the start. */
  denseGap?: number;
  denseCount?: number;
  /** Space no mark may take, per band, px. */
  reserved?: readonly { band: number; left: number; right: number }[];
};

export type PlacedCallout = {
  kind: 'callout';
  id: string;
  band: number;
  left: number;
  width: number;
  anchor: number;
  /**
   * Events close in time that found no place of their own, folded into this
   * callout as "+N": the busiest stretch keeps its most important label, and
   * the rest are one click away, counted.
   */
  more: string[];
};
export type PlacedCluster = {
  kind: 'cluster';
  ids: string[];
  band: number;
  left: number;
  width: number;
  anchor: number;
  /** The time the cluster covers, px: from its earliest member to its latest. */
  from: number;
  to: number;
};
export type AnnotationLayout = { callouts: PlacedCallout[]; clusters: PlacedCluster[] };

/** The cluster chip's words. */
export const clusterLabel = (count: number) => `+${count} change${count === 1 ? '' : 's'}`;

/** A chip's width from its label, px. */
export const clusterWidth = (count: number) => Math.round(clusterLabel(count).length * 6.6 + 22);

const CALLOUT_MIN = 96;
const CALLOUT_MAX = 188;

/**
 * A callout's width from its two lines, px: the family line (10.5px capitals,
 * a marker before it and an arrow after) and the title (12px, medium). The
 * callout is drawn at exactly this width and truncates the title inside it,
 * so the estimate is the drawn size.
 */
export function calloutWidth(title: string, meta: string): number {
  const text = Math.max(title.length * 6.9, meta.length * 7.3 + 28);
  return Math.round(Math.min(CALLOUT_MAX, Math.max(CALLOUT_MIN, text + 20)));
}

type Box = { left: number; right: number; owner: string };

/** The free left edge in `[lo, hi]` closest to `want`, or undefined. */
function freeSpot(want: number, width: number, lo: number, hi: number, taken: readonly Box[], gap: number): number | undefined {
  if (lo > hi) return undefined;
  const fits = (left: number) =>
    left >= lo - 1e-6 &&
    left <= hi + 1e-6 &&
    taken.every((box) => left + width + gap <= box.left + 1e-6 || left >= box.right + gap - 1e-6);
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  const candidates = [clamp(want)];
  for (const box of taken) candidates.push(box.right + gap, box.left - gap - width);
  let best: number | undefined;
  for (const c of candidates) {
    if (!fits(c)) continue;
    const d = Math.abs(c - want);
    const b = best === undefined ? Infinity : Math.abs(best - want);
    if (d < b - 1e-9 || (Math.abs(d - b) <= 1e-9 && c < best!)) best = c;
  }
  return best === undefined ? undefined : Math.round(best * 100) / 100;
}

/** The range a box's left edge may take so that `anchor` stays inside it, `margin` from its edges. */
function range(anchor: number, width: number, plotWidth: number, tolerance: number): [number, number, number] {
  const margin = Math.min(10, width / 2);
  const want = Math.min(plotWidth - width, Math.max(0, anchor - width / 2));
  const lo = Math.max(0, anchor - width + margin, want - tolerance);
  const hi = Math.min(plotWidth - width, anchor - margin, want + tolerance);
  // At an edge the anchor may sit closer than the margin; the box still covers it.
  return [want, Math.min(lo, want), Math.max(hi, want)];
}

const round = (v: number) => Math.round(v * 100) / 100;

export function layoutAnnotations(items: readonly AnnotationItem[], options: LayoutOptions): AnnotationLayout {
  const plotWidth = Math.max(0, options.plotWidth);
  const bands = Math.max(1, Math.floor(options.bands));
  const gap = options.gap ?? 6;
  const tolerance = options.tolerance ?? 56;
  const radius = options.clusterRadius ?? 72;
  const denseGap = options.denseGap ?? 26;
  const denseCount = options.denseCount ?? 4;
  const px = (fraction: number) => Math.min(plotWidth, Math.max(0, fraction * plotWidth));

  const ordered = [...items].sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const importance = new Map(ordered.map((item, index) => [item.id, ordered.length - index]));
  const anchorOf = new Map(ordered.map((item) => [item.id, px(item.x)]));
  const spanOf = new Map(
    ordered.map((item) => [item.id, item.span ? ([px(item.span[0]), px(item.span[1])] as const) : ([px(item.x), px(item.x)] as const)]),
  );
  const byTime = (a: string, b: string) => anchorOf.get(a)! - anchorOf.get(b)! || (a < b ? -1 : a > b ? 1 : 0);

  const taken: Box[][] = Array.from({ length: bands }, (_, band) =>
    (options.reserved ?? []).filter((r) => r.band === band).map((r) => ({ left: r.left, right: r.right, owner: '' })),
  );
  /* Every placed mark's stem: it runs down from its band through every band nearer the plot. */
  const stems = new Map<string, { band: number; x: number }>();
  const STEM = 3;

  /*
   * What a mark in `band` must keep clear of: the marks in its own band, and
   * the stems of marks further from the plot, which pass down through it.
   */
  const blockersFor = (band: number): Box[] => [
    ...taken[band]!,
    ...[...stems].filter(([, stem]) => stem.band > band).map(([owner, stem]) => ({ left: stem.x - STEM, right: stem.x + STEM, owner })),
  ];
  /* And its own stem must not run behind a mark nearer the plot. */
  const stemClear = (band: number, x: number) =>
    taken.slice(0, band).every((row) => row.every((box) => x < box.left - STEM || x > box.right + STEM));

  const place = (owner: string, band: number, left: number, width: number, anchor: number) => {
    taken[band]!.push({ left, right: left + width, owner });
    stems.set(owner, { band, x: anchor });
  };
  const unplace = (owner: string, band: number) => {
    taken[band] = taken[band]!.filter((box) => box.owner !== owner);
    stems.delete(owner);
  };
  /*
   * The row furthest from the plot first: its stem is a hairline the rows
   * below can sit between, where a wide box near the plot would shut every
   * row above it out of that stretch of time. The result is the staggered
   * look of a well-set annotation, and more labels at one width.
   */
  const bandOrder = Array.from({ length: bands }, (_, k) => bands - 1 - k);
  const tryBands = (want: number, width: number, anchor: number, lo: number, hi: number) => {
    for (const band of bandOrder) {
      if (!stemClear(band, anchor)) continue;
      const left = freeSpot(want, width, lo, hi, blockersFor(band), gap);
      if (left !== undefined) return { band, left };
    }
    return undefined;
  };

  const callouts = new Map<string, PlacedCallout>();
  const clusters = new Map<string, PlacedCluster>();
  let serial = 0;

  const extent = (ids: readonly string[]) => {
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const id of ids) {
      const [a, b] = spanOf.get(id)!;
      from = Math.min(from, a);
      to = Math.max(to, b);
    }
    return { from, to, anchor: (from + to) / 2 };
  };

  /** The placed callout whose time is nearest `x`, within `limit` px. */
  const nearestCallout = (x: number, limit: number): PlacedCallout | undefined => {
    let best: PlacedCallout | undefined;
    for (const callout of callouts.values()) {
      const d = Math.abs(callout.anchor - x);
      if (d <= limit && (!best || d < Math.abs(best.anchor - x) || (d === Math.abs(best.anchor - x) && callout.id < best.id))) best = callout;
    }
    return best;
  };

  /** A chip for these items, over their time, beside it, merged with its neighbour, or — last — in place of callouts. */
  const placeCluster = (start: readonly string[]) => {
    let ids = [...start];
    const key = `cluster-${serial++}`;
    for (;;) {
      ids.sort(byTime);
      const { from, to, anchor } = extent(ids);
      const width = Math.min(plotWidth, clusterWidth(ids.length));
      const [want, lo, hi] = range(anchor, width, plotWidth, Math.max(tolerance, width));
      const commit = (chosen: { band: number; left: number }) => {
        place(key, chosen.band, chosen.left, width, anchor);
        clusters.set(key, { kind: 'cluster', ids, band: chosen.band, left: chosen.left, width, anchor: round(anchor), from: round(from), to: round(to) });
      };
      /*
       * Over its own time first; else beside it, within twice the tolerance —
       * the chip then joins its bracket by a connector, so the time it stands
       * for is still drawn where it is.
       */
      const chosen =
        tryBands(want, width, anchor, lo, hi) ??
        tryBands(want, width, anchor, Math.max(0, anchor - width - 2 * tolerance), Math.min(plotWidth - width, anchor + 2 * tolerance));
      if (chosen) {
        commit(chosen);
        return;
      }
      /* A chip close in time takes these in: one "+N" for one busy stretch. */
      let nearest: PlacedCluster | undefined;
      let nearestKey = '';
      for (const [other, cluster] of clusters) {
        const distance = Math.max(0, cluster.from - to, from - cluster.to);
        if (distance <= 2 * radius && (!nearest || distance < Math.max(0, nearest.from - to, from - nearest.to))) {
          nearest = cluster;
          nearestKey = other;
        }
      }
      if (nearest) {
        clusters.delete(nearestKey);
        unplace(nearestKey, nearest.band);
        ids = [...ids, ...nearest.ids];
        continue;
      }
      /* Else the callout nearest in time counts them as its "+N", rather than a more important label giving way. */
      const host = nearestCallout(anchor, 2 * radius);
      if (host) {
        host.more.push(...ids);
        return;
      }
      /*
       * No room: take the cheapest band's place over its time, absorbing what
       * is in the way — the marks it would cover, the stems that would run
       * through it, and the marks nearer the plot its own stem would run behind.
       */
      let cheapest: { band: number; cost: number; owners: string[] } | undefined;
      for (let band = 0; band < bands; band += 1) {
        const hit = (box: Box) => want < box.right + gap && want + width + gap > box.left;
        if (taken[band]!.some((box) => box.owner === '' && hit(box))) continue;
        const owners = new Set<string>();
        for (const box of blockersFor(band)) if (box.owner !== '' && hit(box)) owners.add(box.owner);
        for (const row of taken.slice(0, band))
          for (const box of row) if (box.owner !== '' && anchor >= box.left - STEM && anchor <= box.right + STEM) owners.add(box.owner);
        const cost = [...owners].reduce((sum, owner) => sum + (clusters.has(owner) ? 0.5 : (importance.get(owner) ?? 0)), 0);
        if (!cheapest || cost < cheapest.cost) cheapest = { band, cost, owners: [...owners] };
      }
      const absorbed: string[] = [];
      for (const owner of cheapest?.owners ?? []) {
        const cluster = clusters.get(owner);
        if (cluster) {
          absorbed.push(...cluster.ids);
          clusters.delete(owner);
          unplace(owner, cluster.band);
        } else if (callouts.has(owner)) {
          const callout = callouts.get(owner)!;
          absorbed.push(owner, ...callout.more);
          callouts.delete(owner);
          unplace(owner, callout.band);
        }
      }
      if (absorbed.length === 0) {
        // Nothing left to move: any free place in the plot, else over its time. The count stays visible.
        commit(tryBands(want, width, anchor, 0, plotWidth - width) ?? { band: cheapest?.band ?? 0, left: Math.max(0, Math.min(plotWidth - width, want)) });
        return;
      }
      ids = [...ids, ...absorbed];
    }
  };

  /*
   * A callout for one item: over its time (`tolerance`), or — `loose` — anywhere
   * its time stays inside its edges, or — `beside` — near its time, joined by a
   * connector as a chip is. A callout is never wider than the plot; its title
   * truncates inside the width it is drawn at.
   */
  const tryCallout = (item: AnnotationItem, mode: 'tight' | 'loose' | 'beside'): PlacedCallout | undefined => {
    const anchor = anchorOf.get(item.id)!;
    const width = Math.min(item.width, plotWidth);
    const [want, lo, hi] = range(anchor, width, plotWidth, mode === 'tight' ? tolerance : Number.POSITIVE_INFINITY);
    const chosen =
      mode === 'beside'
        ? tryBands(want, width, anchor, Math.max(0, anchor - width - 2 * tolerance), Math.min(plotWidth - width, anchor + 2 * tolerance))
        : tryBands(want, width, anchor, lo, hi);
    if (!chosen) return undefined;
    place(item.id, chosen.band, chosen.left, width, anchor);
    const callout: PlacedCallout = { kind: 'callout', id: item.id, band: chosen.band, left: chosen.left, width, anchor: round(anchor), more: [] };
    callouts.set(item.id, callout);
    return callout;
  };
  const itemOf = new Map(ordered.map((item) => [item.id, item]));

  /* 2. Density: tight runs in time, each to be one mark. */
  const timeline = ordered.map((item) => item.id).sort(byTime);
  const runOf = new Map<string, string[]>();
  for (let k = 0; k < timeline.length; ) {
    let end = k;
    while (end + 1 < timeline.length && anchorOf.get(timeline[end + 1]!)! - anchorOf.get(timeline[end]!)! <= denseGap) end += 1;
    if (end - k + 1 >= denseCount) {
      const run = timeline.slice(k, end + 1);
      for (const id of run) runOf.set(id, run);
    }
    k = end + 1;
  }

  /*
   * 3–4. In rank order: the most important and newest first. A dense run is
   * placed at its best member's rank, as that member's callout with the run
   * counted as its "+N", else as one chip. A single event that does not fit
   * is counted beside its neighbour; one with no neighbour keeps a callout.
   */
  const done = new Set<string>();
  for (const item of ordered) {
    if (done.has(item.id)) continue;
    const run = runOf.get(item.id);
    for (const id of run ?? [item.id]) done.add(id);
    const anchor = anchorOf.get(item.id)!;
    const room = callouts.size < options.maxCallouts;
    if (run) {
      const lead = room ? tryCallout(item, 'tight') : undefined;
      if (lead) lead.more.push(...run.filter((id) => id !== item.id));
      else placeCluster(run);
      continue;
    }
    if (room && tryCallout(item, 'tight')) continue;
    const [a, b] = spanOf.get(item.id)!;
    let near: [string, PlacedCluster] | undefined;
    for (const entry of clusters) {
      const distance = Math.max(0, entry[1].from - b, a - entry[1].to);
      if (distance <= radius && (!near || distance < Math.max(0, near[1].from - b, a - near[1].to))) near = entry;
    }
    const host = nearestCallout(anchor, radius);
    const chipDistance = near ? Math.max(0, near[1].from - b, a - near[1].to) : Infinity;
    if (host && Math.abs(host.anchor - anchor) < chipDistance) {
      host.more.push(item.id);
    } else if (near) {
      clusters.delete(near[0]);
      unplace(near[0], near[1].band);
      placeCluster([...near[1].ids, item.id]);
    } else if (!tryCallout(item, 'loose')) placeCluster([item.id]);
  }

  /*
   * 6. A chip that ended up holding one event is that event's callout: a
   * "+1 change" chip would hide a title behind a count of one. Over its time,
   * else beside it, else counted in the nearest mark (a callout's "+N" first).
   */
  for (const [key, cluster] of [...clusters]) {
    // A chip merged away earlier in this pass is no longer there to convert.
    if (cluster.ids.length !== 1 || clusters.get(key) !== cluster) continue;
    const id = cluster.ids[0]!;
    clusters.delete(key);
    unplace(key, cluster.band);
    const item = itemOf.get(id)!;
    if (tryCallout(item, 'loose') ?? tryCallout(item, 'beside')) continue;
    const x = anchorOf.get(id)!;
    const host = nearestCallout(x, Number.POSITIVE_INFINITY);
    if (host) {
      host.more.push(id);
      continue;
    }
    let nearest: [string, PlacedCluster] | undefined;
    for (const entry of clusters) {
      const d = Math.abs(entry[1].anchor - x);
      if (!nearest || d < Math.abs(nearest[1].anchor - x)) nearest = entry;
    }
    if (nearest) {
      clusters.delete(nearest[0]);
      unplace(nearest[0], nearest[1].band);
      placeCluster([...nearest[1].ids, id]);
      continue;
    }
    /* Nothing else on the chart and no free room: its callout over its time all the same (the chip's last resort). */
    const width = Math.min(item.width, plotWidth);
    const left = round(Math.max(0, Math.min(plotWidth - width, x - width / 2)));
    place(id, cluster.band, left, width, x);
    callouts.set(id, { kind: 'callout', id, band: cluster.band, left, width, anchor: round(x), more: [] });
  }

  const byLeft = <T extends { band: number; left: number }>(a: T, b: T) => a.left - b.left || a.band - b.band;
  return { callouts: [...callouts.values()].sort(byLeft), clusters: [...clusters.values()].sort(byLeft) };
}

/** The axis place of a lane event: its column, the fraction of its day, or its span. */
export function axisOf(event: { i: number; j?: number | undefined; f?: number | undefined; p: AnnotationPrecision }, columns: number): { x: number; span?: [number, number] } {
  const n = Math.max(1, columns);
  if (event.j !== undefined && (event.p === 'WEEK' || event.p === 'WINDOW')) {
    const span: [number, number] = [event.i / n, (event.j + 1) / n];
    return { x: (span[0] + span[1]) / 2, span };
  }
  // Only an exact time moves inside its day; a date, an observation or a schedule sits mid-day.
  const within = event.p === 'EXACT' && event.f !== undefined ? Math.min(1, Math.max(0, event.f)) : 0.5;
  return { x: (event.i + within) / n };
}

/** Whether an event covers a column: its own day, or any day of its week or window. */
export function coversColumn(event: { i: number; j?: number | undefined }, column: number): boolean {
  return column >= event.i && column <= (event.j ?? event.i);
}

/** Band count for a number of visible events: fixed per count, so the server and the browser reserve the same height. */
export function bandsFor(visible: number): number {
  return visible === 0 ? 0 : visible <= 4 ? 1 : visible <= 20 ? 2 : 3;
}
