import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { betterEmbed, errorEmbed, successEmbed } from '../../utils/betterembed';
import EloRank from '../../models/EloRank';
import { safeReply } from '../../utils/safeReply';

 



export async function addelo(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  let roleId: string;
  let startElo: number;
  let endElo: number;
  let winElo: number;
  let loseElo: number;
  let mvpElo: number;
  let bedElo: number;

  if (interaction instanceof ChatInputCommandInteraction) {
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
  } else {
    if (!args || args.length < 6) {
      await safeReply(interaction, errorEmbed('Usage: =addelo <roleId> <startElo> <endElo> <winElo> <loseElo> <mvpElo> [bedElo]', 'ELO Rank Creation Error'));
      return;
    }
    roleId = args[0];
    startElo = Number(args[1]);
    endElo = Number(args[2]);
    winElo = Number(args[3]);
    loseElo = Number(args[4]);
    mvpElo = Number(args[5]);
    bedElo = args.length > 6 ? Number(args[6]) : 0;
    
    if (!roleId || isNaN(startElo) || isNaN(endElo) || isNaN(winElo) || isNaN(loseElo) || isNaN(mvpElo) || (args.length > 6 && isNaN(bedElo))) {
      await safeReply(interaction, errorEmbed('All arguments are required and must be valid numbers.', 'ELO Rank Creation Error'));
      return;
    }
  }

  try {
    
    const existingRank = await EloRank.findOne({
      $or: [
        { startElo: { $lte: endElo }, endElo: { $gte: startElo } }
      ]
    });

    if (existingRank) {
      const embed = betterEmbed('This ELO range overlaps with an existing rank!', '#00AAAA', 'ELO Rank Creation Error');
      embed.builder.addFields(
        { name: 'Existing Range', value: `${existingRank.startElo}-${existingRank.endElo}`, inline: true },
        { name: 'Role', value: `<@&${existingRank.roleId}>`, inline: true }
      );
      await safeReply(interaction, embed);
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