import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { ScreenshareService } from '../../services/ScreenshareService';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

const { errorEmbed, successEmbed } = embedsFor('Screenshare');

export async function screenshare(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  const target = interaction.options.getUser('user') ?? interaction.options.getUser('target');
  const reason = interaction.options.getString('reason', true);
  const image = interaction.options.getAttachment('image') ?? interaction.options.getAttachment('proof');
  const guild = interaction.guild;

  if (!target) {
    await safeReply(interaction, errorEmbed('Target user not provided.', 'Screenshare Error'));
    return;
  }

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Screenshare Error'));
    return;
  }

  if (!image) {
    await safeReply(interaction, errorEmbed('An image attachment is required as proof.', 'Screenshare Error'));
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  try {

    const result = await ScreenshareService.createSession(
      guild,
      target.id,
      interaction.user.id,
      reason,
      image.url
    );

    if (!result.success) {
      await safeReply(interaction, { embeds: [errorEmbed(result.error!, 'Screenshare Error').builder] });
      return;
    }

    const session = result.session!;

    const posted = await ScreenshareService.postRequest(guild, session, {
      targetName: target.username,
      imageUrl: image.url,
      dontlogResult: result.dontlogResult
    });
    if (!posted.success) {
      await safeReply(interaction, { embeds: [errorEmbed(posted.error!, 'Screenshare Error').builder] });
      return;
    }


    const successEmbedObj = successEmbed('Screenshare request created successfully!', 'Screenshare Request Created');
    successEmbedObj.builder.addFields(
      { name: 'Target', value: `<@${target.id}> (${session.targetIgn})`, inline: true },
      { name: 'Session ID', value: session.sessionId, inline: true },
      { name: 'Thread', value: `<#${posted.threadId}>`, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(session.expireTime.getTime() / 1000)}:R>`, inline: true }
    );

    if (result.dontlogResult) {
      successEmbedObj.builder.addFields({
        name: 'Player Status',
        value: `Online: ${result.dontlogResult.online ? 'Yes' : 'No'} | DontLog: ${result.dontlogResult.dontlog ? 'Yes' : 'No'}`,
        inline: true
      });
    }

    await safeReply(interaction, { embeds: [successEmbedObj.builder] });

  } catch (error) {
    console.error('[Screenshare Command] Unexpected error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await safeReply(interaction, {
      embeds: [errorEmbed(`There was an error processing your screenshare request: ${errorMessage}`, 'Screenshare Error').builder]
    });
  }
}
