import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import EloRank from '../../models/EloRank';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { auditInteractionContext, recordAudit } from '../../services/AuditService';

const { errorEmbed, successEmbed } = embedsFor('Rank');

export async function removeelo(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let roleId: string;

  
    roleId = interaction.options.getString('role_id', true);
  

  try {
    const rank = await EloRank.findOneAndDelete({ roleId });

    if (!rank) {
      await safeReply(interaction, errorEmbed('No ELO rank found with the specified role ID.', 'ELO Rank Removal Error'));
      return;
    }

    await recordAudit({
      ...auditInteractionContext(interaction),
      action: 'config.elo_rank_remove',
      category: 'config',
      source: 'discord',
      success: true,
      targetType: 'role',
      targetId: roleId,
      before: { roleId, startElo: rank.startElo, endElo: rank.endElo },
    });

    const embed = successEmbed('The ELO rank has been successfully removed!', 'ELO Rank Removed');
    embed.builder.addFields(
      { name: 'Role', value: `<@&${roleId}>`, inline: true },
      { name: 'ELO Range', value: `${rank.startElo}-${rank.endElo}`, inline: true }
    );
    await safeReply(interaction, embed);
  } catch (error) {
    await replyCommandError(interaction, error, 'remove the ELO rank', '[removeelo]');
  }
}