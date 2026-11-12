import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageComponentInteraction,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import { isServerAdmin } from '../../utils/permissions';
import { PermissionService } from '../../services/PermissionService';
import { CATEGORY_LABELS, CommandCategory, commandsIn } from '../../config/commandCategories';

const { themedEmbed, errorEmbed } = embedsFor('Config');

export const rbwconfigData = new SlashCommandBuilder()
  .setName('rbwconfig')
  .setDescription('Choose which roles can use which commands')
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

/** Works out the next screen for a click on the panel, saving any change first. */
export async function handlePanelClick(click: MessageComponentInteraction): Promise<View> {
  const [, action, category] = click.customId.split(':');
  if (action === 'section' && click.isStringSelectMenu()) {
    const choice = click.values[0];
    return choice === 'overview' ? overviewView() : categoryView(choice as CommandCategory);
  }
  if (action === 'roles' && click.isRoleSelectMenu()) {
    const target = category as CommandCategory;
    await PermissionService.update({ [target]: click.values });
    return categoryView(target, `${CATEGORY_LABELS[target]} → ${mentions(click.values) || 'server administrators only'}`);
  }
  if (action === 'everyone') {
    const on = !PermissionService.current().playerEveryone;
    await PermissionService.update({ playerEveryone: on });
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
      await click.update(await handlePanelClick(click));
    } catch (error) {
      console.error('[rbwconfig] Could not apply the change:', error);
      await click.reply({ embeds: [errorEmbed('That change could not be saved. Try again.').builder], flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  });
  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => undefined);
  });
}
