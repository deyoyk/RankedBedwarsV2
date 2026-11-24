import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { embedsFor, EMBED_COLORS, themedEmbed } from '../../utils/betterembed';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { StrikeRuleService, StrikeRuleSettings, actionFor } from '../../services/StrikeRuleService';
import { parseDuration } from '../../utils/parseDuration';

const { errorEmbed } = embedsFor('Punishments');

interface TimedRecord {
  reason?: string;
  date: Date | string;
  duration?: number;
}

interface StrikeRecord {
  reason?: string;
  date: Date | string;
}

export interface CurrentPunishments {
  ban: TimedRecord | null;
  mute: TimedRecord | null;
  strikes: StrikeRecord[];
}

export function formatMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return 'Permanent';
  const units: Array<[number, string]> = [[60 * 24 * 7, 'week'], [60 * 24, 'day'], [60, 'hour'], [1, 'minute']];
  const parts: string[] = [];
  let left = Math.round(minutes);
  for (const [size, name] of units) {
    const count = Math.floor(left / size);
    if (count > 0 && parts.length < 2) {
      parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
      left -= count * size;
    }
  }
  return parts.join(' ');
}

const stamp = (date: Date | string, style: 'R' | 'D') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

function timedLines(record: TimedRecord): string {
  const minutes = record.duration ?? 0;
  const ends = minutes > 0
    ? stamp(new Date(new Date(record.date).getTime() + minutes * 60000), 'R')
    : 'Never';
  return [
    `> **Reason:** ${record.reason || 'No reason given'}`,
    `> **Duration:** \`${formatMinutes(minutes)}\``,
    `> **Ends:** ${ends}`,
  ].join('\n');
}

export function nextStrikeText(count: number, rules: StrikeRuleSettings): string | null {
  const action = actionFor(rules, count + 1);
  if (action === 'warn') return null;
  const ms = parseDuration(action);
  const length = ms === null ? 'permanent' : formatMinutes(Math.round(ms / 60000)).replace(/(\d+ \w+?)s\b/g, '$1');
  return `-# Your next strike means a **${length} ban**.`;
}

export function buildPunishmentView(current: CurrentPunishments, rules: StrikeRuleSettings = StrikeRuleService.current()) {
  const color = current.ban || current.mute ? EMBED_COLORS.error : current.strikes.length ? EMBED_COLORS.warning : EMBED_COLORS.info;
  const embed = themedEmbed(color).setHeader('Punishments');
  const empty = !current.ban && !current.mute && current.strikes.length === 0;
  const body: string[] = ['-# ➡ Your current punishments'];
  if (empty) {
    body.push('✅ You have no active punishments. Keep it up!');
    return embed.setDescription(body.join('\n'));
  }
  embed.setDescription(body.join('\n'));
  if (current.ban) embed.addFields({ name: '🔨 Ranked ban', value: timedLines(current.ban) });
  if (current.mute) embed.addFields({ name: '🔇 Mute', value: timedLines(current.mute) });
  if (current.strikes.length) {
    const shown = current.strikes.slice(-10);
    const skipped = current.strikes.length - shown.length;
    const lines = [
      ...(skipped ? [`> -# …${skipped} older`] : []),
      ...shown.map((s, i) => `> **${skipped + i + 1}.** ${(s.reason || 'No reason given').slice(0, 60)} · ${stamp(s.date, 'D')}`),
    ];
    const next = nextStrikeText(current.strikes.length, rules);
    embed.addFields({ name: `⚠️ Strikes (${current.strikes.length})`, value: [...lines, ...(next ? ['', next] : [])].join('\n').slice(0, 1024) });
  }
  return embed;
}

export async function loadCurrent(discordId: string): Promise<CurrentPunishments | null> {
  const user = await User.findOne({ discordId }).select('isBanned isMuted bans mutes strikes').lean() as {
    isBanned?: boolean; isMuted?: boolean; bans?: TimedRecord[]; mutes?: TimedRecord[]; strikes?: StrikeRecord[];
  } | null;
  if (!user) return null;
  return {
    ban: user.isBanned ? user.bans?.at(-1) ?? null : null,
    mute: user.isMuted ? user.mutes?.at(-1) ?? null : null,
    strikes: user.strikes ?? [],
  };
}

export async function punishment(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  try {
    const current = await loadCurrent(interaction.user.id);
    if (!current) {
      await safeReply(interaction, errorEmbed("You aren't registered, so you have no punishments here.", 'Punishments', true));
      return;
    }
    await safeReply(interaction, { embeds: [buildPunishmentView(current)], flags: 64 });
  } catch (error) {
    await replyCommandError(interaction, error, 'show your punishments', '[punishment]');
  }
}
