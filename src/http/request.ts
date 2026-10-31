/**
 * Parses a delimited query parameter into a trimmed, non-empty list.
 * Returns `undefined` when the parameter is missing or contains no values.
 */
export function parseDelimitedList(value: string | null, separators: string | RegExp = ','): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(separators)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items.length > 0 ? items : undefined;
}

/** Parses an optional integer query parameter, preserving `NaN` for invalid input. */
export function parseOptionalInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  return Number.parseInt(value, 10);
}
