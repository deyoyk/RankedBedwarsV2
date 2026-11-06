import { Message, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeFix } from '../../utils/fix';
import { safeReply } from '../../utils/safeReply';
import { resetUserStats } from '../../utils/userStats';
import { countStatResetsInWindow, getStatResetAllowance } from '../../utils/statReset';
import { SeasonManager } from '../../managers/SeasonManager';
import config from '../../config/config';

function actorId(interaction: Message | ChatInputCommandInteraction): string {
  return interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
}

async function memberRoleIds(interaction: Message | ChatInputCommandInteraction, discordId: string): Promise<string[]> {
  const member = interaction.member as GuildMember | null;
  const fromCache = (m?: unknown): string[] | null => {
    const cache = (m as { roles?: { cache?: unknown } })?.roles?.cache as unknown as { keys?: unknown } | null;
    if (!cache) return null;
    if (typeof cache.keys === 'function') return Array.from((cache as { keys: () => Iterable<string> }).keys());
    return null;
  };
  const cached = fromCache(member);
  if (cached) return cached;
  if (interaction.guild) {
    const fetched = await interaction.guild.members.fetch(discordId).catch(() => null) as unknown;
    const ids = fromCache(fetched);
    if (ids) return ids;
  }
  return [];
}

export async function statreset(interaction: Message | ChatInputCommandInteraction, _args?: string[], _wsManager?: WebSocketManager) {
  const discordId = actorId(interaction);
  try {
    const roleIds = await memberRoleIds(interaction, discordId);
    const allowed = getStatResetAllowance(roleIds, config.statReset.roles);
    if (allowed <= 0) {
      await safeReply(interaction, errorEmbed('You do not have a donator role with stat resets.', 'Stat Reset Error'));
      return;
    }

    const user = await User.findOne({ discordId }).lean() as unknown as { statResets?: Array<{ date: Date; seasonNumber?: number; chapterNumber?: number }> } | null;
    if (!user) {
      await safeReply(interaction, errorEmbed('You need to register first!', 'Stat Reset Error'));
      return;
    }

    const currentSeason = config.statReset.scope === 'season' ? await SeasonManager.getCurrentSeason() : null;
    const used = countStatResetsInWindow(user.statResets ?? [], config.statReset.scope, config.statReset.windowDays, currentSeason);
    if (used >= allowed) {
      const windowText = config.statReset.scope === 'season' ? `this season` : `the last ${config.statReset.windowDays} days`;
      await safeReply(interaction, errorEmbed(`You have used all ${allowed} stat resets for ${windowText}.`, 'Stat Reset Error'));
      return;
    }

    const zeroed: Record<string, unknown> = {};
    resetUserStats(zeroed);
    const entry: Record<string, unknown> = { date: new Date() };
    if (currentSeason) {
      entry.seasonNumber = currentSeason.seasonNumber;
      entry.chapterNumber = currentSeason.chapterNumber;
    }
    const wiped = await User.findOneAndUpdate(
      { discordId },
      { $set: zeroed, $push: { statResets: entry } },
      { new: true }
    );
    if (!wiped) {
      await safeReply(interaction, errorEmbed('User not found in the database.', 'Stat Reset Error'));
      return;
    }

    await safeFix(interaction.guild, discordId);

    const windowText = config.statReset.scope === 'season' ? `this season` : `the last ${config.statReset.windowDays} days`;
    const remaining = allowed - (used + 1);
    await safeReply(interaction, successEmbed(`Your stats have been reset.\nResets left for ${windowText}: **${remaining}** (used ${used + 1}/${allowed}).`, 'Stat Reset Successful'));
  } catch (error) {
    console.error('Error in statreset command:', error);
    await safeReply(interaction, errorEmbed('There was an error resetting your stats.', 'Stat Reset Error'));
  }
}
