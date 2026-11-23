import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Guild, GuildMember, Message, MessageFlags } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import config from '../../config/config';
import EloRank from '../../models/EloRank';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

const { errorEmbed, successEmbed, warningEmbed } = embedsFor('Reset');
const CONFIRM_MS = 60 * 1000;

export async function rolesToClear(): Promise<string[]> {
  const ranks = await EloRank.find().select('roleId').lean() as Array<{ roleId: string }>;
  return [...new Set([...ranks.map(r => r.roleId), config.roles.banned, config.roles.muted].filter(Boolean))];
}

export async function clearMember(member: GuildMember, roleIds: string[]): Promise<number> {
  const held = roleIds.filter(id => member.roles.cache.has(id));
  if (held.length) {
    await member.roles.remove(held, 'Reset with /resetdb');
  }
  return held.length;
}

export async function clearEveryone(guild: Guild, roleIds: string[]): Promise<{ members: number; roles: number; failed: number }> {
  const members = await guild.members.fetch();
  const totals = { members: 0, roles: 0, failed: 0 };
  for (const member of members.values()) {
    try {
      const removed = await clearMember(member, roleIds);
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
  if (!roleIds.length) {
    await safeReply(interaction, errorEmbed('There are no ELO, muted or banned roles set up to clear.', undefined, true));
    return;
  }
  if (user) {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await safeReply(interaction, errorEmbed(`<@${user.id}> isn't in this server.`, undefined, true));
      return;
    }
    const removed = await clearMember(member, roleIds);
    await safeReply(interaction, successEmbed(removed
      ? `Took ${removed} ELO, muted or banned role${removed === 1 ? '' : 's'} off <@${user.id}>. Their database record is unchanged.`
      : `<@${user.id}> had no ELO, muted or banned roles.`, undefined, true));
    return;
  }
  const confirm = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('resetdb:confirm').setLabel('Yes, clear everyone').setStyle(ButtonStyle.Danger),
  );
  const prompt = await safeReply(interaction, {
    embeds: [warningEmbed(`This takes every ELO rank, muted and banned role (${roleIds.length} roles) off **every member** on Discord. `
      + 'The database and the Minecraft server are not touched.', 'Clear everyone?').builder],
    components: [confirm],
    fetchReply: true,
    flags: MessageFlags.Ephemeral,
  }) as Message | null;
  const click = await prompt?.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: CONFIRM_MS }).catch(() => null);
  if (!click) {
    await interaction.editReply({ embeds: [errorEmbed('Nothing was cleared.').builder], components: [] }).catch(() => undefined);
    return;
  }
  await click.update({ embeds: [warningEmbed('Clearing roles, this can take a while…').builder], components: [] });
  const totals = await clearEveryone(guild, roleIds);
  await interaction.editReply({
    embeds: [successEmbed(`Cleared ${totals.roles} role${totals.roles === 1 ? '' : 's'} from ${totals.members} member${totals.members === 1 ? '' : 's'}.`
      + (totals.failed ? `\n-# ${totals.failed} couldn't be changed (check the bot's role is above those roles).` : '')).builder],
    components: [],
  });
}
