import { ButtonInteraction, TextChannel, EmbedBuilder } from 'discord.js';
import { ScreenshareService } from '../services/ScreenshareService';
import { errorEmbed, successEmbed } from '../utils/betterembed';
import config from '../config/config';

export async function handleScreenshareFreeze(interaction: ButtonInteraction) {
  const { guild, user } = interaction;
  
  if (!guild) {
    await interaction.reply({ 
      embeds: [errorEmbed('Guild not found.', 'Screenshare Error').builder], 
      ephemeral: true 
    });
    return;
  }

  
  await interaction.deferReply({ ephemeral: true });

  try {
    
    const sessionId = interaction.customId.replace('ss_freeze_', '');
    if (!sessionId) {
      await interaction.editReply({ 
        embeds: [errorEmbed('Invalid session ID.', 'Screenshare Error').builder]
      });
      return;
    }

    
    const session = await ScreenshareService.getSessionById(sessionId);
    if (!session) {
      await interaction.editReply({ 
        embeds: [errorEmbed('Screenshare session not found or has expired.', 'Screenshare Error').builder]
      });
      return;
    }

    
    if (session.status !== 'pending') {
      const statusMessage = session.status === 'frozen' ? 'already frozen' : 
                           session.status === 'closed' ? 'closed' : 
                           session.status === 'expired' ? 'expired' : session.status;
      
      await interaction.editReply({ 
        embeds: [errorEmbed(`This screenshare session is ${statusMessage}.`, 'Screenshare Error').builder]
      });
      return;
    }

    
    if (new Date() > session.expireTime) {
      await interaction.editReply({ 
        embeds: [errorEmbed('This screenshare session has expired.', 'Screenshare Error').builder]
      });
      return;
    }

    
    const member = await guild.members.fetch(user.id).catch(() => null);
    const screensharerRoleId = config.roles.screensharer;
    
    if (!member) {
      await interaction.editReply({ 
        embeds: [errorEmbed('User not found in server.', 'Screenshare Error').builder]
      });
      return;
    }

    if (!screensharerRoleId || !member.roles.cache.has(screensharerRoleId)) {
      await interaction.editReply({ 
        embeds: [errorEmbed('You do not have permission to freeze screenshare sessions.', 'Screenshare Error').builder]
      });
      return;
    }

    
    const result = await ScreenshareService.freezeSession(guild, session, user.id);
    
    if (!result.success) {
      await interaction.editReply({ 
        embeds: [errorEmbed(result.error!, 'Screenshare Error').builder]
      });
      return;
    }

    const channel = result.channel!;
    
    
    try {
      const targetMention = `<@${session.targetId}>`;
      const freezeEmbed = ScreenshareService.createFreezeEmbed(session.targetId);
      
      await channel.send({ 
        content: targetMention, 
        embeds: [freezeEmbed] 
      });

      
      try {
        const originalMessage = interaction.message;
        if (originalMessage) {
          const updatedEmbed = EmbedBuilder.from(originalMessage.embeds[0])
            .setColor(0xff0000)
            .setTitle('🔒 Screenshare Session - FROZEN')
            .addFields({ 
              name: 'Status', 
              value: `Frozen by <@${user.id}> at <t:${Math.floor(Date.now() / 1000)}:T>`, 
              inline: false 
            });

          await originalMessage.edit({ 
            embeds: [updatedEmbed], 
            components: [] 
          });
        }
      } catch (error) {
        console.warn('[ScreenshareFreezeHandler] Failed to update original message:', error);
        
      }

    } catch (error) {
      console.error('[ScreenshareFreezeHandler] Failed to send freeze message:', error);
      
    }

    
    const successEmbedObj = successEmbed('Session frozen successfully!', 'Session Frozen');
    successEmbedObj.builder.addFields(
      { name: 'Session ID', value: session.sessionId, inline: true },
      { name: 'Target', value: `<@${session.targetId}> (${session.targetIgn})`, inline: true },
      { name: 'Channel', value: `<#${channel.id}>`, inline: true },
      { name: 'Frozen At', value: `<t:${Math.floor(Date.now() / 1000)}:T>`, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(session.expireTime.getTime() / 1000)}:R>`, inline: true }
    );

    await interaction.editReply({ 
      embeds: [successEmbedObj.builder]
    });

    console.log(`[ScreenshareFreezeHandler] Session ${sessionId} frozen by ${user.tag}, channel created: ${channel.name}`);

  } catch (error) {
    console.error('[ScreenshareFreezeHandler] Unexpected error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.editReply({ 
      embeds: [errorEmbed(`There was an error processing the freeze request: ${errorMessage}`, 'Screenshare Error').builder]
    });
  }
}