import config from '../config/config';
import { Guild, MessageCreateOptions, TextChannel } from 'discord.js';
import path from 'path';
import fs from 'fs';
import { themedEmbed } from './betterembed';

type PunishmentType = 'ban' | 'unban' | 'mute' | 'unmute' | 'strike' | 'unstrike';
type BasePunishmentType = 'ban' | 'mute' | 'strike';

interface PunishmentEmbedOptions {
  guild: Guild;
  targetId: string;
  moderatorId: string;
  reason: string;
  type: PunishmentType;
  expires?: Date | null;
  extraFields?: Array<{ label: string; value: string }>;
  assetFileName?: string;
  title?: string;
  color?: number;
}

interface PunishmentStyle {
  title: string;
  label: string;
  color: number;
  asset: string;
  removalPhrase: string;
}

const TYPE_STYLES: Record<BasePunishmentType, PunishmentStyle> = {
  ban: {
    title: 'PLAYER PUNISHED',
    label: 'Ranked Ban',
    color: 0x71368A,
    asset: 'ban.png',
    removalPhrase: 'is no longer banned',
  },
  mute: {
    title: 'PLAYER PUNISHED',
    label: 'Mute',
    color: 0x992D22,
    asset: 'mute.png',
    removalPhrase: 'is no longer muted',
  },
  strike: {
    title: 'PLAYER PUNISHED',
    label: 'Strike',
    color: 0xC27C0E,
    asset: 'strike.png',
    removalPhrase: 'has had their strike removed',
  },
};

const REMOVAL_TITLES: Record<BasePunishmentType, string> = {
  ban: 'BAN REMOVED',
  mute: 'MUTE DELETED',
  strike: 'STRIKE REMOVED',
};

const REMOVAL_COLOR = 0x1ABC9C;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function baseTypeOf(type: PunishmentType): BasePunishmentType {
  return (type.startsWith('un') ? type.slice(2) : type) as BasePunishmentType;
}

function formatDuration(expires: Date): string {
  const remainingMs = Math.max(0, expires.getTime() - Date.now());
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (days === 0 && minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' ') : '0 minutes';
}

function formatExpiryDate(expires: Date): string {
  const d = new Date(expires);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function formatProcessedDate(date: Date): string {
  const d = new Date(date);
  const weekday = WEEKDAYS[d.getDay()];
  const month = MONTHS[d.getMonth()];
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${weekday}, ${d.getDate()} ${month}, ${d.getFullYear()} ${hours}:${minutes}`;
}

const assetPathCache = new Map<string, string | null>();

function resolveAssetPath(fileName: string): string | null {
  const hit = assetPathCache.get(fileName);
  if (hit !== undefined) return hit;
  const candidatePaths = [
    path.resolve(process.cwd(), 'src', 'assets', 'punishments', fileName),
    path.resolve(process.cwd(), 'assets', 'punishments', fileName)
  ];
  const found = candidatePaths.find(p => fs.existsSync(p)) ?? null;
  if (assetPathCache.size >= 100) {
    const oldest = assetPathCache.keys().next();
    if (!oldest.done) assetPathCache.delete(oldest.value);
  }
  assetPathCache.set(fileName, found);
  return found;
}

export async function sendPunishmentEmbed(options: PunishmentEmbedOptions): Promise<void> {
  const { guild, targetId, reason, type, expires, extraFields, assetFileName: customAsset, title: customTitle, color: customColor } = options;

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

  const baseType = baseTypeOf(type);
  const style = TYPE_STYLES[baseType];
  const isRemoval = type.startsWith('un');
  const userMention = `<@${targetId}>`;
  const reasonText = reason?.trim() || 'No reason provided';

  const descriptionLines: string[] = [];

  if (isRemoval) {
    descriptionLines.push(`• ${userMention} ${style.removalPhrase}. Punishment Type: **${style.label}**.`);
    descriptionLines.push(`• This punishment was deleted for the reason **${reasonText}**.`);
    descriptionLines.push(`• Processed ${formatProcessedDate(new Date())}.`);
  } else {
    descriptionLines.push(`• ${userMention} has been issued a **${style.label}** punishment.`);
    if (expires) {
      descriptionLines.push(`• The punishment duration is **${formatDuration(expires)}**. Expiring ${formatExpiryDate(expires)}`);
    }
    descriptionLines.push(`• The punishment reason is **${reasonText}**`);
    if (baseType === 'ban') {
      descriptionLines.push('• Player is no longer able to queue. They can appeal by opening a support ticket.');
    }
  }

  if (extraFields) {
    for (const field of extraFields) {
      descriptionLines.push(`• ${field.label}: **${field.value}**`);
    }
  }

  const embed = themedEmbed(customColor ?? (isRemoval ? REMOVAL_COLOR : style.color))
    .setTitle(customTitle || (isRemoval ? REMOVAL_TITLES[baseType] : style.title))
    .setDescription(descriptionLines.join('\n'))
    .setTimestamp();

  const fileName = customAsset || (isRemoval ? 'unbanunmute.png' : style.asset);
  const assetPath = resolveAssetPath(fileName);
  const files: { attachment: string; name: string }[] = [];
  if (assetPath) {
    embed.setThumbnail(`attachment://${fileName}`);
    files.push({ attachment: assetPath, name: fileName });
  } else {
    console.warn(`[PunishmentEmbed] Asset not found for embed thumbnail: ${fileName}`);
  }

  const payload: MessageCreateOptions = { embeds: [embed] };
  if (files.length > 0) payload.files = files;

  try {
    await channel.send(payload);
  } catch (error) {
    console.error(`[PunishmentEmbed] Failed to send ${type} embed, queueing one background retry:`, error);
    void channel
      .send(payload)
      .catch((retryError) => console.error(`[PunishmentEmbed] Background retry failed for ${type} embed:`, retryError));
  }
}
