
import { Client, VoiceState } from 'discord.js';
import Game from '../models/Game';
import { deleteChannelIfEmpty } from '../utils/channelCleanup';

export function registerVcLeaveCleanupListener(client: Client) {
  client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
    if (!oldState.channelId || oldState.channelId === newState.channelId) return;

    try {
      const channel = oldState.guild.channels.cache.get(oldState.channelId);
      if (!channel || !channel.isVoiceBased() || channel.members.size !== 0) return;

      const game = await Game.findOne({
        $or: [
          { 'channels.team1Voice': oldState.channelId },
          { 'channels.team2Voice': oldState.channelId }
        ]
      }).select('state').lean();

      if (!game) return;
      if (game.state !== 'scored' && game.state !== 'voided') return;

      const result = await deleteChannelIfEmpty(
        oldState.guild,
        oldState.channelId,
        'Team VC is empty after user left and game is scored/voided'
      );
      if (result === 'deleted') {
        console.log(`[VcLeaveCleanupListener] Deleted empty team VC: ${channel.name} (${oldState.channelId})`);
      } else if (result === 'occupied') {
        console.log(`[VcLeaveCleanupListener] Team VC ${channel.name} (${oldState.channelId}) is still occupied; keeping it`);
      }
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      if (code === 10003 || code === '10003') {
        console.log(`[VcLeaveCleanupListener] Channel ${oldState.channelId} was already deleted`);
        return;
      }
      console.error(`[VcLeaveCleanupListener] Error cleaning up channel ${oldState.channelId}:`, error);
    }
  });
}