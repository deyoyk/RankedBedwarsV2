import { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { ScreenshareService } from '../../services/ScreenshareService';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import config from '../../config/config';

export async function screenshare(interaction: ChatInputCommandInteraction) {
  const target = interaction.options.getUser('target', true);
  const reason = interaction.options.getString('reason', true);
  const image = interaction.options.getAttachment('image', true);
  const guild = interaction.guild;

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Screenshare Error'));
    return;
  }

  
  await interaction.deferReply({ ephemeral: true });

  try {
    
    const result = await ScreenshareService.createSession(
      guild,
      target.id,
      interaction.user.id,
      reason,
      image.url
    );

    if (!result.success) {
      await interaction.editReply({ embeds: [errorEmbed(result.error!, 'Screenshare Error').builder] });
      return;
    }

    const session = result.session!;
    
    
    const channelId = config.channels.screensharerequestsChannel;
    if (!channelId) {
      await interaction.editReply({ embeds: [errorEmbed('Screenshare requests channel not configured.', 'Screenshare Error').builder] });
      return;
    }

    let channel: TextChannel;
    try {
      const channelRaw = await guild.channels.fetch(channelId);
      if (!channelRaw || !channelRaw.isTextBased()) {
        await interaction.editReply({ embeds: [errorEmbed('Screenshare requests channel not found or not a text channel.', 'Screenshare Error').builder] });
        return;
      }
      channel = channelRaw as TextChannel;
    } catch (error) {
      console.error('[Screenshare Command] Failed to fetch channel:', error);
      await interaction.editReply({ embeds: [errorEmbed('Failed to access screenshare requests channel.', 'Screenshare Error').builder] });
      return;
    }

    
    const embed = ScreenshareService.createSessionEmbed(session, image.url);
    const row = ScreenshareService.createFreezeButton(session.sessionId);

    
    if (result.dontlogResult) {
      embed.addFields({
        name: 'Player Status',
        value: `Online: ${result.dontlogResult.online ? '✅' : '❌'} | DontLog: ${result.dontlogResult.dontlog ? '✅' : '❌'}`,
        inline: true
      });
    }

    const screensharerRoleId = config.roles.screensharer;
    const mention = screensharerRoleId ? `<@&${screensharerRoleId}>` : '';
    
    
    let sentMsg, thread;
    try {
      sentMsg = await channel.send({
        content: mention,
        embeds: [embed],
        components: [row]
      });

      thread = await sentMsg.startThread({
        name: `SS: ${target.username} | ${session.sessionId}`,
        autoArchiveDuration: 60,
        reason: `Screenshare session thread for ${session.sessionId}`
      });

      if (screensharerRoleId) {
        await thread.setLocked(false);
        try {
          await (thread as any).setInvitable?.(false);
        } catch (_) {
        }
      }

      await thread.send({ 
        content: `<@${target.id}>`,
        embeds: [embed] 
      });

    } catch (error) {
      console.error('[Screenshare Command] Failed to create thread:', error);
      await interaction.editReply({ embeds: [errorEmbed('Failed to create screenshare thread.', 'Screenshare Error').builder] });
      
      
      await ScreenshareService.closeSession(guild, session.sessionId, 'system', 'Thread creation failed');
      return;
    }

    
    if (global._wsManager && typeof global._wsManager.registerScreenshareThread === 'function') {
      try {
        global._wsManager.registerScreenshareThread({
          ign: session.targetIgn,
          sessionId: session.sessionId,
          threadId: thread.id,
          expiresAt: Date.now() + 15 * 60 * 1000
        });
      } catch (error) {
        console.warn('[Screenshare Command] Failed to register with websocket manager:', error);
        
      }
    }

    
    const successEmbedObj = successEmbed('Screenshare request created successfully!', 'Screenshare Request Created');
    successEmbedObj.builder.addFields(
      { name: 'Target', value: `<@${target.id}> (${session.targetIgn})`, inline: true },
      { name: 'Session ID', value: session.sessionId, inline: true },
      { name: 'Thread', value: `<#${thread.id}>`, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(session.expireTime.getTime() / 1000)}:R>`, inline: true }
    );

    if (result.dontlogResult) {
      successEmbedObj.builder.addFields({
        name: 'Player Status',
        value: `Online: ${result.dontlogResult.online ? '✅' : '❌'} | DontLog: ${result.dontlogResult.dontlog ? '✅' : '❌'}`,
        inline: true
      });
    }

    await interaction.editReply({ embeds: [successEmbedObj.builder] });

  } catch (error) {
    console.error('[Screenshare Command] Unexpected error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.editReply({ 
      embeds: [errorEmbed(`There was an error processing your screenshare request: ${errorMessage}`, 'Screenshare Error').builder] 
    });
  }
}