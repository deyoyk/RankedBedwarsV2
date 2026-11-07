import { EmbedBuilder } from 'discord.js';

/**
 * Single source of truth for embed styling.
 *
 * These values are hardcoded. Edit this file to change the look of every bot
 * embed; all embed helpers and direct embeds use the same palette and footer.
 */
export const EMBED_THEME = {
  defaultColor: 0x3498DB,
  errorColor: 0xE74C3C,
  successColor: 0x2ECC71,
  footer: 'deyo Ranked Bedwars',
  defaultTitle: 'Notice',
  errorTitle: 'Error',
  successTitle: 'Success',
  errorText: 'An error occurred.',
  successText: 'Success!',
} as const;

function cleanColor(color: string | number) {
  if (typeof color === 'string') {
    let c = color.trim();
    if (c.startsWith('-#')) c = c.slice(2);
    if (c.startsWith('#')) c = c.slice(1);

    if (/^[0-9a-fA-F]{6}$/.test(c)) {
      return parseInt(c, 16);
    }

    return 0x5865F2;
  }
  if (typeof color === 'number' && !isNaN(color)) {
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff) return 0x5865F2;
    return color;
  }

  return 0x5865F2;
}


export function themedEmbed(color: string | number = EMBED_THEME.defaultColor) {
  return new EmbedBuilder()
    .setColor(cleanColor(color))
    .setFooter({ text: EMBED_THEME.footer });
}

export function betterEmbed(
  text?: string,
  color?: string | number,
  title?: string,
  ephemeral?: boolean,
  footer?: string,
  iconURL?: string
) {
  const finalText = text !== undefined ? text : '';
  const finalColor = color !== undefined ? color : EMBED_THEME.defaultColor;
  const finalTitle = title !== undefined ? title : EMBED_THEME.defaultTitle;
  const finalEphemeral = ephemeral !== undefined ? ephemeral : false;
  const finalFooter = footer !== undefined ? footer : EMBED_THEME.footer;
  const finalIcon = iconURL;
  let safeColor: number;
  try {
    safeColor = cleanColor(finalColor);
  } catch {
    safeColor = 0x5865F2;
  }
  const builder = new EmbedBuilder()
    .setColor(safeColor)
    .setTitle(finalTitle);
  if (typeof finalText === 'string' && finalText.trim().length > 0) {
    builder.setDescription(finalText);
  }
  if (finalFooter) {
    if (finalIcon) builder.setFooter({ text: finalFooter, iconURL: finalIcon });
    else builder.setFooter({ text: finalFooter });
  }
  return {
    embeds: [builder],
    flags: finalEphemeral ? 64 : 0,
    builder,
  };
}

export function errorEmbed(
  text?: string,
  title?: string,
  ephemeral?: boolean,
  footer?: string,
  iconURL?: string
) {
  return betterEmbed(
    text !== undefined ? text : EMBED_THEME.errorText,
    EMBED_THEME.errorColor,
    title !== undefined ? title : EMBED_THEME.errorTitle,
    ephemeral !== undefined ? ephemeral : false,
    footer !== undefined ? footer : EMBED_THEME.footer,
    iconURL
  );
}

export function successEmbed(
  text?: string,
  title?: string,
  ephemeral?: boolean,
  footer?: string,
  iconURL?: string
) {
  return betterEmbed(
    text !== undefined ? text : EMBED_THEME.successText,
    EMBED_THEME.successColor,
    title !== undefined ? title : EMBED_THEME.successTitle,
    ephemeral !== undefined ? ephemeral : false,
    footer !== undefined ? footer : EMBED_THEME.footer,
    iconURL
  );
}
