import { APIEmbed, ColorResolvable, EmbedBuilder, EmbedFooterOptions, resolveColor } from 'discord.js';

// ---------------------------------------------------------------------------
// House style: every embed opens with a "<brand> · <header>" author line and the bot's avatar
// instead of a title, and has one teal brand bar. Reds, ambers and yellows (errors, warnings,
// voids, punishments) keep their colour. setTitle() becomes a small "-# ➡" subtitle line.
//
// Each file picks its header once:
//   const { errorEmbed, successEmbed, themedEmbed } = embedsFor('Player');
// ---------------------------------------------------------------------------

export type EmbedStatus = 'info' | 'success' | 'warning' | 'error' | 'punishment';

export const BRAND_COLOR = 0x00aaaa;
const BRAND_NAME = (process.env.BRAND_NAME || '').trim() || 'Veltrix';

export const EMBED_COLORS: Record<EmbedStatus, number> = {
  info: BRAND_COLOR,
  success: BRAND_COLOR,
  warning: 0xf0b232,
  error: 0xed4245,
  punishment: 0xed4245,
};

const STATUS_LABELS: Record<EmbedStatus, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
  punishment: 'Punishment',
};

export const EMBED_THEME = {
  brandName: BRAND_NAME,
  defaultColor: EMBED_COLORS.info,
  errorColor: EMBED_COLORS.error,
  successColor: EMBED_COLORS.success,
  warningColor: EMBED_COLORS.warning,
  punishmentColor: EMBED_COLORS.punishment,
  defaultTitle: STATUS_LABELS.info,
  errorTitle: STATUS_LABELS.error,
  successTitle: STATUS_LABELS.success,
  warningTitle: STATUS_LABELS.warning,
  punishmentTitle: STATUS_LABELS.punishment,
  errorText: 'An error occurred.',
  successText: 'Done.',
} as const;

// Titles that only repeat what the colour or header already says
const GENERIC_TITLE = /^(info|information|notice|success|warning|punishment|.*\berror\b.*|.*\busage\b.*)$/i;
const DEFAULT_FOOTERS = /^(veltrix ranked bedwars|deyo ranked bedwars)$/i;

let brandIconURL: string | undefined;

/** Set once the bot is logged in; used as the icon in every author line. */
export function setBrandIcon(url: string | undefined): void {
  brandIconURL = url;
}

function isStatus(value: unknown): value is EmbedStatus {
  return value === 'info' || value === 'success' || value === 'warning' || value === 'error' || value === 'punishment';
}

function toNumber(color: unknown): number | null {
  if (typeof color === 'number') {
    return Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : null;
  }
  if (typeof color === 'string') {
    let c = color.trim();
    if (c.startsWith('-#')) c = c.slice(2);
    if (c.startsWith('#')) c = c.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(c)) return parseInt(c, 16);
  }
  try {
    return resolveColor(color as ColorResolvable);
  } catch {
    return null;
  }
}

/** Keeps reds, oranges and yellows (errors, warnings, punishments); everything else becomes the brand teal. */
export function houseColor(color: ColorResolvable | EmbedStatus | null | undefined): number {
  if (color === null || color === undefined) return BRAND_COLOR;
  if (typeof color === 'string' && isStatus(color.trim().toLowerCase())) {
    return EMBED_COLORS[color.trim().toLowerCase() as EmbedStatus];
  }
  const value = toNumber(color);
  if (value === null) return BRAND_COLOR;
  const r = ((value >> 16) & 255) / 255, g = ((value >> 8) & 255) / 255, b = (value & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.35 || max < 0.25) return BRAND_COLOR;
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  return hue <= 55 || hue >= 340 ? value : BRAND_COLOR;
}

const stripLeadingEmoji = (s: string) => s.replace(/^[^\p{L}\p{N}<`*#]+/u, '').trim();

export interface HouseEmbedOptions {
  /** Drop setTitle() text entirely (short replies). By default it becomes a small "➡" subtitle. */
  dropTitle?: boolean;
  /** Keep setTitle() as a real title under the author line (messages that must stand out). */
  keepTitle?: boolean;
}

/**
 * EmbedBuilder in the house style. setTitle() becomes a subtitle line (or is dropped), setColor()
 * is mapped to the house colours and a footer that only repeats the brand is removed, so existing
 * builder chains switch style without being rewritten.
 */
export class HouseEmbed extends EmbedBuilder {
  private subtitle: string | null = null;
  private body: string | null = null;
  private readonly options: HouseEmbedOptions;

  constructor(header: string, options: HouseEmbedOptions = {}, data?: APIEmbed) {
    super(data);
    this.options = options;
    if (!data || data.color === undefined) super.setColor(BRAND_COLOR);
    this.setHeader(header);
  }

  /** Converts an existing embed (for example one being edited) to the house style. */
  static fromExisting(header: string, embed: APIEmbed | { toJSON(): APIEmbed } | { data: APIEmbed }, options: HouseEmbedOptions = {}): HouseEmbed {
    const data: APIEmbed = 'toJSON' in embed ? embed.toJSON() : 'data' in embed ? { ...embed.data } : { ...embed };
    const result = new HouseEmbed(header, options, { ...data, title: undefined, description: undefined });
    if (data.color !== undefined) result.setColor(data.color);
    // An embed that is already house-styled carries its subtitle as the first description line
    const existing = data.description?.match(/^-# ➡ (.*)(?:\n([\s\S]*))?$/);
    if (existing) {
      result.subtitle = existing[1];
      result.body = existing[2] ?? null;
    } else if (data.description) {
      result.body = data.description;
    }
    if (data.title) result.setTitle(data.title);
    else result.render();
    return result;
  }

  setHeader(header: string): this {
    const name = header ? `${BRAND_NAME} · ${header}` : BRAND_NAME;
    return super.setAuthor({ name, iconURL: brandIconURL });
  }

  override setTitle(title: string | null): this {
    if (this.options.keepTitle) return super.setTitle(title);
    const cleaned = title ? stripLeadingEmoji(title) : '';
    this.subtitle = this.options.dropTitle || !cleaned || GENERIC_TITLE.test(cleaned) ? null : cleaned;
    return this.render();
  }

  override setDescription(description: string | null): this {
    this.body = description;
    return this.render();
  }

  override setColor(color: ColorResolvable | EmbedStatus | null): this {
    return super.setColor(houseColor(color));
  }

  override setFooter(options: EmbedFooterOptions | null): this {
    if (!options || !options.text?.trim() || DEFAULT_FOOTERS.test(options.text.trim())) {
      return super.setFooter(null);
    }
    return super.setFooter(options);
  }

  private render(): this {
    const parts: string[] = [];
    if (this.subtitle) parts.push(`-# ➡ ${this.subtitle}`);
    if (this.body && this.body.trim()) parts.push(this.body);
    return super.setDescription(parts.length ? parts.join('\n') : null);
  }
}

function buildReply(
  header: string,
  text: string | undefined,
  color: EmbedStatus | string | number,
  title: string | undefined,
  ephemeral: boolean | undefined,
  options: HouseEmbedOptions,
) {
  const builder = new HouseEmbed(header, options).setColor(color as ColorResolvable | EmbedStatus);
  if (title) builder.setTitle(title);
  builder.setDescription(text && text.trim() ? text : null);
  return {
    embeds: [builder],
    flags: ephemeral ? 64 : 0,
    builder,
  };
}

/** The embed helpers with this file's header in the author line. */
export function embedsFor(header: string) {
  const themedEmbed = (color: EmbedStatus | string | number = 'info') =>
    new HouseEmbed(header).setColor(color as ColorResolvable | EmbedStatus);

  const themedFrom = (embed: EmbedBuilder | APIEmbed) => HouseEmbed.fromExisting(header, embed);

  const betterEmbed = (text?: string, color: EmbedStatus | string | number = 'info', title?: string, ephemeral?: boolean) =>
    buildReply(header, text, color, title, ephemeral, {});

  const errorEmbed = (text?: string, title?: string, ephemeral?: boolean) =>
    buildReply(header, text !== undefined ? text : EMBED_THEME.errorText, 'error', title, ephemeral, { dropTitle: true });

  const successEmbed = (text?: string, title?: string, ephemeral?: boolean) =>
    buildReply(header, text !== undefined ? text : EMBED_THEME.successText, 'success', title, ephemeral, { dropTitle: true });

  const warningEmbed = (text?: string, title?: string, ephemeral?: boolean) =>
    buildReply(header, text, 'warning', title, ephemeral, {});

  const infoEmbed = (text?: string, title?: string, ephemeral?: boolean) =>
    buildReply(header, text, 'info', title, ephemeral, {});

  return { themedEmbed, themedFrom, betterEmbed, errorEmbed, successEmbed, warningEmbed, infoEmbed };
}

// Header-less versions for code that hasn't picked a header (brand name only)
export const { themedEmbed, themedFrom, betterEmbed, errorEmbed, successEmbed, warningEmbed, infoEmbed } = embedsFor('');
