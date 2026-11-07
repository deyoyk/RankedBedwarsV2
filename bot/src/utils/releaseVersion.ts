import pkg from '../../package.json';

const REPO = 'deyoyk/RankedBedwarsV2';
const CACHE_TTL_MS = 10 * 60 * 1000;

let cached: { value: string; at: number } | null = null;
let inFlight: Promise<string> | null = null;

export function fallbackReleaseVersion(): string {
  return `v${pkg.version}`;
}

export function clearReleaseVersionCache(): void {
  cached = null;
  inFlight = null;
}

export async function getReleaseVersion(): Promise<string> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'RankedBedwarsBot',
        },
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
      const data = await response.json() as { tag_name?: unknown };
      const tag = typeof data.tag_name === 'string' && data.tag_name.trim()
        ? data.tag_name.trim()
        : fallbackReleaseVersion();
      cached = { value: tag, at: Date.now() };
      return tag;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ReleaseVersion] Could not fetch the latest GitHub release (${message}); using ${fallbackReleaseVersion()}`);
      cached = { value: fallbackReleaseVersion(), at: Date.now() };
      return cached.value;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
