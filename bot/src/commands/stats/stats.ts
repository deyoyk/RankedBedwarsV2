import { ChatInputCommandInteraction, Guild } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import User, { type IUser } from '../../models/User';
import { resolveTheme } from '../../themes';
import type { PlayerData, RecentGame } from '../../themes/base';
import { getRankInfo } from '../../utils/rankInfo';

const { errorEmbed } = embedsFor('Player');

export const DEFAULT_THEME = 'veltrix';

/** A theme the player may use: the default one, or one an admin gave them. */
export function themeFor(user: Pick<IUser, 'currentTheme' | 'ownedThemes'>): string {
  const chosen = (user.currentTheme || DEFAULT_THEME).toLowerCase();
  return chosen === DEFAULT_THEME || (user.ownedThemes || []).includes(chosen) ? chosen : DEFAULT_THEME;
}

async function primeRankOf(guild: Guild | null, discordId: string): Promise<string | null> {
  const member = guild ? await guild.members.fetch(discordId).catch(() => null) : null;
  if (!member) return null;
  for (const tier of ['prime++', 'prime+', 'prime']) {
    if (member.roles.cache.some(role => role.name.toLowerCase().trim() === tier)) return tier;
  }
  return null;
}

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

    const guild = interaction.guild ?? interaction.client.guilds.cache.first() ?? null;
    const playerData: PlayerData = {
      discordid: user.discordId,
      ign: user.ign || 'Player',
      primeRank: await primeRankOf(guild, user.discordId),
      wins: user.wins || 0,
      losses: user.losses || 0,
      mvps: user.mvps || 0,
      elo: user.elo || 0,
      gamesplayed: user.games || 0,
      winstreak: user.winStreak || 0,
      losestreak: user.loseStreak || 0,
      level: user.level || 1,
      experience: user.experience || 0,
      kills: user.kills || 0,
      deaths: user.deaths || 0,
      bedBroken: user.bedBroken || 0,
      finalKills: user.finalKills || 0,
      diamonds: user.diamonds || 0,
      irons: user.irons || 0,
      gold: user.gold || 0,
      emeralds: user.emeralds || 0,
      blocksPlaced: user.blocksPlaced || 0,
      rankInfo: await getRankInfo(user.elo || 0, guild),
    };
    const helpers = {
      calculatePosition: async () => (await User.countDocuments({ elo: { $gt: playerData.elo } })) + 1,
      calculateRating: (pd: PlayerData) => pd.elo,
    };

    const theme = themeFor(user);
    let image: Buffer;
    try {
      image = await resolveTheme(theme)(playerData, recentResults(user), helpers);
    } catch (themeError) {
      console.warn(`[stats] Theme "${theme}" failed, drawing the default one:`, themeError);
      image = await resolveTheme(DEFAULT_THEME)(playerData, recentResults(user), helpers);
    }

    await safeReply(interaction, { files: [{ attachment: image, name: `${playerData.ign}_stats.png` }] });
  } catch (error) {
    console.error('[stats] Error drawing stats:', error);
    await safeReply(interaction, errorEmbed('Could not load those stats. Try again.'));
  }
}
