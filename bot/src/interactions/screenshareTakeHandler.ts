import { ButtonInteraction } from 'discord.js';
import { ScreenshareService } from '../services/ScreenshareService';
import { embedsFor } from '../utils/betterembed';

const { errorEmbed } = embedsFor('Screenshare');

export async function handleScreenshareTake(interaction: ButtonInteraction): Promise<void> {
  const { guild, user } = interaction;
  if (!guild) {
    await interaction.reply({ embeds: [errorEmbed('Guild not found.', 'Screenshare Error').builder], ephemeral: true });
    return;
  }

  const sessionId = interaction.customId.replace('ss_take_', '');
  const session = sessionId ? await ScreenshareService.getSessionById(sessionId) : null;
  if (!session) {
    await interaction.reply({ embeds: [errorEmbed('Screenshare session not found.', 'Screenshare Error').builder], ephemeral: true });
    return;
  }

  const result = await ScreenshareService.takeSession(guild, sessionId, user.id);
  if (!result.success) {
    await interaction.reply({ embeds: [errorEmbed(`${result.error}.`, 'Screenshare Error').builder], ephemeral: true });
    return;
  }

  await interaction.update({ components: [] }).catch(error => {
    console.warn('[ScreenshareTakeHandler] Failed to remove the take button:', error);
  });
  await interaction.followUp({ embeds: [ScreenshareService.createTakenEmbed(session, user.id, result.expireTime!)] }).catch(error => {
    console.warn('[ScreenshareTakeHandler] Failed to post the taken message:', error);
  });
}
