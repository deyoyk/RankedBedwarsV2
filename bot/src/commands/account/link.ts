import { ChatInputCommandInteraction } from 'discord.js';
import { embedsFor } from '../../utils/betterembed';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import { safeFix } from '../../utils/fix';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import config from '../../config/config';
import { auditInteractionContext, recordAudit } from '../../services/AuditService';
import { linkCodes } from '../../services/LinkCodes';

const { errorEmbed, successEmbed } = embedsFor('Player');

export async function link(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const discordId = interaction.user.id;
  const claim = linkCodes.claim(interaction.options.getString('code', true), discordId);
  if ('error' in claim) {
    await safeReply(interaction, errorEmbed(
      claim.error === 'locked'
        ? 'Too many wrong codes. Wait 10 minutes, then run `/link` in game for a new one.'
        : `That code is wrong or has expired. Run \`/link\` on \`${config.serverip}\` for a new one.`,
      'Link Error'
    ));
    return;
  }
  const { ign } = claim;

  try {
    const owner = await User.findOne({ ign }).collation({ locale: 'en', strength: 2 }).select('discordId').lean();
    if (owner && owner.discordId !== discordId) {
      await safeReply(interaction, errorEmbed(`**${ign}** is already linked to another Discord account.`, 'Link Error'));
      return;
    }
    if (owner) {
      await safeFix(interaction.guild, discordId);
      await safeReply(interaction, successEmbed(`You're already linked to **${ign}**.`, 'Linked'));
      return;
    }

    const previous = await User.findOneAndUpdate({ discordId }, { $set: { ign } }, { new: false }).select('ign').lean();
    if (!previous) {
      await User.create({ discordId, ign });
    }
    await safeFix(interaction.guild, discordId);

    await recordAudit({
      ...auditInteractionContext(interaction),
      action: previous ? 'account.relink' : 'account.register',
      category: 'account',
      source: 'discord',
      success: true,
      targetType: 'user',
      targetId: discordId,
      targetName: ign,
      before: previous ? { ign: previous.ign } : undefined,
      after: { ign },
    });

    await safeReply(interaction, successEmbed(
      previous
        ? `Your account is now linked to **${ign}** (was **${previous.ign}**).`
        : `Your account is linked to **${ign}**. Your nickname and roles are set up.`,
      'Linked'
    ));
  } catch (error) {
    if ((error as { code?: unknown })?.code === 11000) {
      await safeReply(interaction, errorEmbed(`**${ign}** is already linked to another Discord account.`, 'Link Error'));
      return;
    }
    await replyCommandError(interaction, error, 'link your account', '[link]');
  }
}
