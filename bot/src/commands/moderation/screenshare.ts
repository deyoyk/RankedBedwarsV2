import { Message, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { ScreenshareService } from '../../services/ScreenshareService';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import config from '../../config/config';

export async function screenshare(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager): Promise<void> {
  const resolvedWs = wsManager ?? (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
  void resolvedWs;
  if (!(interaction instanceof ChatInputCommandInteraction)) {
    await safeReply(interaction, errorEmbed('Use /screenshare <user> <reason> [image] (slash command) to request a screenshare.', 'Screenshare Error'));
    return;
  }
  // Support both registered option names ('user'/'reason') and legacy names ('target'/image required).
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


    const channelId = config.channels.screensharerequestsChannel;
    if (!channelId) {
      await safeReply(interaction, { embeds: [errorEmbed('Screenshare requests channel not configured.', 'Screenshare Error').builder] });
      return;
    }

    let channel: TextChannel;
    try {
      const channelRaw = guild.channels.cache?.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
      if (!channelRaw || !channelRaw.isTextBased()) {
        await safeReply(interaction, { embeds: [errorEmbed('Screenshare requests channel not found or not a text channel.', 'Screenshare Error').builder] });
        return;
      }
      channel = channelRaw as TextChannel;
    } catch (error) {
      console.error('[Screenshare Command] Failed to fetch channel:', error);
      await safeReply(interaction, { embeds: [errorEmbed('Failed to access screenshare requests channel.', 'Screenshare Error').builder] });
      return;
    }


    const embed = ScreenshareService.createSessionEmbed(session, image.url);
    const row = ScreenshareService.createFreezeButton(session.sessionId);


    if (result.dontlogResult) {
      embed.addFields({
        name: 'Player Status',
        value: `Online: ${result.dontlogResult.online ? '\u2705' : '\u274c'} | DontLog: ${result.dontlogResult.dontlog ? '\u2705' : '\u274c'}`,
        inline: true
      });
    }

    const screensharerRoleId = config.roles.screensharer;
    const mention = screensharerRoleId ? `<@&${screensharerRoleId}>` : '';


    let sentMsg, thread;
    try {
      sentMsg = await channel.send({
        content: mention,
        embeds: [embed],
        components: [row]
      });

      thread = await sentMsg.startThread({
        name: `SS: ${target.username} | ${session.sessionId}`,
        autoArchiveDuration: 60,
        reason: `Screenshare session thread for ${session.sessionId}`
      });

      if (screensharerRoleId) {
        await thread.setLocked(false);
      }

      await thread.send({
        content: `<@${target.id}>`,
        embeds: [embed]
      });

    } catch (error) {
      console.error('[Screenshare Command] Failed to create thread:', error);
      await safeReply(interaction, { embeds: [errorEmbed('Failed to create screenshare thread.', 'Screenshare Error').builder] });


      await ScreenshareService.closeSession(guild, session.sessionId, 'system', 'Thread creation failed');
      return;
    }


    const activeWs = resolvedWs ?? global._wsManager;
    if (activeWs && typeof activeWs.registerScreenshareThread === 'function') {
      try {
        activeWs.registerScreenshareThread({
          ign: session.targetIgn,
          sessionId: session.sessionId,
          threadId: thread.id,
          expiresAt: Date.now() + 15 * 60 * 1000
        });
      } catch (error) {
        console.warn('[Screenshare Command] Failed to register with websocket manager:', error);

      }
    }


    const successEmbedObj = successEmbed('Screenshare request created successfully!', 'Screenshare Request Created');
    successEmbedObj.builder.addFields(
      { name: 'Target', value: `<@${target.id}> (${session.targetIgn})`, inline: true },
      { name: 'Session ID', value: session.sessionId, inline: true },
      { name: 'Thread', value: `<#${thread.id}>`, inline: true },
      { name: 'Expires', value: `<t:${Math.floor(session.expireTime.getTime() / 1000)}:R>`, inline: true }
    );

    if (result.dontlogResult) {
      successEmbedObj.builder.addFields({
        name: 'Player Status',
        value: `Online: ${result.dontlogResult.online ? '\u2705' : '\u274c'} | DontLog: ${result.dontlogResult.dontlog ? '\u2705' : '\u274c'}`,
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
