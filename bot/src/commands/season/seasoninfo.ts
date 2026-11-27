import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  Message,
  StringSelectMenuBuilder
} from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import Season from '../../models/Season';
import { SeasonRulesService } from '../../services/SeasonRulesService';
import { formatRuleSections } from '../../utils/seasonRules';
import { embedsFor } from '../../utils/betterembed';

const { errorEmbed, infoEmbed } = embedsFor('Season');
const MENU_ID = 'seasoninfo_rules';

type Ruleset = 'season' | 'ppp';

function menu(selected: Ruleset) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(MENU_ID)
    .setPlaceholder('Choose rules')
    .addOptions([
      { label: 'Season Rules', value: 'season', default: selected === 'season' },
      { label: 'PPP Rules', value: 'ppp', default: selected === 'ppp' },
    ]);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export async function seasoninfo(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  void _wsManager;
  try {
    const rules = await SeasonRulesService.get();
    if (!rules) {
      await safeReply(interaction, errorEmbed('The Minecraft server has not sent the season rules yet.', 'Season Info Error', true));
      return;
    }

    const currentSeason = await Season.findOne({ isActive: true });

    const render = (ruleset: Ruleset) => {
      const sections = formatRuleSections(rules[ruleset]);
      const embed = sections.length === 0
        ? errorEmbed(`No ${ruleset === 'ppp' ? 'PPP' : 'season'} rules are set.`, 'Season Info Error', true).builder
        : infoEmbed('Current season and server information.', 'Season Information').builder;

      if (sections.length > 0 && currentSeason) {
        embed.addFields({
          name: 'Current Season',
          value: `C ${currentSeason.chapterNumber} - S ${currentSeason.seasonNumber} ${currentSeason.name}`,
          inline: false
        });
      }

      for (const section of sections) {
        embed.addFields({
          name: section.title,
          value: section.lines.map(line => `${section.emoji} ${line}`).join('\n'),
          inline: false
        });
      }

      return { embeds: [embed], components: [menu(ruleset)] };
    };

    const selected = interaction.options.getString('rules') === 'ppp' ? 'ppp' : 'season';
    const reply = await safeReply(interaction, { ...render(selected), fetchReply: true }) as Message | null;
    if (!reply) return;

    const collector = reply.createMessageComponentCollector({
      time: 5 * 60 * 1000,
      filter: i => i.user.id === interaction.user.id
    });
    collector.on('collect', async i => {
      if (!i.isStringSelectMenu() || i.customId !== MENU_ID) return;
      await i.update(render(i.values[0] === 'ppp' ? 'ppp' : 'season'));
    });
  } catch (error) {
    await replyCommandError(interaction, error, 'load the season information', '[seasoninfo]');
  }
}
