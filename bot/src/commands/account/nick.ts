import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import UserModel from '../../models/User';
import { fix } from '../../utils/fix';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { auditInteractionContext, recordAudit } from '../../services/AuditService';

const { errorEmbed, successEmbed } = embedsFor('Player');

export async function nick(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const userId = interaction.user.id;
  const action = interaction.options.getString('action', true).toLowerCase();
  const nickname = (interaction.options.getString('nickname') || '').trim();

  if (action === 'set') {
    if (!nickname) {
      await safeReply(interaction, errorEmbed('Please provide a nickname to set.', 'Nickname Error'));
      return;
    }
    const updated = await UserModel.findOneAndUpdate(
      { discordId: userId },
      { $set: { 'settings.nick': nickname } },
      { new: true }
    );
    if (!updated) {
      await safeReply(interaction, errorEmbed('You need to register first!', 'Nickname Error'));
      return;
    }
    if (interaction.guild) {
      await fix(interaction.guild, userId);
    }
    await recordAudit({
      ...auditInteractionContext(interaction),
      action: 'account.nick_set',
      category: 'account',
      source: 'discord',
      success: true,
      targetType: 'user',
      targetId: userId,
      after: { nick: nickname },
    });
    await safeReply(interaction, successEmbed(`Your nickname has been set to: **${nickname}**`, 'Nickname Set'));
  } else if (action === 'remove') {
    const previous = await UserModel.findOneAndUpdate(
      { discordId: userId },
      { $set: { 'settings.nick': '' } }
    );
    if (!previous) {
      await safeReply(interaction, errorEmbed('You need to register first!', 'Nickname Error'));
      return;
    }
    if (!previous.settings?.nick) {
      await safeReply(interaction, errorEmbed('You do not have a nickname set.', 'Nickname Error'));
      return;
    }
    if (interaction.guild) {
      await fix(interaction.guild, userId);
    }
    await recordAudit({
      ...auditInteractionContext(interaction),
      action: 'account.nick_remove',
      category: 'account',
      source: 'discord',
      success: true,
      targetType: 'user',
      targetId: userId,
      before: { nick: previous.settings?.nick },
      after: { nick: '' },
    });
    await safeReply(interaction, successEmbed('Your nickname has been removed.', 'Nickname Removed'));
  } else {
    await safeReply(interaction, errorEmbed('Invalid action! Use: set or remove', 'Nickname Error'));
  }
}
