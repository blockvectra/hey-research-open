import { cn } from './cn';
import { formatRelativeTime, formatUsdCompact, valuationKindLabel } from './format';
import { activityLabel, type ActivityStatusValue } from './status';

/**
 * Ecosystem map (UI/UX V2 sections 28-29).
 *
 * Plain server-rendered SVG, like the rest of HEY's visuals: no charting or
 * graph library, no client-side simulation. Positions come from a deterministic
 * layout, so the same data always draws the same map and the page can be
 * cached. Every node is a real link with a native `<title>` tooltip.
 *
 * The visual grammar carries the product's argument:
 *
 *   size   market cap      — a big project is a big circle
 *   colour narrative       — neighbours share a hue
 *   ring   activity status — a dormant giant is large but faded, and a small
 *                            active project is vivid
 *
 * Size is not activity.
 */
export type MapNodeData = {
  slug: string;
  name: string;
  ticker?: string | null;
  narrative?: string | null;
  narrativeSlug?: string | null;
  activityStatus: ActivityStatusValue;
  hbm?: number | null;
  stillBuilding?: boolean;
  marketCapUsd?: number | null;
  /** Which measure `marketCapUsd` is (2026-09-25): an FDV is never called a market cap. */
  valuationKind?: 'marketCap' | 'fdv' | null;
  /** The figure is a launch pool's own supply at its last price (2026-10-16): labelled, never sized as a market. */
  launchPool?: boolean;
  lastShipAt?: Date | null;
};

export type MapEdgeData = { from: string; to: string; kind: string };

const WIDTH = 960;
const HEIGHT = 640;
const MIN_R = 7;
const MAX_R = 34;

/**
 * Node colours come from the controlled narrative palette (section 47), given
 * by legend order so a narrative keeps one colour across the legend and the
 * graph. Arbitrary generated hues would drift between renders and make the
 * legend meaningless.
 *
 * Six colours, never cycled (2026-10-16, audit #10): the legend used to cycle
 * seventeen narratives through seven colours, so AI Agents, Infrastructure and
 * Lending were one blue and a colour said nothing. The six largest narratives
 * keep a colour of their own; every other narrative is one grey, named "Other
 * narratives" in the legend; a project with no narrative is a hollow dashed
 * circle, its own legend entry, never a narrative's colour.
 */
const NARRATIVE_COLORS = [
  'var(--color-narrative-ai)',
  'var(--color-narrative-defi)',
  'var(--color-narrative-rwa)',
  'var(--color-narrative-meme)',
  'var(--color-narrative-trading)',
  'var(--color-narrative-infra)',
];
const OTHER_NARRATIVES_HUE = 'var(--color-narrative-other)';
/** A project with no narrative: no fill colour, a dashed outline (see `UnclassifiedSwatch`). */
export const UNCLASSIFIED_HUE = 'unclassified';

/** Faded means "not shipping", never "not worth looking at". */
const STATUS_OPACITY: Record<string, number> = {
  SHIPPING: 1,
  RESUMED: 0.95,
  ACTIVE: 0.85,
  QUIET: 0.5,
  DORMANT: 0.32,
  UNKNOWN: 0.32,
};

const RING_STROKE: Record<string, string> = {
  SHIPPING: 'var(--color-status-shipping)',
  ACTIVE: 'var(--color-status-active)',
  QUIET: 'var(--color-status-quiet)',
  DORMANT: 'var(--color-status-dormant)',
  RESUMED: 'var(--color-status-resumed)',
  UNKNOWN: 'var(--color-status-unknown)',
};

export const mapHueFor = (narrativeSlug: string | null | undefined, order: readonly string[]): string => {
  if (!narrativeSlug) return UNCLASSIFIED_HUE;
  const index = order.indexOf(narrativeSlug);
  return (index < 0 ? undefined : NARRATIVE_COLORS[index]) ?? OTHER_NARRATIVES_HUE;
};

/**
 * Radius is log-scaled: market caps span several orders of magnitude, and a
 * linear scale would render every small project as an invisible dot.
 */
/**
 * The figure a circle is sized by (2026-10-16, audit #1): a launch pool's
 * "valuation" is the token's own supply at its last price, not a market, so
 * it draws at the smallest size, like a project with no market.
 */
const sizingValue = (node: MapNodeData): number => (node.launchPool ? 0 : (node.marketCapUsd ?? 0));

/** The valuation as the list prints it: "$29K · launch pool" for a launch pool, as the card does. */
export const mapNodeValuation = (node: MapNodeData): string | undefined =>
  node.marketCapUsd ? `${formatUsdCompact(node.marketCapUsd)}${node.launchPool ? ' · launch pool' : ''}` : undefined;

const radiusFor = (marketCapUsd: number | null | undefined, max: number): number => {
  if (!marketCapUsd || marketCapUsd <= 0 || max <= 0) return MIN_R;
  const ratio = Math.log10(1 + marketCapUsd) / Math.log10(1 + max);
  return MIN_R + (MAX_R - MIN_R) * Math.max(0, Math.min(1, ratio));
};

export type PlacedMapNode = MapNodeData & {
  x: number;
  y: number;
  r: number;
  hue: string;
  labelled: boolean;
};

/** How much emptier than the circles themselves a cluster should be. */
const PACKING_SLACK = 3.6;
const MARGIN = 26;
/** Labels are for orientation, not a legend — past a handful they collide. */
const MAX_LABELS = 8;
/** Half-extent of a rendered label, used to keep two of them apart. */
const LABEL_GUARD = { x: 96, y: 22 };

type Rect = { x: number; y: number; w: number; h: number };
type Cluster = { key: string; members: { node: MapNodeData; r: number }[]; weight: number };

/**
 * Slice-and-dice treemap: split the canvas by cluster weight, always across the
 * longer side, so cells stay reasonably square. Deterministic and total —
 * every cluster gets a cell, and the cells tile the canvas exactly.
 */
function sliceAndDice(
  clusters: readonly Cluster[],
  rect: Rect,
): { cluster: Cluster; rect: Rect }[] {
  const first = clusters[0];
  if (!first) return [];
  if (clusters.length === 1) return [{ cluster: first, rect }];

  const total = clusters.reduce((sum, cluster) => sum + cluster.weight, 0);
  let running = 0;
  let split = 1;
  for (let index = 0; index < clusters.length - 1; index += 1) {
    running += clusters[index]?.weight ?? 0;
    split = index + 1;
    if (running >= total / 2) break;
  }

  const head = clusters.slice(0, split);
  const tail = clusters.slice(split);
  // An all-zero-weight group still has to be divided somehow.
  const ratio = total > 0 ? running / total : split / clusters.length;

  const [rectA, rectB] =
    rect.w >= rect.h
      ? [
          { ...rect, w: rect.w * ratio },
          { ...rect, x: rect.x + rect.w * ratio, w: rect.w * (1 - ratio) },
        ]
      : [
          { ...rect, h: rect.h * ratio },
          { ...rect, y: rect.y + rect.h * ratio, h: rect.h * (1 - ratio) },
        ];

  return [...sliceAndDice(head, rectA), ...sliceAndDice(tail, rectB)];
}

/**
 * Cluster nodes by narrative, give each cluster a share of the canvas
 * proportional to what it needs, and place its projects on a golden-angle
 * spiral sized to the area their circles actually occupy.
 *
 * A fixed spiral step does not work: HEY's clusters range from one project to
 * most of the chain, and the same step that spaces five nodes turns fifty into
 * an unreadable blob. Sizing the spiral from the members' own radii keeps both
 * legible. Deterministic throughout — no force simulation, no client JS.
 */
export function layoutMapNodes(
  nodes: readonly MapNodeData[],
  legendOrder: string[],
): PlacedMapNode[] {
  const maxCap = nodes.reduce((max, node) => Math.max(max, sizingValue(node)), 0);
  // Dense maps use smaller circles, so a crowded chain stays readable.
  const scale = nodes.length > 40 ? 0.72 : nodes.length > 20 ? 0.85 : 1;

  const groups = new Map<string, MapNodeData[]>();
  for (const node of nodes) {
    const key = node.narrativeSlug ?? '__none__';
    const group = groups.get(key);
    if (group) group.push(node);
    else groups.set(key, [node]);
  }

  const keys = [...groups.keys()].sort((a, b) => {
    const sizeDelta = (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0);
    return sizeDelta !== 0 ? sizeDelta : a.localeCompare(b);
  });

  const sized = keys.map((key) => {
    const members = (groups.get(key) ?? [])
      .slice()
      .sort((a, b) => sizingValue(b) - sizingValue(a))
      .map((node) => ({ node, r: radiusFor(sizingValue(node), maxCap) * scale }));
    return {
      key,
      members,
      // Area the cluster's circles need, spread a few times their own size.
      weight: PACKING_SLACK * members.reduce((sum, member) => sum + member.r * member.r, 0),
    };
  });

  // Cells are proportional to what each cluster needs, not equal: most of
  // Robinhood Chain is unclassified, and an equal grid would squeeze fifty
  // projects into the same box as a one-project narrative.
  const cells = sliceAndDice(sized, { x: 0, y: 0, w: WIDTH, h: HEIGHT });
  const placed: PlacedMapNode[] = [];

  cells.forEach(({ cluster, rect }) => {
    const gx = rect.x + rect.w / 2;
    const gy = rect.y + rect.h / 2;
    const hue = mapHueFor(cluster.key === '__none__' ? null : cluster.key, legendOrder);
    const room = Math.max(0, Math.min(rect.w, rect.h) / 2 - MARGIN);
    const count = cluster.members.length;
    // A narrow cell must never collapse a cluster onto a single point, so
    // multi-member clusters keep a floor and spill into the canvas instead.
    const widest = cluster.members.reduce((max, member) => Math.max(max, member.r), 0);
    const floor = count > 1 ? widest * 1.6 : 0;
    const spread = Math.max(floor, Math.min(Math.sqrt(cluster.weight), room));

    cluster.members.forEach((member, index) => {
      const theta = index * 2.399963;
      // Sunflower placement: even density from the centre outward.
      const distance = count <= 1 ? 0 : spread * Math.sqrt(index / (count - 1));
      placed.push({
        ...member.node,
        hue,
        r: member.r,
        labelled: false,
        x: Math.max(MARGIN, Math.min(WIDTH - MARGIN, gx + Math.cos(theta) * distance)),
        y: Math.max(MARGIN, Math.min(HEIGHT - MARGIN, gy + Math.sin(theta) * distance)),
      });
    });
  });

  // Only the largest few carry a visible name; the rest rely on the tooltip.
  // A label is also dropped when it would collide with one already placed,
  // because two overlapping names are less use than one readable name — and
  // when it would sit over another project's circle (2026-10-16, audit #10:
  // "progr mablehq" read through a neighbour).
  const anchors: { x: number; y: number }[] = [];
  const labelled = new Set<string>();
  for (const node of placed.slice().sort((a, b) => b.r - a.r)) {
    if (labelled.size >= MAX_LABELS) break;
    const anchor = { x: node.x, y: node.y + node.r };
    const collides = anchors.some(
      (other) =>
        Math.abs(other.x - anchor.x) < LABEL_GUARD.x &&
        Math.abs(other.y - anchor.y) < LABEL_GUARD.y,
    );
    if (collides) continue;
    const box = mapLabelBox(node);
    const covers = placed.some((other) => other.slug !== node.slug && circleMeetsBox(other, box));
    if (covers) continue;
    anchors.push(anchor);
    labelled.add(node.slug);
  }

  return placed.map((node) => ({ ...node, labelled: labelled.has(node.slug) }));
}

/** The name a labelled node shows, cut to fit. */
const mapLabelText = (name: string): string => (name.length > 18 ? `${name.slice(0, 17)}…` : name);

/** The box a label occupies: 10 px type, about 5.6 px a character, its baseline 15 px under the circle. */
export function mapLabelBox(node: { name: string; x: number; y: number; r: number }): { x: number; y: number; w: number; h: number } {
  const width = mapLabelText(node.name).length * 5.6;
  return { x: node.x - width / 2, y: node.y + node.r + 5, w: width, h: 13 };
}

/** Whether a circle (with its 3 px status ring) reaches into a box. */
function circleMeetsBox(circle: { x: number; y: number; r: number }, box: Rect): boolean {
  const nearestX = Math.max(box.x, Math.min(circle.x, box.x + box.w));
  const nearestY = Math.max(box.y, Math.min(circle.y, box.y + box.h));
  return Math.hypot(circle.x - nearestX, circle.y - nearestY) < circle.r + 3;
}

/** The native tooltip of one node, exported so its words are tested (2026-09-25). */
export const mapNodeTooltip = (node: MapNodeData, now: Date): string => {
  const lines = [
    `${node.name}${node.ticker ? ` (${node.ticker})` : ''}`,
    activityLabel(node.activityStatus),
  ];
  if (typeof node.hbm === 'number') lines.push(`Build momentum ${node.hbm}`);
  // A launch pool is "Valuation … · launch pool", never a market cap (the card's words, 2026-10-16).
  if (node.marketCapUsd) lines.push(`${node.launchPool ? 'Valuation' : valuationKindLabel(node.valuationKind)} ${mapNodeValuation(node)}`);
  if (node.lastShipAt) lines.push(`Last ship ${formatRelativeTime(node.lastShipAt, now)}`);
  if (node.stillBuilding) lines.push('Still Building');
  return lines.join('\n');
};

export function EcosystemMapChart({
  nodes,
  edges,
  legend,
  now = new Date(),
  className,
}: {
  nodes: readonly MapNodeData[];
  edges: readonly MapEdgeData[];
  legend: readonly { slug: string; name: string; count: number }[];
  now?: Date;
  className?: string;
}) {
  const legendOrder = legend.map((entry) => entry.slug);
  const placed = layoutMapNodes(nodes, legendOrder);
  const byslug = new Map(placed.map((node) => [node.slug, node]));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn('h-auto w-full', className)}
      role="img"
      aria-label={`Ecosystem map of ${placed.length} projects`}
    >
      {/*
       * No ground of its own (Luminous Glass, 2026-09-30): the graph sits on
       * the page's level-2 glass panel, which follows the theme. It used to
       * paint a Midnight rectangle in both themes (section 55); a faded node
       * reads as faded against either ground. The faint grid is drawn in the
       * theme's own hairline token.
       */}
      <defs>
        <pattern id="hey-map-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" className="stroke-hey-border" strokeOpacity={0.6} strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} rx={12} fill="url(#hey-map-grid)" />

      {edges.map((edge) => {
        const from = byslug.get(edge.from);
        const to = byslug.get(edge.to);
        if (!from || !to) return null;
        return (
          <line
            key={`${edge.from}-${edge.to}-${edge.kind}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="var(--color-blue-500)"
            strokeOpacity={0.35}
            strokeWidth={1.5}
          />
        );
      })}

      {placed.map((node) => (
        <a key={node.slug} href={`/project/${node.slug}`} aria-label={node.name}>
          <title>{mapNodeTooltip(node, now)}</title>
          {node.hue === UNCLASSIFIED_HUE ? (
            // No narrative: an outline, never a narrative's colour. The transparent fill keeps the whole circle a link.
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill="transparent"
              stroke={OTHER_NARRATIVES_HUE}
              strokeWidth={1.5}
              strokeDasharray="3 2"
              opacity={STATUS_OPACITY[node.activityStatus] ?? 0.4}
            />
          ) : (
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={node.hue}
              opacity={STATUS_OPACITY[node.activityStatus] ?? 0.4}
            />
          )}
          <circle
            cx={node.x}
            cy={node.y}
            r={node.r + 3}
            fill="none"
            stroke={RING_STROKE[node.activityStatus] ?? 'var(--color-status-unknown)'}
            strokeWidth={2}
            opacity={STATUS_OPACITY[node.activityStatus] ?? 0.4}
          />
          {node.labelled ? (
            <text
              x={node.x}
              y={node.y + node.r + 15}
              textAnchor="middle"
              className="fill-hey-secondary text-[10px]"
            >
              {mapLabelText(node.name)}
            </text>
          ) : null}
        </a>
      ))}
    </svg>
  );
}

/**
 * Legend: narrative colour keys, in the same order the layout uses.
 *
 * The six narratives with a colour of their own, then "Other narratives" (one
 * grey, the rest named in its tooltip), then "Unclassified" — the projects with
 * no narrative, often the largest cluster on the canvas, which had no entry
 * until 2026-10-16 (audit #10).
 *
 * `tone="dark"` is kept for a legend placed on a fixed dark ground (secondary
 * grey on one is unreadable, and a legend nobody can read is worse than no
 * legend). The map page itself sits on the theme's glass canvas since
 * 2026-09-30 and uses the default.
 */
export function MapLegend({
  legend,
  unclassified = 0,
  tone = 'light',
  className,
}: {
  legend: readonly { slug: string; name: string; count: number }[];
  /** How many projects on the map have no narrative. */
  unclassified?: number;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const coloured = legend.slice(0, NARRATIVE_COLORS.length);
  const others = legend.slice(NARRATIVE_COLORS.length);
  const itemClass = cn('flex items-center gap-2 text-xs', tone === 'dark' ? 'text-white/70' : 'text-hey-secondary');
  const countClass = tone === 'dark' ? 'text-white/40' : 'text-hey-muted';
  const swatch = (color: string) => (
    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
  );
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {coloured.map((entry) => (
        <li key={entry.slug} className={itemClass}>
          {swatch(mapHueFor(entry.slug, legend.map((item) => item.slug)))}
          {entry.name}
          <span className={countClass}>{entry.count}</span>
        </li>
      ))}
      {others.length > 0 ? (
        <li className={itemClass} title={others.map((entry) => `${entry.name} ${entry.count}`).join(', ')}>
          {swatch(OTHER_NARRATIVES_HUE)}
          Other narratives
          <span className={countClass}>{others.reduce((sum, entry) => sum + entry.count, 0)}</span>
          <span className="sr-only">: {others.map((entry) => `${entry.name} ${entry.count}`).join(', ')}</span>
        </li>
      ) : null}
      {unclassified > 0 ? (
        <li className={itemClass}>
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full border border-dashed"
            style={{ borderColor: OTHER_NARRATIVES_HUE }}
          />
          Unclassified
          <span className={countClass}>{unclassified}</span>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Mobile fallback (UI/UX V2 section 29).
 *
 * A canvas graph on a 375px screen is unreadable and un-tappable, so small
 * screens get the same clusters as a grouped list instead.
 */
export function MapClusterList({
  nodes,
  legend,
  now = new Date(),
  className,
}: {
  nodes: readonly MapNodeData[];
  legend: readonly { slug: string; name: string; count: number }[];
  now?: Date;
  className?: string;
}) {
  const groups = [
    ...legend.map((entry) => ({
      key: entry.slug,
      name: entry.name,
      items: nodes.filter((node) => node.narrativeSlug === entry.slug),
    })),
    {
      key: '__none__',
      name: 'Unclassified',
      items: nodes.filter((node) => !node.narrativeSlug),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <div className={cn('space-y-6', className)}>
      {groups.map((group) => (
        <section key={group.key}>
          {/* h2: these sit directly under the page title on the phone view. */}
          <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-hey-muted">
            {group.name}
            <span className="ml-2 text-hey-muted">{group.items.length}</span>
          </h2>
          <ul className="lg-card divide-y divide-hey-border overflow-hidden">
            {group.items.map((node) => (
              <li key={node.slug}>
                <a
                  href={`/project/${node.slug}`}
                  className="hey-row-link flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-hey-ink">{node.name}</span>
                    <span className="block text-xs text-hey-secondary">
                      {activityLabel(node.activityStatus)}
                      {node.lastShipAt ? ` · ${formatRelativeTime(node.lastShipAt, now)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-hey-muted">
                    {mapNodeValuation(node) ?? '—'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
