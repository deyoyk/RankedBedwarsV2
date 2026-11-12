import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import User from '../../models/User';
import { themes } from '../../themes';
import { DEFAULT_THEME, themeFor } from './stats';

const { themedEmbed, errorEmbed, successEmbed } = embedsFor('Player');
const ephemeral = MessageFlags.Ephemeral;

export const THEME_CHOICES = themes.map(theme => ({ name: theme, value: theme }));

/** /themes: the themes you own and the one your /stats card uses. */
export async function themesCommand(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) {
    await interaction.reply({ embeds: [errorEmbed("You're not registered yet. Use `/register` first.").builder], flags: ephemeral });
    return;
  }
  const owned = [...new Set([DEFAULT_THEME, ...(user.ownedThemes || [])])];
  const embed = themedEmbed('info')
    .setTitle('Your themes')
    .addFields(
      { name: 'Current theme', value: `\`${themeFor(user)}\``, inline: false },
      { name: 'Owned themes', value: owned.map(theme => `\`${theme}\``).join(' '), inline: false },
    );
  await interaction.reply({ embeds: [embed], flags: ephemeral });
}

/** /changetheme: pick one of your themes for /stats. */
export async function changetheme(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  const theme = interaction.options.getString('theme', true).toLowerCase();
  const user = await User.findOne({ discordId: interaction.user.id });
  if (!user) {
    await interaction.reply({ embeds: [errorEmbed("You're not registered yet. Use `/register` first.").builder], flags: ephemeral });
    return;
  }
  if (!themes.includes(theme)) {
    await interaction.reply({ embeds: [errorEmbed(`There's no \`${theme}\` theme.`).builder], flags: ephemeral });
    return;
  }
  if (theme !== DEFAULT_THEME && !(user.ownedThemes || []).includes(theme)) {
    await interaction.reply({ embeds: [errorEmbed(`You don't own the \`${theme}\` theme.\n-# ➡ An admin can give it to you with \`/thememanage\``).builder], flags: ephemeral });
    return;
  }
  await User.updateOne({ discordId: user.discordId }, { $set: { currentTheme: theme } });
  await interaction.reply({ embeds: [successEmbed(`Your \`/stats\` card now uses the \`${theme}\` theme.`).builder], flags: ephemeral });
}

/** /thememanage: give a player a theme, or take it away. */
export async function thememanage(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  const action = interaction.options.getString('action', true);
  const target = interaction.options.getUser('user', true);
  const theme = interaction.options.getString('theme', true).toLowerCase();
  if (!themes.includes(theme)) {
    await interaction.reply({ embeds: [errorEmbed(`There's no \`${theme}\` theme.`).builder], flags: ephemeral });
    return;
  }
  const update = action === 'give'
    ? { $addToSet: { ownedThemes: theme } }
    : { $pull: { ownedThemes: theme } };
  const user = await User.findOneAndUpdate({ discordId: target.id }, update, { new: true });
  if (!user) {
    await interaction.reply({ embeds: [errorEmbed(`<@${target.id}> isn't registered.`).builder], flags: ephemeral });
    return;
  }
  if (action === 'take' && user.currentTheme === theme) {
    await User.updateOne({ discordId: target.id }, { $set: { currentTheme: DEFAULT_THEME } });
  }
  const done = action === 'give' ? `Gave <@${target.id}> the \`${theme}\` theme.` : `Took the \`${theme}\` theme from <@${target.id}>.`;
  await interaction.reply({ embeds: [successEmbed(done).builder], flags: ephemeral });
}
