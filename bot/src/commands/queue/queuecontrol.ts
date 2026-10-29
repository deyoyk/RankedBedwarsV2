import { SlashCommandBuilder, Message, ChatInputCommandInteraction, EmbedBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import Queue from '../../models/Queue';
import { safeReply } from '../../utils/safeReply';
import { errorEmbed } from '../../utils/betterembed';

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
      await safeReply(interaction, errorEmbed('Usage: =queuecontrol <enable|disable> <ranked|unranked|specific> [queue_id]', 'QueueControl Usage Error'));
      return;
    }
    sub = args[0].toLowerCase();
    type = args[1].toLowerCase();
    queueId = args[2];
    if ((sub !== 'enable' && sub !== 'disable') || (type !== 'ranked' && type !== 'unranked' && type !== 'specific')) {
      await safeReply(interaction, errorEmbed('Usage: =queuecontrol <enable|disable> <ranked|unranked|specific> [queue_id]', 'QueueControl Usage Error'));
      return;
    }
  }

  let filter: Record<string, unknown> = {};
  if (type === 'ranked') filter = { isRanked: true };
  else if (type === 'unranked') filter = { isRanked: false };
  else if (type === 'specific') {
    if (!queueId) {
      await safeReply(interaction, { content: 'You must provide a queue_id for specific type.', ephemeral: true });
      return;
    }
    filter = { channelId: queueId };
  }
  try {
    const update = sub === 'enable' ? { isActive: true } : { isActive: false };
    const result = await Queue.updateMany(filter, update);
    const embed = new EmbedBuilder()
      .setColor(sub === 'enable' ? '#00ff00' : '#00AAAA')
      .setTitle(sub === 'enable' ? 'Queues Enabled' : 'Queues Disabled')
      .setDescription(`Affected queues: ${result.modifiedCount}`);
    await safeReply(interaction, { embeds: [embed] });
  } catch {
    await safeReply(interaction, { content: 'Error updating queues.', ephemeral: true });
  }
}

// Backward-compatible alias (previous export name).
export const executeQueueControl = queuecontrol;
