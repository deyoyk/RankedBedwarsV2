
import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { getEloRanks } from '../../utils/fix';
import config from '../../config/config';
import { parseTiers } from '../../utils/eloProgression';


export async function ranks(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {

  try {
    const ranks = (await getEloRanks()).slice().sort((a, b) => a.startElo - b.startElo);
    if (!ranks.length) {
      await safeReply(interaction, errorEmbed('No ranks found.', 'Ranks'));
      return;
    }

    const rankLines = ranks.map(rank =>
      `<@&${rank.roleId}>: \`${rank.startElo}\` - \`${rank.endElo}\` ELO | Win: \`${rank.winElo}\` | Lose: \`${rank.loseElo}\` | MVP: \`${rank.mvpElo}\` | Bed: \`${rank.bedElo}\``
    );

    const sections = [rankLines.join('\n'), buildDecaySection(), buildStreakSection(), buildBountySection()].filter(Boolean);

    await safeReply(interaction, successEmbed(sections.join('\n\n'), 'Rank List'));
  } catch (error) {
    console.error('Error in ranks command:', error);
    await safeReply(interaction, errorEmbed('Failed to fetch ranks.', 'Ranks Error'));
  }
}

function buildDecaySection(): string {
  const decay = config.eloDecay;
  if (!decay.enabled) {
    return 'Decay\nDisabled';
  }
  return [
    'Decay',
    `After ${decay.inactivityDays} days of inactivity:`,
    `${decay.midMin} - ${decay.midMax} Elo -> \`-${decay.midAmount} Elo\``,
    `${decay.highMin}+ Elo -> \`-${decay.highAmount} Elo\``,
    `New accounts safe for ${decay.rankGraceDays} days`,
  ].join('\n');
}

function buildStreakSection(): string {
  if (!config.winStreakBonus.enabled) {
    return 'Win Streak Bonuses\nDisabled';
  }
  const tiers = parseTiers(config.winStreakBonus.tiers, []);
  if (tiers.length === 0) {
    return 'Win Streak Bonuses\nDisabled';
  }
  return [
    'Win Streak Bonuses',
    ...tiers.map(t => `${t.threshold} win streak -> \`+${t.bonus} Elo\``),
  ].join('\n');
}

function buildBountySection(): string {
  if (!config.bounty.enabled) {
    return 'Bounties\nDisabled';
  }
  const tiers = parseTiers(config.bounty.tiers, []);
  if (tiers.length === 0) {
    return 'Bounties\nDisabled';
  }
  return [
    'Bounties',
    ...tiers.map(t => `${t.threshold}+ win streak beaten -> \`+${t.bonus} Elo\``),
  ].join('\n');
}