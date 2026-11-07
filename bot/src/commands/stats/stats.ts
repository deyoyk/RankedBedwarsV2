import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import Season from '../../models/Season';
import { errorEmbed, warningEmbed } from '../../utils/betterembed';
import { resolveTheme } from '../../assets/stats-theme';
import { getLevelInfo } from '../../utils/levelSystem';
import { resolveRecentGameResult } from '../../utils/recentGameResult';

export async function stats(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const targetUserId = interaction.options.getUser('user')?.id || interaction.user.id;



  

  const user = await User.findOne({ discordId: targetUserId })
    .select('discordId ign wins losses games kills deaths mvps elo winStreak loseStreak wlr kdr finalKills bedBroken finalDeaths playtimeSeconds experience recentGames createdAt')
    .lean();

  if (!user) {
    const notFoundEmbed = errorEmbed('User not found or not registered.', 'Stats Error');
    await safeReply(interaction, { embeds: [notFoundEmbed.builder] });
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
  const streak = winStreak > 0 ? `+${winStreak}` : '0';

  const rankFields = [
    'wins',
    'losses',
    'wlr',
    'kills',
    'kdr',
    'mvps',
    'winStreak',
    'playtimeSeconds',
    'finalKills',
    'bedBroken',
    'finalDeaths',
  ] as const;
  const rankValues: Record<(typeof rankFields)[number], number> = {
    wins,
    losses,
    wlr: user.wlr || 0,
    kills,
    kdr: user.kdr || 0,
    mvps,
    winStreak,
    playtimeSeconds: playSecs,
    finalKills: user.finalKills || 0,
    bedBroken: user.bedBroken || 0,
    finalDeaths: user.finalDeaths || 0,
  };
  type FacetStage = { $match: Record<string, unknown> } | { $count: string };
  const rankFacet: Record<string, FacetStage[]> = {};
  for (const field of rankFields) {
    rankFacet[`${field}Rank`] = [{ $match: { [field]: { $gt: rankValues[field] } } }, { $count: 'n' }];
  }
  rankFacet.position = [{ $match: { elo: { $gt: elo } } }, { $count: 'n' }];

  const seasonPromise = Season.findOne({ isActive: true }).lean();
  const [facetCounts] = (await User.aggregate([{ $facet: rankFacet }])) as Array<Record<string, Array<{ n: number }>>>;
  const season = await seasonPromise;

  const higherOf = (key: string): number => facetCounts?.[key]?.[0]?.n ?? 0;
  const rankOf = (key: string): string => `#${higherOf(key) + 1}`;

  const winsRank = rankOf('winsRank');
  const lossesRank = rankOf('lossesRank');
  const wlrRank = rankOf('wlrRank');
  const killsRank = rankOf('killsRank');
  const kdrRank = rankOf('kdrRank');
  const mvpsRank = rankOf('mvpsRank');
  const streakRank = rankOf('winStreakRank');
  const playtimeRank = rankOf('playtimeSecondsRank');
  const finalKillsRank = rankOf('finalKillsRank');
  const bedsRank = rankOf('bedBrokenRank');
  const finalDeathsRank = rankOf('finalDeathsRank');
  const position = higherOf('position') + 1;

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
  const recentGames = sortedRecent.slice(0, 10).map(g => ({
    game_id: g.gameId,
    result: resolveRecentGameResult(g),
  }));

  
  async function calculatePosition(_discordId: string): Promise<number> {
    void _discordId;
    return position;
  }

  const generator = resolveTheme('default');

  let buffer: Buffer;
  try {
    buffer = await generator(playerData, recentGames, {
      calculatePosition,
      calculateRating: (pd) => pd.elo,
    });
  } catch (error) {
    console.error('[Stats] Failed to generate stats image:', error);
    const busyEmbed = warningEmbed(
      'Stats image generation is under heavy load right now. Please try again in a few seconds.',
      'Stats Busy',
    );
    await safeReply(interaction, { embeds: [busyEmbed.builder] });
    return;
  }

  await safeReply(interaction, {
    files: [{ attachment: buffer, name: `${playerData.ign}_stats.png` }]
  });
}