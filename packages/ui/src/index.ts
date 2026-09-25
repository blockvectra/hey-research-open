/*
 * Order matters here, and it should not (2026-09-14).
 *
 * Adding `./bubble-map` in the middle of this list turned the homepage's
 * theme-boot e2e green to red: `data-theme` was never stamped, the inline
 * theme script and the JSON-LD block both appeared twice, and the console
 * carried React error #418 — a hydration mismatch. Moving the same export to
 * the end made it pass again, with no change to the module itself.
 *
 * The hydration mismatch on `/` is **pre-existing**: error #418 is in the
 * console on a build with this file untouched too. What the export order
 * changes is only how React recovers from it, and one recovery path happens to
 * wipe the attribute the boot script set before paint. So the order is not the
 * bug, it is what made the bug visible.
 *
 * Until the mismatch itself is found, append new exports at the end rather
 * than slotting them alphabetically, and do not reorder this list "for
 * tidiness" without running the e2e suite.
 */
export * from './brand';
export * from './builder-activity';
export * from './logo';
export * from './project-logo';
export * from './charts';
export * from './code';
export * from './cn';
export * from './container';
export * from './format';
export * from './map';
export * from './narrative-color';
export * from './project-card';
export * from './project-visuals';
export * from './sections';
export * from './status';
export * from './timeline';
export * from './token-identity';
export * from './market-charts';
export * from './bubble-map';
export * from './sparkline';
export * from './terminal-chart';
export * from './daily-series-chart';
export * from './token-lock';
