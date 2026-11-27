import fs from 'fs';
import path from 'path';
import config from '../config/config';
import User from '../models/User';
import PunishmentAction, { PunishmentSource } from '../models/PunishmentAction';
import {
  ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ContainerBuilder, Guild, GuildMember,
  MessageCreateOptions, MessageFlags, PermissionFlagsBits, SectionBuilder, TextChannel, TextDisplayBuilder, ThumbnailBuilder
} from 'discord.js';
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
  /** The player's Minecraft name, shown after their mention; looked up when left out. */
  ign?: string;
  /** Shown as Staff when no PUNISHMENT_STAFF_ID is set, so posts never name the moderator. */
  botId?: string;
}

const ANONYMOUS = new Set<PunishmentType>(['ban', 'unban']);

const TYPE_CONFIG: Record<PunishmentType, { title: string; color: number; icon: string }> = {
  ban: { title: 'Rank Ban', color: 0xa50e1e, icon: 'ban.png' },
  unban: { title: 'Rank Unban', color: 0x2ecc71, icon: 'unbanunmute.png' },
  mute: { title: 'Mute', color: 0xff9900, icon: 'mute.png' },
  unmute: { title: 'Unmute', color: 0x2ecc71, icon: 'unbanunmute.png' },
  strike: { title: 'Strike', color: 0xcda12f, icon: 'strike.png' },
  unstrike: { title: 'Strike Removed', color: 0x2ecc71, icon: 'unbanunmute.png' },
};

const FIELD_LABELS: Record<string, string> = { 'Elo Lost': 'Penalty', 'Elo Refunded': 'Refund' };

const ICON_DIR = path.resolve(process.cwd(), 'src', 'assets', 'punishments');

const moderatorText = (moderatorId: string) =>
  moderatorId === 'system' ? 'System' : moderatorId === 'auto' ? 'Auto-Moderation' : `<@${moderatorId}>`;

const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

function expiryText(expires: Date | null | undefined): string {
  if (!expires) return code('Never');
  const date = expires.toLocaleDateString('en-GB', { timeZone: 'UTC' });
  return `${code(date)} [<t:${Math.floor(expires.getTime() / 1000)}:R>]`;
}

function staffText(options: Pick<PunishmentEmbedOptions, 'type' | 'moderatorId' | 'botId'>): string {
  const automatic = options.moderatorId === 'system' || options.moderatorId === 'auto';
  if (automatic) return moderatorText(options.moderatorId);
  const shown = config.punishmentStaffId || options.botId;
  return shown ? `<@${shown}>` : 'Staff Team';
}

function iconFile(type: PunishmentType): { attachment: string; name: string } | null {
  const name = TYPE_CONFIG[type].icon;
  const full = path.join(ICON_DIR, name);
  return fs.existsSync(full) ? { attachment: full, name } : null;
}

export function buildPunishmentMessage(options: Omit<PunishmentEmbedOptions, 'guild'>, issuerActionId?: string): MessageCreateOptions {
  const { targetId, moderatorId, reason, type, expires, extraFields, caseId, ign } = options;
  const typeConfig = TYPE_CONFIG[type] || TYPE_CONFIG.ban;
  const isPositive = type.startsWith('un');
  const reasonText = reason?.trim() || 'No reason provided';

  const player = [
    `> **Player:** <@${targetId}>${ign ? ` (${ign})` : ''}`,
    `> **Reason:** ${code(reasonText)}${caseId ? ` \`#${caseId}\`` : ''}`,
  ];
  const details: string[] = [];
  for (const field of extraFields || []) {
    const value = /elo/i.test(field.label) ? `*${field.value} ELO*` : code(field.value);
    details.push(`> **${FIELD_LABELS[field.label] || field.label}:** ${value}`);
  }
  details.push(`> **${isPositive && moderatorId === 'system' ? 'Expired' : 'Staff'}:** ${staffText(options)}`);
  if (type === 'ban' || type === 'mute') details.push(`> **Expires:** ${expiryText(expires)}`);

  const body = new TextDisplayBuilder().setContent([`### ${typeConfig.title}`, ...player, '', ...details].join('\n'));
  const icon = iconFile(type);
  const container = new ContainerBuilder().setAccentColor(typeConfig.color);
  if (icon) {
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(body)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${icon.name}`)));
  } else {
    container.addTextDisplayComponents(body);
  }

  const buttons: ButtonBuilder[] = [];
  if (issuerActionId) {
    buttons.push(new ButtonBuilder().setCustomId(`punishment:issuer:${issuerActionId}`).setLabel('Details').setEmoji('📖').setStyle(ButtonStyle.Secondary));
  } else if (caseId && !ANONYMOUS.has(type)) {
    buttons.push(new ButtonBuilder().setCustomId(`punishment:details:${type}:${targetId}:${caseId}`).setLabel('Details').setStyle(ButtonStyle.Secondary));
  }

  if (!isPositive) {
    const support = config.channels?.supportChannel;
    const appeal = new TextDisplayBuilder()
      .setContent(`-# If you wish to appeal, open a ticket in ${support ? `<#${support}>` : 'the support channel'}`);
    const store = (type === 'ban' || type === 'mute') ? config.storeUrl : '';
    const accessory = store
      ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(store).setLabel(type === 'ban' ? 'Buy Unban' : 'Buy Unmute')
      : buttons.shift();
    if (accessory) {
      container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(appeal).setButtonAccessory(accessory));
    } else {
      container.addTextDisplayComponents(appeal);
    }
  }
  if (buttons.length) container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons));

  return {
    components: [container],
    files: icon ? [icon] : [],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [targetId] },
  };
}

async function lookupIgn(discordId: string): Promise<string | undefined> {
  const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 2000).unref?.());
  const user = await Promise.race([
    Promise.resolve(User.findOne({ discordId }).select('ign').lean()).catch(() => null),
    timeout,
  ]) as { ign?: string } | null;
  return user?.ign || undefined;
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
  const ign = options.ign ?? await lookupIgn(options.targetId);
  const botId = options.botId ?? guild.client?.user?.id;
  const payload = buildPunishmentMessage({ ...options, ign, botId }, issuerActionId);
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
    const isAdmin = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
    if (!ANONYMOUS.has(base as PunishmentType) && canSeeIssuer(interaction.member as GuildMember | null, isAdmin)) {
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
