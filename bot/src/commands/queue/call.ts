import { ButtonInteraction, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import type { OpenTier } from '../../services/CallRoleService';
import { CallAction, CallFlow } from '../../services/CallFlow';

const { errorEmbed, successEmbed } = embedsFor('VC Access');
const NEEDS_USER = new Set(['add', 'remove', 'mute', 'unmute', 'request']);

export async function call(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const sub = (interaction.options.getSubcommand(false) ?? 'add') as CallAction;
  try {
    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Error'));
      return;
    }
    const target = interaction.options.getUser('user')?.id;
    if (NEEDS_USER.has(sub)) {
      if (!target) {
        await safeReply(interaction, errorEmbed('Choose a user.', 'Call'));
        return;
      }
      const registered = await User.findOne({ discordId: target }).select('_id').lean();
      if (!registered) {
        await safeReply(interaction, errorEmbed('The target user is not registered in the system.', 'User Not Found'));
        return;
      }
    }
    const result = await CallFlow.run(guild, interaction.user.id, sub, {
      targetId: target,
      muted: sub === 'add' ? Boolean(interaction.options.getBoolean('mute')) : undefined,
      tier: sub === 'open' ? (interaction.options.getString('to') || 'everyone') as OpenTier : undefined,
    });
    await safeReply(interaction, result.ok
      ? successEmbed(result.message, 'Call', true)
      : errorEmbed(result.message, 'Call', true));
  } catch (error) {
    await replyCommandError(interaction, error, `${sub} the call`, '[call]');
  }
}

export async function handleCallVote(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId.split(':')[2] || '';
  const result = await CallFlow.vote(id, interaction.user.id);
  const reply = result.ok ? successEmbed(result.message, 'Call') : errorEmbed(result.message, 'Call');
  await interaction.reply({ embeds: [reply.builder], flags: MessageFlags.Ephemeral });
}
