import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { queueSystemEmbed } from '../../utils/queueEmbed';
import Queue from '../../models/Queue';

export async function addqueue(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let channelId: string;
  let maxPlayers: number;
  let minElo: number;
  let maxElo: number;
  let isRanked: boolean;
  let isPicking: boolean;
  let bypassRoles: string[] = [];

  
    channelId = interaction.options.getString('channel_id', true);
    maxPlayers = interaction.options.getInteger('max_players', true);
    minElo = interaction.options.getInteger('min_elo', true);
    maxElo = interaction.options.getInteger('max_elo', true);
    isRanked = interaction.options.getBoolean('is_ranked', true);
    isPicking = interaction.options.getBoolean('is_picking', true);
    const bypassRolesStr = interaction.options.getString('bypass_roles', false);
    if (bypassRolesStr) {
      bypassRoles = bypassRolesStr.split(',').map(id => id.trim());
    }
  

  if (!/^\d{17,20}$/.test(channelId)) {
    await safeReply(interaction, { embeds: [queueSystemEmbed('channelId must be a Discord voice channel ID (17-20 digits).', 'error')] });
    return;
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2) {
    await safeReply(interaction, { embeds: [queueSystemEmbed('maxPlayers must be an integer of at least 2.', 'error')] });
    return;
  }
  if (!Number.isInteger(minElo) || !Number.isInteger(maxElo) || minElo < 0 || maxElo < 0 || minElo > maxElo) {
    await safeReply(interaction, { embeds: [queueSystemEmbed('minElo and maxElo must be integers with minElo no greater than maxElo.', 'error')] });
    return;
  }
  const badBypass = bypassRoles.find(id => !/^\d{17,20}$/.test(id));
  if (badBypass) {
    await safeReply(interaction, { embeds: [queueSystemEmbed(`Bypass role "${badBypass}" is not a valid Discord role ID.`, 'error')] });
    return;
  }

  const details = (queue: { maxPlayers: number; minElo: number; maxElo: number; isRanked?: boolean; isPicking?: boolean }) => [
    `**Channel:** <#${channelId}>`,
    `**Max Players:** ${queue.maxPlayers}`,
    `**ELO Range:** ${queue.minElo}-${queue.maxElo}`,
    `**Queue Type:** ${queue.isRanked ? 'Ranked' : 'Casual'}`,
    `**Picking:** ${queue.isPicking ? 'Enabled' : 'Disabled'}`,
  ];

  try {
    const existingQueue = await Queue.findOne({ channelId });
    if (existingQueue) {
      await safeReply(interaction, {
        embeds: [queueSystemEmbed([
          'A queue already exists for this channel.',
          ...details(existingQueue),
        ], 'error')]
      });
      return;
    }

    const queue = new Queue({
      channelId,
      maxPlayers,
      minElo,
      maxElo,
      isRanked,
      isPicking,
      bypassRoles,
      players: [],
      parties: []
    });

    let created = false;
    try {
      await queue.save();
      created = true;
    } catch (error: unknown) {
      const code = (error as { code?: unknown })?.code;
      if (code === 11000) {
        await safeReply(interaction, {
          embeds: [queueSystemEmbed([
            'A queue already exists for this channel.',
            `**Channel:** <#${channelId}>`,
            `**Max Players:** ${maxPlayers}`,
            `**ELO Range:** ${minElo}-${maxElo}`,
          ], 'error')]
        });
        return;
      }
      throw error;
    }

    if (created) {
      await safeReply(interaction, {
        embeds: [queueSystemEmbed([
          'A new queue has been created successfully!',
          ...details(queue),
          `**Bypass Roles:** ${bypassRoles.length > 0 ? bypassRoles.map(id => `<@&${id}>`).join(', ') : 'None'}`,
        ], 'success')]
      });
    }
  } catch (error) {
    console.error('Error in addqueue command:', error);
    await safeReply(interaction, { embeds: [queueSystemEmbed('There was an error creating the queue.', 'error')] });
  }
}
