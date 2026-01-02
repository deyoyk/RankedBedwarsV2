import { ChatInputCommandInteraction, SlashCommandBuilder, User as DUser } from 'discord.js';
import User from '../../models/User';
import { safeReply } from '../../utils/safeReply';
import { themes, resolveTheme } from '../../themes';

export const data = new SlashCommandBuilder()
  .setName('thememanage')
  .setDescription('Admin: give or take a user\'s theme')
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('give or take')
      .setRequired(true)
      .addChoices({ name: 'give', value: 'give' }, { name: 'take', value: 'take' })
  )
  .addUserOption(option =>
    option
      .setName('user')
      .setDescription('Target user')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('theme')
      .setDescription('Theme to manage')
      .setRequired(true)
      .addChoices(...themes.map(t => ({ name: t, value: t })))
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  try {
    const action = interaction.options.getString('action', true) as 'give' | 'take';
    const target = interaction.options.getUser('user', true) as DUser;
    const theme = interaction.options.getString('theme', true).toLowerCase();

    resolveTheme(theme);

    const doc = await User.findOne({ discordId: target.id });
    if (!doc) {
      await safeReply(interaction, { content: 'Target user is not registered.', ephemeral: true });
      return;
    }

    const owned = new Set(doc.ownedThemes || []);

    if (action === 'give') {
      owned.add(theme);
    } else {
      owned.delete(theme);
      if (doc.currentTheme === theme) {
        doc.currentTheme = 'elite';
      }
    }

    doc.ownedThemes = Array.from(owned);
    await doc.save();

    await safeReply(interaction, { content: `Theme ${theme} ${action === 'give' ? 'granted to' : 'removed from'} ${target.tag}.`, ephemeral: true });
  } catch (e) {
    console.error('[thememanage] error:', e);
    await safeReply(interaction, { content: 'Failed to manage theme.', ephemeral: true });
  }
}