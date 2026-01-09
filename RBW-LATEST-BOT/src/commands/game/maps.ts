import { ChatInputCommandInteraction, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { MapService } from '../../managers/MapManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { betterEmbed, errorEmbed } from '../../utils/betterembed';

 


export async function maps(
  interaction: Message | ChatInputCommandInteraction,
  args?: string[],
  wsManager?: WebSocketManager
) {
  if (!wsManager) {
    await safeReply(interaction, errorEmbed('WebSocketManager not available.', 'Error'));
    return;
  }
  
  const mapService = new MapService(wsManager);
  
  const allMapNames: string[] = (await mapService.getAllMaps()).map(m => m.name);
  if (!allMapNames.length) {
    await safeReply(interaction, errorEmbed('No maps available.', 'No Maps'));
    return;
  }

  let page = 0;
  const pageSize = 15;
  const totalPages = Math.ceil(allMapNames.length / pageSize);

  const buildEmbed = (page: number) => {
    const start = page * pageSize;
    const end = start + pageSize;
    const mapsForPage = allMapNames.slice(start, end);
    const embedObj = betterEmbed(
      mapsForPage.length ? mapsForPage.map(m => `${m}`).join('\n') : 'No maps.',
      '#00AAAA',
      `Available Maps (Page ${page + 1}/${totalPages})`
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

  const sent = await safeReply(interaction, {
    embeds: [buildEmbed(page)],
    components: buildButtons(page),
    fetchReply: true
  });

  function getUserId(i: Message | ChatInputCommandInteraction): string {
    return (i instanceof ChatInputCommandInteraction) ? i.user.id : (i as any).author.id;
  }

  const collector = (interaction.channel as any)?.createMessageComponentCollector({
    filter: (i: any) => ['back', 'forward'].includes(i.customId) && i.user.id === getUserId(interaction),
    time: 60000
  });

  collector?.on('collect', async (buttonInt: any) => {
    if (buttonInt.customId === 'back' && page > 0) page--;
    if (buttonInt.customId === 'forward' && page < totalPages - 1) page++;
    await buttonInt.update({
      embeds: [buildEmbed(page)],
      components: buildButtons(page)
    });
  });
}