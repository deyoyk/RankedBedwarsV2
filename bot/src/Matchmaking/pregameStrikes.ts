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

export const OFFLINE_WARP_REASON = 'Some players are offline';

export function leaversToStrikeOnGiveUp(lastFailureReason: string, leftPlayers: string[] | undefined): string[] {
  return lastFailureReason === OFFLINE_WARP_REASON ? leftPlayers ?? [] : [];
}

export interface AbandonedPregameDeps {
  voidGame(): Promise<unknown>;
  strike(left: string[]): Promise<unknown>;
  ackAlreadySettled(): void;
}

export async function settleAbandonedPregame(left: string[], deps: AbandonedPregameDeps): Promise<void> {
  try {
    await deps.voidGame();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already settled/i.test(message) && !/in progress/i.test(message)) {
      deps.ackAlreadySettled();
    }
    return;
  }
  if (left.length > 0) {
    await deps.strike(left);
  }
}
