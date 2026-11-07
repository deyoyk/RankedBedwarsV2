import { ChatInputCommandInteraction, GuildMember, Message } from 'discord.js';

function roleIdsFromMember(member: unknown): string[] | null {
  const cache = (member as { roles?: { cache?: unknown } })?.roles?.cache as unknown as { keys?: unknown } | null;
  if (!cache) return null;
  if (typeof cache.keys === 'function') {
    return Array.from((cache as { keys: () => Iterable<string> }).keys());
  }
  return null;
}

/**
 * Resolves the Discord role IDs for a member, falling back to a guild fetch
 * when the interaction's member cache does not expose role keys.
 */
export async function getMemberRoleIds(
  interaction: Message | ChatInputCommandInteraction,
  discordId: string,
): Promise<string[]> {
  const member = interaction.member as GuildMember | null;
  const cached = roleIdsFromMember(member);
  if (cached) return cached;
  if (interaction.guild) {
    const fetched = await interaction.guild.members.fetch(discordId).catch(() => null) as unknown;
    const ids = roleIdsFromMember(fetched);
    if (ids) return ids;
  }
  return [];
}
