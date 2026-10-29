import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { betterEmbed, errorEmbed, successEmbed } from '../../utils/betterembed';
import Queue from '../../models/Queue';





export async function addqueue(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  let channelId: string;
  let maxPlayers: number;
  let minElo: number;
  let maxElo: number;
  let isRanked: boolean;
  let isPicking: boolean;
  let bypassRoles: string[] = [];

  if (interaction instanceof ChatInputCommandInteraction) {
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
  } else {
    if (!args || args.length < 6) {
      await safeReply(interaction, errorEmbed('Usage: =addqueue <channelId> <maxPlayers> <minElo> <maxElo> <isRanked> <isPicking> [bypassRoles]', 'Queue Creation Error'));
      return;
    }
    channelId = args[0];
    maxPlayers = parseInt(args[1], 10);
    minElo = parseInt(args[2], 10);
    maxElo = parseInt(args[3], 10);
    isRanked = args[4].toLowerCase() === 'true';
    isPicking = args[5].toLowerCase() === 'true';
    if (args.length > 6) {
      bypassRoles = args[6].split(',').map(id => id.trim());
    }
  }

  if (!/^\d{17,20}$/.test(channelId)) {
    await safeReply(interaction, errorEmbed('channelId must be a Discord voice channel ID (17-20 digits).', 'Queue Creation Error'));
    return;
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2) {
    await safeReply(interaction, errorEmbed('maxPlayers must be an integer of at least 2.', 'Queue Creation Error'));
    return;
  }
  if (!Number.isInteger(minElo) || !Number.isInteger(maxElo) || minElo < 0 || maxElo < 0 || minElo > maxElo) {
    await safeReply(interaction, errorEmbed('minElo and maxElo must be integers with minElo no greater than maxElo.', 'Queue Creation Error'));
    return;
  }
  const badBypass = bypassRoles.find(id => !/^\d{17,20}$/.test(id));
  if (badBypass) {
    await safeReply(interaction, errorEmbed(`Bypass role "${badBypass}" is not a valid Discord role ID.`, 'Queue Creation Error'));
    return;
  }

  try {
    const existingQueue = await Queue.findOne({ channelId });
    if (existingQueue) {
      const embed = betterEmbed('A queue already exists for this channel!', '#00AAAA', 'Queue Creation Error');
      embed.builder.addFields(
        { name: 'Channel ID', value: channelId, inline: true },
        { name: 'Max Players', value: existingQueue.maxPlayers.toString(), inline: true },
        { name: 'ELO Range', value: `${existingQueue.minElo}-${existingQueue.maxElo}`, inline: true }
      );
      await safeReply(interaction, embed);
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
        const embed = betterEmbed('A queue already exists for this channel!', '#00AAAA', 'Queue Creation Error');
        embed.builder.addFields(
          { name: 'Channel ID', value: channelId, inline: true },
          { name: 'Max Players', value: maxPlayers.toString(), inline: true },
          { name: 'ELO Range', value: `${minElo}-${maxElo}`, inline: true }
        );
        await safeReply(interaction, embed);
        return;
      }
      throw error;
    }
    if (created) {
      const embed = successEmbed('A new queue has been created successfully!', 'Queue Created');
    embed.builder.addFields(
      { name: 'Channel ID', value: channelId, inline: true },
      { name: 'Max Players', value: maxPlayers.toString(), inline: true },
      { name: 'ELO Range', value: `${minElo}-${maxElo}`, inline: true },
      { name: 'Queue Type', value: isRanked ? 'Ranked' : 'Casual', inline: true },
      { name: 'Picking Enabled', value: isPicking ? 'Yes' : 'No', inline: true },
      { name: 'Bypass Roles', value: bypassRoles.length > 0 ? bypassRoles.join(', ') : 'None', inline: true }
    );
    await safeReply(interaction, embed);
    }
  } catch (error) {
    console.error('Error in addqueue command:', error);
    await safeReply(interaction, errorEmbed('There was an error creating the queue.', 'Queue Creation Error'));
  }
}