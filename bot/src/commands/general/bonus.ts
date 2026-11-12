import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import config from '../../config/config';
import { parseTiers, type ProgressionTier } from '../../utils/eloProgression';

const { errorEmbed, themedEmbed } = embedsFor('Rank');

function statusLine(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}

function tierLines(tiers: ProgressionTier[]): string[] {
  if (tiers.length === 0) return ['No tiers configured'];
  return tiers.map(tier => `${tier.threshold}+ winstreak → +${tier.bonus} ELO`);
}

function buildBonusDescription(): string {
  const lines: string[] = [
    '> Current bonus configuration used by scoring system.',
    '>',
    '> **[P] Winstreak Bonus**',
    `> ${statusLine(config.winStreakBonus.enabled)}`,
  ];

  if (config.winStreakBonus.enabled) {
    const tiers = parseTiers(config.winStreakBonus.tiers, []);
    for (const line of tierLines(tiers)) lines.push(`> ${line}`);
  }

  lines.push('>', '> **[T] Bounty Bonus | Winstreak**', `> ${statusLine(config.bounty.enabled)}`);

  if (config.bounty.enabled) {
    const tiers = parseTiers(config.bounty.tiers, []);
    for (const line of tierLines(tiers)) lines.push(`> ${line}`);
  }

  return lines.join('\n');
}

export async function bonus(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  try {
    const embed = themedEmbed()
      .setTitle('Scoring System')
      .setDescription(buildBonusDescription())
      .setTimestamp();

    await safeReply(interaction, { embeds: [embed] });
  } catch (error) {
    console.error('Error in bonus command:', error);
    await safeReply(interaction, errorEmbed('Failed to load bonus configuration.', 'Bonus Error'));
  }
}
