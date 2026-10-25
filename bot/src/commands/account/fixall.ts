import { Message, ChatInputCommandInteraction, EmbedBuilder, ButtonStyle } from 'discord.js';
import { fix } from '../../utils/fix';
import User from '../../models/User';
import { executeWithConfirmation } from '../../utils/confirmAction';

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
  const total = await User.countDocuments();
  if (!total) {
    const { safeReply } = await import('../../utils/safeReply');
    const { errorEmbed } = await import('../../utils/betterembed');
    await safeReply(interaction, errorEmbed('No users found in the database.', 'Fix All Error'));
    return;
  }

  await executeWithConfirmation(interaction, {
    commandName: 'fixall',
    confirmTitle: '⚠️ Confirm Fix All Operation',
    confirmDescription: `Are you sure you want to fix roles and nicknames for **${total}** users?\n\nThis operation will:`,
    confirmLabel: '✅ Confirm',
    confirmStyle: ButtonStyle.Success,
    fields: [
      { name: 'What it does', value: '• Update user roles based on ELO\n• Update user nicknames\n• Process all users in batches\n• Respect Discord rate limits', inline: false },
      { name: 'Users to process', value: `${total}`, inline: true },
      { name: 'Estimated time', value: `${Math.ceil(total / 25)} seconds`, inline: true },
      { name: 'Rate limiting', value: '1 second between batches', inline: true }
    ],
    startMessage: 'Starting fix all operation...',
    cancelMessage: 'Fix all operation cancelled.',
    onConfirm: () => executeFixAll(interaction, total)
  });
}

async function executeFixAll(interaction: Message | ChatInputCommandInteraction, total: number) {
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

  const batchSize = 25;
  const rateLimitDelay = 1000;
  const updateInterval = 3000;
  const maxStoredErrors = 50;

  try {
    await interaction.guild!.members.fetch();
  } catch (error) {
    console.error('[FixAll] Member pre-warm fetch failed, falling back to per-user lookup:', error);
  }

  let lastId: unknown = null;
  for (;;) {
    const filter: Record<string, unknown> = lastId === null ? {} : { _id: { $gt: lastId } };
    const batch = await User.find(filter).select('_id discordId elo ign settings').sort({ _id: 1 }).limit(batchSize).lean();
    if (batch.length === 0) break;
    lastId = (batch[batch.length - 1] as { _id: unknown })._id;

    const batchPromises = batch.map(async (user) => {
      try {
        const fixed = await fix(interaction.guild!, user.discordId, { discordId: user.discordId, elo: user.elo, ign: user.ign, settings: user.settings });
        if (fixed) {
          progress.successful++;
          console.log(`[FixAll] Successfully fixed user ${user.discordId} (${user.ign || 'Unknown'})`);
        } else {
          progress.failed++;
          const errorMsg = `Skipped ${user.ign || user.discordId}: not in server`;
          if (progress.errors.length < maxStoredErrors) {
            progress.errors.push(errorMsg);
          }
          console.log(`[FixAll] ${errorMsg}`);
        }
      } catch (error) {
        progress.failed++;
        const detail = error instanceof Error ? error.message : 'Unknown error';
        const errorMsg = `Failed to fix ${user.ign || user.discordId}: ${detail}`;
        if (progress.errors.length < maxStoredErrors) {
          progress.errors.push(errorMsg);
        }
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

    if (progress.processed < total) {
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

  if (progress.failed > 0) {
    const errorCount = progress.failed;
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
