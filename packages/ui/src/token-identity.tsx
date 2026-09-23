'use client';

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

import { Check, Copy, ExternalLink } from 'lucide-react';

import { explorerTokenUrl } from './brand';
import { cn } from './cn';
import { shortenAddress } from './format';

/**
 * Token identity on a card (Card V7, 2026-09-03).
 *
 * The contract address is the token's identity — a ticker is a nickname
 * anyone can reuse. So the card shows the address itself, shortened only for
 * the eye: the full value is in `title`, the copy action copies the full
 * value, and the explorer link opens the explorer's page for this exact
 * contract on this chain.
 *
 * Every control here sits inside a card whose body is one large link. The
 * controls are raised above that link (`relative z-10`) and stop the click
 * from reaching it, so "copy" copies and "open" opens instead of navigating
 * to the project page.
 */
const stop = (event: MouseEvent) => {
  event.stopPropagation();
};

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export function ContractAddress({
  address,
  chainId,
  explorerUrl,
  className,
}: {
  address: string;
  chainId: number;
  /** Override for tests or another chain; defaults to the brand explorer's token page. */
  explorerUrl?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const href = explorerUrl ?? explorerTokenUrl(address);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div
      className={cn('relative z-10 flex min-w-0 items-center gap-1', className)}
      data-testid="contract-address"
      data-chain-id={chainId}
      data-address={address}
    >
      {/*
       * The whole address as text, the short form as the picture
       * (2026-09-23).
       *
       * `0x8f6e…0b07` was the only rendering of the contract anywhere in the
       * body, so the full string existed on the page solely inside a
       * `title`, a data attribute and the structured data — none of which is
       * indexed as text. Pasting a contract address into a search engine is
       * the highest-intent question in this product's whole surface (*who
       * built this thing?*), and HEY is the only site that can answer it,
       * and it could not be matched.
       *
       * A screen reader was in the same position, worse: it read the ellipsis
       * aloud and gave a listener four hex digits of a forty-digit identity.
       * One `sr-only` span fixes both, and the sighted reader keeps the short
       * form, which is the one a human can actually check against a wallet.
       * The wrapper is `relative`, so the absolute positioning has an
       * ancestor and cannot push the document wide.
       */}
      <code
        title={address}
        className="min-w-0 truncate rounded-[4px] bg-hey-subtle px-1.5 py-0.5 text-[11.5px] tracking-[0.03em] text-hey-secondary [font-family:var(--font-mono)]"
      >
        {shortenAddress(address)}
      </code>
      {/* Outside the <code>, so selecting or copying the visible chip still
          yields the short form and only the short form. */}
      <span className="sr-only">{address}</span>
      <button
        type="button"
        onClick={(event) => {
          stop(event);
          event.preventDefault();
          void writeClipboard(address).then((ok) => setCopied(ok));
        }}
        aria-label={copied ? 'Contract address copied' : 'Copy contract address'}
        title={copied ? 'Copied' : 'Copy full address'}
        // Reported only where a `TrackClicks` listener is mounted (the project page, 2026-09-18).
        data-track="link.copied"
        data-outcome="contract"
        className={cn(
        /*
         * 28px drawn, 40px to the thumb: the ring extends the target without
         * moving the row. Vertically only — a 6px bleed on all four sides
         * put the explorer's box 2px inside the copy button's drawn edge,
         * and being later in the DOM it won, so pressing the right of the
         * copy icon opened the explorer instead (layout audit, 2026-09-22).
           */
          'relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-hey-muted',
          'before:absolute before:-inset-y-1.5 before:-inset-x-0.5 before:content-[""]',
          'hover:bg-hey-subtle hover:text-hey-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hey-ink/30',
          copied && 'text-status-shipping',
        )}
      >
        {copied ? (
          <Check aria-hidden="true" size={14} strokeWidth={2} />
        ) : (
          <Copy aria-hidden="true" size={14} strokeWidth={1.75} />
        )}
      </button>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stop}
        aria-label="Open contract in explorer"
        title="Open in explorer"
        data-track="source.clicked"
        data-outcome="explorer"
        className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-hey-muted before:absolute before:-inset-y-1.5 before:-inset-x-0.5 before:content-[''] hover:bg-hey-subtle hover:text-hey-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hey-ink/30"
      >
        <ExternalLink aria-hidden="true" size={14} strokeWidth={1.75} />
      </a>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied full contract address' : ''}
      </span>
    </div>
  );
}

/** A small external link that does not trigger the surrounding card link. */
export function ExternalRef({
  href,
  children,
  label,
  className,
  'data-testid': testId,
}: {
  href: string;
  children: ReactNode;
  label?: string;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <a
      data-testid={testId}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stop}
      aria-label={label}
      className={cn(
        // A 20px line of text; the pseudo-element gives it a 40px row to tap.
        'relative z-10 inline-flex min-w-0 items-center gap-1 rounded-[4px] text-hey-secondary hover:text-hey-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hey-ink/30',
        'before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[""]',
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ExternalLink aria-hidden="true" size={12} strokeWidth={1.75} className="shrink-0" />
    </a>
  );
}
