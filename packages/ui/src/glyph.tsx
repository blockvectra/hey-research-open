import type { CSSProperties, ReactNode } from 'react';

/**
 * The Terminal's kind marks, drawn rather than typed (remaining issues,
 * 2026-09-26).
 *
 * ● ■ ◆ ◈ ◇ ○ ◦ ▌ ▬ ◷ ↗ ⋯ are not in the site's font, so the browser went looking
 * for a system font that has them before it could lay out the first screen:
 * on the project workspace at 390px with a 4× slower CPU, first layout took
 * 60–70 ms with them and about 15 ms without, and it is why the redesigned
 * workspace painted later than the one before it (first paint, median of
 * five: 256 ms with them, 172 ms drawn; 180 ms before the redesign). Drawn as a 10-unit SVG in
 * `currentColor`, sized in `em` and sitting on the text baseline, each mark
 * looks the way the glyph did and costs nothing to lay out. A mark this map
 * does not know is printed as text, as before.
 *
 * Always `aria-hidden`: the word beside a mark carries its meaning (UI rule 13
 * — never colour or shape alone).
 */
type Shape = { d?: string; circle?: [number, number, number]; fill: boolean };

const SHAPES: Readonly<Record<string, Shape>> = {
  '●': { circle: [5, 5, 4], fill: true },
  '■': { d: 'M1.5 1.5h7v7h-7z', fill: true },
  '◆': { d: 'M5 .6 9.4 5 5 9.4.6 5z', fill: true },
  '◈': { d: 'M5 .9 9.1 5 5 9.1.9 5zM5 3.4 6.6 5 5 6.6 3.4 5z', fill: false },
  '◇': { d: 'M5 .9 9.1 5 5 9.1.9 5z', fill: false },
  '○': { circle: [5, 5, 3.9], fill: false },
  '◦': { circle: [5, 5, 2.2], fill: false },
  '▌': { d: 'M1 0h4v10H1z', fill: true },
  '▬': { d: 'M.5 3.5h9v3h-9z', fill: true },
  '↗': { d: 'M2.5 7.5 7.5 2.5M3.5 2.5h4v4', fill: false },
  '◷': { circle: [5, 5, 4], d: 'M5 2.6V5h2.2', fill: false },
  '⋯': { d: 'M1.6 5h.01M5 5h.01M8.4 5h.01', fill: false },
};

export function Glyph({
  glyph,
  className,
  style,
  size = '0.8em',
}: {
  glyph: string;
  className?: string;
  style?: CSSProperties;
  /** The mark's box, in the surrounding text's `em`. */
  size?: string;
}): ReactNode {
  const shape = SHAPES[glyph];
  if (!shape) {
    return (
      <span aria-hidden className={className} style={style}>
        {glyph}
      </span>
    );
  }
  const dots = glyph === '⋯';
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      width={size}
      height={size}
      className={className ? `inline-block shrink-0 ${className}` : 'inline-block shrink-0'}
      style={style}
      fill={shape.fill ? 'currentColor' : 'none'}
      stroke={shape.fill ? 'none' : 'currentColor'}
      strokeWidth={dots ? 2.2 : 1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-glyph={glyph}
    >
      {shape.circle ? <circle cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} /> : null}
      {shape.d ? <path d={shape.d} /> : null}
    </svg>
  );
}

const SUBSCRIPT = /([₀-₉]+)/;

/**
 * A compact price (`$0.0₄254`, from `formatTerminalPrice`) with its zero
 * count set as a small lowered digit in the site's own font, rather than the
 * Unicode subscript, which the font lacks and which sent the first layout
 * looking for one (the same cost as the marks above). The text a screen
 * reader gets is the caller's: every price beside this carries the full
 * decimal for it.
 *
 * The small digit is drawn by CSS (`content: attr(data-zeros)`), so it is not
 * part of the text; in its place the text holds the zeros it stands for,
 * visually hidden (review 2, 2026-09-26). Copying the shown `$0.0₄254`, or
 * reading the element's text, gives `$0.0000254`. As a plain "4" it pasted as
 * `$0.04254`, a figure over a thousand times too large.
 */
export function PriceDigits({ text }: { text: string }): ReactNode {
  if (!SUBSCRIPT.test(text)) return text;
  return text.split(SUBSCRIPT).map((part, index) => {
    if (index % 2 === 0) return part;
    const zeros = Number([...part].map((digit) => String(digit.charCodeAt(0) - 0x2080)).join(''));
    return (
      <span key={index}>
        <span aria-hidden data-zeros={zeros} className="before:content-[attr(data-zeros)]" style={{ fontSize: '0.62em', verticalAlign: '-0.28em', lineHeight: 0 }} />
        {/*
          `$0.0` already prints one of the zeros. Hidden by size, not by
          `sr-only`: an inline box keeps the figure one line in `innerText`,
          where an absolute one broke it into three.
        */}
        <span style={{ fontSize: 0 }}>{'0'.repeat(Math.max(0, zeros - 1))}</span>
      </span>
    );
  });
}

/** The glyphs `Glyph` draws; a static test keeps new marks from slipping back in as text. */
export const DRAWN_GLYPHS: readonly string[] = Object.keys(SHAPES);
