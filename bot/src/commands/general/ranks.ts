
import { Message, ChatInputCommandInteraction } from 'discord.js';
import EloRank from '../../models/EloRank';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';


export async function ranks(interaction: Message | ChatInputCommandInteraction) {

  try {
    const ranks = await EloRank.find().sort({ startElo: 1 });
    if (!ranks.length) {
      await safeReply(interaction, errorEmbed('No ranks found.', 'Ranks'));
      return;
    }

    const rankLines = ranks.map(rank =>
      `<@&${rank.roleId}>: \`${rank.startElo}\` - \`${rank.endElo}\` ELO | Win: \`${rank.winElo}\` | Lose: \`${rank.loseElo}\` | MVP: \`${rank.mvpElo}\` | Bed: \`${rank.bedElo}\``
    );

    await safeReply(interaction, successEmbed(rankLines.join('\n'), 'Rank List'));
  } catch (error) {
    console.error('Error in ranks command:', error);
    await safeReply(interaction, errorEmbed('Failed to fetch ranks.', 'Ranks Error'));
  }
}