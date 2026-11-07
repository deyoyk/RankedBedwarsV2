import { EmbedBuilder } from 'discord.js';
import { themedEmbed } from './betterembed';

export const QUEUE_SYSTEM_TITLE = 'Queue System';
export const QUEUE_SYSTEM_COLOR = 0x71368A;

export type QueueEmbedStatus = 'info' | 'success' | 'error';

/**
 * Shared styling for every queue-system embed: purple accent, "Queue System"
 * title, and blockquoted status lines like the queue control panel.
 */
export function queueSystemEmbed(
  lines: string | string[],
  status: QueueEmbedStatus = 'info',
): EmbedBuilder {
  const input = Array.isArray(lines) ? lines : [lines];
  const allLines = input.flatMap(line => String(line).split('\n'));
  const symbol = status === 'success' ? ' ✓' : status === 'error' ? ' ✗' : '';

  const description = allLines
    .map((line, index) => `> ${line}${index === allLines.length - 1 ? symbol : ''}`)
    .join('\n');

  return themedEmbed(QUEUE_SYSTEM_COLOR)
    .setTitle(QUEUE_SYSTEM_TITLE)
    .setDescription(description)
    .setTimestamp();
}
