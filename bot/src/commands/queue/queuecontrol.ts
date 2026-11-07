import { SlashCommandBuilder, Message, ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import Queue from '../../models/Queue';
import { safeReply } from '../../utils/safeReply';
import { queueSystemEmbed } from '../../utils/queueEmbed';
import config from '../../config/config';

function addQueueOptions(sub: SlashCommandSubcommandBuilder) {
  return sub
    .addStringOption(opt =>
      opt.setName('type')
        .setDescription('Type: ranked, unranked, or specific')
        .setRequired(true)
        .addChoices(
          { name: 'ranked', value: 'ranked' },
          { name: 'unranked', value: 'unranked' },
          { name: 'specific', value: 'specific' }
        )
    )
    .addStringOption(opt =>
      opt.setName('queue_id')
        .setDescription('Channel ID of the specific queue (if type is specific)')
        .setRequired(false)
    );
}

export const queueControlData = new SlashCommandBuilder()
  .setName('queuecontrol')
  .setDescription('Enable or disable queues by type or specific queue')
  .addSubcommand(sub => addQueueOptions(sub.setName('enable').setDescription('Enable queues')))
  .addSubcommand(sub => addQueueOptions(sub.setName('disable').setDescription('Disable queues')));

export async function queuecontrol(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager): Promise<void> {
  void wsManager;
  let sub: string;
  let type: string;
  let queueId: string | undefined;

  if (interaction instanceof ChatInputCommandInteraction) {
    sub = interaction.options.getSubcommand();
    type = interaction.options.getString('type', true);
    queueId = interaction.options.getString('queue_id') ?? undefined;
  } else {
    if (!args || args.length < 2) {
      await safeReply(interaction, { embeds: [queueSystemEmbed(`Usage: ${config.prefix}queuecontrol <enable|disable> <ranked|unranked|specific> [queue_id]`, 'error')] });
      return;
    }
    sub = args[0].toLowerCase();
    type = args[1].toLowerCase();
    queueId = args[2];
    if ((sub !== 'enable' && sub !== 'disable') || (type !== 'ranked' && type !== 'unranked' && type !== 'specific')) {
      await safeReply(interaction, { embeds: [queueSystemEmbed(`Usage: ${config.prefix}queuecontrol <enable|disable> <ranked|unranked|specific> [queue_id]`, 'error')] });
      return;
    }
  }

  let filter: Record<string, unknown> = {};
  if (type === 'ranked') filter = { isRanked: true };
  else if (type === 'unranked') filter = { isRanked: false };
  else if (type === 'specific') {
    if (!queueId) {
      await safeReply(interaction, { embeds: [queueSystemEmbed('You must provide a queue_id for specific type.', 'error')] });
      return;
    }
    filter = { channelId: queueId };
  }
  try {
    const update = sub === 'enable' ? { isActive: true } : { isActive: false };
    const result = await Queue.updateMany(filter, update);
    const label = type === 'specific'
      ? `<#${queueId}>`
      : `\`${type.charAt(0).toUpperCase()}${type.slice(1)}\``;
    const noun = type === 'specific' ? 'queue' : 'queues';
    const verb = sub === 'enable' ? 'opened' : 'closed';

    const message = result.modifiedCount > 0
      ? `Successfully ${verb} ${label} ${noun}`
      : `No matching ${label} ${noun} were updated`;

    await safeReply(interaction, {
      embeds: [queueSystemEmbed(message, result.modifiedCount > 0 ? 'success' : 'info')]
    });
  } catch {
    await safeReply(interaction, { embeds: [queueSystemEmbed('Error updating queues.', 'error')] });
  }
}

export const executeQueueControl = queuecontrol;
