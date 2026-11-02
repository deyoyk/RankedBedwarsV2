export interface MapHeatOptions {
  lookbackGames: number;
  globalWeight: number;
  historySize: number;
}

export interface ScoredMap {
  name: string;
  heat: number;
}

export function resolveMapFrequencyOptions(raw?: {
  enabled?: boolean;
  lookbackGames?: number;
  historySize?: number;
  globalWeight?: number;
}): Required<MapHeatOptions> & { enabled: boolean } {
  const lookbackGames = raw && Number.isInteger(raw.lookbackGames) && (raw.lookbackGames as number) > 0 ? (raw.lookbackGames as number) : 5;
  const historySize = raw && Number.isInteger(raw.historySize) && (raw.historySize as number) > 0 ? (raw.historySize as number) : 50;
  const globalWeight = raw && typeof raw.globalWeight === 'number' && (raw.globalWeight as number) >= 0 ? (raw.globalWeight as number) : 1;
  return { enabled: !raw || raw.enabled !== false, lookbackGames, historySize, globalWeight };
}

export function scoreMapsByFrequency(
  candidateNames: string[],
  perPlayerRecentMaps: string[][],
  globalHistory: string[],
  options: MapHeatOptions
): ScoredMap[] {
  const lookback = Math.max(1, Math.floor(options.lookbackGames));
  const history = options.historySize > 0 ? globalHistory.slice(-Math.floor(options.historySize)) : [];
  const globalCounts = new Map<string, number>();
  for (const name of history) {
    globalCounts.set(name, (globalCounts.get(name) ?? 0) + 1);
  }
  const playerHeat = new Map<string, number>();
  for (const recent of perPlayerRecentMaps) {
    const trimmed = recent.slice(0, lookback);
    for (let i = 0; i < trimmed.length; i++) {
      const name = trimmed[i];
      playerHeat.set(name, (playerHeat.get(name) ?? 0) + (lookback - i));
    }
  }
  return candidateNames.map(name => ({
    name,
    heat: (globalCounts.get(name) ?? 0) * options.globalWeight + (playerHeat.get(name) ?? 0),
  }));
}

export function pickLeastPlayedMap(scored: ScoredMap[], random: () => number = Math.random): string | null {
  if (scored.length === 0) return null;
  let best = scored[0].heat;
  for (const s of scored) {
    if (s.heat < best) best = s.heat;
  }
  const coolest = scored.filter(s => s.heat === best);
  return coolest[Math.floor(random() * coolest.length)].name;
}
