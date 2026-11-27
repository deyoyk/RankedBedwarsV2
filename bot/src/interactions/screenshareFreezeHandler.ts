import { ButtonInteraction } from 'discord.js';
import { ScreenshareService } from '../services/ScreenshareService';
import { embedsFor } from '../utils/betterembed';
import config from '../config/config';

const { errorEmbed, successEmbed } = embedsFor('Screenshare');

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

    
    const member = guild.members.cache?.get(user.id) ?? await guild.members.fetch(user.id).catch(() => null);
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

    const frozen = result.session!;
    const successEmbedObj = successEmbed('Player frozen.', 'Session Frozen');
    successEmbedObj.builder.addFields(
      { name: 'Target', value: `<@${frozen.targetId}> (${frozen.targetIgn})`, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(frozen.expireTime.getTime() / 1000)}:R>`, inline: true }
    );
    await interaction.editReply({ embeds: [successEmbedObj.builder] });
  } catch (error) {
    console.error('[ScreenshareFreezeHandler] Unexpected error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await interaction.editReply({ 
      embeds: [errorEmbed(`There was an error processing the freeze request: ${errorMessage}`, 'Screenshare Error').builder]
    });
  }
}