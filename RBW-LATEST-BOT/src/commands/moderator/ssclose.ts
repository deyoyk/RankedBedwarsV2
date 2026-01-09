import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { ScreenshareService } from '../../services/ScreenshareService';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import config from '../../config/config';

export async function ssclose(interaction: ChatInputCommandInteraction) {
  const reason = interaction.options.getString('reason', true);
  const channel = interaction.channel as TextChannel;
  const guild = interaction.guild;

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Screenshare Error'));
    return;
  }

  const screensharerRoleId = config.roles.screensharer;
  const member = interaction.member;
  
  let hasRole = false;
  if (member && 'roles' in member) {
    const roles = member.roles;
    if (typeof roles === 'object' && typeof (roles as any).cache === 'object' && typeof (roles as any).has === 'function') {
      hasRole = (roles as any).has(screensharerRoleId);
    } else if (Array.isArray(roles)) {
      hasRole = roles.includes(screensharerRoleId);
    }
  }

  if (!screensharerRoleId || !hasRole) {
    await safeReply(interaction, errorEmbed('You do not have permission to use this command.', 'Screenshare Error'));
    return;
  }

  try {
    const session = await ScreenshareService.getSessionByChannelId(channel.id);
    if (!session) {
      await safeReply(interaction, errorEmbed('This command can only be used in a screenshare session channel.', 'Screenshare Error'));
      return;
    }

    const result = await ScreenshareService.closeSession(guild, session.sessionId, interaction.user.id, reason);
    
    if (!result.success) {
      await safeReply(interaction, errorEmbed(result.error!, 'Screenshare Error'));
      return;
    }

    const successEmbedObj = successEmbed('Screenshare session closed successfully.', 'Session Closed');
    successEmbedObj.builder.addFields(
      { name: 'Session ID', value: session.sessionId, inline: true },
      { name: 'Target', value: `<@${session.targetId}>`, inline: true },
      { name: 'Reason', value: reason, inline: true },
      { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true }
    );

    await safeReply(interaction, { embeds: [successEmbedObj.builder] });
  } catch (error) {
    console.error('[SSClose Command] Error:', error);
    await safeReply(interaction, errorEmbed('There was an error closing the screenshare session.', 'Screenshare Error'));
  }
}