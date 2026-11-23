import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Guild, GuildMember, Message, MessageFlags } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import config from '../../config/config';
import EloRank from '../../models/EloRank';
import PunishmentAction from '../../models/PunishmentAction';
import User from '../../models/User';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

const { errorEmbed, successEmbed, warningEmbed } = embedsFor('Reset');
const CONFIRM_MS = 60 * 1000;

export async function rolesToClear(): Promise<string[]> {
  const ranks = await EloRank.find().select('roleId').lean() as Array<{ roleId: string }>;
  const roles = [...ranks.map(r => r.roleId), config.roles.registered, config.roles.banned, config.roles.muted];
  return [...new Set(roles.filter(Boolean))];
}

export async function clearMember(member: GuildMember, roleIds: string[], unregisteredRole?: string): Promise<number> {
  const held = roleIds.filter(id => member.roles.cache.has(id));
  if (held.length) {
    await member.roles.remove(held, 'Wiped with /resetdb');
  }
  if (held.length && unregisteredRole && !member.roles.cache.has(unregisteredRole)) {
    await member.roles.add(unregisteredRole, 'Wiped with /resetdb');
  }
  return held.length;
}

export async function clearEveryone(guild: Guild, roleIds: string[], unregisteredRole?: string): Promise<{ members: number; roles: number; failed: number }> {
  const members = await guild.members.fetch();
  const totals = { members: 0, roles: 0, failed: 0 };
  for (const member of members.values()) {
    try {
      const removed = await clearMember(member, roleIds, unregisteredRole);
      if (removed) {
        totals.members++;
        totals.roles += removed;
      }
    } catch {
      totals.failed++;
    }
  }
  return totals;
}

export async function wipeData(discordId: string | null): Promise<number> {
  if (discordId) {
    const result = await User.deleteOne({ discordId });
    await PunishmentAction.deleteMany({ targetId: discordId });
    return result.deletedCount;
  }
  const result = await User.deleteMany({});
  await PunishmentAction.deleteMany({});
  return result.deletedCount;
}

export function warningText(target: string | null): string {
  const who = target ? `<@${target}>'s` : "**every player's**";
  return `This deletes ${who} ranked account from the bot: ELO, IGN, stats and every ban, mute and strike. `
    + `It also takes the ELO rank, registered, muted and banned roles off ${target ? 'them' : 'everyone'} on Discord.\n\n`
    + `⚠ It can't be undone. ${target ? 'They' : 'Everyone'} would have to \`/register\` again, and anyone banned or muted is let back in on Discord. `
    + 'The Minecraft server is not touched.';
}

async function confirmed(interaction: ChatInputCommandInteraction, title: string, text: string, label: string): Promise<boolean> {
  const confirm = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('resetdb:confirm').setLabel(label).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('resetdb:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
  const prompt = await safeReply(interaction, {
    embeds: [warningEmbed(text, title).builder],
    components: [confirm],
    fetchReply: true,
    flags: MessageFlags.Ephemeral,
  }) as Message | null;
  const click = await prompt?.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: CONFIRM_MS }).catch(() => null);
  if (!click || click.customId !== 'resetdb:confirm') {
    await interaction.editReply({ embeds: [errorEmbed('Nothing was wiped.').builder], components: [] }).catch(() => undefined);
    return false;
  }
  await click.update({ embeds: [warningEmbed('Wiping…').builder], components: [] });
  return true;
}

export async function resetdb(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const guild = interaction.guild;
  const user = interaction.options.getUser('user');
  const global = Boolean(interaction.options.getBoolean('global'));
  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', undefined, true));
    return;
  }
  if (Boolean(user) === global) {
    await safeReply(interaction, errorEmbed('Choose either `user` or `global: True`.', undefined, true));
    return;
  }
  const roleIds = await rolesToClear();
  const unregisteredRole = config.roles.nonRegistered || undefined;
  if (user) {
    if (!await confirmed(interaction, 'Wipe this player?', warningText(user.id), 'Yes, wipe them')) {
      return;
    }
    const deleted = await wipeData(user.id);
    const member = await guild.members.fetch(user.id).catch(() => null);
    const removed = member ? await clearMember(member, roleIds, unregisteredRole).catch(() => -1) : 0;
    const lines = [deleted ? `Deleted <@${user.id}>'s ranked account and punishments.` : `<@${user.id}> had no ranked account.`];
    if (removed > 0) lines.push(`Took ${removed} role${removed === 1 ? '' : 's'} off them.`);
    if (removed < 0) lines.push("-# Their roles couldn't be changed (check the bot's role is above those roles).");
    await interaction.editReply({ embeds: [successEmbed(lines.join('\n')).builder], components: [] });
    return;
  }
  if (!await confirmed(interaction, 'Wipe everyone?', warningText(null), 'Yes, wipe everyone')) {
    return;
  }
  const deleted = await wipeData(null);
  const totals = await clearEveryone(guild, roleIds, unregisteredRole);
  await interaction.editReply({
    embeds: [successEmbed(`Deleted ${deleted} ranked account${deleted === 1 ? '' : 's'} and their punishments, `
      + `and took ${totals.roles} role${totals.roles === 1 ? '' : 's'} off ${totals.members} member${totals.members === 1 ? '' : 's'}.`
      + (totals.failed ? `\n-# ${totals.failed} couldn't be changed (check the bot's role is above those roles).` : '')).builder],
    components: [],
  });
}
