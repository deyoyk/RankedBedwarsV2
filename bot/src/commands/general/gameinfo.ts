import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { betterEmbed } from '../../utils/betterembed';
import Game from '../../models/Game';

export async function gameinfo(interaction: Message | ChatInputCommandInteraction, args?: string[]): Promise<void> {
  let gameId: number | undefined;
  if (interaction instanceof ChatInputCommandInteraction) {
    gameId = interaction.options.getInteger('game_id', true);
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
  const game = await Game.findOne({ gameId }).select('-timeline').lean();
  if (!game) {
    await safeReply(interaction, 'Game not found!');
    return;
  }

  const f = (arr: string[]) => arr.length ? '\n- ' + arr.map(id => `<@${id}>`).join(' ') : 'None';
  const lines = [
    `**Map:** \`${game.map}\` | **State:** \`${game.state}\` | **Ranked:** \`${game.isRanked ? 'Yes' : 'No'}\``,
    `**Queue:** <#${game.queueId}>`,
    `**Start:** ${game.startTime ? `<t:${Math.floor(new Date(game.startTime).getTime()/1000)}:F>` : 'N/A'} | **End:** ${game.endTime ? `<t:${Math.floor(new Date(game.endTime).getTime()/1000)}:F>` : 'N/A'}`,
    `**Team 1:** ${f(game.team1)}`,
    `**Team 2:** ${f(game.team2)}`,
    `**Winners:** ${f(game.winners)}`,
    `**Losers:** ${f(game.losers)}`,
    `**MVPs:** ${f(game.mvps)}`,
    `**Bed Breaks:** ${f(game.bedbreaks)}`,
    `**Parties:** \`${game.partiesInThisGame || 'None'}\``,
    `**Reason:** \`${game.reason || 'None'}\``,
  ];
  const combat = game.combat;
  if (Array.isArray(combat) && combat.length > 0) {
    const rows = [...combat]
      .sort((a, b) => (b.damageDealt || 0) - (a.damageDealt || 0))
      .slice(0, 3)
      .map((c) => {
        const kills = c.kills || 0;
        const deaths = c.deaths || 0;
        const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
        const fights = Array.isArray(c.fights) ? c.fights.length : 0;
        return `<@${c.player}> dmg \`${Math.round(c.damageDealt || 0)}\` K/D \`${kills}/${deaths} (${kd})\` fights \`${fights}\``;
      });
    const firstBlood = combat.find((c) => c.firstBlood);
    lines.push(`**Top Damage:**\n- ${rows.join('\n- ')}`);
    lines.push(`**First Blood:** ${firstBlood ? `<@${firstBlood.player}>` : 'None'}`);
  }
  const embed = betterEmbed(
    lines.join('\n'),
    '#00AAAA',
    `Game #${game.gameId}`
  );
  await safeReply(interaction, { embeds: [embed.builder] });
  return;
}