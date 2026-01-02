import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import User from '../../models/User';
import { safeReply } from '../../utils/safeReply';

export const data = new SlashCommandBuilder()
  .setName('themes')
  .setDescription('List your owned themes and current theme');

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    const user = await User.findOne({ discordId: interaction.user.id });
    if (!user) {
      await safeReply(interaction, { content: 'You are not registered.', ephemeral: true });
      return;
    }

    const owned = user.ownedThemes && user.ownedThemes.length > 0 ? user.ownedThemes.join(', ') : 'None';
    const current = user.currentTheme || 'elite';

    const embed = new EmbedBuilder()
      .setColor('#00AAAA')
      .setTitle('Your Themes')
      .addFields(
        { name: 'Current Theme', value: current, inline: false },
        { name: 'Owned Themes', value: owned, inline: false }
      );

    await safeReply(interaction, { embeds: [embed], ephemeral: true });
  } catch (e) {
    console.error('[themes command] error:', e);
    await safeReply(interaction, { content: 'Failed to fetch your themes.', ephemeral: true });
  }
}