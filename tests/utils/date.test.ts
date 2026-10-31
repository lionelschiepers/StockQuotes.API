import { isStrictIsoDate, parseStrictDate } from '../../src/utils/date';

describe('parseStrictDate', () => {
  it('parses a valid calendar date as UTC midnight', () => {
    const date = parseStrictDate('2024-03-15');

    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe('2024-03-15T00:00:00.000Z');
  });

  it('accepts February 29 in a leap year', () => {
    expect(parseStrictDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('rejects February 29 in a non-leap year', () => {
    expect(parseStrictDate('2023-02-29')).toBeNull();
  });

  it('rejects days that do not exist in the month', () => {
    expect(parseStrictDate('2026-02-30')).toBeNull();
    expect(parseStrictDate('2026-04-31')).toBeNull();
  });

  it('rejects out-of-range month and day values', () => {
    expect(parseStrictDate('2026-00-10')).toBeNull();
    expect(parseStrictDate('2026-13-10')).toBeNull();
    expect(parseStrictDate('2026-01-00')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseStrictDate('')).toBeNull();
    expect(parseStrictDate('15-03-2024')).toBeNull();
    expect(parseStrictDate('2024-3-15')).toBeNull();
    expect(parseStrictDate('2024-03-15T00:00:00Z')).toBeNull();
  });

  it('isStrictIsoDate mirrors parseStrictDate', () => {
    expect(isStrictIsoDate('2024-12-31')).toBe(true);
    expect(isStrictIsoDate('2024-02-30')).toBe(false);
  });
});
