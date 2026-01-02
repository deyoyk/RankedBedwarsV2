import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import User from '../../models/User';
import { safeReply } from '../../utils/safeReply';
import { themes, resolveTheme } from '../../themes';

export const data = new SlashCommandBuilder()
  .setName('changetheme')
  .setDescription('Change your stats image theme')
  .addStringOption(option =>
    option
      .setName('theme')
      .setDescription('Theme name')
      .setRequired(true)
      .addChoices(...themes.map(t => ({ name: t, value: t })))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    const theme = interaction.options.getString('theme', true).toLowerCase();
    const user = await User.findOne({ discordId: interaction.user.id });
    if (!user) {
      await safeReply(interaction, { content: 'You are not registered.', ephemeral: true });
      return;
    }

    resolveTheme(theme);

    const owned = user.ownedThemes || [];
    if (!owned.includes(theme) && theme !== 'elite') {
      await safeReply(interaction, { content: 'You do not own this theme.', ephemeral: true });
      return;
    }

    user.currentTheme = theme;
    await user.save();

    await safeReply(interaction, { content: `Theme changed to ${theme}.`, ephemeral: true });
  } catch (e) {
    console.error('[changetheme] error:', e);
    await safeReply(interaction, { content: 'Failed to change theme.', ephemeral: true });
  }
}