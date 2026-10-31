const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a `yyyy-MM-dd` string as a UTC calendar date.
 *
 * Returns `null` for malformed or impossible dates. `new Date('2026-02-30')`
 * silently rolls over to March 2, so the parsed components are compared back
 * against the input instead of trusting the constructor.
 */
export function parseStrictDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}

/** True when `value` is a strict, real `yyyy-MM-dd` calendar date. */
export function isStrictIsoDate(value: string): boolean {
  return parseStrictDate(value) !== null;
}
