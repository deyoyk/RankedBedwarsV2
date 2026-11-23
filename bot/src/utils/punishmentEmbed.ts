import config from '../config/config';
import User from '../models/User';
import PunishmentAction, { PunishmentSource } from '../models/PunishmentAction';
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Guild, GuildMember, MessageCreateOptions, MessageFlags, PermissionFlagsBits, TextChannel } from 'discord.js';
import { embedsFor } from './betterembed';
import { PermissionService } from '../services/PermissionService';

const { themedEmbed } = embedsFor('Punishment');

type PunishmentType = 'ban' | 'unban' | 'mute' | 'unmute' | 'strike' | 'unstrike';

interface PunishmentEmbedOptions {
  guild: Guild;
  targetId: string;
  moderatorId: string;
  reason: string;
  type: PunishmentType;
  expires?: Date | null;
  extraFields?: Array<{ label: string; value: string }>;
  /** The record's ID (for example "4840E"), shown next to the reason and used by the Details button */
  caseId?: string;
  staff?: string;
  source?: PunishmentSource;
}

const ANONYMOUS = new Set<PunishmentType>(['ban', 'unban']);

const TYPE_CONFIG: Record<PunishmentType, { action: string; color: number }> = {
  ban: { action: 'has been 🔨 rank banned', color: 0x7b0606 },
  unban: { action: 'has been ✅ unbanned', color: 0x00aaaa },
  mute: { action: 'has been 🔇 muted', color: 0xff9900 },
  unmute: { action: 'has been 🔊 unmuted', color: 0x00aaaa },
  strike: { action: 'has been issued a ⭐ strike', color: 0xcda12f },
  unstrike: { action: 'had a ⭐ strike removed', color: 0x00aaaa },
};

const FIELD_LABELS: Record<string, string> = { 'Elo Lost': 'Penalty', 'Elo Refunded': 'Refund' };

const moderatorText = (moderatorId: string) =>
  moderatorId === 'system' ? 'System' : moderatorId === 'auto' ? 'Auto-Moderation' : `<@${moderatorId}>`;

function formatDuration(expires: Date): string {
  const remainingMs = Math.max(0, expires.getTime() - Date.now());
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.ceil(minutes / 60)}h`;
  return `${Math.ceil(minutes / 1440)}d`;
}

export function buildPunishmentMessage(options: Omit<PunishmentEmbedOptions, 'guild'>, issuerActionId?: string): MessageCreateOptions {
  const { targetId, moderatorId, reason, type, expires, extraFields, caseId } = options;
  const typeConfig = TYPE_CONFIG[type] || TYPE_CONFIG.ban;
  const isPositive = type.startsWith('un');
  const userMention = `<@${targetId}>`;
  const reasonText = reason?.trim() || 'No reason provided';

  const description = [
    `${userMention} ${typeConfig.action}.`,
    `> **Reason:** ${reasonText}${caseId ? ` \`#${caseId}\`` : ''}`,
  ].join('\n');

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  for (const field of extraFields || []) {
    const value = /elo/i.test(field.label) ? `*${field.value} ELO*` : `\`${field.value}\``;
    fields.push({ name: FIELD_LABELS[field.label] || field.label, value, inline: true });
  }
  if (!isPositive && (type === 'ban' || type === 'mute')) {
    fields.push({ name: 'Duration', value: expires ? `\`${formatDuration(expires)}\`` : '`Permanent`', inline: true });
    fields.push({ name: 'Expires', value: expires ? `<t:${Math.floor(expires.getTime() / 1000)}:R>` : '`Never`', inline: true });
  }
  if (!ANONYMOUS.has(type)) {
    fields.push({ name: isPositive && moderatorId === 'system' ? 'Expired' : 'Staff', value: `> ${moderatorText(moderatorId)}`, inline: true });
  }

  const embed = themedEmbed(typeConfig.color)
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();
  if (!isPositive) embed.setFooter({ text: 'To appeal, open a ticket in the support channel' });

  const buttons: ButtonBuilder[] = [];
  if (issuerActionId) {
    buttons.push(new ButtonBuilder().setCustomId(`punishment:issuer:${issuerActionId}`).setLabel('Details').setEmoji('📖').setStyle(ButtonStyle.Secondary));
  } else if (caseId && !ANONYMOUS.has(type)) {
    buttons.push(new ButtonBuilder().setCustomId(`punishment:details:${type}:${targetId}:${caseId}`).setLabel('Details').setStyle(ButtonStyle.Secondary));
  }
  const components = buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)] : [];

  return { content: userMention, embeds: [embed], components };
}

export async function sendPunishmentEmbed(options: PunishmentEmbedOptions): Promise<void> {
  const { guild, type } = options;

  const channelId = config.channels.punishmentsChannel;
  if (!channelId) {
    console.warn('[PunishmentEmbed] Punishments channel not configured');
    return;
  }

  const cachedChannel = guild.channels.cache?.get(channelId) as TextChannel | undefined;
  const channelPromise = cachedChannel
    ? Promise.resolve(cachedChannel)
    : guild.channels.fetch(channelId);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Channel fetch timeout')), 3000)
  );

  const channel = (await Promise.race([channelPromise, timeoutPromise]).catch(() => null)) as TextChannel | null;
  if (!channel || !channel.isTextBased()) {
    console.warn(`[PunishmentEmbed] Punishments channel ${channelId} not found or not text-based`);
    return;
  }

  let issuerActionId: string | undefined;
  if (ANONYMOUS.has(type)) {
    try {
      const action = await PunishmentAction.create({
        type, targetId: options.targetId, moderatorId: options.moderatorId, staff: options.staff,
        source: options.source ?? 'discord', caseId: options.caseId
      });
      issuerActionId = String(action._id);
    } catch (error) {
      console.error(`[PunishmentEmbed] Couldn't record who issued the ${type}:`, error);
    }
  }
  const payload = buildPunishmentMessage(options, issuerActionId);
  try {
    await channel.send(payload);
  } catch (error) {
    console.error(`[PunishmentEmbed] Failed to send ${type} embed, queueing one background retry:`, error);
    void channel
      .send(payload)
      .catch((retryError) => console.error(`[PunishmentEmbed] Background retry failed for ${type} embed:`, retryError));
  }
}

/** "Details" button on a punishment post: the record plus the player's punishment totals, only for whoever clicked. */
export async function handlePunishmentDetails(interaction: ButtonInteraction): Promise<void> {
  const [, , type, targetId, caseId] = interaction.customId.split(':');
  const user = await User.findOne({ discordId: targetId }).select('ign strikes mutes bans').lean() as {
    ign?: string;
    strikes?: Array<{ id: string; reason?: string; date: Date; moderator: string; duration?: number }>;
    mutes?: Array<{ id: string; reason?: string; date: Date; moderator: string; duration?: number }>;
    bans?: Array<{ id: string; reason?: string; date: Date; moderator: string; duration?: number }>;
  } | null;

  if (!user) {
    const embed = themedEmbed('error').setDescription('This player is no longer registered.');
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  const lists = { strike: user.strikes || [], ban: user.bans || [], mute: user.mutes || [] };
  const base = type.replace(/^un/, '') as keyof typeof lists;
  const record = (lists[base] || []).find(r => r.id === caseId);

  const lines = [`<@${targetId}>${user.ign ? ` · \`${user.ign}\`` : ''}`];
  if (record) {
    lines.push(`> **Case:** \`#${record.id}\``);
    lines.push(`> **Reason:** ${record.reason || 'No reason provided'}`);
    lines.push(`> **Date:** <t:${Math.floor(new Date(record.date).getTime() / 1000)}:f>`);
    if (typeof record.duration === 'number') {
      lines.push(`> **Duration:** \`${record.duration > 0 ? `${record.duration}m` : 'Permanent'}\``);
    }
    if (!ANONYMOUS.has(base as PunishmentType)) {
      lines.push(`> **Staff:** ${moderatorText(record.moderator)}`);
    }
  } else {
    lines.push(`-# ➡ Case \`#${caseId}\` is no longer on record`);
  }

  const embed = themedEmbed('info')
    .setDescription(lines.join('\n'))
    .addFields(
      { name: 'Strikes', value: `\`${lists.strike.length}\``, inline: true },
      { name: 'Mutes', value: `\`${lists.mute.length}\``, inline: true },
      { name: 'Bans', value: `\`${lists.ban.length}\``, inline: true },
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export function canSeeIssuer(member: GuildMember | null, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  const roles = PermissionService.rolesFor('ban');
  return Boolean(member?.roles?.cache && roles.some(roleId => member.roles.cache.has(roleId)));
}

export async function handlePunishmentIssuer(interaction: ButtonInteraction): Promise<void> {
  const isAdmin = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
  if (!canSeeIssuer(interaction.member as GuildMember | null, isAdmin)) {
    const embed = themedEmbed('error').setDescription('Only staff can see who issued this.');
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  const id = interaction.customId.split(':')[2] || '';
  const action = await PunishmentAction.findById(id).lean().catch(() => null);
  if (!action) {
    const embed = themedEmbed('error').setDescription('Who issued this is no longer on record.');
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }
  const when = Math.floor(new Date(action.date).getTime() / 1000);
  const who = action.source === 'minecraft'
    ? `\`${action.staff || 'Console'}\`${/^\d{17,20}$/.test(action.moderatorId) && action.moderatorId !== interaction.client.user?.id ? ` (<@${action.moderatorId}>)` : ''}`
    : moderatorText(action.moderatorId);
  const lines = [
    `<@${action.targetId}> · ${action.type === 'unban' ? 'Unban' : 'Ban'}${action.caseId ? ` \`#${action.caseId}\`` : ''}`,
    `> **Issued by:** ${who}`,
    `> **When:** <t:${when}:f> (<t:${when}:R>)`,
    `> **Where:** ${action.source === 'minecraft' ? 'Minecraft' : 'Discord'}`,
  ];
  await interaction.reply({ embeds: [themedEmbed('info').setDescription(lines.join('\n'))], flags: MessageFlags.Ephemeral });
}
