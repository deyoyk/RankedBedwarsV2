import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import { commandErrorDetails } from '../../utils/errorReporter';
import { isServerAdmin } from '../../utils/permissions';
import { PermissionService } from '../../services/PermissionService';
import { CATEGORY_LABELS, CommandCategory, commandsIn } from '../../config/commandCategories';
import { describeAction, StrikeRuleService } from '../../services/StrikeRuleService';
import { CALL_ROLE_LABELS, CallRoleKey, CallRoleService } from '../../services/CallRoleService';
import { recordAudit } from '../../services/AuditService';
import { PARTY_SIZE_LABELS, PARTY_SIZES, PartySizeService } from '../../services/PartySizeService';

const { themedEmbed, errorEmbed } = embedsFor('Config');

export const rbwconfigData = new SlashCommandBuilder()
  .setName('rbwconfig')
  .setDescription('Command permissions and strike rules')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .toJSON();

const PANEL_TIMEOUT_MS = 10 * 60 * 1000;
const CATEGORIES: CommandCategory[] = ['admin', 'staff', 'player'];
const ALSO_ALLOWED: Record<CommandCategory, string> = {
  admin: '',
  staff: 'Admin roles can use these too.',
  player: 'Staff and Admin roles can use these too.',
};

type View = { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder | RoleSelectMenuBuilder | ButtonBuilder>[] };

const mentions = (ids: string[]) => ids.map(id => `<@&${id}>`).join(', ');

function whoCanUse(category: CommandCategory): string {
  const settings = PermissionService.current();
  if (category === 'player' && settings.playerEveryone) return 'Everyone';
  return mentions(settings[category]) || 'Server administrators only';
}

function sectionRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rbwcfg:section')
      .setPlaceholder('Choose a section…')
      .addOptions(
        ...CATEGORIES.map(category => ({
          label: CATEGORY_LABELS[category],
          value: category,
          description: `${commandsIn(category).length} commands · ${whoCanUse(category)}`.slice(0, 100),
        })),
        { label: 'Command Overview', value: 'overview', description: 'Who can use each category' },
        { label: 'Strike Rules', value: 'strikes', description: 'How many strikes lead to a rank ban, and for how long' },
        { label: 'Call Roles', value: 'callroles', description: 'The Pups, Pugs Trial, Pugs and Premium roles /call open uses' },
        { label: 'Party Size', value: 'partysize', description: 'Solo season, parties of 2 or parties of 4' },
      ),
  );
}

const backRow = (...extra: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...extra,
    new ButtonBuilder().setCustomId('rbwcfg:back').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );

export function rootView(): View {
  const embed = themedEmbed('info')
    .setTitle('Command permissions')
    .setDescription('Pick a section to choose which roles can use its commands.\n-# Server administrators can always use every command.');
  return { embeds: [embed], components: [sectionRow()] };
}

export function categoryView(category: CommandCategory, note?: string): View {
  const settings = PermissionService.current();
  const commands = commandsIn(category).map(name => `\`/${name}\``).join(' ');
  const lines = [`**Who can use these:** ${whoCanUse(category)}`];
  if (ALSO_ALLOWED[category]) lines.push(`-# ${ALSO_ALLOWED[category]}`);
  if (note) lines.push(`-# ${note}`);

  const embed = themedEmbed('info')
    .setTitle(`${CATEGORY_LABELS[category]} commands`)
    .setDescription(lines.join('\n'))
    .addFields({ name: `Commands (${commandsIn(category).length})`, value: commands.slice(0, 1024) });

  const roles = new RoleSelectMenuBuilder()
    .setCustomId(`rbwcfg:roles:${category}`)
    .setPlaceholder(`Roles for ${CATEGORY_LABELS[category]} commands…`)
    .setMinValues(0)
    .setMaxValues(25);
  if (settings[category].length) roles.setDefaultRoles(settings[category].slice(0, 25));

  const extra = category === 'player'
    ? [new ButtonBuilder()
        .setCustomId('rbwcfg:everyone')
        .setLabel(`Everyone: ${settings.playerEveryone ? 'on' : 'off'}`)
        .setStyle(settings.playerEveryone ? ButtonStyle.Success : ButtonStyle.Secondary)]
    : [];

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roles), backRow(...extra)],
  };
}

export function overviewView(): View {
  const embed = themedEmbed('info')
    .setTitle('Command overview')
    .setDescription('Server administrators can always use every command.')
    .addFields(CATEGORIES.map(category => ({
      name: `${CATEGORY_LABELS[category]} (${commandsIn(category).length})`,
      value: `**${whoCanUse(category)}**\n${commandsIn(category).map(name => `\`/${name}\``).join(' ')}`.slice(0, 1024),
    })));
  return { embeds: [embed], components: [backRow()] };
}

const CALL_KEYS: CallRoleKey[] = ['pups', 'pugstrial', 'pugs', 'premium'];

export function callRolesView(note?: string): View {
  const settings = CallRoleService.current();
  const lines = CALL_KEYS.map(key => `**${CALL_ROLE_LABELS[key]}** · ${settings[key] ? `<@&${settings[key]}>` : '*not set*'}`);
  lines.push('-# `/call open pups` opens to Pups, Pugs Trial, Pugs and Premium; `pugs` to Pugs and Premium; `premium` to Premium only.');
  if (note) lines.push(`-# ${note}`);
  const embed = themedEmbed('info').setTitle('Call roles').setDescription(lines.join('\n'));
  const pickers = CALL_KEYS.map(key => {
    const picker = new RoleSelectMenuBuilder()
      .setCustomId(`rbwcfg:callrole:${key}`)
      .setPlaceholder(`${CALL_ROLE_LABELS[key]} role…`)
      .setMinValues(0)
      .setMaxValues(1);
    if (settings[key]) picker.setDefaultRoles([settings[key] as string]);
    return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(picker);
  });
  return { embeds: [embed], components: [...pickers, backRow()] };
}

export function partySizeView(note?: string): View {
  const size = PartySizeService.current();
  const lines = [
    `**Now** · ${PARTY_SIZE_LABELS[size]}`,
    '-# Parties with private games on (`/party private`) can always have 16. Parties already bigger keep their players but can\'t invite more.',
  ];
  if (note) lines.push(`-# ${note}`);
  const embed = themedEmbed('info').setTitle('Party size').setDescription(lines.join('\n'));
  const picker = new StringSelectMenuBuilder()
    .setCustomId('rbwcfg:partysize')
    .setPlaceholder('Party size…')
    .addOptions(PARTY_SIZES.map(option => ({
      label: PARTY_SIZE_LABELS[option],
      value: String(option),
      default: option === size,
    })));
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(picker), backRow()] };
}

const plural = (n: number) => `${n} strike${n === 1 ? '' : 's'}`;

export function strikeView(note?: string): View {
  const { rules, otherwise } = StrikeRuleService.current();
  const lines = rules.map(rule => `**${plural(rule.strikes)}** → ${describeAction(rule.action)}`);
  lines.push(`**Any other number** → ${describeAction(otherwise)}${otherwise.startsWith('+') ? ' (fewer strikes: warning only)' : ''}`);
  lines.push('-# Each strike a player gets is checked against these. A rule is the total number of strikes they have.');
  if (note) lines.push(`-# ${note}`);
  const embed = themedEmbed('info').setTitle('Strike rules').setDescription(lines.join('\n'));
  const components: View['components'] = [];
  if (rules.length) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('rbwcfg:strikedel')
        .setPlaceholder('Remove rules…')
        .setMinValues(1)
        .setMaxValues(rules.length)
        .addOptions(rules.map(rule => ({ label: plural(rule.strikes), value: String(rule.strikes), description: describeAction(rule.action) }))),
    ));
  }
  components.push(backRow(
    new ButtonBuilder().setCustomId('rbwcfg:strikeadd').setLabel('Add or change rule').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rbwcfg:strikeelse').setLabel('Any other number').setStyle(ButtonStyle.Primary),
  ));
  return { embeds: [embed], components };
}

export function strikeModal(customId: 'strikeadd' | 'strikeelse'): ModalBuilder {
  const action = new TextInputBuilder()
    .setCustomId('action')
    .setLabel('What happens: warn, a ban time (12h, 7d) or perm')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);
  const modal = new ModalBuilder().setCustomId(`rbwcfg:${customId}`).setTitle(customId === 'strikeadd' ? 'Strike rule' : 'Any other number of strikes');
  if (customId === 'strikeadd') {
    const strikes = new TextInputBuilder()
      .setCustomId('strikes')
      .setLabel('Number of strikes')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(4);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(strikes));
  } else {
    action.setLabel('warn, ban time, perm, or +14d per strike').setValue(StrikeRuleService.current().otherwise);
  }
  return modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(action));
}

export async function saveStrikeModal(customId: string, strikes: string, action: string, actorId?: string): Promise<View> {
  try {
    if (customId === 'strikeadd') {
      const count = Number(strikes.trim());
      await StrikeRuleService.setRule(count, action);
      await recordAudit({
        action: 'config.strike_rule',
        category: 'config',
        source: 'discord',
        success: true,
        actorId,
        targetType: 'strike_rule',
        targetId: String(count),
        after: { strikes: count, action: StrikeRuleService.actionFor(count) },
      });
      return strikeView(`${plural(count)} → ${describeAction(StrikeRuleService.actionFor(count))}`);
    }
    await StrikeRuleService.setOtherwise(action);
    await recordAudit({
      action: 'config.strike_rule_default',
      category: 'config',
      source: 'discord',
      success: true,
      actorId,
      targetType: 'strike_rule',
      targetId: 'otherwise',
      after: { action: StrikeRuleService.current().otherwise },
    });
    return strikeView(`Any other number → ${describeAction(StrikeRuleService.current().otherwise)}`);
  } catch (error) {
    return strikeView(`⚠ ${error instanceof Error ? error.message : 'That rule could not be saved.'}`);
  }
}

/** Works out the next screen for a click on the panel, saving any change first. */
export async function handlePanelClick(click: MessageComponentInteraction): Promise<View> {
  const [, action, category] = click.customId.split(':');
  if (action === 'section' && click.isStringSelectMenu()) {
    const choice = click.values[0];
    if (choice === 'strikes') return strikeView();
    if (choice === 'callroles') return callRolesView();
    if (choice === 'partysize') return partySizeView();
    return choice === 'overview' ? overviewView() : categoryView(choice as CommandCategory);
  }
  if (action === 'partysize' && click.isStringSelectMenu()) {
    const before = PartySizeService.current();
    const size = await PartySizeService.set(Number(click.values[0]));
    await recordAudit({
      action: 'config.party_size',
      category: 'config',
      source: 'discord',
      success: true,
      actorId: click.user?.id,
      guildId: click.guildId ?? undefined,
      channelId: click.channelId ?? undefined,
      targetType: 'party_size',
      targetId: String(size),
      before: { size: before },
      after: { size },
    });
    return partySizeView(`Party size → ${PARTY_SIZE_LABELS[size]}`);
  }
  if (action === 'callrole' && click.isRoleSelectMenu()) {
    const key = category as CallRoleKey;
    await CallRoleService.set(key, click.values[0] ?? null);
    await recordAudit({
      action: 'config.call_role',
      category: 'config',
      source: 'discord',
      success: true,
      actorId: click.user?.id,
      guildId: click.guildId ?? undefined,
      channelId: click.channelId ?? undefined,
      targetType: 'role',
      targetId: click.values[0] ?? 'unset',
      after: { key, roleId: click.values[0] ?? null },
    });
    return callRolesView(`${CALL_ROLE_LABELS[key]} → ${click.values[0] ? `<@&${click.values[0]}>` : 'not set'}`);
  }
  if (action === 'strikedel' && click.isStringSelectMenu()) {
    await StrikeRuleService.removeRules(click.values.map(Number));
    await recordAudit({
      action: 'config.strike_rule_remove',
      category: 'config',
      source: 'discord',
      success: true,
      actorId: click.user?.id,
      guildId: click.guildId ?? undefined,
      channelId: click.channelId ?? undefined,
      targetType: 'strike_rule',
      targetId: click.values.join(','),
      before: { strikes: click.values.map(Number) },
    });
    return strikeView(`Removed ${click.values.map(v => plural(Number(v))).join(', ')}`);
  }
  if (action === 'roles' && click.isRoleSelectMenu()) {
    const target = category as CommandCategory;
    const before = PermissionService.current()[target];
    await PermissionService.update({ [target]: click.values });
    await recordAudit({
      action: 'config.permissions',
      category: 'config',
      source: 'discord',
      success: true,
      actorId: click.user?.id,
      guildId: click.guildId ?? undefined,
      channelId: click.channelId ?? undefined,
      targetType: 'permission_category',
      targetId: target,
      before: { roles: before },
      after: { roles: click.values },
    });
    return categoryView(target, `${CATEGORY_LABELS[target]} → ${mentions(click.values) || 'server administrators only'}`);
  }
  if (action === 'everyone') {
    const on = !PermissionService.current().playerEveryone;
    await PermissionService.update({ playerEveryone: on });
    await recordAudit({
      action: 'config.player_everyone',
      category: 'config',
      source: 'discord',
      success: true,
      actorId: click.user?.id,
      guildId: click.guildId ?? undefined,
      channelId: click.channelId ?? undefined,
      targetType: 'permission_category',
      targetId: 'player',
      before: { playerEveryone: !on },
      after: { playerEveryone: on },
    });
    return categoryView('player', on ? 'Player commands are open to everyone' : 'Player commands now need one of the chosen roles');
  }
  return rootView();
}

export async function rbwconfig(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  if (!isServerAdmin(interaction)) {
    await interaction.reply({ embeds: [errorEmbed('Only server administrators can use `/rbwconfig`.').builder], flags: MessageFlags.Ephemeral });
    return;
  }

  const response = await interaction.reply({ ...rootView(), flags: MessageFlags.Ephemeral });
  const collector = response.createMessageComponentCollector({
    filter: click => click.user.id === interaction.user.id,
    time: PANEL_TIMEOUT_MS,
  });

  collector.on('collect', async click => {
    try {
      const [, action] = click.customId.split(':');
      if (click.isButton() && (action === 'strikeadd' || action === 'strikeelse')) {
        await click.showModal(strikeModal(action));
        const submit = await click.awaitModalSubmit({ filter: m => m.user.id === interaction.user.id, time: PANEL_TIMEOUT_MS }).catch(() => null);
        if (submit?.isFromMessage()) {
          const strikes = action === 'strikeadd' ? submit.fields.getTextInputValue('strikes') : '';
          await submit.update(await saveStrikeModal(action, strikes, submit.fields.getTextInputValue('action'), submit.user.id));
        }
        return;
      }
      await click.update(await handlePanelClick(click));
    } catch (error) {
      const { description } = commandErrorDetails('save that config change', error, '[rbwconfig]');
      await click.reply({ embeds: [errorEmbed(description).builder], flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  });
  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => undefined);
  });
}
