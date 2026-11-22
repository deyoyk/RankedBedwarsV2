export const MAX_DISCORD_LOOKUP = 50;

export interface DiscordLookupDeps {
  discordIdOf(ign: string): Promise<string | null>;
  usernameOf(discordId: string): Promise<string | null>;
}

export async function lookupDiscordNames(igns: string[], deps: DiscordLookupDeps): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  for (const ign of igns.slice(0, MAX_DISCORD_LOOKUP)) {
    let username: string | null = null;
    try {
      const discordId = await deps.discordIdOf(ign);
      username = discordId ? await deps.usernameOf(discordId) : null;
    } catch (error) {
      console.warn(`[DiscordLookup] Lookup for ${ign} failed:`, error);
    }
    results[ign] = username;
  }
  return results;
}
