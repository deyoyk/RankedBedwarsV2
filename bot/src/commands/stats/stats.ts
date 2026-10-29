import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import Season from '../../models/Season';
import { betterEmbed } from '../../utils/betterembed';
import { resolveTheme } from '../../themes';
import { getLevelInfo } from '../../utils/levelSystem';

 

export async function stats(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  let targetUserId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    targetUserId = interaction.options.getUser('user')?.id || interaction.user.id;
  } else {
    targetUserId = args && args[0] ? args[0].replace(/[<@!>]/g, '') : interaction.author.id;
  }


  

  const user = await User.findOne({ discordId: targetUserId })
    .select('discordId ign wins losses games kills deaths mvps elo winStreak loseStreak wlr kdr finalKills bedBroken finalDeaths playtimeSeconds experience recentGames createdAt')
    .lean();

  if (!user) {
    const notFoundEmbed = betterEmbed('User not found or not registered.', '#00AAAA', 'Stats Error');
    await safeReply(interaction, { embeds: [notFoundEmbed.builder] });
    return;
  }

  if (!(interaction instanceof ChatInputCommandInteraction) && (!args || args.length === 0)) {
    const usageEmbed = betterEmbed('Usage: =stats <@user|userId>', '#ffcc00', 'Stats Usage');
    await safeReply(interaction, { embeds: [usageEmbed.builder] });
    return;
  }

  
  const wins = user.wins || 0;
  const losses = user.losses || 0;
  const games = user.games || 0;
  const kills = user.kills || 0;
  const deaths = user.deaths || 0;
  const mvps = user.mvps || 0;
  const elo = user.elo || 0;
  const winStreak = user.winStreak || 0;
  const loseStreak = user.loseStreak || 0;
  const wlr = losses > 0 ? wins / losses : wins;
  const kdr = deaths > 0 ? kills / deaths : kills;
  const winRate = games > 0 ? wins / games : 0;

  const levelInfo = getLevelInfo(user.experience || 0);
  const xpProgress = levelInfo.totalExperienceForLevel > 0
    ? 1 - levelInfo.experienceNeededForNext / levelInfo.totalExperienceForLevel
    : 0;

  const joined = user.createdAt
    ? `Joined ${user.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : '';

  const playSecs = user.playtimeSeconds || 0;
  const playtime = playSecs < 3600 ? `${Math.floor(playSecs / 60)}m` : playSecs < 86400 ? `${Math.floor(playSecs / 3600)}h` : `${Math.floor(playSecs / 86400)}d`;
  const streak = winStreak > 0 ? `+${winStreak}` : loseStreak > 0 ? `-${loseStreak}` : '0';

  const rankOf = async (field: string, value: number): Promise<string> => {
    const higher = await User.countDocuments({ [field]: { $gt: value } });
    return `#${higher + 1}`;
  };

  const season = await Season.findOne({ isActive: true }).lean();
  const [winsRank, lossesRank, wlrRank, killsRank, kdrRank, mvpsRank, streakRank, playtimeRank, finalKillsRank, bedsRank, finalDeathsRank] = await Promise.all([
    rankOf('wins', wins),
    rankOf('losses', losses),
    rankOf('wlr', user.wlr || 0),
    rankOf('kills', kills),
    rankOf('kdr', user.kdr || 0),
    rankOf('mvps', mvps),
    rankOf('winStreak', winStreak),
    rankOf('playtimeSeconds', playSecs),
    rankOf('finalKills', user.finalKills || 0),
    rankOf('bedBroken', user.bedBroken || 0),
    rankOf('finalDeaths', user.finalDeaths || 0),
  ]);

  const playerData = {
    discordid: user.discordId,
    ign: user.ign || 'Player',
    wins,
    losses,
    mvps,
    elo,
    gamesplayed: games,
    games,
    joined,
    level: levelInfo.level,
    xpToNext: levelInfo.experienceNeededForNext,
    xpProgress,
    winRate,
    winCaption: `${(winRate * 100).toFixed(1)}% win rate · ${games} games`,
    tiles: [
      { value: String(wins), label: 'Wins', accent: '#00e676', rank: winsRank },
      { value: String(losses), label: 'Losses', accent: '#ff5252', rank: lossesRank },
      { value: wlr.toFixed(2), label: 'W/L ratio', accent: '#8b5cf6', rank: wlrRank },
      { value: String(kills), label: 'Total Kills', accent: '#8b5cf6', rank: killsRank },
      { value: kdr.toFixed(2), label: 'K/D ratio', accent: '#00e5ff', rank: kdrRank },
      { value: String(mvps), label: 'MVPs', accent: '#ffd600', rank: mvpsRank },
      { value: streak, label: 'Streak', accent: '#ff9100', rank: streakRank },
      { value: playtime, label: 'Playtime', accent: '#ffd600', rank: playtimeRank },
    ],
    combat: [
      { value: String(user.finalKills || 0), label: 'Final Kills', accent: '#8b5cf6', rank: finalKillsRank },
      { value: String(user.bedBroken || 0), label: 'Beds Broken', accent: '#8b5cf6', rank: bedsRank },
      { value: String(user.finalDeaths || 0), label: 'Final Deaths', accent: '#8b5cf6', rank: finalDeathsRank },
    ],
    seasonLine1: season ? (season.name || `SEASON ${season.seasonNumber} CHAPTER ${season.chapterNumber}`).toUpperCase() : '',
    seasonLine2: season?.startDate ? new Date(season.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
  };

  const sortedRecent = [...(user.recentGames || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const recentGames = sortedRecent.slice(0, 10).map(g => {
    let result: string | undefined;
    if (g.state === 'scored') result = g.won ? 'win' : 'lose';
    else if (g.state === 'voided') result = 'voided';
    else result = 'pending';
    return { game_id: g.gameId, result };
  });

  
  async function calculatePosition(_discordId: string): Promise<number> {
    const higher = await User.countDocuments({ elo: { $gt: elo } });
    return higher + 1;
  }

  const generator = resolveTheme('default');

  const buffer = await generator(playerData, recentGames, {
    calculatePosition,
    calculateRating: (pd) => pd.elo,
  });

  await safeReply(interaction, { files: [{ attachment: buffer, name: `${playerData.ign}_stats.png` }], content: '' });
}