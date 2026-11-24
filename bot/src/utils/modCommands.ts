import { ChatInputCommandInteraction, Guild } from 'discord.js';
import { safeReply } from './safeReply';
import { embedsFor } from './betterembed';
import { parseDuration } from './parseDuration';
import { parseDiscordId } from './inputValidation';
import User from '../models/User';
import type { ApplyOptions } from '../managers/timedPunishmentManager';
import { PunishmentPresets, resolvePreset } from '../services/PunishmentPresets';

const { errorEmbed, successEmbed } = embedsFor('Punishment');

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
  managerCall: (guild: Guild, targetId: string, issuerId: string, duration: string, reason: string, options: ApplyOptions) => Promise<unknown>;
  hasDuration: boolean;
}

interface Chosen {
  duration: string;
  reason: string;
  options: ApplyOptions;
  note: string;
}

export async function choosePunishment(
  type: 'ban' | 'mute',
  targetId: string,
  presetName: string | null,
  typedDuration: string,
  typedReason: string
): Promise<Chosen | { error: string }> {
  if (!presetName) {
    if (!typedDuration) {
      return { error: `Give a duration or a preset. \`/preset list\` shows the presets.` };
    }
    return { duration: typedDuration, reason: typedReason || 'No reason provided', options: {}, note: '' };
  }
  const preset = await PunishmentPresets.get(presetName);
  if (!preset) {
    return { error: `There's no preset called \`${presetName}\`. \`/preset list\` shows them.` };
  }
  if (preset.type !== type) {
    return { error: `\`${preset.name}\` is a ${preset.type} preset, not a ${type} one.` };
  }
  const user = await User.findOne({ discordId: targetId }).select(type === 'ban' ? 'bans' : 'mutes').lean() as
    { bans?: Array<{ preset?: string }>; mutes?: Array<{ preset?: string }> } | null;
  const resolved = resolvePreset(preset, (type === 'ban' ? user?.bans : user?.mutes) ?? []);
  return {
    duration: typedDuration || resolved.duration,
    reason: typedReason || resolved.reason,
    options: { preset: preset.name },
    note: `\n**Preset:** ${preset.name} (offence ${resolved.offence})`
  };
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

  const chosen = config.hasDuration && (config.commandName === 'ban' || config.commandName === 'mute')
    ? await choosePunishment(config.commandName, parsed.targetId, interaction.options.getString('preset'),
      interaction.options.getString('duration') || '', interaction.options.getString('reason') || '')
    : { duration: '', reason: interaction.options.getString('reason') || 'No reason provided', options: {}, note: '' };
  if ('error' in chosen) {
    await safeReply(interaction, errorEmbed(chosen.error, `${config.commandName} Error`));
    return;
  }
  const { duration, reason } = chosen;

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
    await config.managerCall(parsed.guild, parsed.targetId, parsed.issuerId, duration, reason, chosen.options);
    const durationText = config.hasDuration && duration ? `\n**Duration:** ${duration}` : '';
    const embed = successEmbed(
      `${config.actionVerb} <@${parsed.targetId}>.${durationText}\n**Reason:** ${reason}${chosen.note}`,
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
  activeWord: string;
  managerCall: (guild: Guild, targetId: string, issuerId: string, reason?: string) => Promise<boolean>;
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
    const reason = interaction.options.getString('reason')?.trim() || undefined;
    const undone = await config.managerCall(parsed.guild, parsed.targetId, parsed.issuerId, reason);
    if (!undone) {
      await safeReply(interaction, errorEmbed(`<@${parsed.targetId}> isn't ${config.activeWord}.`, `${config.commandName} Error`));
      return;
    }
    await safeReply(interaction, successEmbed(
      `${config.actionVerb} <@${parsed.targetId}>.${reason ? `\n**Reason:** ${reason}` : ''}`,
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
  managerCall: (guild: Guild, targetId: string, issuerId: string, reason: string, count: number) => Promise<unknown>;
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

  const presetName = config.commandName === 'strike' ? interaction.options.getString('preset') : null;
  let reason = interaction.options.getString('reason') || '';
  let count = 1;
  if (presetName) {
    const preset = await PunishmentPresets.get(presetName);
    if (!preset || preset.type !== 'strike') {
      await safeReply(interaction, errorEmbed(preset
        ? `\`${preset.name}\` is a ${preset.type} preset, not a strike one.`
        : `There's no preset called \`${presetName}\`. \`/preset list\` shows them.`, `${config.commandName} Error`));
      return;
    }
    reason = reason || preset.reason;
    count = preset.strikes ?? 1;
  }
  reason = reason || 'No reason provided';

  try {
    await config.managerCall(parsed.guild, parsed.targetId, parsed.issuerId, reason, count);
    await safeReply(interaction, successEmbed(
      config.successMessage(parsed.targetId, reason) + (count > 1 ? `\n**Strikes given:** ${count}` : ''),
      undefined,
      false
    ));
  } catch (error) {
    console.error(`Failed to ${config.commandName} user:`, error);
    await safeReply(interaction, errorEmbed(`Failed to ${config.commandName} user.`, `${config.commandName} Error`));
  }
}
