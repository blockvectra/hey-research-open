import { cn } from './cn';

/**
 * Token distribution as a bubble map (2026-09-14, third cut).
 *
 * One circle per holder, area proportional to the share of supply, a line
 * where two of them moved the token between each other in the last few days.
 * Server-rendered SVG, a `<title>` on everything, a `role="img"` summary, an
 * honest empty state: the same recipe as every other chart in this package,
 * with no client bundle and no charting dependency.
 *
 * What makes it readable is the colouring, and that was the lesson of the first
 * two cuts. Colouring by "HEY could name this address" told the reader almost
 * nothing, because the answer is no for forty-eight circles out of fifty. The
 * colour now carries the **cluster** — a set of addresses that moved the token
 * between each other — so the shape a reader is looking for is the shape that
 * stands out. Everything not in a cluster stays a quiet neutral, which is most
 * of the picture and should be.
 *
 * Area stays honest. A token with ninety-two per cent in one address draws as
 * one enormous circle, because that is what it is; the map is not flattened to
 * make it prettier.
 *
 * Every id in here is a constant. The package learned on the same day that a
 * generated id is a hydration mismatch waiting to happen.
 *
 * Every circle is a link to that address on the block explorer (2026-09-14),
 * because the first question a reader has about a bubble is "who is that", and
 * HEY's answer is to hand them the chain rather than a label of its own. The
 * link opens in a new tab and carries `rel="noreferrer"`; without an
 * `explorerBase` the circles render exactly as before, unlinked.
 *
 * What the picture may say: how much of a supply sits in how few places, which
 * of those places HEY can name, and which of them move it between each other.
 * What it must never say: that an address is a person, that a cluster is one
 * person, or that any of it is good or bad. No verdict, no score.
 */
export type BubbleNode = {
  address: string;
  /** 0–100. A holder whose share HEY does not know is dropped by the caller, never drawn as zero. */
  sharePct: number;
  /** What HEY can say the address is; absent means it could not say. */
  label?: string;
  /** 1 is the largest balance. */
  rank: number;
  /** Which cluster it belongs to, if any. Absent means it moved the token with nobody else drawn here. */
  cluster?: number;
  x: number;
  y: number;
  r: number;
};

export type BubbleEdge = { from: string; to: string; transfers: number };

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
// A real balance never prints as 0.00% (2026-09-25): under a hundredth of a per cent says so.
const pct = (value: number) =>
  value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value > 0 && value < 0.01 ? '<0.01' : value.toFixed(2);

/**
 * One hue per cluster, cycling (redesigned 2026-09-26). A cluster is a group,
 * not a severity and not a builder state, so none of these is a warning tone
 * or the builder green; and the hue is only ever an outline. The fill stays
 * flat and neutral, so the map never reads as a heat map of good and bad.
 */
export const CLUSTER_COLOURS = [
  'var(--color-narrative-trading)',
  'var(--color-narrative-infra)',
  'var(--color-narrative-ai)',
  'var(--color-narrative-rwa)',
  'var(--color-narrative-meme)',
  'var(--color-narrative-defi)',
] as const;

export const clusterColour = (cluster: number) =>
  CLUSTER_COLOURS[(cluster - 1) % CLUSTER_COLOURS.length]!;

/** Stable ids: never generated, never counted (see the note above). */
const HATCH_ID = 'hey-bubble-hatch';

/** The drawing's own bounds plus a margin, so the map is as tall as its circles and no taller. */
export function bubbleBounds(
  nodes: readonly Pick<BubbleNode, 'x' | 'y' | 'r'>[],
  margin = 24,
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r);
    minY = Math.min(minY, node.y - node.r);
    maxX = Math.max(maxX, node.x + node.r);
    maxY = Math.max(maxY, node.y + node.r);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX - margin, y: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 };
}

export function BubbleMap({
  nodes,
  edges = [],
  explorerBase,
  className,
  testId,
}: {
  nodes: readonly BubbleNode[];
  edges?: readonly BubbleEdge[];
  /** Kept for callers that pass it; the drawing now fits its own circles. */
  size?: number;
  /** Block explorer origin, e.g. `https://robinhoodchain.blockscout.com`. Absent means no links. */
  explorerBase?: string;
  className?: string;
  testId?: string;
}) {
  if (nodes.length === 0) {
    return (
      <div className={cn('py-2', className)} data-testid={testId}>
        <p className="text-t-ui text-hey-secondary">No distribution indexed for this token yet.</p>
        <p className="mt-0.5 text-t-meta text-hey-muted">HEY reads the largest balances daily; the map appears once it has.</p>
      </div>
    );
  }

  const byAddress = new Map(nodes.map((node) => [node.address, node]));
  const drawn = edges.flatMap((edge) => {
    const from = byAddress.get(edge.from);
    const to = byAddress.get(edge.to);
    return from && to ? [{ from, to, transfers: edge.transfers }] : [];
  });
  const busiest = drawn.reduce((max, edge) => Math.max(max, edge.transfers), 1);
  const box = bubbleBounds(nodes);
  const addressHref = (address: string) =>
    explorerBase ? `${explorerBase.replace(/\/$/, '')}/address/${address}` : undefined;
  const named = nodes.some((node) => node.label !== undefined);
  const clustered = nodes.some((node) => node.cluster !== undefined);

  return (
    <div className={className} data-testid={testId}>
      <svg
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        className="mx-auto block h-auto w-full"
        style={{ maxWidth: Math.round(box.width) }}
        role="img"
        aria-label={`Token distribution, largest first: ${nodes
          .slice(0, 10)
          .map(
            (node) =>
              `${node.label ?? short(node.address)} ${pct(node.sharePct)} per cent${node.cluster !== undefined ? `, cluster ${node.cluster}` : ''}`,
          )
          .join('; ')}`}
      >
        <defs>
          {/* A pool, a locker or a burn: hatched, so it reads as "not an ordinary balance" without a colour. */}
          <pattern id={HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--hey-subtle)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--hey-muted)" strokeWidth="1.6" strokeOpacity="0.55" />
          </pattern>
        </defs>

        {/* Edges under the circles, thin and quiet: the clusters are the story, not the wiring. */}
        <g fill="none" strokeLinecap="round">
          {drawn.map((edge) => {
            const strength = Math.log10(edge.transfers + 1) / Math.log10(busiest + 1);
            const inCluster = edge.from.cluster !== undefined && edge.from.cluster === edge.to.cluster;
            /* Rim to rim, not centre to centre: a line through a large disc reads as a spoke. */
            const dx = edge.to.x - edge.from.x;
            const dy = edge.to.y - edge.from.y;
            const distance = Math.hypot(dx, dy) || 1;
            return (
              <line
                key={`${edge.from.address}>${edge.to.address}`}
                x1={edge.from.x + (dx / distance) * edge.from.r}
                y1={edge.from.y + (dy / distance) * edge.from.r}
                x2={edge.to.x - (dx / distance) * edge.to.r}
                y2={edge.to.y - (dy / distance) * edge.to.r}
                stroke={inCluster ? clusterColour(edge.from.cluster!) : 'var(--hey-muted)'}
                strokeWidth={0.6 + strength * 1.4}
                strokeOpacity={inCluster ? 0.35 + strength * 0.4 : 0.25 + strength * 0.25}
              >
                <title>{`${short(edge.from.address)} sent to ${short(edge.to.address)}: ${edge.transfers.toLocaleString('en-US')} transfer${edge.transfers === 1 ? '' : 's'} in the last few days`}</title>
              </line>
            );
          })}
        </g>

        {/* The circles: flat fills; a cluster is a 1.5px outline in its hue, nothing more. */}
        {nodes.map((node) => {
          const href = addressHref(node.address);
          const circle = (
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={node.label !== undefined ? `url(#${HATCH_ID})` : 'var(--hey-subtle)'}
              stroke={node.cluster !== undefined ? clusterColour(node.cluster) : 'var(--hey-border-strong)'}
              strokeWidth={node.cluster !== undefined ? 1.5 : 1}
              vectorEffect="non-scaling-stroke"
              className={href ? 'cursor-pointer' : undefined}
            >
              <title>{`#${node.rank} · ${node.label ?? short(node.address)} · ${pct(node.sharePct)}% of supply${node.cluster !== undefined ? ` · cluster ${node.cluster}` : ''}`}</title>
            </circle>
          );
          /*
           * The link is out of the tab order (accessibility audit, 2026-09-22):
           * `role="img"` prunes the anchors from the accessibility tree, but they
           * stay focusable. The same addresses are real links in `BubbleList`.
           */
          return href ? (
            <a key={node.address} href={href} tabIndex={-1} aria-hidden="true" target="_blank" rel="noreferrer" className="transition-opacity hover:opacity-75">
              {circle}
            </a>
          ) : (
            <g key={node.address}>{circle}</g>
          );
        })}

        {/*
          Labels last, over everything, with a 2px surface halo so a numeral
          crossing a line or a neighbour stays legible. The thresholds keep a
          label readable once a phone scales the drawing down; smaller circles
          carry their rank and share in `BubbleList` beside the map.
        */}
        <g pointerEvents="none" className="tabular-nums" fill="var(--hey-ink)" stroke="var(--hey-surface)" strokeWidth={2} paintOrder="stroke" strokeLinejoin="round">
          {nodes.map((node) =>
            node.r >= 40 ? (
              <g key={node.address}>
                <text x={node.x} y={node.y - node.r * 0.1} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(28, Math.max(12, node.r * 0.42))} fontWeight={600}>
                  {pct(node.sharePct)}%
                </text>
                <text x={node.x} y={node.y + node.r * 0.32} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(13, Math.max(9, node.r * 0.19))} fill="var(--hey-secondary)">
                  #{node.rank}
                </text>
              </g>
            ) : node.r >= 26 ? (
              <text key={node.address} x={node.x} y={node.y} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(13, Math.max(8, node.r * 0.62))} fill="var(--hey-secondary)">
                {node.rank}
              </text>
            ) : null,
          )}
        </g>
      </svg>

      {/* The legend with real swatches: the same fills and outlines the drawing uses. */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-t-meta text-hey-muted">
        <li className="flex items-center gap-1.5">
          <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="5" fill="var(--hey-subtle)" stroke="var(--hey-border-strong)" />
          </svg>
          a balance: area is its share, a number its rank
        </li>
        {named ? (
          <li className="flex items-center gap-1.5">
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="5" fill={`url(#${HATCH_ID})`} stroke="var(--hey-border-strong)" />
            </svg>
            a pool, locker or burn
          </li>
        ) : null}
        {clustered ? (
          <li className="flex items-center gap-1.5">
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="5" fill="var(--hey-subtle)" stroke={clusterColour(1)} strokeWidth="1.5" />
            </svg>
            an outline colour is a cluster
          </li>
        ) : null}
        {drawn.length > 0 ? (
          <li className="flex items-center gap-1.5">
            <svg aria-hidden width="14" height="12" viewBox="0 0 14 12">
              <line x1="1" y1="6" x2="13" y2="6" stroke="var(--hey-muted)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            a transfer between two of them in the last few days
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * The ranked list beside the map: every drawn circle, its share, and its
 * cluster. A colour is not a label, so the clusters are written out.
 */
export function BubbleList({
  nodes,
  clusters = [],
  explorerBase,
  className,
  limit = 12,
}: {
  nodes: readonly BubbleNode[];
  clusters?: readonly { id: number; addresses: readonly string[]; sharePct?: number }[];
  /** Block explorer origin; absent means the rows are plain text. */
  explorerBase?: string;
  className?: string;
  limit?: number;
}) {
  const shown = [...nodes].sort((a, b) => a.rank - b.rank).slice(0, limit);
  if (shown.length === 0) return null;
  return (
    <div className={className}>
      {clusters.length > 0 ? (
        <ul className="mb-5 space-y-1.5">
          {clusters.slice(0, 4).map((cluster) => (
            <li key={cluster.id} className="flex items-baseline justify-between gap-3 text-t-ui">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-[10px] shrink-0 rounded-full border-[1.5px] bg-hey-subtle"
                  style={{ borderColor: clusterColour(cluster.id) }}
                />
                <span className="truncate">
                  Cluster {cluster.id}
                  <span className="text-hey-muted"> · {cluster.addresses.length} addresses</span>
                </span>
              </span>
              {cluster.sharePct !== undefined ? (
                <span className="tabular-nums">{pct(cluster.sharePct)}%</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="space-y-1">
        {shown.map((node) => (
          <li key={node.address} className="flex items-baseline justify-between gap-3 text-t-ui">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-5 shrink-0 tabular-nums text-right text-t-meta text-hey-muted">
                {node.rank}
              </span>
              {explorerBase ? (
                <a
                  href={`${explorerBase.replace(/\/$/, '')}/address/${node.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-t-meta underline decoration-hey-border-strong underline-offset-4 hover:decoration-hey-ink"
                >
                  {node.label ?? short(node.address)}
                </a>
              ) : (
                <span className="truncate font-mono text-t-meta">
                  {node.label ?? short(node.address)}
                </span>
              )}
              {node.cluster !== undefined ? (
                <span
                  aria-hidden="true"
                  className="inline-block size-[8px] shrink-0 rounded-full border-[1.5px] bg-hey-subtle"
                  style={{ borderColor: clusterColour(node.cluster) }}
                />
              ) : null}
            </span>
            <span className="tabular-nums">{pct(node.sharePct)}%</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
