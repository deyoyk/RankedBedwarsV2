export function parseDiscordId(input: string | undefined | null): string | null {
  if (!input || typeof input !== 'string') return null;
  const match = input.match(/^<@!?(\d{17,20})>$/) || input.match(/^(\d{17,20})$/);
  return match ? match[1] : null;
}

export function isValidIgn(ign: string | undefined | null): boolean {
  return typeof ign === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(ign);
}

export function parsePositiveInt(input: string | undefined | null, min = 1): number | null {
  if (typeof input !== 'string') return null;
  const value = parseInt(input, 10);
  if (!Number.isInteger(value) || value < min) return null;
  return value;
}
