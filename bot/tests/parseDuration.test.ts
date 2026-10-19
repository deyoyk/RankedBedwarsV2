import { parseDuration } from '../src/utils/parseDuration';

describe('parseDuration', () => {
  it('parses single units', () => {
    expect(parseDuration('1h')).toBe(60 * 60 * 1000);
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    expect(parseDuration('45min')).toBe(45 * 60 * 1000);
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration('1mo')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseDuration('1month')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(parseDuration('30s')).toBe(30 * 1000);
    expect(parseDuration('1w')).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration('2 weeks')).toBe(14 * 24 * 60 * 60 * 1000);
    expect(parseDuration('5 minutes')).toBe(5 * 60 * 1000);
    expect(parseDuration('3 hours')).toBe(3 * 60 * 60 * 1000);
    expect(parseDuration('10 seconds')).toBe(10 * 1000);
  });

  it('parses compound durations', () => {
    expect(parseDuration('1h30m')).toBe(60 * 60 * 1000 + 30 * 60 * 1000);
    expect(parseDuration('2d3h')).toBe(2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000);
    expect(parseDuration('1d1d')).toBe(2 * 24 * 60 * 60 * 1000);
    expect(parseDuration('1h30m45s')).toBe(60 * 60 * 1000 + 30 * 60 * 1000 + 45 * 1000);
  });

  it('tolerates spaces and uppercase', () => {
    expect(parseDuration('1 day')).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration('2H 30M')).toBe(2 * 60 * 60 * 1000 + 30 * 60 * 1000);
    expect(parseDuration('  1d  ')).toBe(24 * 60 * 60 * 1000);
  });

  it('returns null for permanent keywords and empty input', () => {
    expect(parseDuration('perm')).toBeNull();
    expect(parseDuration('permanent')).toBeNull();
    expect(parseDuration('inf')).toBeNull();
    expect(parseDuration('infinite')).toBeNull();
    expect(parseDuration('forever')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration(undefined as any)).toBeNull();
  });

  it('throws for unparseable input instead of silently returning 0', () => {
    expect(() => parseDuration('toxic')).toThrow();
    expect(() => parseDuration('1.5h')).toThrow();
    expect(() => parseDuration('h')).toThrow();
    expect(() => parseDuration('1d2')).toThrow();
    expect(() => parseDuration('12345')).toThrow();
    expect(() => parseDuration('1 minute please')).toThrow();
  });

  it('does not confuse minutes with months', () => {
    expect(parseDuration('1m')).toBe(60 * 1000);
    expect(parseDuration('1mo')).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
