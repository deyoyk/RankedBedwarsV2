import config from '../config/config';
import { Guild, MessageCreateOptions, TextChannel } from 'discord.js';
import { EmbedStatus, themedEmbed } from './betterembed';

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
}

interface PunishmentStyle {
  label: string;
  status: EmbedStatus;
  removalTitle: string;
  removalPhrase: string;
}

const TYPE_STYLES: Record<BasePunishmentType, PunishmentStyle> = {
  ban: {
    label: 'Ranked Ban',
    status: 'punishment',
    removalTitle: 'Ban Removed',
    removalPhrase: 'is no longer banned',
  },
  mute: {
    label: 'Mute',
    status: 'warning',
    removalTitle: 'Mute Removed',
    removalPhrase: 'is no longer muted',
  },
  strike: {
    label: 'Strike',
    status: 'warning',
    removalTitle: 'Strike Removed',
    removalPhrase: 'has had their strike removed',
  },
};

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

export async function sendPunishmentEmbed(options: PunishmentEmbedOptions): Promise<void> {
  const { guild, targetId, reason, type, expires, extraFields } = options;

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

  const lines: string[] = [];

  if (isRemoval) {
    lines.push(`The player ${style.removalPhrase}.`);
    lines.push('');
    lines.push(`**Type:** ${style.label}`);
    lines.push(`**Reason:** ${reasonText}`);
    lines.push(`**Processed:** ${formatProcessedDate(new Date())}`);
  } else {
    lines.push(`The player has been issued a ${style.label} punishment.`);
    lines.push('');
    if (expires) {
      lines.push(`**Duration:** ${formatDuration(expires)}`);
      lines.push(`**Expires:** ${formatExpiryDate(expires)}`);
    }
    lines.push(`**Reason:** ${reasonText}`);
    if (baseType === 'ban') {
      lines.push('**Queue:** Player is no longer able to queue. They can appeal by opening a support ticket.');
    }
  }

  if (extraFields) {
    for (const field of extraFields) {
      lines.push(`**${field.label}:** ${field.value}`);
    }
  }

  const embed = themedEmbed(isRemoval ? 'success' : style.status)
    .setTitle(isRemoval ? style.removalTitle : style.label)
    .setDescription(lines.join('\n'));

  const payload: MessageCreateOptions = { content: userMention, embeds: [embed] };

  try {
    await channel.send(payload);
  } catch (error) {
    console.error(`[PunishmentEmbed] Failed to send ${type} embed, queueing one background retry:`, error);
    void channel
      .send(payload)
      .catch((retryError) => console.error(`[PunishmentEmbed] Background retry failed for ${type} embed:`, retryError));
  }
}
