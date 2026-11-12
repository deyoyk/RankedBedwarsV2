import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Message } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { MapService } from '../../managers/MapManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';

const { betterEmbed, errorEmbed } = embedsFor('Game');

export async function maps(
  interaction: ChatInputCommandInteraction,
  wsManager?: WebSocketManager
) {
  if (!wsManager) {
    await safeReply(interaction, errorEmbed('WebSocketManager not available.', 'Error'));
    return;
  }
  
  const mapService = MapService.getSharedInstance(wsManager);
  
  const allMapNames: string[] = (await mapService.getAllMaps()).map(m => m.name);
  if (!allMapNames.length) {
    await safeReply(interaction, errorEmbed('No maps available.', 'No Maps'));
    return;
  }

  let page = 0;
  const pageSize = 25;
  const totalPages = Math.ceil(allMapNames.length / pageSize);

  const buildEmbed = (page: number) => {
    const start = page * pageSize;
    const end = start + pageSize;
    const mapsForPage = allMapNames.slice(start, end);
    const embedObj = betterEmbed(
      `Page ${page + 1} of ${totalPages}.\n\n${mapsForPage.length ? mapsForPage.map(m => `- ${m}`).join('\n') : 'No maps.'}`,
      'info',
      'Available Maps'
    );
    return embedObj.builder;
  };

  const buildButtons = (page: number) => {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('back')
          .setLabel('Back')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('forward')
          .setLabel('Forward')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page >= totalPages - 1)
      )
    ];
  };

  const sentMsg = (await safeReply(interaction, {
    embeds: [buildEmbed(page)],
    components: buildButtons(page),
    fetchReply: true
  })) as unknown as Message | undefined;

  function getUserId(i: ChatInputCommandInteraction): string {
    return i.user.id;
  }

  const collector = sentMsg?.createMessageComponentCollector({
    filter: (i) => ['back', 'forward'].includes(i.customId) && i.user.id === getUserId(interaction),
    time: 60000
  });

  collector?.on('collect', async (buttonInt) => {
    if (buttonInt.customId === 'back' && page > 0) page--;
    if (buttonInt.customId === 'forward' && page < totalPages - 1) page++;
    await buttonInt.update({
      embeds: [buildEmbed(page)],
      components: buildButtons(page)
    });
  });

  collector?.on('end', async () => {
    const disabled = buildButtons(page).map((row) => {
      row.components.forEach((btn) => btn.setDisabled(true));
      return row;
    });
    await sentMsg?.edit({ components: disabled }).catch(() => undefined);
  });
}