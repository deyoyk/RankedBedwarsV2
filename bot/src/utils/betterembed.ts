import { APIEmbed, ColorResolvable, EmbedBuilder } from 'discord.js';
import config from '../config/config';

export type EmbedStatus = 'info' | 'success' | 'warning' | 'error' | 'punishment';

export const EMBED_COLORS: Record<EmbedStatus, number> = {
  info: 0x4de1f2,
  success: 0x4ade80,
  warning: 0xfbbf24,
  error: 0xfb7185,
  punishment: 0xfb7185,
};

const STATUS_LABELS: Record<EmbedStatus, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
  punishment: 'Punishment',
};

const LEGACY_COLORS: Record<number, EmbedStatus> = {
  0x3498db: 'info',
  0x00aaaa: 'info',
  0x5865f2: 'info',
  0x71368a: 'info',
  0x4de1f2: 'info',
  0x2ecc71: 'success',
  0x00ff00: 'success',
  0x00ff99: 'success',
  0x1abc9c: 'success',
  0x4ade80: 'success',
  0xe74c3c: 'error',
  0xff0000: 'error',
  0xff6b6b: 'error',
  0x992d22: 'error',
  0xfb7185: 'error',
  0xffa500: 'warning',
  0xffcc00: 'warning',
  0xff9900: 'warning',
  0xc27c0e: 'warning',
  0xfbbf24: 'warning',
};

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
const EMOJI_COMBINING_RE = /\u{FE0F}|\u{200D}|\u{20E3}/gu;

export const EMBED_THEME = {
  defaultColor: EMBED_COLORS.info,
  errorColor: EMBED_COLORS.error,
  successColor: EMBED_COLORS.success,
  warningColor: EMBED_COLORS.warning,
  punishmentColor: EMBED_COLORS.punishment,
  footer: config.serverName || 'deyo Ranked Bedwars',
  defaultTitle: STATUS_LABELS.info,
  errorTitle: STATUS_LABELS.error,
  successTitle: STATUS_LABELS.success,
  warningTitle: STATUS_LABELS.warning,
  punishmentTitle: STATUS_LABELS.punishment,
  errorText: 'An error occurred.',
  successText: 'Success!',
} as const;

function isStatus(value: string): value is EmbedStatus {
  return value === 'info' || value === 'success' || value === 'warning' || value === 'error' || value === 'punishment';
}

function cleanColor(color: string | number): number {
  if (typeof color === 'string') {
    let c = color.trim();
    if (c.startsWith('-#')) c = c.slice(2);
    if (c.startsWith('#')) c = c.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(c)) return parseInt(c, 16);
    return EMBED_COLORS.info;
  }
  if (typeof color === 'number' && Number.isInteger(color) && color >= 0 && color <= 0xffffff) return color;
  return EMBED_COLORS.info;
}

function statusFromColor(color: ColorResolvable | EmbedStatus | null | undefined): EmbedStatus {
  if (typeof color === 'string' && isStatus(color.trim().toLowerCase())) {
    return color.trim().toLowerCase() as EmbedStatus;
  }
  if (typeof color === 'string' || typeof color === 'number') {
    return LEGACY_COLORS[cleanColor(color)] ?? 'info';
  }
  return 'info';
}

function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(EMOJI_COMBINING_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}

function normalizeTitle(status: EmbedStatus, rawTitle: string | null | undefined): string {
  const label = STATUS_LABELS[status];
  const cleaned = stripEmoji(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return label;
  const subject = cleaned.replace(/^(info|success|warning|error|punishment)\s*(?::|-)\s*/i, '').trim();
  if (!subject || subject.toLowerCase() === label.toLowerCase()) return label;
  return `${label}: ${subject}`;
}

function normalizeDescription(rawDescription: string | null | undefined): string | undefined {
  if (!rawDescription) return undefined;
  const cleaned = stripEmoji(rawDescription.replace(/\r\n/g, '\n')).trim();
  if (!cleaned) return undefined;
  const lines = cleaned.split('\n').map(line => line.replace(/^>\s?/, '').trimEnd());
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return undefined;
  const firstIndex = lines.findIndex(line => line.trim().length > 0);
  lines[firstIndex] = `> ${lines[firstIndex].trim()}`;
  if (lines.length > 1 && lines[1].trim()) lines.splice(1, 0, '');
  return lines.join('\n');
}

class ThemedEmbedBuilder extends EmbedBuilder {
  private status: EmbedStatus = 'info';
  private rawTitle: string | null = null;
  private rawDescription: string | null = null;

  constructor(data?: APIEmbed) {
    super(data);
    if (data?.color != null) this.status = statusFromColor(data.color);
    this.rawTitle = data?.title ?? null;
    this.rawDescription = data?.description ?? null;
    this.setTimestamp();
  }

  override setColor(color: ColorResolvable | EmbedStatus | null): this {
    this.status = statusFromColor(color);
    super.setColor(EMBED_COLORS[this.status]);
    return this;
  }

  getStatus(): EmbedStatus {
    return this.status;
  }

  override setTitle(title: string | null): this {
    this.rawTitle = title;
    super.setTitle(normalizeTitle(this.status, title));
    return this;
  }

  override setDescription(description: string | null): this {
    this.rawDescription = description;
    super.setDescription(normalizeDescription(description) ?? null);
    return this;
  }

  override setFooter(options: { text: string; iconURL?: string } | null): this {
    super.setFooter({ text: EMBED_THEME.footer, ...(options?.iconURL ? { iconURL: options.iconURL } : {}) });
    return this;
  }

  override toJSON(): APIEmbed {
    const json = super.toJSON();
    return {
      ...json,
      color: EMBED_COLORS[this.status],
      title: this.rawTitle !== null ? normalizeTitle(this.status, this.rawTitle) : json.title,
      description: this.rawDescription !== null ? normalizeDescription(this.rawDescription) : json.description,
      footer: { text: EMBED_THEME.footer },
      fields: json.fields?.map(field => ({
        ...field,
        name: stripEmoji(field.name),
        value: stripEmoji(field.value),
      })),
    };
  }
}

export function themedEmbed(color: EmbedStatus | string | number = EMBED_THEME.defaultColor) {
  return new ThemedEmbedBuilder().setColor(color as ColorResolvable | EmbedStatus);
}

export function themedFrom(embed: EmbedBuilder | APIEmbed) {
  return new ThemedEmbedBuilder('toJSON' in embed ? embed.toJSON() : embed);
}

export function betterEmbed(
  text?: string,
  color: EmbedStatus | string | number = EMBED_THEME.defaultColor,
  title?: string,
  ephemeral?: boolean
) {
  const builder = themedEmbed(color);
  builder.setTitle(title ?? STATUS_LABELS[builder.getStatus()]);
  if (text && text.trim().length > 0) builder.setDescription(text);
  return {
    embeds: [builder],
    flags: ephemeral ? 64 : 0,
    builder,
  };
}

export function errorEmbed(text?: string, title?: string, ephemeral?: boolean) {
  return betterEmbed(text !== undefined ? text : EMBED_THEME.errorText, 'error', title !== undefined ? title : EMBED_THEME.errorTitle, ephemeral);
}

export function successEmbed(text?: string, title?: string, ephemeral?: boolean) {
  return betterEmbed(text !== undefined ? text : EMBED_THEME.successText, 'success', title !== undefined ? title : EMBED_THEME.successTitle, ephemeral);
}

export function warningEmbed(text?: string, title?: string, ephemeral?: boolean) {
  return betterEmbed(text !== undefined ? text : EMBED_THEME.warningTitle, 'warning', title !== undefined ? title : EMBED_THEME.warningTitle, ephemeral);
}

export function infoEmbed(text?: string, title?: string, ephemeral?: boolean) {
  return betterEmbed(text !== undefined ? text : EMBED_THEME.defaultTitle, 'info', title !== undefined ? title : EMBED_THEME.defaultTitle, ephemeral);
}
