import { Message, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { fix } from '../../utils/fix';
import User from '../../models/User';

interface FixAllProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  startTime: number;
  lastUpdateTime: number;
}

export async function fixall(interaction: Message | ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Fix All Error'));
    return;
  }

  try {
    const users = await User.find().select('discordId ign');
    if (!users.length) {
      await safeReply(interaction, errorEmbed('No users found in the database.', 'Fix All Error'));
      return;
    }

    const total = users.length;
    const timestamp = Math.floor(Date.now() / 1000);

    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Fix All Operation')
      .setColor('#FFA500')
      .setDescription(`Are you sure you want to fix roles and nicknames for **${total}** users?\n\nThis operation will:`)
      .addFields(
        { name: 'What it does', value: '• Update user roles based on ELO\n• Update user nicknames\n• Process all users in batches\n• Respect Discord rate limits', inline: false },
        { name: 'Users to process', value: `${total}`, inline: true },
        { name: 'Estimated time', value: `${Math.ceil(total / 5)} seconds`, inline: true },
        { name: 'Rate limiting', value: '1 second between batches', inline: true }
      )
      .setFooter({ text: 'This confirmation will expire in 30 seconds' })
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId('fixall_confirm')
      .setLabel('✅ Confirm')
      .setStyle(ButtonStyle.Success);

    const denyButton = new ButtonBuilder()
      .setCustomId('fixall_deny')
      .setLabel('❌ Cancel')
      .setStyle(ButtonStyle.Danger);

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
          return (i.customId === 'fixall_confirm' || i.customId === 'fixall_deny') && 
                 i.user.id === (interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id);
        },
        time: 30000,
        componentType: ComponentType.Button
      });

      if (confirmation.customId === 'fixall_deny') {
        await confirmation.update({
          embeds: [errorEmbed('Fix all operation cancelled.', 'Operation Cancelled').builder],
          components: []
        });
        return;
      }

      await confirmation.update({
        embeds: [successEmbed('Starting fix all operation...', 'Fix All Started').builder],
        components: []
      });

      await executeFixAll(interaction, users);

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
    console.error('[FixAll] Error in fixall command:', error);
    await safeReply(interaction, errorEmbed(`There was an error running fixall: ${error.message || 'Unknown error'}`, 'Fix All Error'));
  }
}

async function executeFixAll(interaction: Message | ChatInputCommandInteraction, users: any[]) {
  const total = users.length;
  const progress: FixAllProgress = {
    total,
    processed: 0,
    successful: 0,
    failed: 0,
    errors: [],
    startTime: Date.now(),
    lastUpdateTime: Date.now()
  };

  console.log(`[FixAll] Starting fix for ${total} users`);

  let progressMsg: Message | undefined = undefined;
  
  if (interaction instanceof ChatInputCommandInteraction) {
    await interaction.editReply({
      embeds: [createProgressEmbed(progress)]
    });
  } else {
    const channel = interaction.channel;
    if (channel && 'send' in channel) {
      progressMsg = await channel.send({
        embeds: [createProgressEmbed(progress)]
      });
    }
  }

  const batchSize = 5;
  const rateLimitDelay = 1000;
  const updateInterval = 3000;

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (user) => {
      try {
        await fix(interaction.guild!, user.discordId);
        progress.successful++;
        console.log(`[FixAll] Successfully fixed user ${user.discordId} (${user.ign || 'Unknown'})`);
      } catch (error: any) {
        progress.failed++;
        const errorMsg = `Failed to fix ${user.ign || user.discordId}: ${error.message || 'Unknown error'}`;
        progress.errors.push(errorMsg);
        console.error(`[FixAll] ${errorMsg}`);
      } finally {
        progress.processed++;
      }
    });

    await Promise.allSettled(batchPromises);

    const now = Date.now();
    if (now - progress.lastUpdateTime >= updateInterval) {
      progress.lastUpdateTime = now;
      
      try {
        if (progressMsg) {
          await progressMsg.edit({ embeds: [createProgressEmbed(progress)] });
        } else if (interaction instanceof ChatInputCommandInteraction) {
          await interaction.editReply({ embeds: [createProgressEmbed(progress)] });
        }
      } catch (updateError) {
        console.error('[FixAll] Failed to update progress embed:', updateError);
      }
    }

    if (i + batchSize < users.length) {
      await sleep(rateLimitDelay);
    }
  }

  const finalEmbed = createFinalEmbed(progress);
  
  if (progressMsg) {
    await progressMsg.edit({ embeds: [finalEmbed] });
  } else if (interaction instanceof ChatInputCommandInteraction) {
    await interaction.editReply({ embeds: [finalEmbed] });
  }

  console.log(`[FixAll] Completed fix for ${total} users. Success: ${progress.successful}, Failed: ${progress.failed}`);
}

function createProgressEmbed(progress: FixAllProgress): EmbedBuilder {
  const elapsed = Date.now() - progress.startTime;
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const progressPercent = Math.round((progress.processed / progress.total) * 100);
  const successRate = progress.processed > 0 ? Math.round((progress.successful / progress.processed) * 100) : 0;
  
  const progressBar = createProgressBar(progressPercent);
  
  const embed = new EmbedBuilder()
    .setTitle('🔄 Fix All Progress')
    .setColor('#FFA500')
    .setDescription(`Processing user roles and nicknames...`)
    .addFields(
      { name: 'Progress', value: progressBar, inline: false },
      { name: 'Processed', value: `${progress.processed}/${progress.total} (${progressPercent}%)`, inline: true },
      { name: 'Successful', value: `${progress.successful}`, inline: true },
      { name: 'Failed', value: `${progress.failed}`, inline: true },
      { name: 'Success Rate', value: `${successRate}%`, inline: true },
      { name: 'Elapsed Time', value: formatTime(elapsedSeconds), inline: true },
      { name: 'ETA', value: calculateETA(progress, elapsed), inline: true }
    )
    .setFooter({ text: 'Deyo.lol' })
    .setTimestamp();

  if (progress.errors.length > 0) {
    const recentErrors = progress.errors.slice(-3);
    embed.addFields({
      name: 'Recent Errors',
      value: recentErrors.map(err => `• ${err}`).join('\n'),
      inline: false
    });
  }

  return embed;
}

function createFinalEmbed(progress: FixAllProgress): EmbedBuilder {
  const elapsed = Date.now() - progress.startTime;
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const successRate = progress.total > 0 ? Math.round((progress.successful / progress.total) * 100) : 0;
  
  const color = successRate >= 90 ? '#00FF00' : successRate >= 70 ? '#FFA500' : '#00AAAA';
  const status = successRate >= 90 ? '✅ Completed Successfully' : successRate >= 70 ? '⚠️ Completed with Issues' : '❌ Completed with Errors';
  
  const embed = new EmbedBuilder()
    .setTitle(status)
    .setColor(color)
    .setDescription(`Fix all operation completed!`)
    .addFields(
      { name: 'Total Users', value: `${progress.total}`, inline: true },
      { name: 'Successful', value: `${progress.successful}`, inline: true },
      { name: 'Failed', value: `${progress.failed}`, inline: true },
      { name: 'Success Rate', value: `${successRate}%`, inline: true },
      { name: 'Total Time', value: formatTime(elapsedSeconds), inline: true },
      { name: 'Average Time/User', value: `${Math.round(elapsed / progress.total)}ms`, inline: true }
    )
    .setFooter({ text: 'Deyo.lol' })
    .setTimestamp();

  if (progress.errors.length > 0) {
    const errorCount = progress.errors.length;
    const displayErrors = progress.errors.slice(-5);
    
    embed.addFields({
      name: `Errors (${errorCount} total)`,
      value: displayErrors.map(err => `• ${err}`).join('\n') + (errorCount > 5 ? `\n... and ${errorCount - 5} more` : ''),
      inline: false
    });
  }

  return embed;
}

function createProgressBar(percent: number): string {
  const barLength = 20;
  const filledLength = Math.round((percent / 100) * barLength);
  const emptyLength = barLength - filledLength;
  
  const filled = '█'.repeat(filledLength);
  const empty = '░'.repeat(emptyLength);
  
  return `${filled}${empty} ${percent}%`;
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

function calculateETA(progress: FixAllProgress, elapsed: number): string {
  if (progress.processed === 0) {
    return 'Calculating...';
  }
  
  const remaining = progress.total - progress.processed;
  const avgTimePerUser = elapsed / progress.processed;
  const etaMs = remaining * avgTimePerUser;
  
  return formatTime(Math.floor(etaMs / 1000));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}