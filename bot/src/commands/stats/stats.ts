import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import User, { type IUser } from '../../models/User';
import { resolveTheme } from '../../assets/stats-theme';
import type { EnrichedPlayerData, PlayerData, RecentGame } from '../../assets/stats-theme/base';
import { getRankInfo } from '../../utils/rankInfo';
import { getDivisionTag } from '../../utils/divisionTags';
import config, { buildPlayerResultUrl } from '../../config/config';

const { errorEmbed } = embedsFor('Player');

export function recentResults(user: Pick<IUser, 'recentGames'>): RecentGame[] {
  return [...(user.recentGames || [])]
    .sort((a, b) => new Date(b?.date ?? 0).getTime() - new Date(a?.date ?? 0).getTime())
    .slice(0, 10)
    .map(game => ({
      gameid: game.gameId,
      result: game.state === 'scored' ? (game.won ? 'win' : 'lose') : game.state === 'voided' ? 'voided' : 'pending',
    }));
}

export async function stats(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  try {
    const targetId = interaction.options.getUser('user')?.id ?? interaction.user.id;
    const user = await User.findOne({ discordId: targetId });
    if (!user) {
      await safeReply(interaction, errorEmbed(targetId === interaction.user.id
        ? "You're not registered yet. Use `/register` first."
        : `<@${targetId}> isn't registered.`));
      return;
    }

    const wins = user.wins || 0;
    const losses = user.losses || 0;
    const games = user.games || 0;
    const elo = user.elo || 0;
    const winstreak = user.winStreak || 0;
    const losestreak = user.loseStreak || 0;
    const wlr = losses > 0 ? (wins / losses).toFixed(2) : wins > 0 ? String(wins) : 'N/A';
    const guild = interaction.guild ?? interaction.client.guilds.cache.first() ?? null;
    const rank = await getRankInfo(elo, guild);

    const rankOf = async (field: string, value: number): Promise<string> => {
      const higher = await User.countDocuments({ [field]: { $gt: value } });
      return `#${higher + 1}`;
    };
    const streak = winstreak > 0 ? winstreak : losestreak > 0 ? -losestreak : 0;
    const [eloPos, winsPos, lossesPos, wlrPos, mvpsPos, bedsPos, streakPos, divisionTag] = await Promise.all([
      rankOf('elo', elo),
      rankOf('wins', wins),
      rankOf('losses', losses),
      rankOf('wlr', user.wlr || 0),
      rankOf('mvps', user.mvps || 0),
      rankOf('bedBroken', user.bedBroken || 0),
      rankOf(winstreak > 0 ? 'winStreak' : 'loseStreak', Math.abs(streak)),
      getDivisionTag(user.discordId),
    ]);

    const playerData: EnrichedPlayerData = {
      discordid: user.discordId,
      ign: user.ign || 'Player',
      wins,
      losses,
      mvps: user.mvps || 0,
      elo,
      gamesplayed: games,
      rankName: rank.name,
      rankColor: rank.color,
      wlr,
      beds: user.bedBroken || 0,
      streak,
      divisionTag,
      positions: {
        elo: eloPos,
        wins: winsPos,
        losses: lossesPos,
        wlr: wlrPos,
        mvps: mvpsPos,
        beds: bedsPos,
        streak: streakPos,
      },
    };

    const helpers = {
      calculatePosition: async () => (await User.countDocuments({ elo: { $gt: elo } })) + 1,
      calculateRating: (pd: PlayerData) => pd.elo,
    };

    const image = await resolveTheme()(playerData, recentResults(user), helpers);

    const websiteButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View full stats')
        .setStyle(ButtonStyle.Link)
        .setURL(buildPlayerResultUrl(config.gameResultUrl, playerData.ign)),
    );

    await safeReply(interaction, {
      files: [{ attachment: image, name: `${playerData.ign}_stats.png` }],
      components: [websiteButton],
    });
  } catch (error) {
    await replyCommandError(interaction, error, 'load those stats', '[stats]');
  }
}
