/**
 * "An around-this-event panel was opened", told to the page (round 2,
 * 2026-10-01). This package cannot import the app's beacons, so the chart's
 * event panel announces the opening as a DOM event and the app's one
 * listener (`components/value-clicks.tsx`) reports `around_event.opened`.
 *
 * Announced only when a reader opened a panel that carries the before-and-
 * after rows — never on render, never on hover — so the useful-session
 * reason `around_event` stays "opened an event's before-and-after panel".
 */
export const AROUND_EVENT_OPENED = 'hey:around-event-opened' as const;

export type AroundEventOpenedSurface = 'project' | 'market' | 'terminal';

export type AroundEventOpenedDetail = { surface: AroundEventOpenedSurface; eventId: string };

export function announceAroundEventOpened(surface: AroundEventOpenedSurface, eventId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AroundEventOpenedDetail>(AROUND_EVENT_OPENED, { detail: { surface, eventId } }));
}
