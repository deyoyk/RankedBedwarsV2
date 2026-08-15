const PERMANENT_KEYWORDS = new Set(['perm', 'permanent', 'inf', 'infinite', 'forever']);

const UNIT_MS: Record<string, number> = {
  month: 30 * 24 * 60 * 60 * 1000,
  months: 30 * 24 * 60 * 60 * 1000,
  mo: 30 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  min: 60 * 1000,
  m: 60 * 1000,
  second: 1000,
  seconds: 1000,
  sec: 1000,
  s: 1000
};

const UNIT_ALTERNATION = 'months|month|weeks|week|minutes|minute|seconds|second|hours|hour|days|day|mo|min|sec|w|d|h|m|s';

const TOKEN_PATTERN = new RegExp(`\\d+(?:${UNIT_ALTERNATION})`, 'g');
const TOKEN_VALUE = new RegExp(`^(\\d+)(${UNIT_ALTERNATION})$`);

/**
 * Parses a human-readable duration string into milliseconds.
 *
 * Supported formats: combinations of number+unit tokens, e.g. "1h30m", "2d",
 * "45min", "1 day", "1 month", "1w". Units can repeat ("1d1d" = 2 days).
 * Returns `null` for permanent keywords (perm/permanent/inf/infinite/forever)
 * and for empty input. Throws for any unparseable input so callers never
 * silently convert garbage into a permanent punishment.
 */
export function parseDuration(str: string): number | null {
  if (!str) return null;
  const cleaned = str.toLowerCase().replace(/\s+/g, '');
  if (!cleaned) return null;
  if (PERMANENT_KEYWORDS.has(cleaned)) return null;

  const tokens = cleaned.match(TOKEN_PATTERN);
  if (!tokens || tokens.join('') !== cleaned) {
    throw new Error(`Invalid duration format: "${str}". Use formats like 1d, 2h30m, 45min, 1w, or 1 month.`);
  }

  let totalMs = 0;
  for (const token of tokens) {
    const match = token.match(TOKEN_VALUE);
    if (!match || !(match[2] in UNIT_MS)) {
      throw new Error(`Invalid duration format: "${str}".`);
    }
    totalMs += parseInt(match[1], 10) * UNIT_MS[match[2]];
  }
  return totalMs;
}
