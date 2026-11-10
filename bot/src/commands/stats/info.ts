import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import Season from '../../models/Season';
import { errorEmbed, themedEmbed } from '../../utils/betterembed';
import { getLevelInfo } from '../../utils/levelSystem';

function number(value: number | undefined | null): string {
  return (Number.isFinite(value) ? Number(value) : 0).toLocaleString('en-US');
}

function decimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatPlaytime(seconds: number): string {
  if (seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days > 0 ? `${days}d` : '', hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '']
    .filter(Boolean)
    .join(' ') || '0m';
}

function timestamp(value: Date | string | undefined | null, style: 'F' | 'R'): string {
  if (!value) return 'N/A';
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'N/A';
}

export async function info(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const targetUserId = interaction.options.getUser('user')?.id || interaction.user.id;

  const user = await User.findOne({ discordId: targetUserId })
    .select('discordId ign wins losses games kills deaths mvps elo peakElo winStreak loseStreak bestStreak wlr kdr finalKills finalDeaths bedBroken diamonds irons gold emeralds blocksPlaced damageDealt damageTaken assists firstBloods playtimeSeconds level experience recentGames createdAt updatedAt lastPlayedAt isBanned isMuted isFrozen currentTheme seasonNumber chapterNumber strikes mutes bans statResets eloClaims')
    .lean();

  if (!user) {
    const notFoundEmbed = errorEmbed('User not found or not registered.', 'Info Error');
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
  const loseStreak = user.loseStreak || 0;
  const bestStreak = user.bestStreak || 0;
  const wlr = losses > 0 ? wins / losses : wins;
  const kdr = deaths > 0 ? kills / deaths : kills;
  const winRate = games > 0 ? wins / games : 0;
  const playtimeSeconds = user.playtimeSeconds || 0;
  const levelInfo = getLevelInfo(user.experience || 0);

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
    wlr,
    kills,
    kdr,
    mvps,
    winStreak,
    playtimeSeconds,
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
  const withRank = (value: string, key: string): string => `${value} (${rankOf(key)})`;
  const position = higherOf('position') + 1;

  const status = [
    user.isBanned ? 'Banned' : '',
    user.isFrozen ? 'Frozen' : '',
    user.isMuted ? 'Muted' : '',
  ].filter(Boolean).join(', ') || 'Active';

  const seasonLabel = season
    ? `${season.name || `Season ${season.seasonNumber}`} (S${season.seasonNumber} C${season.chapterNumber})`
    : user.seasonNumber
      ? `S${user.seasonNumber} C${user.chapterNumber ?? 1}`
      : 'N/A';

  const account = [
    `**IGN:** ${user.ign || 'Not set'}`,
    `**Discord:** <@${user.discordId}>`,
    `**Registered:** ${timestamp(user.createdAt, 'F')}`,
    `**Last Played:** ${timestamp(user.lastPlayedAt, 'R')}`,
    `**Season:** ${seasonLabel}`,
    `**Theme:** ${user.currentTheme || 'default'}`,
    `**Status:** ${status}`,
  ].join('\n');

  const progress = [
    `**ELO:** ${number(elo)} (#${position})`,
    `**Peak ELO:** ${number(user.peakElo)}`,
    `**Level:** ${number(user.level ?? levelInfo.level)}`,
    `**Experience:** ${number(user.experience)} XP`,
    `**XP to next level:** ${number(levelInfo.experienceNeededForNext)} XP`,
    `**Playtime:** ${withRank(formatPlaytime(playtimeSeconds), 'playtimeSecondsRank')}`,
  ].join('\n');

  const record = [
    `**Games:** ${number(games)}`,
    `**Wins:** ${withRank(number(wins), 'winsRank')}`,
    `**Losses:** ${withRank(number(losses), 'lossesRank')}`,
    `**Win Rate:** ${(winRate * 100).toFixed(1)}%`,
    `**W/L:** ${withRank(decimal(wlr), 'wlrRank')}`,
    `**Win Streak:** ${withRank(number(winStreak), 'winStreakRank')}`,
    `**Lose Streak:** ${number(loseStreak)}`,
    `**Best Streak:** ${number(bestStreak)}`,
    `**MVPs:** ${withRank(number(mvps), 'mvpsRank')}`,
  ].join('\n');

  const combat = [
    `**Kills:** ${withRank(number(kills), 'killsRank')}`,
    `**Deaths:** ${number(deaths)}`,
    `**K/D:** ${withRank(decimal(kdr), 'kdrRank')}`,
    `**Final Kills:** ${withRank(number(user.finalKills), 'finalKillsRank')}`,
    `**Final Deaths:** ${withRank(number(user.finalDeaths), 'finalDeathsRank')}`,
    `**Beds Broken:** ${withRank(number(user.bedBroken), 'bedBrokenRank')}`,
    `**Assists:** ${number(user.assists)}`,
    `**First Bloods:** ${number(user.firstBloods)}`,
    `**Damage Dealt:** ${number(user.damageDealt)}`,
    `**Damage Taken:** ${number(user.damageTaken)}`,
  ].join('\n');

  const resources = [
    `**Diamonds:** ${number(user.diamonds)}`,
    `**Irons:** ${number(user.irons)}`,
    `**Gold:** ${number(user.gold)}`,
    `**Emeralds:** ${number(user.emeralds)}`,
    `**Blocks Placed:** ${number(user.blocksPlaced)}`,
  ].join('\n');

  const moderation = [
    `**Strikes:** ${number(user.strikes?.length)}`,
    `**Mutes:** ${number(user.mutes?.length)}`,
    `**Bans:** ${number(user.bans?.length)}`,
    `**Stat Resets:** ${number(user.statResets?.length)}`,
    `**ELO Claims:** ${number(user.eloClaims?.length)}`,
    `**Recent Games Stored:** ${number(user.recentGames?.length)}`,
  ].join('\n');

  const embed = themedEmbed('info')
    .setTitle(user.ign || user.discordId)
    .setDescription(`Full player information and statistics for <@${user.discordId}>.`)
    .addFields(
      { name: 'Account', value: account, inline: true },
      { name: 'Progress', value: progress, inline: true },
      { name: 'Record', value: record, inline: true },
      { name: 'Combat', value: combat, inline: true },
      { name: 'Resources', value: resources, inline: true },
      { name: 'Moderation', value: moderation, inline: true },
    );

  await safeReply(interaction, { embeds: [embed] });
}
