import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import Queue from '../../models/Queue';

export const data = new SlashCommandBuilder()
  .setName('queuecontrol')
  .setDescription('Enable or disable queues by type or specific queue')
  .addSubcommand(sub =>
    sub.setName('enable')
      .setDescription('Enable queues')
      .addStringOption(opt =>
        opt.setName('type')
          .setDescription('Type: ranked, unranked, or specific')
          .setRequired(true)
          .addChoices(
            { name: 'ranked', value: 'ranked' },
            { name: 'unranked', value: 'unranked' },
            { name: 'specific', value: 'specific' }
          )
      )
      .addStringOption(opt =>
        opt.setName('queueid')
          .setDescription('Channel ID of the specific queue (if type is specific)')
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName('disable')
      .setDescription('Disable queues')
      .addStringOption(opt =>
        opt.setName('type')
          .setDescription('Type: ranked, unranked, or specific')
          .setRequired(true)
          .addChoices(
            { name: 'ranked', value: 'ranked' },
            { name: 'unranked', value: 'unranked' },
            { name: 'specific', value: 'specific' }
          )
      )
      .addStringOption(opt =>
        opt.setName('queueid')
          .setDescription('Channel ID of the specific queue (if type is specific)')
          .setRequired(false)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const type = interaction.options.getString('type', true);
  const queueId = interaction.options.getString('queueid');
  let filter: any = {};
  if (type === 'ranked') filter = { isRanked: true };
  else if (type === 'unranked') filter = { isRanked: false };
  else if (type === 'specific') {
    if (!queueId) {
      return interaction.reply({ content: 'You must provide a queueid for specific type.', ephemeral: true });
    }
    filter = { channelId: queueId };
  }
  try {
    const update = sub === 'enable' ? { isActive: true } : { isActive: false };
    const result = await Queue.updateMany(filter, update);
    const embed = new EmbedBuilder()
      .setColor(sub === 'enable' ? '#00ff00' : '#00AAAA')
      .setTitle(sub === 'enable' ? 'Queues Enabled' : 'Queues Disabled')
      .setDescription(`Affected queues: ${result.modifiedCount}`);
    await interaction.reply({ embeds: [embed], ephemeral: false });
  } catch (error) {
    await interaction.reply({ content: 'Error updating queues.', ephemeral: true });
  }
}