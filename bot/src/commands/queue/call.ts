import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import type { OpenTier } from '../../services/CallRoleService';
import { addToCall, closeCall, findCall, openCall, removeFromCall, unmuteInCall } from '../../services/CallControl';

const { errorEmbed, successEmbed } = embedsFor('VC Access');

export async function call(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const sub = interaction.options.getSubcommand(false) ?? 'add';
  try {
    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Error'));
      return;
    }
    const target = interaction.options.getUser('user')?.id ?? null;
    if ((sub === 'add' || sub === 'remove' || sub === 'unmute') && target) {
      const registered = await User.findOne({ discordId: target }).select('_id').lean();
      if (!registered) {
        await safeReply(interaction, errorEmbed('The target user is not registered in the system.', 'User Not Found'));
        return;
      }
    }
    const ctx = await findCall(guild, interaction.user.id, sub === 'open' || sub === 'close' || sub === 'unmute');
    if ('error' in ctx) {
      await safeReply(interaction, errorEmbed(ctx.error, 'Call'));
      return;
    }
    const result = sub === 'open'
      ? await openCall(ctx, (interaction.options.getString('to') || 'everyone') as OpenTier)
      : sub === 'close'
        ? await closeCall(ctx)
        : !target
          ? { ok: false as const, message: 'Choose a user.' }
          : sub === 'remove'
            ? await removeFromCall(ctx, target)
            : sub === 'unmute'
              ? await unmuteInCall(ctx, target)
              : await addToCall(ctx, target, Boolean(interaction.options.getBoolean('mute')));
    if (!result.ok) {
      await safeReply(interaction, errorEmbed(result.message, 'Call'));
      return;
    }
    await safeReply(interaction, successEmbed(`${result.message}\n-# Game #${ctx.game.gameId} · by <@${interaction.user.id}>`, 'Call'));
    if (target && (sub === 'add' || sub === 'remove')) {
      const { CallBridge } = await import('../../services/CallBridge');
      await CallBridge.announce(interaction.client, target, ctx.voice.id, sub === 'add');
    }
  } catch (error) {
    await replyCommandError(interaction, error, `${sub} the call`, '[call]');
  }
}
