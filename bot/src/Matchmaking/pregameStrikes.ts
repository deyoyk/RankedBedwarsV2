export const PREGAME_STRIKE_REASON = 'Left before the game started';

export interface PregameStrikeDeps {
  discordIdOf(ign: string): Promise<string | null>;
  strike(discordId: string, reason: string): Promise<unknown>;
}

export async function strikeLeavers(igns: string[] | undefined, deps: PregameStrikeDeps): Promise<string[]> {
  const struck: string[] = [];
  const seen = new Set<string>();
  for (const ign of igns ?? []) {
    const key = ign?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      const discordId = await deps.discordIdOf(ign);
      if (!discordId) continue;
      await deps.strike(discordId, PREGAME_STRIKE_REASON);
      struck.push(ign);
    } catch (error) {
      console.error(`[PregameStrikes] Could not strike ${ign}:`, error);
    }
  }
  return struck;
}
