import {
  Message,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';

import { errorEmbed, betterEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import UserModel from '../../models/User';
import { fix } from '../../utils/fix';


const SETTINGS = [
  { key: 'toggleprefix', label: 'Show Prefix', description: 'Show only IGN or [ELO] IGN in nickname.' },
  { key: 'togglescoreping', label: 'Score Ping', description: 'Receive a ping when your score is updated.' },
  { key: 'togglepartyinvites', label: 'Party Invites', description: 'Allow others to invite you to parties.' },
  { key: 'togglestaticnick', label: 'Static Nick', description: 'Keep nickname blank (no auto update).' }
] as const;
type SettingKey = typeof SETTINGS[number]['key'];

export async function settings(interaction: Message | ChatInputCommandInteraction) {
  const userId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
  const user = await UserModel.findOne({ discordId: userId });
  if (!user) {
    await safeReply(interaction, errorEmbed('You need to register first!', 'Settings Error'));
    return;
  }

  const embedObj = betterEmbed('Toggle your personal settings below:', '#00AAAA', 'User Settings');
  for (const setting of SETTINGS) {
    embedObj.builder.addFields({
      name: setting.label,
      value: `${setting.description}\nCurrent: **${user.settings?.[setting.key as SettingKey] ? 'Enabled' : 'Disabled'}**`,
      inline: false
    });
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('settings_select')
    .setPlaceholder('Select a setting to toggle')
    .addOptions(
      SETTINGS.map(s => ({
        label: s.label,
        description: s.description,
        value: s.key
      }))
    );

  const saveButton = new ButtonBuilder()
    .setCustomId('settings_save')
    .setLabel('Save & Apply')
    .setStyle(ButtonStyle.Success);

  const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(saveButton);

  const reply = await safeReply(interaction, {
    embeds: [embedObj.builder],
    components: [row1, row2],
    fetchReply: true
  });

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: 5 * 60 * 1000
  });

  let changedSettings: Record<SettingKey, boolean> = { ...user.settings };
  let currentEmbed = embedObj.builder;

  const updateEmbed = async (componentInteraction?: any) => {
    const updatedEmbedObj = betterEmbed('Toggle your personal settings below:', '#00AAAA', 'User Settings');
    for (const setting of SETTINGS) {
      updatedEmbedObj.builder.addFields({
        name: setting.label,
        value: `${setting.description}\nCurrent: **${changedSettings[setting.key as SettingKey] ? 'Enabled' : 'Disabled'}**`,
        inline: false
      });
    }
    currentEmbed = updatedEmbedObj.builder;
    if (componentInteraction) {
      await componentInteraction.update({ embeds: [updatedEmbedObj.builder], components: [row1, row2] });
    } else {
      await reply.edit({ embeds: [updatedEmbedObj.builder], components: [row1, row2] });
    }
  };

  collector.on('collect', async (i) => {
    if (i.user.id !== userId) {
      await i.reply(errorEmbed('This menu is not for you!', 'Settings Error'));
      return;
    }
    const key = i.values[0] as SettingKey;
    changedSettings[key] = !changedSettings[key];
    await updateEmbed(i);
  });

  reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000
  }).on('collect', async (i) => {
    if (i.user.id !== userId) {
      await i.reply({ content: 'This button is not for you!', flags: 64 }); 
      return;
    }
    user.settings = changedSettings;
    await user.save();
    if (interaction.guild) {
      await fix(interaction.guild, userId);
    }
    await i.update(successEmbed('Settings saved and applied!', 'Settings Saved'));
    collector.stop();
  });

  collector.on('end', async () => {
    await reply.edit({ components: [] });
  });
}