import { ButtonInteraction, EmbedBuilder } from 'discord.js';
import { ScreenshareService } from '../services/ScreenshareService';
import { errorEmbed, successEmbed } from '../utils/betterembed';
import config from '../config/config';

export async function handleScreenshareCancel(interaction: ButtonInteraction) {
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
    
    const sessionId = interaction.customId.replace('ss_cancel_', '');
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
      const statusMessage = session.status === 'frozen' ? 'already frozen and cannot be cancelled' : 
                           session.status === 'closed' ? 'already closed' : 
                           session.status === 'expired' ? 'expired' : session.status;
      
      await interaction.editReply({ 
        embeds: [errorEmbed(`This screenshare session is ${statusMessage}.`, 'Screenshare Error').builder]
      });
      return;
    }

    
    const isRequester = session.requesterId === user.id;
    const member = await guild.members.fetch(user.id).catch(() => null);
    const screensharerRoleId = config.roles.screensharer;
    const hasScreensharerRole = member && screensharerRoleId && member.roles.cache.has(screensharerRoleId);

    if (!isRequester && !hasScreensharerRole) {
      await interaction.editReply({ 
        embeds: [errorEmbed('You can only cancel your own screenshare requests or must have screensharer permissions.', 'Screenshare Error').builder]
      });
      return;
    }

    
    const result = await ScreenshareService.cancelSession(guild, sessionId, user.id, 'Cancelled via button');
    
    if (!result.success) {
      await interaction.editReply({ 
        embeds: [errorEmbed(result.error!, 'Screenshare Error').builder]
      });
      return;
    }

    
    try {
      const originalMessage = interaction.message;
      if (originalMessage) {
        const updatedEmbed = EmbedBuilder.from(originalMessage.embeds[0])
          .setColor(0x808080)
          .setTitle('❌ Screenshare Session - CANCELLED')
          .addFields({ 
            name: 'Status', 
            value: `Cancelled by <@${user.id}> at <t:${Math.floor(Date.now() / 1000)}:T>`, 
            inline: false 
          });

        await originalMessage.edit({ 
          embeds: [updatedEmbed], 
          components: [] 
        });
      }
    } catch (error) {
      console.warn('[ScreenshareCancelHandler] Failed to update original message:', error);
      
    }

    
    const successEmbedObj = successEmbed('Session cancelled successfully!', 'Session Cancelled');
    successEmbedObj.builder.addFields(
      { name: 'Session ID', value: session.sessionId, inline: true },
      { name: 'Target', value: `<@${session.targetId}> (${session.targetIgn})`, inline: true },
      { name: 'Cancelled By', value: `<@${user.id}>`, inline: true },
      { name: 'Cancelled At', value: `<t:${Math.floor(Date.now() / 1000)}:T>`, inline: true }
    );

    await interaction.editReply({ 
      embeds: [successEmbedObj.builder]
    });

    console.log(`[ScreenshareCancelHandler] Session ${sessionId} cancelled by ${user.tag}`);

  } catch (error) {
    console.error('[ScreenshareCancelHandler] Unexpected error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.editReply({ 
      embeds: [errorEmbed(`There was an error cancelling the session: ${errorMessage}`, 'Screenshare Error').builder]
    });
  }
}