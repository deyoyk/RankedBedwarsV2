import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { embedsFor } from '../../utils/betterembed';
import { safeFix } from '../../utils/fix';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { resetUserStats } from '../../utils/userStats';
import { countStatResetsInWindow, getStatResetAllowance } from '../../utils/statReset';
import { getMemberRoleIds } from '../../utils/memberRoles';
import { SeasonManager } from '../../managers/SeasonManager';
import config from '../../config/config';
import { auditInteractionContext, recordAudit } from '../../services/AuditService';

const { errorEmbed, successEmbed } = embedsFor('Player');

function actorId(interaction: ChatInputCommandInteraction): string {
  return interaction.user.id;
}

export async function statreset(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const discordId = actorId(interaction);
  try {
    const roleIds = await getMemberRoleIds(interaction, discordId);
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

    await recordAudit({
      ...auditInteractionContext(interaction),
      action: 'stats.self_reset',
      category: 'stats',
      source: 'discord',
      success: true,
      targetType: 'user',
      targetId: discordId,
      targetName: interaction.user?.username,
      reason: 'Donator stat reset',
      before: { statResetsUsed: used },
      after: { statResetsUsed: used + 1 },
      metadata: { allowed: Number.isFinite(allowed) ? allowed : 'unlimited', scope: config.statReset.scope, season: currentSeason?.seasonNumber, chapter: currentSeason?.chapterNumber },
    });

    const windowText = config.statReset.scope === 'season' ? `this season` : `the last ${config.statReset.windowDays} days`;
    const left = Number.isFinite(allowed)
      ? `Resets left for ${windowText}: **${allowed - (used + 1)}** (used ${used + 1}/${allowed}).`
      : 'You have unlimited resets.';
    await safeReply(interaction, successEmbed(`Your stats have been reset.\n${left}`, 'Stat Reset Successful'));
  } catch (error) {
    await replyCommandError(interaction, error, 'reset your stats', '[statreset]');
  }
}
