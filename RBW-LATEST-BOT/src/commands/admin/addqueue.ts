import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { betterEmbed, errorEmbed, successEmbed } from '../../utils/betterembed';
import Queue from '../../models/Queue';





export async function addqueue(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let channelId: string;
  let maxPlayers: number;
  let minElo: number;
  let maxElo: number;
  let isRanked: boolean;
  let ispicking: boolean;
  let bypassRoles: string[] = [];

  if (interaction instanceof ChatInputCommandInteraction) {
    channelId = interaction.options.getString('channelid', true);
    maxPlayers = interaction.options.getInteger('maxplayers', true);
    minElo = interaction.options.getInteger('minelo', true);
    maxElo = interaction.options.getInteger('maxelo', true);
    isRanked = interaction.options.getBoolean('isranked', true);
    ispicking = interaction.options.getBoolean('ispicking', true);
    const bypassRolesStr = interaction.options.getString('bypassroles', false);
    if (bypassRolesStr) {
      bypassRoles = bypassRolesStr.split(',').map(id => id.trim());
    }
  } else {
    if (!args || args.length < 7) {
      await safeReply(interaction, errorEmbed('Usage: =addqueue <channelId> <maxPlayers> <minElo> <maxElo> <isRanked> <ispicking> [bypassRoles]', 'Queue Creation Error'));
      return;
    }
    channelId = args[0];
    maxPlayers = parseInt(args[1]);
    minElo = parseInt(args[2]);
    maxElo = parseInt(args[3]);
    isRanked = args[4].toLowerCase() === 'true';
    ispicking = args[5].toLowerCase() === 'true';
    if (args.length > 7) {
      bypassRoles = args[7].split(',').map(id => id.trim());
    }
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
      ispicking,
      bypassRoles,
      players: [],
      parties: []
    });

    await queue.save();

    const embed = successEmbed('A new queue has been created successfully!', 'Queue Created');
    embed.builder.addFields(
      { name: 'Channel ID', value: channelId, inline: true },
      { name: 'Max Players', value: maxPlayers.toString(), inline: true },
      { name: 'ELO Range', value: `${minElo}-${maxElo}`, inline: true },
      { name: 'Queue Type', value: isRanked ? 'Ranked' : 'Casual', inline: true },
      { name: 'Picking Enabled', value: ispicking ? 'Yes' : 'No', inline: true },
      { name: 'Bypass Roles', value: bypassRoles.length > 0 ? bypassRoles.join(', ') : 'None', inline: true }
    );
    await safeReply(interaction, embed);
  } catch (error) {
    console.error('Error in addqueue command:', error);
    await safeReply(interaction, errorEmbed('There was an error creating the queue.', 'Queue Creation Error'));
  }
}