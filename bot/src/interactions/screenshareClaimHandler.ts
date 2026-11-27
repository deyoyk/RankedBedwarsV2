import { ButtonInteraction } from 'discord.js';
import { ScreenshareService } from '../services/ScreenshareService';
import { embedsFor } from '../utils/betterembed';

const { errorEmbed, successEmbed } = embedsFor('Screenshare');

export async function handleScreenshareClaim(interaction: ButtonInteraction): Promise<void> {
  const { guild, user } = interaction;
  if (!guild) {
    await interaction.reply({ embeds: [errorEmbed('Guild not found.', 'Screenshare Error').builder], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const sessionId = interaction.customId.replace(/^ss_(claim|take)_/, '');
  const result = await ScreenshareService.claimSession(guild, sessionId, user.id);
  if (!result.success) {
    await interaction.editReply({ embeds: [errorEmbed(`${result.error}.`, 'Screenshare Error').builder] });
    return;
  }
  const closes = Math.floor(result.expireTime!.getTime() / 1000);
  await interaction.editReply({ embeds: [successEmbed(`Screenshare claimed. The ticket closes <t:${closes}:R>.`, 'Screenshare Claimed').builder] });
}
