import { Message, ChatInputCommandInteraction, EmbedBuilder, ButtonStyle } from 'discord.js';
import User from '../../models/User';
import { fix } from '../../utils/fix';
import { executeWithConfirmation } from '../../utils/confirmAction';
import { successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { resetUserStats } from '../../utils/userStats';

export async function wipeeveryone(interaction: Message | ChatInputCommandInteraction) {
  const users = await User.find();
  if (!users.length) {
    const { errorEmbed } = await import('../../utils/betterembed');
    await safeReply(interaction, errorEmbed('No users found in the database.', 'Wipe Everyone Error'));
    return;
  }

  const total = users.length;

  await executeWithConfirmation(interaction, {
    commandName: 'wipeeveryone',
    confirmTitle: '⚠️ Confirm Wipe Everyone Operation',
    confirmDescription: `Are you sure you want to wipe all stats for **${total}** users?\n\n**⚠️ WARNING: This action is irreversible!**`,
    confirmLabel: '🗑️ Confirm Wipe',
    confirmStyle: ButtonStyle.Danger,
    fields: [
      { name: 'What will be wiped', value: '• ELO\n• Wins/Losses\n• Games played\n• MVPs\n• Kills/Deaths\n• Bed breaks/Final kills\n• Resource stats\n• Win/Lose streaks\n• KDR/WLR\n• Recent games\n• Daily ELO history', inline: false },
      { name: 'What will be preserved', value: '• Bans\n• Mutes\n• Strikes\n• User registration\n• Party information', inline: false },
      { name: 'Users to process', value: `${total}`, inline: true },
      { name: 'Estimated time', value: `${Math.ceil(total / 10)} seconds`, inline: true },
      { name: 'Rate limiting', value: '1 second between batches', inline: true }
    ],
    startMessage: 'Starting wipe everyone operation...',
    cancelMessage: 'Wipe everyone operation cancelled.',
    onConfirm: () => executeWipeEveryone(interaction, users)
  });
}

async function executeWipeEveryone(interaction: Message | ChatInputCommandInteraction, users: any[]) {
  const total = users.length;
  let processed = 0;
  const startTime = Date.now();

  let progressMsg: Message | undefined = undefined;
  if (interaction instanceof ChatInputCommandInteraction) {
    await interaction.editReply({
      embeds: [successEmbed(`Starting wipe for **${total}** users...`, 'Wipe Everyone Progress').builder]
    });
  } else {
    const channel = interaction.channel;
    if (channel && 'send' in channel) {
      progressMsg = await channel.send({
        embeds: [successEmbed(`Starting wipe for **${total}** users...`, 'Wipe Everyone Progress').builder]
      });
    }
  }

  for (const userDoc of users) {
    resetUserStats(userDoc);
    await userDoc.save();
    await fix(interaction.guild!, userDoc.discordId);
    processed++;

    if (processed % 10 === 0 || processed === total) {
      const percent = ((processed / total) * 100).toFixed(1);
      const elapsed = (Date.now() - startTime) / 1000;
      const eta = processed > 0 ? ((elapsed / processed) * (total - processed)) : 0;
      const etaStr = eta > 60 ? `${Math.floor(eta / 60)}m ${Math.round(eta % 60)}s` : `${Math.round(eta)}s`;
      const embed = successEmbed(
        `Wiping stats for **${total}** users...\n\n` +
        `Progress: **${processed} / ${total}** (**${percent}%**)\n` +
        `ETA: ~${etaStr}`,
        'Wipe Everyone Progress'
      );
      if (interaction instanceof ChatInputCommandInteraction) {
        await interaction.editReply({ embeds: [embed.builder] });
      } else if (progressMsg) {
        await progressMsg.edit({ embeds: [embed.builder] });
      }
    }
  }

  const embed = successEmbed(
    `All user stats have been wiped and roles/nicknames updated.\n\nProcessed: **${total} / ${total}** (100%)`,
    'Wipe Everyone Complete'
  );
  if (interaction instanceof ChatInputCommandInteraction) {
    await interaction.editReply({ embeds: [embed.builder] });
  } else if (progressMsg) {
    await progressMsg.edit({ embeds: [embed.builder] });
  }
}
