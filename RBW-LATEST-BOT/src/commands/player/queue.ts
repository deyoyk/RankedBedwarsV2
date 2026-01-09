import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { betterEmbed } from '../../utils/betterembed';
import User from '../../models/User';
import Queue from '../../models/Queue';
import { queuePlayers } from '../../types/queuePlayersMemory';

export async function queue(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  try {
    const userId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
    
    const user = await User.findOne({ discordId: userId });
    if (!user) {
      await safeReply(interaction, betterEmbed('You are not registered. Please register first.', '#00AAAA', 'Not Registered'));
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, betterEmbed('This command can only be used in a server.', '#00AAAA', 'Guild Required'));
      return;
    }

    const member = await guild.members.fetch(userId);
    if (!member.voice.channel) {
      await safeReply(interaction, betterEmbed('You are not in a voice channel.', '#00AAAA', 'Not in Voice Channel'));
      return;
    }

    const queue = await Queue.findOne({ channelId: member.voice.channel.id });
    if (!queue) {
      await safeReply(interaction, betterEmbed('You are not in a queue channel.', '#00AAAA', 'Not in Queue'));
      return;
    }

    const playersInQueue = queuePlayers.get(queue.channelId) || [];
    if (playersInQueue.length === 0) {
      await safeReply(interaction, betterEmbed('No players are currently in this queue.', '#ffcc00', 'Empty Queue'));
      return;
    }

    const users = await User.find({ discordId: { $in: playersInQueue } });
    
    const playerInfo = users.map(user => {
      const wlr = user.wlr !== undefined ? user.wlr : (user.losses > 0 ? (user.wins / user.losses) : user.wins);
      const wlrFormatted = typeof wlr === 'number' ? wlr.toFixed(2) : '0.00';
      const mvpsFormatted = (user.mvps || 0).toString().padStart(2, '0');
      
      return ` - **User:** <@${user.discordId}> **WLR:** ${wlrFormatted} **Mvps:** ${mvpsFormatted}`;
    }).join('\n');

    const embed = betterEmbed(
      playerInfo,
      '#00AAAA',
      `Queue Information - ${member.voice.channel.name}`
    );

    embed.builder.addFields(
      { name: 'Players', value: `${playersInQueue.length}/${queue.maxPlayers}`, inline: true },
      { name: 'ELO Range', value: `${queue.minElo}-${queue.maxElo}`, inline: true },
      { name: 'Type', value: queue.isRanked ? 'Ranked' : 'Casual', inline: true },
      { name: 'Picking', value: queue.ispicking ? 'Enabled' : 'Disabled', inline: true }
    );

    embed.builder.setTimestamp();

    await safeReply(interaction, { embeds: [embed.builder] });

  } catch (error) {
    console.error('[Queue Command] Error:', error);
    await safeReply(interaction, betterEmbed('An error occurred while fetching queue information.', '#00AAAA', 'Error'));
  }
}