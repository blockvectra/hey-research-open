import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Container } from './container';
import { Sparkline } from './sparkline';
import { TokenLockChip } from './token-lock';

/**
 * A caller's sizing class must survive (2026-09-22).
 *
 * `cn` is a plain joiner, not tailwind-merge, so a component that bakes a
 * utility and also accepts `className` emits both — and the winner is decided
 * by where Tailwind happened to write them in the stylesheet, not by the
 * caller. Twice in one day that shipped:
 *
 * - `Sparkline` baked `w-full`; the Market tab's rail asked for `w-28` with
 *   `shrink-0`. `w-full` won, so the drawing took the whole flex row, could not
 *   shrink, and painted 83px out through the right edge of its card.
 * - `Container` baked `max-w-shell`; twenty-two pages asked for a reading
 *   column. `max-w-2xl`, `3xl` and `4xl` lost while `max-w-xl` won, purely
 *   because `xl` sorts after `shell` — two callers writing the same override,
 *   opposite results, no way to tell from the callsite.
 *
 * Both are fixed by taking the value as a default parameter instead of baking
 * it. These assert the fix from the outside: render with an override, and the
 * emitted class list must name that property exactly once.
 */
const classesOf = (element: { props: { className?: string } }): string[] =>
  (element.props.className ?? '').split(/\s+/).filter(Boolean);

const matching = (element: { props: { className?: string } }, pattern: RegExp): string[] =>
  classesOf(element).filter((klass) => pattern.test(klass));

describe('a caller-supplied sizing class is the only one emitted', () => {
  const days = [
    { day: '2026-09-01', value: 1 },
    { day: '2026-09-02', value: 2 },
  ];

  it('Sparkline emits one width when the caller sets one', () => {
    const element = Sparkline({ days, label: 'Commits per day', className: 'h-8 w-28 shrink-0' });
    expect(matching(element!, /^w-/)).toEqual(['w-28']);
    expect(matching(element!, /^h-/)).toEqual(['h-8']);
  });

  it('Sparkline still has a width when the caller sets none', () => {
    const element = Sparkline({ days, label: 'Commits per day' });
    expect(matching(element!, /^w-/)).toEqual(['w-full']);
  });

  it('Container emits one max-width when the caller sets one', () => {
    const element = Container({ children: null, width: 'max-w-2xl', className: 'py-10' });
    expect(matching(element, /^max-w-/)).toEqual(['max-w-2xl']);
  });

  it('Container falls back to the shell width', () => {
    const element = Container({ children: null });
    expect(matching(element, /^max-w-/)).toEqual(['max-w-shell']);
  });
});

describe('TokenLockChip tone', () => {
  it('lets a caller replace the tone instead of fighting it', () => {
    const html = renderToStaticMarkup(
      createElement(TokenLockChip, {
        lock: { supplyPct: 2.53, until: '2027-09-09', pairLocked: false },
        tone: 'text-[14px] text-hey-ink',
      }),
    );
    const classes = /class="([^"]+)"/.exec(html)?.[1] ?? '';
    /* `cn` is a plain joiner: two colour classes would leave stylesheet order to decide. */
    expect(classes.match(/text-hey-(ink|muted|secondary)/g)).toEqual(['text-hey-ink']);
    expect(classes).not.toContain('text-hey-muted');
  });
});
