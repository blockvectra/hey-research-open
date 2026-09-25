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
  lastShipAt?: Date | null;
};

export type MapEdgeData = { from: string; to: string; kind: string };

const WIDTH = 960;
const HEIGHT = 640;
const MIN_R = 7;
const MAX_R = 34;

/**
 * Node colours come from the controlled narrative palette (section 47), cycled
 * by legend order so a narrative keeps one colour across the legend and the
 * graph. Arbitrary generated hues would drift between renders and make the
 * legend meaningless.
 */
const NARRATIVE_COLORS = [
  'var(--color-narrative-ai)',
  'var(--color-narrative-defi)',
  'var(--color-narrative-rwa)',
  'var(--color-narrative-meme)',
  'var(--color-narrative-trading)',
  'var(--color-narrative-infra)',
  'var(--color-narrative-other)',
];

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

const hueFor = (narrativeSlug: string | null | undefined, order: string[]): string => {
  if (!narrativeSlug) return 'var(--color-narrative-other)';
  const index = order.indexOf(narrativeSlug);
  return (
    NARRATIVE_COLORS[(index < 0 ? order.length : index) % NARRATIVE_COLORS.length] ??
    'var(--color-narrative-other)'
  );
};

/**
 * Radius is log-scaled: market caps span several orders of magnitude, and a
 * linear scale would render every small project as an invisible dot.
 */
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
  const maxCap = nodes.reduce((max, node) => Math.max(max, node.marketCapUsd ?? 0), 0);
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
      .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0))
      .map((node) => ({ node, r: radiusFor(node.marketCapUsd, maxCap) * scale }));
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
    const hue = hueFor(cluster.key === '__none__' ? null : cluster.key, legendOrder);
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
  // because two overlapping names are less use than one readable name.
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
    anchors.push(anchor);
    labelled.add(node.slug);
  }

  return placed.map((node) => ({ ...node, labelled: labelled.has(node.slug) }));
}

/** The native tooltip of one node, exported so its words are tested (2026-09-25). */
export const mapNodeTooltip = (node: MapNodeData, now: Date): string => {
  const lines = [
    `${node.name}${node.ticker ? ` (${node.ticker})` : ''}`,
    activityLabel(node.activityStatus),
  ];
  if (typeof node.hbm === 'number') lines.push(`Build momentum ${node.hbm}`);
  if (node.marketCapUsd) lines.push(`${valuationKindLabel(node.valuationKind)} ${formatUsdCompact(node.marketCapUsd)}`);
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
       * Midnight ground (section 55): the map is HEY's most dramatic surface,
       * and node opacity only reads as activity against a dark field.
       */}
      <rect width={WIDTH} height={HEIGHT} rx={16} fill="var(--color-midnight-950)" />
      <defs>
        <pattern id="hey-map-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} rx={16} fill="url(#hey-map-grid)" />

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
          <circle
            cx={node.x}
            cy={node.y}
            r={node.r}
            fill={node.hue}
            opacity={STATUS_OPACITY[node.activityStatus] ?? 0.4}
          />
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
              className="fill-white/70 text-[10px]"
            >
              {node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name}
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
 * `tone` exists because the map sits on Midnight: secondary grey on a dark
 * ground is unreadable, and a legend nobody can read is worse than no legend.
 */
export function MapLegend({
  legend,
  tone = 'light',
  className,
}: {
  legend: readonly { slug: string; name: string; count: number }[];
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-2', className)}>
      {legend.map((entry, index) => (
        <li
          key={entry.slug}
          className={cn(
            'flex items-center gap-2 text-xs',
            tone === 'dark' ? 'text-white/70' : 'text-hey-secondary',
          )}
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              backgroundColor:
                NARRATIVE_COLORS[index % NARRATIVE_COLORS.length] ?? 'var(--color-narrative-other)',
            }}
          />
          {entry.name}
          <span className={tone === 'dark' ? 'text-white/40' : 'text-hey-muted'}>
            {entry.count}
          </span>
        </li>
      ))}
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
          <ul className="divide-y divide-hey-border rounded-[6px] border border-hey-border bg-hey-surface">
            {group.items.map((node) => (
              <li key={node.slug}>
                <a
                  href={`/project/${node.slug}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-hey-ink">{node.name}</span>
                    <span className="block text-xs text-hey-secondary">
                      {activityLabel(node.activityStatus)}
                      {node.lastShipAt ? ` · ${formatRelativeTime(node.lastShipAt, now)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-hey-muted">
                    {node.marketCapUsd ? formatUsdCompact(node.marketCapUsd) : '—'}
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
