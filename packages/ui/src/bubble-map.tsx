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
const pct = (value: number) =>
  value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2);

/**
 * One hue per cluster, cycling. They are the product's own data colours, not a
 * new palette: a cluster is a group, not a severity, so none of them may read
 * as a warning.
 */
export const CLUSTER_COLOURS = [
  'var(--color-narrative-trading)',
  'var(--color-status-shipping)',
  'var(--color-narrative-infra)',
  'var(--color-status-quiet)',
  'var(--color-narrative-defi)',
  'var(--color-blue-500)',
] as const;

export const clusterColour = (cluster: number) =>
  CLUSTER_COLOURS[(cluster - 1) % CLUSTER_COLOURS.length]!;

/** Stable ids: never generated, never counted (see the note above). */
const SPHERE_ID = 'hey-bubble-sphere';

export function BubbleMap({
  nodes,
  edges = [],
  size = 560,
  explorerBase,
  className,
  testId,
}: {
  nodes: readonly BubbleNode[];
  edges?: readonly BubbleEdge[];
  size?: number;
  /** Block explorer origin, e.g. `https://robinhoodchain.blockscout.com`. Absent means no links. */
  explorerBase?: string;
  className?: string;
  testId?: string;
}) {
  if (nodes.length === 0) {
    return (
      <div
        className={cn(
          'rounded-[10px] border border-dashed border-hey-border px-4 py-6 text-center',
          className,
        )}
        data-testid={testId}
      >
        <p className="text-[13.5px] text-hey-secondary">
          No distribution indexed for this token yet.
        </p>
        <p className="mt-0.5 text-[12.5px] text-hey-muted">
          HEY reads the largest balances daily; the map appears once it has.
        </p>
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
  const half = size / 2;
  /* Room for a rim label on an outer circle without clipping it. */
  const pad = 18;
  const addressHref = (address: string) =>
    explorerBase ? `${explorerBase.replace(/\/$/, '')}/address/${address}` : undefined;
  const colourOf = (node: BubbleNode) =>
    node.cluster !== undefined
      ? clusterColour(node.cluster)
      : node.label !== undefined
        ? 'var(--hey-muted)'
        : 'var(--hey-border-strong)';

  return (
    <div className={className} data-testid={testId}>
      <svg
        viewBox={`${-half - pad} ${-half - pad} ${size + pad * 2} ${size + pad * 2}`}
        className="h-auto w-full"
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
          {/* One light source for every sphere, so the circles read as objects rather than flat discs. */}
          <radialGradient id={SPHERE_ID} cx="36%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.30" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.14" />
          </radialGradient>
        </defs>

        {/* Edges under the circles, thin and quiet: the clusters are the story, not the wiring. */}
        <g fill="none" strokeLinecap="round">
          {drawn.map((edge) => {
            const strength = Math.log10(edge.transfers + 1) / Math.log10(busiest + 1);
            const inCluster =
              edge.from.cluster !== undefined && edge.from.cluster === edge.to.cluster;
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
                strokeWidth={0.6 + strength * 1.6}
                strokeOpacity={inCluster ? 0.3 + strength * 0.45 : 0.2 + strength * 0.25}
              >
                <title>{`${short(edge.from.address)} sent to ${short(edge.to.address)}: ${edge.transfers.toLocaleString('en-US')} transfer${edge.transfers === 1 ? '' : 's'} in the last few days`}</title>
              </line>
            );
          })}
        </g>

        {nodes.map((node) => {
          const hue = colourOf(node);
          const clustered = node.cluster !== undefined;
          const showPct = node.r >= 24;
          const showRank = node.r >= 13;
          const href = addressHref(node.address);
          const body = (
            <>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={hue}
                fillOpacity={clustered ? 0.42 : 0.16}
                stroke={hue}
                strokeWidth={clustered ? 1.5 : 1}
                strokeOpacity={clustered ? 0.85 : 0.4}
                className={href ? 'cursor-pointer' : undefined}
              >
                <title>
                  {`#${node.rank} · ${node.label ?? short(node.address)} · ${pct(node.sharePct)}% of supply${clustered ? ` · cluster ${node.cluster}` : ''}`}
                </title>
              </circle>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill={`url(#${SPHERE_ID})`}
                pointerEvents="none"
              />
              {showPct ? (
                <>
                  <text
                    x={node.x}
                    y={node.y - node.r * 0.1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="tabular-nums"
                    fontSize={Math.min(28, Math.max(12, node.r * 0.42))}
                    fontWeight={600}
                    fill="var(--hey-ink)"
                    pointerEvents="none"
                  >
                    {pct(node.sharePct)}%
                  </text>
                  <text
                    x={node.x}
                    y={node.y + node.r * 0.32}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="tabular-nums"
                    fontSize={Math.min(13, Math.max(9, node.r * 0.19))}
                    fill="var(--hey-ink)"
                    fillOpacity={0.6}
                    pointerEvents="none"
                  >
                    #{node.rank}
                  </text>
                </>
              ) : showRank ? (
                <text
                  x={node.x}
                  y={node.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="tabular-nums"
                  fontSize={Math.min(13, Math.max(8, node.r * 0.62))}
                  fill="var(--hey-ink)"
                  fillOpacity={0.7}
                  pointerEvents="none"
                >
                  {node.rank}
                </text>
              ) : null}
            </>
          );
          return href ? (
            <a
              key={node.address}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="opacity-100 transition-opacity hover:opacity-75"
              aria-label={`${node.label ?? short(node.address)} on the block explorer`}
            >
              {body}
            </a>
          ) : (
            <g key={node.address}>{body}</g>
          );
        })}
      </svg>

      <p className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11.5px] text-hey-muted">
        <span>circle area is the share of supply</span>
        <span>a number is its rank</span>
        {drawn.length > 0 ? (
          <span>a line is a transfer between two of them in the last few days</span>
        ) : null}
      </p>
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
            <li key={cluster.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-[9px] shrink-0 rounded-full"
                  style={{ background: clusterColour(cluster.id) }}
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
          <li key={node.address} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-5 shrink-0 tabular-nums text-right text-[11.5px] text-hey-muted">
                {node.rank}
              </span>
              {explorerBase ? (
                <a
                  href={`${explorerBase.replace(/\/$/, '')}/address/${node.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate font-mono text-[12.5px] underline decoration-hey-border-strong underline-offset-4 hover:decoration-hey-ink"
                >
                  {node.label ?? short(node.address)}
                </a>
              ) : (
                <span className="truncate font-mono text-[12.5px]">
                  {node.label ?? short(node.address)}
                </span>
              )}
              {node.cluster !== undefined ? (
                <span
                  aria-hidden="true"
                  className="inline-block size-[7px] shrink-0 rounded-full"
                  style={{ background: clusterColour(node.cluster) }}
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
