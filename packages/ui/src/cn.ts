export type ClassValue = string | number | false | null | undefined;

/**
 * Minimal class-name joiner. Deliberately dependency-free: HEY's visual system
 * is a small set of utility classes, not a variant framework.
 */
export function cn(...values: ClassValue[]): string {
  return values
    .filter(
      (value): value is string | number =>
        value !== null && value !== undefined && value !== false && value !== '',
    )
    .join(' ');
}
