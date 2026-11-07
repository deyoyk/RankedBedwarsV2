import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { queueSystemEmbed } from '../../utils/queueEmbed';
import User from '../../models/User';
import Queue from '../../models/Queue';
import { queuePlayers } from '../../types/queuePlayersMemory';

export async function queue(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  try {
    const userId = interaction.user.id;

    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, { embeds: [queueSystemEmbed('This command can only be used in a server.', 'error')] });
      return;
    }

    const [user, member] = await Promise.all([
      User.findOne({ discordId: userId }).select('_id').lean(),
      guild.members.cache?.get(userId) ?? guild.members.fetch(userId).catch(() => null)
    ]);
    if (!user) {
      await safeReply(interaction, { embeds: [queueSystemEmbed('You are not registered. Please register first.', 'error')] });
      return;
    }

    if (!member?.voice.channel) {
      await safeReply(interaction, { embeds: [queueSystemEmbed('You are not in a voice channel.', 'error')] });
      return;
    }

    const queue = await Queue.findOne({ channelId: member.voice.channel.id }).select('channelId maxPlayers minElo maxElo isRanked isPicking').lean();
    if (!queue) {
      await safeReply(interaction, { embeds: [queueSystemEmbed('You are not in a queue channel.', 'error')] });
      return;
    }

    const playersInQueue = queuePlayers.get(queue.channelId) || [];
    if (playersInQueue.length === 0) {
      await safeReply(interaction, { embeds: [queueSystemEmbed('No players are currently in this queue.', 'info')] });
      return;
    }

    const users = await User.find({ discordId: { $in: playersInQueue } }).select('discordId wins losses wlr mvps').lean();
    const byId = new Map(users.map(u => [u.discordId, u]));

    const playerLines = playersInQueue.map(id => {
      const user = byId.get(id);
      if (!user) return null;
      const wlr = user.wlr !== undefined ? user.wlr : (user.losses > 0 ? (user.wins / user.losses) : user.wins);
      const wlrFormatted = typeof wlr === 'number' ? wlr.toFixed(2) : '0.00';
      const mvpsFormatted = (user.mvps || 0).toString().padStart(2, '0');
      return `<@${user.discordId}> — WLR **${wlrFormatted}** · MVPs **${mvpsFormatted}**`;
    }).filter((line): line is string => Boolean(line));

    const lines = [
      `Queue information for **${member.voice.channel.name}**`,
      `**Players:** ${playersInQueue.length}/${queue.maxPlayers}`,
      `**ELO Range:** ${queue.minElo}-${queue.maxElo}`,
      `**Type:** ${queue.isRanked ? 'Ranked' : 'Casual'}`,
      `**Picking:** ${queue.isPicking ? 'Enabled' : 'Disabled'}`,
    ];
    if (playerLines.length > 0) {
      lines.push('', ...playerLines);
    }

    await safeReply(interaction, { embeds: [queueSystemEmbed(lines)] });

  } catch (error) {
    console.error('[Queue Command] Error:', error);
    await safeReply(interaction, { embeds: [queueSystemEmbed('An error occurred while fetching queue information.', 'error')] });
  }
}
