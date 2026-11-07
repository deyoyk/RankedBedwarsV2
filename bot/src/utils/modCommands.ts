import { ChatInputCommandInteraction, Guild } from 'discord.js';
import { safeReply } from './safeReply';
import { errorEmbed, successEmbed } from './betterembed';
import { parseDuration } from './parseDuration';
import { parseDiscordId } from './inputValidation';

interface ParsedTarget {
  targetId: string;
  guild: Guild | null;
  issuerId: string;
}

function parseTarget(interaction: ChatInputCommandInteraction): ParsedTarget | { error: string } {
  const user = interaction.options.getUser('user');
  if (user) {
    return { targetId: user.id, guild: interaction.guild, issuerId: interaction.user.id };
  }

  const raw = interaction.options.getString('user_id');
  const targetId = raw ? parseDiscordId(raw) : null;
  if (!targetId) {
    return { error: 'Please provide a valid user or user ID.' };
  }

  return { targetId, guild: interaction.guild, issuerId: interaction.user.id };
}

export interface ModerationActionConfig {
  commandName: string;
  actionVerb: string;
  managerCall: (guild: Guild, targetId: string, issuerId: string, duration: string, reason: string) => Promise<unknown>;
  hasDuration: boolean;
}

export async function executeModerationAction(
  interaction: ChatInputCommandInteraction,
  config: ModerationActionConfig
): Promise<void> {
  const parsed = parseTarget(interaction);
  if ('error' in parsed) {
    await safeReply(interaction, errorEmbed(parsed.error, `${config.commandName} Error`));
    return;
  }

  if (!parsed.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', `${config.commandName} Error`));
    return;
  }

  const duration = config.hasDuration ? (interaction.options.getString('duration') || '') : '';
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (config.hasDuration && duration) {
    try {
      const milliseconds = parseDuration(duration);
      if (milliseconds !== null && milliseconds < 60000) {
        await safeReply(interaction, errorEmbed(
          `${config.commandName.charAt(0).toUpperCase()}${config.commandName.slice(1)} duration must be at least 1 minute.`,
          `${config.commandName} Error`,
        ));
        return;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Invalid duration.';
      await safeReply(interaction, errorEmbed(detail, `${config.commandName} Error`));
      return;
    }
  }

  try {
    await config.managerCall(parsed.guild, parsed.targetId, parsed.issuerId, duration, reason);
    const durationText = config.hasDuration && duration ? `\n**Duration:** ${duration}` : '';
    const embed = successEmbed(
      `${config.actionVerb} <@${parsed.targetId}>.${durationText}\n**Reason:** ${reason}`,
      undefined,
      false
    );
    await safeReply(interaction, embed);
  } catch (error) {
    console.error(`Failed to ${config.commandName} user:`, error);
    await safeReply(interaction, errorEmbed(`Failed to ${config.commandName} user.`, `${config.commandName} Error`));
  }
}

export interface UnmoderationActionConfig {
  commandName: string;
  actionVerb: string;
  managerCall: (guild: Guild, targetId: string, issuerId: string) => Promise<unknown>;
}

export async function executeUnmoderationAction(
  interaction: ChatInputCommandInteraction,
  config: UnmoderationActionConfig
): Promise<void> {
  const parsed = parseTarget(interaction);
  if ('error' in parsed) {
    await safeReply(interaction, errorEmbed(parsed.error, `${config.commandName} Error`));
    return;
  }

  if (!parsed.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', `${config.commandName} Error`));
    return;
  }

  try {
    await config.managerCall(parsed.guild, parsed.targetId, parsed.issuerId);
    await safeReply(interaction, successEmbed(
      `${config.actionVerb} <@${parsed.targetId}>.`,
      `User ${config.actionVerb}`
    ));
  } catch (error) {
    console.error(`Failed to ${config.commandName} user:`, error);
    await safeReply(interaction, errorEmbed(`Failed to ${config.commandName} user.`, `${config.commandName} Error`));
  }
}

export interface StrikeActionConfig {
  commandName: string;
  successMessage: (targetId: string, reason: string) => string;
  managerCall: (guild: Guild, targetId: string, issuerId: string, reason: string) => Promise<unknown>;
}

export async function executeStrikeAction(
  interaction: ChatInputCommandInteraction,
  config: StrikeActionConfig
): Promise<void> {
  const parsed = parseTarget(interaction);
  if ('error' in parsed) {
    await safeReply(interaction, errorEmbed(parsed.error, `${config.commandName} Error`));
    return;
  }

  if (!parsed.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', `${config.commandName} Error`));
    return;
  }

  const reason = interaction.options.getString('reason') || 'No reason provided';

  try {
    await config.managerCall(parsed.guild, parsed.targetId, parsed.issuerId, reason);
    await safeReply(interaction, successEmbed(
      config.successMessage(parsed.targetId, reason),
      undefined,
      false
    ));
  } catch (error) {
    console.error(`Failed to ${config.commandName} user:`, error);
    await safeReply(interaction, errorEmbed(`Failed to ${config.commandName} user.`, `${config.commandName} Error`));
  }
}
