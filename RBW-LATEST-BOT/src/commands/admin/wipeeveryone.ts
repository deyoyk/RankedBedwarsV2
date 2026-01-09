import { Message, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { fix } from '../../utils/fix';

export async function wipeeveryone(interaction: Message | ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Wipe Everyone Error'));
    return;
  }

  try {
    const users = await User.find();
    if (!users.length) {
      await safeReply(interaction, errorEmbed('No users found in the database.', 'Wipe Everyone Error'));
      return;
    }

    const total = users.length;
    const timestamp = Math.floor(Date.now() / 1000);

    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Wipe Everyone Operation')
      .setColor('#00AAAA')
      .setDescription(`Are you sure you want to wipe all stats for **${total}** users?\n\n**⚠️ WARNING: This action is irreversible!**`)
      .addFields(
        { name: 'What will be wiped', value: '• ELO\n• Wins/Losses\n• Games played\n• MVPs\n• Kills/Deaths\n• Bed breaks/Final kills\n• Resource stats\n• Win/Lose streaks\n• KDR/WLR\n• Recent games\n• Daily ELO history', inline: false },
        { name: 'What will be preserved', value: '• Bans\n• Mutes\n• Strikes\n• User registration\n• Party information', inline: false },
        { name: 'Users to process', value: `${total}`, inline: true },
        { name: 'Estimated time', value: `${Math.ceil(total / 10)} seconds`, inline: true },
        { name: 'Rate limiting', value: '1 second between batches', inline: true }
      )
      .setFooter({ text: 'This confirmation will expire in 30 seconds' })
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId('wipeeveryone_confirm')
      .setLabel('🗑️ Confirm Wipe')
      .setStyle(ButtonStyle.Danger);

    const denyButton = new ButtonBuilder()
      .setCustomId('wipeeveryone_deny')
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, denyButton);

    const response = await safeReply(interaction, {
      embeds: [confirmEmbed],
      components: [row],
      fetchReply: true
    });

    const message = response instanceof Message ? response : response;

    try {
      const confirmation = await message.awaitMessageComponent({
        filter: (i) => {
          return (i.customId === 'wipeeveryone_confirm' || i.customId === 'wipeeveryone_deny') && 
                 i.user.id === (interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id);
        },
        time: 30000,
        componentType: ComponentType.Button
      });

      if (confirmation.customId === 'wipeeveryone_deny') {
        await confirmation.update({
          embeds: [errorEmbed('Wipe everyone operation cancelled.', 'Operation Cancelled').builder],
          components: []
        });
        return;
      }

      await confirmation.update({
        embeds: [successEmbed('Starting wipe everyone operation...', 'Wipe Everyone Started').builder],
        components: []
      });

      await executeWipeEveryone(interaction, users);

    } catch (timeoutError) {
      const timeoutEmbed = new EmbedBuilder()
        .setTitle('⏰ Confirmation Expired')
        .setColor('#00AAAA')
        .setDescription('The confirmation has expired. Please run the command again if you want to proceed.')
        .setFooter({ text: 'Deyo.lol' })
        .setTimestamp();

      await message.edit({
        embeds: [timeoutEmbed],
        components: []
      });
    }

  } catch (error: any) {
    console.error('[WipeEveryone] Error in wipeeveryone command:', error);
    await safeReply(interaction, errorEmbed(`There was an error running wipeeveryone: ${error.message || 'Unknown error'}`, 'Wipe Everyone Error'));
  }
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
    userDoc.elo = 0;
    userDoc.wins = 0;
    userDoc.losses = 0;
    userDoc.games = 0;
    userDoc.mvps = 0;
    userDoc.kills = 0;
    userDoc.deaths = 0;
    userDoc.bedBroken = 0;
    userDoc.finalKills = 0;
    userDoc.diamonds = 0;
    userDoc.irons = 0;
    userDoc.gold = 0;
    userDoc.emeralds = 0;
    userDoc.blocksPlaced = 0;
    userDoc.winstreak = 0;
    userDoc.losestreak = 0;
    userDoc.kdr = 0;
    userDoc.wlr = 0;
    userDoc.recentGames = [];
    userDoc.dailyElo = [];
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