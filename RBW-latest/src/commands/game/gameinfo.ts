import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { betterEmbed } from '../../utils/betterembed';
import Game from '../../models/Game';

export async function gameinfo(interaction: Message | ChatInputCommandInteraction, args?: string[]): Promise<void> {
  let gameId: number | undefined;
  if (interaction instanceof ChatInputCommandInteraction) {
    gameId = interaction.options.getInteger('gameid', true);
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, 'Usage: =gameinfo <gameId>');
      return;
    }
    gameId = parseInt(args[0]);
  }
  if (!gameId || isNaN(gameId)) {
    await safeReply(interaction, 'Invalid game ID.');
    return;
  }
  const game = await Game.findOne({ gameId });
  if (!game) {
    await safeReply(interaction, 'Game not found!');
    return;
  }

  const f = (arr: string[], label: string) => arr.length ? '\n- ' + arr.map(id => `<@${id}>`).join(' ') : 'None';
  const embed = betterEmbed(
    [
      `**Map:** \`${game.map}\` | **State:** \`${game.state}\` | **Ranked:** \`${game.isRanked ? 'Yes' : 'No'}\``,
      `**Queue:** <#${game.queueId}>`,
      `**Start:** ${game.startTime ? `<t:${Math.floor(new Date(game.startTime).getTime()/1000)}:F>` : 'N/A'} | **End:** ${game.endTime ? `<t:${Math.floor(new Date(game.endTime).getTime()/1000)}:F>` : 'N/A'}`,
      `**Team 1:** ${f(game.team1, 'Team 1')}`,
      `**Team 2:** ${f(game.team2, 'Team 2')}`,
      `**Winners:** ${f(game.winners, 'Winners')}`,
      `**Losers:** ${f(game.losers, 'Losers')}`,
      `**MVPs:** ${f(game.mvps, 'MVPs')}`,
      `**Bed Breaks:** ${f(game.bedbreaks, 'Bed Breaks')}`,
      `**Parties:** \`${game.partiesInThisGame || 'None'}\``,
      `**Reason:** \`${game.reason || 'None'}\``,
    ].join('\n'),
    '#00AAAA',
    `Game #${game.gameId}`
  );
  await safeReply(interaction, { embeds: [embed.builder] });
  return;
}