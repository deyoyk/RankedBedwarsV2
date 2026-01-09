export function withImage(embedObj: ReturnType<typeof betterEmbed>, url: string) {
  embedObj.builder.setImage(url);
  return embedObj;
}
import { EmbedBuilder } from 'discord.js';
import config from '../config/config';



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
    return color;
  }
  
  return 0x5865F2;
}


export function betterEmbed(
  text?: string,
  color?: string | number,
  title?: string,
  ephemeral?: boolean,
  footer?: string,
  iconURL?: string
) {
  const finalText = text !== undefined ? text : (config.embed && config.embed.defaultText) ? config.embed.defaultText : 'No description provided.';
  const finalColor = color !== undefined ? color : (config.embed && config.embed.defaultColor) ? config.embed.defaultColor : '#00AAAA';
  const finalTitle = title !== undefined ? title : (config.embed && config.embed.defaultTitle) ? config.embed.defaultTitle : 'Notice';
  const finalEphemeral = ephemeral !== undefined ? ephemeral : (config.embed && typeof config.embed.defaultEphemeral === 'boolean') ? config.embed.defaultEphemeral : false;
  const finalFooter = footer !== undefined ? footer : (config.embed && config.embed.defaultFooter) ? config.embed.defaultFooter : 'Deyo.lol';
  const finalIcon = iconURL;
  let safeColor: number;
  try {
    safeColor = cleanColor(finalColor);
  } catch {
    safeColor = 0x5865F2;
  }
  const builder = new EmbedBuilder()
    .setColor(safeColor)
    .setTitle(finalTitle)
    .setDescription(finalText);
  if (finalFooter) builder.setFooter({ text: finalFooter, iconURL: finalIcon });
  return {
    embeds: [builder],
    flags: finalEphemeral ? 64 : 0, 
    builder, 
  };
}


export function withThumbnail(embedObj: ReturnType<typeof betterEmbed>, url: string) {
  embedObj.builder.setThumbnail(url);
  return embedObj;
}

export function withIcon(embedObj: ReturnType<typeof betterEmbed>, url: string) {
  
  embedObj.builder.setAuthor({ name: embedObj.builder.data.title || '', iconURL: url });
  return embedObj;
}

export function withFooter(embedObj: ReturnType<typeof betterEmbed>, text: string, iconURL?: string) {
  embedObj.builder.setFooter({ text, iconURL });
  return embedObj;
}







export function errorEmbed(
  text?: string,
  title?: string,
  ephemeral?: boolean,
  footer?: string,
  iconURL?: string
) {
  return betterEmbed(
    text !== undefined ? text : config.embed?.errorText,
    config.embed?.errorColor,
    title !== undefined ? title : config.embed?.errorTitle,
    ephemeral !== undefined ? ephemeral : config.embed?.errorEphemeral,
    footer !== undefined ? footer : (config.embed?.errorFooter ?? config.embed?.defaultFooter),
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
    text !== undefined ? text : config.embed?.successText,
    config.embed?.successColor,
    title !== undefined ? title : config.embed?.successTitle,
    ephemeral !== undefined ? ephemeral : config.embed?.successEphemeral,
    footer !== undefined ? footer : (config.embed?.successFooter ?? config.embed?.defaultFooter),
    iconURL
  );
}