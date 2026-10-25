import User from '../models/User';
import config from '../config/config';
import { Guild, EmbedBuilder, TextChannel } from 'discord.js';
import path from 'path';
import fs from 'fs';

interface PunishmentEmbedOptions {
  guild: Guild;
  targetId: string;
  moderatorId: string;
  reason: string;
  type: 'ban' | 'unban' | 'mute' | 'unmute' | 'strike' | 'unstrike';
  expires?: Date | null;
  extraFields?: Array<{ label: string; value: string }>;
  assetFileName?: string;
  title?: string;
  color?: number;
}

function formatDuration(expires: Date): string {
  const remainingMs = Math.max(0, expires.getTime() - Date.now());
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.ceil(minutes / 60)}h`;
  return `${Math.ceil(minutes / 1440)}d`;
}

function formatExpiryDate(expires: Date): string {
  const d = new Date(expires);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

const TYPE_CONFIG: Record<string, { title: string; color: number; asset: string }> = {
  ban:     { title: 'Rank Banned',     color: 0x7b0606, asset: 'ban.png' },
  unban:   { title: 'User Unbanned',   color: 0x2dd56b, asset: 'unbanunmute.png' },
  mute:    { title: 'Muted',           color: 0xff9900, asset: 'ban.png' },
  unmute:  { title: 'User Unmuted',    color: 0x2dd56b, asset: 'unbanunmute.png' },
  strike:  { title: 'Strike Issued',   color: 0xcda12f, asset: 'strike.png' },
  unstrike:{ title: 'Strike Removed',  color: 0x2dd56b, asset: 'unbanunmute.png' },
};

const assetPathCache = new Map<string, string | null>();

function resolveAssetPath(fileName: string): string | null {
  const hit = assetPathCache.get(fileName);
  if (hit !== undefined) return hit;
  const candidatePaths = [
    path.resolve(process.cwd(), 'src', 'asserts', 'punishments', fileName),
    path.resolve(process.cwd(), 'asserts', 'punishments', fileName)
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
  const { guild, targetId, moderatorId, reason, type, expires, extraFields, assetFileName: customAsset, title: customTitle, color: customColor } = options;

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

  const [channel, userDoc] = (await Promise.all([
    Promise.race([channelPromise, timeoutPromise]).catch(() => null),
    User.findOne({ discordId: targetId }).select('ign').lean().catch(() => null)
  ])) as [TextChannel | null, { ign?: string } | null];
  if (!channel || !channel.isTextBased()) {
    console.warn(`[PunishmentEmbed] Punishments channel ${channelId} not found or not text-based`);
    return;
  }

  const config_ = TYPE_CONFIG[type] || TYPE_CONFIG.ban;
  const isPositive = type.startsWith('un');
  const userMention = `<@${targetId}>`;
  const moderatorMention = moderatorId === 'system' ? 'System' :
    moderatorId === 'auto' ? 'Auto-Moderation' : `<@${moderatorId}>`;
  const reasonField = reason?.trim() || 'No reason provided';

  const ign = userDoc?.ign;

  const descriptionLines: string[] = [];
  descriptionLines.push(`**User:** ${userMention}${ign ? ` (${ign})` : ''}`);
  descriptionLines.push(`**Reason:** \`${reasonField}\``);

  if (extraFields) {
    for (const field of extraFields) {
      descriptionLines.push(`**${field.label}:** \`${field.value}\``);
    }
  }

  if (isPositive) {
    const actionVerb = type.replace('un', '');
    descriptionLines.push(`**${moderatorId === 'system' ? 'Expired' : `${actionVerb.charAt(0).toUpperCase() + actionVerb.slice(1)}ed by`}:** ${moderatorMention}`);
    descriptionLines.push('\nIn future if you face another punishment, it will likely increase due to your punishment history.');
  } else {
    if (expires) {
      const durationDisplay = formatDuration(expires);
      const expiryDisplay = formatExpiryDate(expires);
      descriptionLines.push(`**Duration:** \`${durationDisplay}\``);
      descriptionLines.push(`**Expires at:** \`${expiryDisplay}\``);
    }
    descriptionLines.push(`**Staff:** ${moderatorMention}`);
    descriptionLines.push('\nIf you wish to appeal this punishment, please create an appeal Support Channel and staff will be swift to help.');
  }

  const embed = new EmbedBuilder()
    .setTitle(customTitle || config_.title)
    .setColor(customColor ?? config_.color)
    .setDescription(descriptionLines.join('\n'))
    .setTimestamp();

  const fileName = customAsset || config_.asset;
  const assetPath = resolveAssetPath(fileName);
  const files: { attachment: string; name: string }[] = [];
  if (assetPath) {
    embed.setThumbnail(`attachment://${fileName}`);
    files.push({ attachment: assetPath, name: fileName });
  } else {
    console.warn(`[PunishmentEmbed] Asset not found for embed thumbnail: ${fileName}`);
  }

  try {
    await channel.send({ content: userMention, embeds: [embed], files });
  } catch (error) {
    console.error(`[PunishmentEmbed] Failed to send ${type} embed, queueing one background retry:`, error);
    void channel
      .send({ content: userMention, embeds: [embed], files })
      .catch((retryError) => console.error(`[PunishmentEmbed] Background retry failed for ${type} embed:`, retryError));
  }
}
