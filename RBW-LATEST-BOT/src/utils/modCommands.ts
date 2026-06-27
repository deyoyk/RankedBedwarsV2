import { Message, ChatInputCommandInteraction, Guild } from 'discord.js';
import { safeReply } from './safeReply';
import { successEmbed, errorEmbed } from './betterembed';

interface ParsedInteraction {
  targetId: string;
  duration?: string;
  reason: string;
  guild: Guild | null;
  issuerId: string;
}

function parseInteractionInput(
  interaction: Message | ChatInputCommandInteraction,
  args: string[] | undefined,
  options: { hasDuration?: boolean; hasReason?: boolean; commandName: string }
): ParsedInteraction | { error: string } {
  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    return {
      targetId: user.id,
      duration: options.hasDuration ? (interaction.options.getString('duration', false) || '') : undefined,
      reason: interaction.options.getString('reason', false) || 'No reason provided',
      guild: interaction.guild,
      issuerId: interaction.user.id
    };
  }

  if (!args || args.length < 1) {
    const usage = options.hasDuration
      ? `Usage: =${options.commandName} <@user> [duration] [reason]`
      : options.hasReason
        ? `Usage: =${options.commandName} <@user> [reason]`
        : `Usage: =${options.commandName} <userId>`;
    return { error: usage };
  }

  if (options.hasDuration || options.hasReason) {
    const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
    if (!mentionMatch) {
      return { error: 'Please mention a valid user.' };
    }
    const targetId = mentionMatch[1];
    const duration = options.hasDuration ? (args[1] || '') : undefined;
    const reasonIdx = options.hasDuration ? 2 : 1;
    const reason = args.length > reasonIdx ? args.slice(reasonIdx).join(' ') : 'No reason provided';
    return {
      targetId,
      duration,
      reason,
      guild: interaction.guild,
      issuerId: interaction.author.id
    };
  }

  return {
    targetId: args[0],
    reason: args.slice(1).join(' ') || 'No reason provided',
    guild: (interaction as Message).guild,
    issuerId: (interaction as Message).author.id
  };
}

export interface ModerationActionConfig {
  commandName: string;
  actionVerb: string;
  managerCall: (guild: Guild, targetId: string, issuerId: string, duration: string, reason: string) => Promise<any>;
  hasDuration: boolean;
}

export async function executeModerationAction(
  interaction: Message | ChatInputCommandInteraction,
  args: string[] | undefined,
  config: ModerationActionConfig
): Promise<void> {
  const parsed = parseInteractionInput(interaction, args, {
    hasDuration: config.hasDuration,
    commandName: config.commandName
  });

  if ('error' in parsed) {
    await safeReply(interaction, errorEmbed(parsed.error, `${config.commandName} Usage Error`));
    return;
  }

  if (!parsed.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', `${config.commandName} Error`));
    return;
  }

  try {
    await config.managerCall(parsed.guild, parsed.targetId, parsed.issuerId, parsed.duration || '', parsed.reason);
    const durationText = config.hasDuration && parsed.duration ? `\n**Duration:** ${parsed.duration}` : '';
    const embed = successEmbed(
      `${config.actionVerb} <@${parsed.targetId}>.${durationText}\n**Reason:** ${parsed.reason}`,
      undefined,
      false
    );
    await safeReply(interaction, embed);
  } catch (error) {
    await safeReply(interaction, errorEmbed(`Failed to ${config.commandName} user.`, `${config.commandName} Error`));
  }
}

export interface UnmoderationActionConfig {
  commandName: string;
  actionVerb: string;
  managerCall: (guild: Guild, targetId: string, issuerId: string) => Promise<any>;
}

export async function executeUnmoderationAction(
  interaction: Message | ChatInputCommandInteraction,
  args: string[] | undefined,
  config: UnmoderationActionConfig
): Promise<void> {
  await executeModerationCommand(interaction, args, {
    commandName: config.commandName,
    onSuccess: async (parsed) => {
      await config.managerCall(parsed.guild!, parsed.targetId, parsed.issuerId);
      return { embed: successEmbed(`${config.actionVerb} <@${parsed.targetId}>.`, `User ${config.actionVerb}`) };
    }
  });
}

export interface StrikeActionConfig {
  commandName: string;
  successMessage: (targetId: string, reason: string) => string;
  managerCall: (guild: Guild, targetId: string, issuerId: string, reason: string) => Promise<any>;
}

async function executeModerationCommand(
  interaction: Message | ChatInputCommandInteraction,
  args: string[] | undefined,
  options: {
    commandName: string;
    hasDuration?: boolean;
    hasReason?: boolean;
    onSuccess: (parsed: ParsedInteraction) => Promise<{ embed: any; errorTitle?: string } | { error: string; errorTitle?: string }>;
  }
): Promise<void> {
  const parsed = parseInteractionInput(interaction, args, {
    hasDuration: options.hasDuration,
    hasReason: options.hasReason,
    commandName: options.commandName
  });

  if ('error' in parsed) {
    await safeReply(interaction, errorEmbed(parsed.error, `${options.commandName} Usage Error`));
    return;
  }

  if (!parsed.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.'));
    return;
  }

  try {
    const result = await options.onSuccess(parsed);
    if ('error' in result) {
      await safeReply(interaction, errorEmbed(result.error, result.errorTitle || `${options.commandName} Error`));
    } else {
      await safeReply(interaction, result.embed);
    }
  } catch (error) {
    await safeReply(interaction, errorEmbed(`Failed to ${options.commandName} user.`));
  }
}

export async function executeStrikeAction(
  interaction: Message | ChatInputCommandInteraction,
  args: string[] | undefined,
  config: StrikeActionConfig
): Promise<void> {
  await executeModerationCommand(interaction, args, {
    commandName: config.commandName,
    hasReason: true,
    onSuccess: async (parsed) => {
      await config.managerCall(parsed.guild!, parsed.targetId, parsed.issuerId, parsed.reason);
      const embed = successEmbed(
        config.successMessage(parsed.targetId, parsed.reason),
        undefined,
        false
      );
      return { embed };
    }
  });
}
