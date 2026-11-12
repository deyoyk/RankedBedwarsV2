/** "lighthouse4v4" / "Lighthouse 4v4" -> "Lighthouse" (the mode suffix is shown elsewhere). */
export function formatMapName(raw: string | null | undefined): string {
  if (!raw) return 'Unknown';
  const match = raw.match(/(\d+v\d+)/i);
  const base = (match ? raw.slice(0, match.index).trim() || raw : raw).replace(/[_-]+/g, ' ').trim();
  return base
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
