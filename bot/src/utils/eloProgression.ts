export interface ProgressionTier {
  threshold: number;
  bonus: number;
}

export interface DecayBand {
  minElo: number;
  maxElo: number;
  amount: number;
}

export function parseTiers(raw: string | undefined, fallback: ProgressionTier[]): ProgressionTier[] {
  if (!raw || !raw.trim()) return [...fallback];
  const tiers: ProgressionTier[] = [];
  for (const part of raw.split(',')) {
    const [t, b] = part.split(':').map(s => s.trim());
    const threshold = parseInt(t ?? '', 10);
    const bonus = parseInt(b ?? '', 10);
    if (Number.isInteger(threshold) && threshold > 0 && Number.isInteger(bonus) && bonus > 0) {
      tiers.push({ threshold, bonus });
    }
  }
  if (tiers.length === 0) return [...fallback];
  tiers.sort((a, b) => a.threshold - b.threshold);
  return tiers;
}

export function streakBonusFor(newWinStreak: number, tiers: ProgressionTier[]): number {
  let bonus = 0;
  for (const tier of tiers) {
    if (tier.threshold === newWinStreak) {
      bonus = Math.max(bonus, tier.bonus);
    }
  }
  return bonus;
}

export function bountyForOpponentStreak(maxOpponentStreak: number, tiers: ProgressionTier[]): number {
  let bonus = 0;
  for (const tier of tiers) {
    if (maxOpponentStreak >= tier.threshold) {
      bonus = Math.max(bonus, tier.bonus);
    }
  }
  return bonus;
}

export function decayAmountForElo(elo: number, bands: DecayBand[]): number {
  for (const band of bands) {
    if (elo >= band.minElo && elo <= band.maxElo) {
      return band.amount;
    }
  }
  return 0;
}

export function isDecayProtected(createdAt: Date | undefined, now: Date, graceDays: number): boolean {
  if (!createdAt || graceDays <= 0) return false;
  return now.getTime() - createdAt.getTime() < graceDays * 24 * 60 * 60 * 1000;
}
