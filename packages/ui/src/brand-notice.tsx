import { cn } from './cn';

/** The domain's `BrandNotice`, restated as props (the UI package does not import the domain). */
export type BrandNoticeData = { kind: string; title: string; detail: string; ticker?: string };

/**
 * "Not affiliated with Robinhood — HEY has not verified this claim."
 * (2026-10-02, outsider audit OA-A). A name that borrows Robinhood's brand or a
 * Robinhood stock ticker carries this above every badge, on the card and on
 * the page, so a gold "Verified builder" is never the first thing a reader
 * sees beside "Robinhood's Official Mascot". A note, not an alert: it says what
 * HEY has not verified, never that anyone is lying. The page adds the reason.
 */
export function BrandNotice({ notice, detail = false, className }: { notice: BrandNoticeData; detail?: boolean; className?: string }) {
  return (
    <p
      role="note"
      data-testid="brand-notice"
      data-kind={notice.kind}
      className={cn('rounded-chip bg-hey-warning-bg px-2.5 py-1.5 text-[12.5px] font-medium leading-5 text-hey-warning [overflow-wrap:anywhere]', className)}
    >
      {notice.title}
      {detail ? <span className="mt-0.5 block font-normal">{notice.detail}</span> : null}
    </p>
  );
}
