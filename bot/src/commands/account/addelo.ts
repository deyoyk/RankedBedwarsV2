import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import EloRank from '../../models/EloRank';
import { safeReply } from '../../utils/safeReply';

const { errorEmbed, successEmbed } = embedsFor('Rank');

export async function addelo(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let roleId: string;
  let startElo: number;
  let endElo: number;
  let winElo: number;
  let loseElo: number;
  let mvpElo: number;
  let bedElo: number;

  
    roleId = interaction.options.getString('role_id', true);
    startElo = interaction.options.getInteger('start_elo', true);
    endElo = interaction.options.getInteger('end_elo', true);
    winElo = interaction.options.getInteger('win_elo', true);
    loseElo = interaction.options.getInteger('lose_elo', true);
    mvpElo = interaction.options.getInteger('mvp_elo', true);
    bedElo = interaction.options.getInteger('bed_elo', false) ?? 0;

    
    if (!roleId || startElo === null || endElo === null || winElo === null || loseElo === null || mvpElo === null) {
      await safeReply(interaction, errorEmbed('All arguments are required and must be valid.', 'ELO Rank Creation Error'));
      return;
    }
  

  try {
    
    const existingRank = await EloRank.findOne({
      $or: [
        { startElo: { $lte: endElo }, endElo: { $gte: startElo } }
      ]
    });

    if (existingRank) {
      const embed = errorEmbed('This ELO range overlaps with an existing rank!', 'ELO Rank Creation Error').builder;
      embed.addFields(
        { name: 'Existing Range', value: `${existingRank.startElo}-${existingRank.endElo}`, inline: true },
        { name: 'Role', value: `<@&${existingRank.roleId}>`, inline: true }
      );
      await safeReply(interaction, { embeds: [embed] });
      return;
    }

    const rank = new EloRank({
      roleId,
      startElo,
      endElo,
      winElo,
      loseElo,
      mvpElo,
      bedElo
    });

    await rank.save();

    const embed = successEmbed('A new ELO rank has been created successfully!', 'ELO Rank Created');
    embed.builder.addFields(
      { name: 'Role', value: `<@&${roleId}>`, inline: true },
      { name: 'ELO Range', value: `${startElo}-${endElo}`, inline: true },
      { name: 'Win ELO', value: winElo.toString(), inline: true },
      { name: 'Lose ELO', value: loseElo.toString(), inline: true },
      { name: 'MVP Bonus', value: mvpElo.toString(), inline: true },
      { name: 'Bed ELO', value: bedElo.toString(), inline: true }
    );
    await safeReply(interaction, embed);
  } catch (error) {
    console.error('Error in addelo command:', error);
    await safeReply(interaction, errorEmbed('There was an error creating the ELO rank.', 'ELO Rank Creation Error'));
  }
}