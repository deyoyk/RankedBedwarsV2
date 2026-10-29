import { Message, ChatInputCommandInteraction, GuildMember, TextChannel } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { ScreenshareService } from '../../services/ScreenshareService';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import config from '../../config/config';

export async function ssclose(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager): Promise<void> {
  void wsManager;
  let reason: string;
  if (interaction instanceof ChatInputCommandInteraction) {
    reason = interaction.options.getString('reason', true);
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =ssclose <reason>', 'Screenshare Error'));
      return;
    }
    reason = args.join(' ');
  }
  const channel = interaction.channel as TextChannel;
  const guild = interaction.guild;

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Screenshare Error'));
    return;
  }

  const screensharerRoleId = config.roles.screensharer;
  const member = interaction.member as GuildMember | null;

  let hasRole = false;
  if (member) {
    const roles = member.roles;
    if (Array.isArray(roles)) {
      hasRole = roles.includes(screensharerRoleId);
    } else if (roles && typeof roles === 'object' && 'cache' in roles) {
      hasRole = roles.cache.has(screensharerRoleId);
    }
  }

  if (!screensharerRoleId || !hasRole) {
    await safeReply(interaction, errorEmbed('You do not have permission to use this command.', 'Screenshare Error'));
    return;
  }

  try {
    if (!channel) {
      await safeReply(interaction, errorEmbed('Channel not available.', 'Screenshare Error'));
      return;
    }
    const session = await ScreenshareService.getSessionByChannelId(channel.id);
    if (!session) {
      await safeReply(interaction, errorEmbed('This command can only be used in a screenshare session channel.', 'Screenshare Error'));
      return;
    }

    const closerId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
    const result = await ScreenshareService.closeSession(guild, session.sessionId, closerId, reason);

    if (!result.success) {
      await safeReply(interaction, errorEmbed(result.error!, 'Screenshare Error'));
      return;
    }

    const successEmbedObj = successEmbed('Screenshare session closed successfully.', 'Session Closed');
    successEmbedObj.builder.addFields(
      { name: 'Session ID', value: session.sessionId, inline: true },
      { name: 'Target', value: `<@${session.targetId}>`, inline: true },
      { name: 'Reason', value: reason, inline: true },
      { name: 'Closed by', value: `<@${closerId}>`, inline: true }
    );

    await safeReply(interaction, { embeds: [successEmbedObj.builder] });
  } catch (error) {
    console.error('[SSClose Command] Error:', error);
    await safeReply(interaction, errorEmbed('There was an error closing the screenshare session.', 'Screenshare Error'));
  }
}
