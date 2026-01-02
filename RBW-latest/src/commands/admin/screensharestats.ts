import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { ScreenshareService } from '../../services/ScreenshareService';
import { errorEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import config from '../../config/config';

export const data = new SlashCommandBuilder()
  .setName('screensharestats')
  .setDescription('View screenshare session statistics and active sessions')
  .addBooleanOption(option =>
    option.setName('detailed')
      .setDescription('Show detailed information about active sessions')
      .setRequired(false)
  );

export async function screensharestats(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild;
  const detailed = interaction.options.getBoolean('detailed') ?? false;

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Screenshare Stats Error'));
    return;
  }

  
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const screensharerRoleId = config.roles.screensharer;
  
  if (!member || !screensharerRoleId || !member.roles.cache.has(screensharerRoleId)) {
    await safeReply(interaction, errorEmbed('You do not have permission to view screenshare statistics.', 'Permission Error'));
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    
    const stats = await ScreenshareService.getSessionStats();
    const activeSessions = await ScreenshareService.getActiveSessions();

    
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Screenshare Statistics')
      .setTimestamp()
      .addFields(
        { name: 'Total Sessions', value: stats.total.toString(), inline: true },
        { name: 'Pending', value: stats.pending.toString(), inline: true },
        { name: 'Frozen', value: stats.frozen.toString(), inline: true },
        { name: 'Closed', value: stats.closed.toString(), inline: true },
        { name: 'Expired', value: stats.expired.toString(), inline: true },
        { name: 'Cancelled', value: stats.cancelled.toString(), inline: true },
        { name: 'Active Now', value: activeSessions.length.toString(), inline: true }
      );

    if (activeSessions.length > 0) {
      if (detailed) {
        
        const sessionDetails = activeSessions.slice(0, 10).map(session => {
          const timeLeft = Math.max(0, session.expireTime.getTime() - Date.now());
          const minutesLeft = Math.floor(timeLeft / 60000);
          const status = session.status === 'pending' ? '⏳ Pending' : '❄️ Frozen';
          
          return `**${session.sessionId}**\n` +
                 `Target: <@${session.targetId}> (${session.targetIgn})\n` +
                 `Status: ${status}\n` +
                 `Expires: ${minutesLeft}m\n` +
                 `${session.channelId ? `Channel: <#${session.channelId}>` : 'No channel'}`;
        }).join('\n\n');

        embed.addFields({
          name: `Active Sessions (${activeSessions.length > 10 ? 'First 10 of ' + activeSessions.length : activeSessions.length})`,
          value: sessionDetails || 'None',
          inline: false
        });
      } else {
        
        const pendingCount = activeSessions.filter(s => s.status === 'pending').length;
        const frozenCount = activeSessions.filter(s => s.status === 'frozen').length;
        
        embed.addFields({
          name: 'Active Session Breakdown',
          value: `⏳ Pending: ${pendingCount}\n❄️ Frozen: ${frozenCount}`,
          inline: false
        });

        if (activeSessions.length > 0) {
          const oldestSession = activeSessions.reduce((oldest, current) => 
            current.createdAt < oldest.createdAt ? current : oldest
          );
          
          const timeRunning = Date.now() - oldestSession.createdAt.getTime();
          const minutesRunning = Math.floor(timeRunning / 60000);
          
          embed.addFields({
            name: 'Oldest Active Session',
            value: `${oldestSession.sessionId} (${oldestSession.targetIgn})\nRunning for: ${minutesRunning}m`,
            inline: true
          });
        }
      }
    }

    
    const channelConfig = config.channels.screensharerequestsChannel;
    const categoryConfig = config.categories.screenshareCategory;
    const roleConfig = config.roles.screensharer;
    const frozenRoleConfig = config.roles.frozen;

    embed.addFields({
      name: 'Configuration Status',
      value: `Requests Channel: ${channelConfig ? '✅' : '❌'}\n` +
             `Category: ${categoryConfig ? '✅' : '❌'}\n` +
             `Screensharer Role: ${roleConfig ? '✅' : '❌'}\n` +
             `Frozen Role: ${frozenRoleConfig ? '✅' : '❌'}`,
      inline: true
    });

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('[ScreenshareStats Command] Error:', error);
    await interaction.editReply({ 
      embeds: [errorEmbed('There was an error retrieving screenshare statistics.', 'Screenshare Stats Error').builder] 
    });
  }
}