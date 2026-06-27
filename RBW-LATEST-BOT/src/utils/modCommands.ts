import { Message, ChatInputCommandInteraction, Guild } from 'discord.js';
import { safeReply } from './safeReply';
import { successEmbed, errorEmbed } from './betterembed';

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
  let targetId: string;
  let duration: string = '';
  let reason: string = 'No reason provided';
  let guild: Guild | null = null;
  let issuerId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetId = user.id;
    if (config.hasDuration) {
      duration = interaction.options.getString('duration', false) || '';
    }
    reason = interaction.options.getString('reason', false) || 'No reason provided';
    guild = interaction.guild;
    issuerId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      const usage = config.hasDuration
        ? `Usage: =${config.commandName} <@user> [duration] [reason]`
        : `Usage: =${config.commandName} <@user> [reason]`;
      await safeReply(interaction, errorEmbed(usage, `${config.commandName} Usage Error`));
      return;
    }
    const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
    if (!mentionMatch) {
      await safeReply(interaction, errorEmbed('Please mention a valid user.', `${config.commandName} Usage Error`));
      return;
    }
    targetId = mentionMatch[1];
    if (config.hasDuration) {
      duration = args[1] || '';
      reason = args.length > 2 ? args.slice(2).join(' ') : 'No reason provided';
    } else {
      reason = args.length > 1 ? args.slice(1).join(' ') : 'No reason provided';
    }
    guild = interaction.guild;
    issuerId = interaction.author.id;
  }

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', `${config.commandName} Error`));
    return;
  }

  try {
    await config.managerCall(guild, targetId, issuerId, duration, reason);
    const durationText = config.hasDuration && duration ? `\n**Duration:** ${duration}` : '';
    const embed = successEmbed(
      `${config.actionVerb} <@${targetId}>.${durationText}\n**Reason:** ${reason}`,
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
  let targetId: string;
  let guild: any;
  let issuerId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    targetId = interaction.options.getString('userid', true);
    guild = interaction.guild;
    issuerId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed(`Usage: =${config.commandName} <userId>`, `${config.commandName} Usage Error`));
      return;
    }
    targetId = args[0];
    guild = (interaction as Message).guild;
    issuerId = (interaction as Message).author.id;
  }

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.'));
    return;
  }

  try {
    await config.managerCall(guild, targetId, issuerId);
    await safeReply(interaction, successEmbed(`${config.actionVerb} <@${targetId}>.`, `User ${config.actionVerb}`));
  } catch (error) {
    await safeReply(interaction, errorEmbed(`Failed to ${config.commandName} user.`));
  }
}

export interface StrikeActionConfig {
  commandName: string;
  successMessage: (targetId: string, reason: string) => string;
  managerCall: (guild: Guild, targetId: string, issuerId: string, reason: string) => Promise<any>;
}

export async function executeStrikeAction(
  interaction: Message | ChatInputCommandInteraction,
  args: string[] | undefined,
  config: StrikeActionConfig
): Promise<void> {
  let targetId: string;
  let reason: string;
  let guild: any;
  let issuerId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetId = user.id;
    reason = interaction.options.getString('reason', false) || 'No reason provided';
    guild = interaction.guild;
    issuerId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed(`Usage: =${config.commandName} <userId> [reason]`, `${config.commandName} Usage Error`));
      return;
    }
    targetId = args[0];
    reason = args.slice(1).join(' ') || 'No reason provided';
    guild = (interaction as Message).guild;
    issuerId = (interaction as Message).author.id;
  }

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.'));
    return;
  }

  try {
    await config.managerCall(guild, targetId, issuerId, reason);
    const embed = successEmbed(
      config.successMessage(targetId, reason),
      undefined,
      false
    );
    await safeReply(interaction, embed);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Failed to ${config.commandName}.`;
    await safeReply(interaction, errorEmbed(errorMessage, `${config.commandName} Error`));
  }
}
