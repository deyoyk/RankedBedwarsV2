import { EmbedBuilder } from 'discord.js';
import { themedEmbed } from './betterembed';

export const QUEUE_SYSTEM_TITLE = 'Queue System';

export type QueueEmbedStatus = 'info' | 'success' | 'error';

export function queueSystemEmbed(
  lines: string | string[],
  status: QueueEmbedStatus = 'info',
): EmbedBuilder {
  const input = Array.isArray(lines) ? lines : [lines];
  const description = input.flatMap(line => String(line).split('\n')).join('\n');

  return themedEmbed(status)
    .setTitle(QUEUE_SYSTEM_TITLE)
    .setDescription(description);
}
