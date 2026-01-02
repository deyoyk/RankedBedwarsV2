
import { Client, VoiceState } from 'discord.js';
import Game from '../models/Game';

export function registerVcLeaveCleanupListener(client: Client) {
  client.on('voiceStateUpdate', async (oldState: VoiceState, newState: VoiceState) => {
    if (!oldState.channelId || oldState.channelId === newState.channelId) return;

    try {
      const game = await Game.findOne({
        $or: [
          { 'channels.team1Voice': oldState.channelId },
          { 'channels.team2Voice': oldState.channelId }
        ]
      });

      if (!game) return;
      if (game.state !== 'scored' && game.state !== 'voided') return;

      const channel = oldState.guild.channels.cache.get(oldState.channelId);
      if (channel && channel.isVoiceBased() && channel.members.size === 0) {
        await channel.delete('Team VC is empty after user left and game is scored/voided');
        console.log(`[VcLeaveCleanupListener] Deleted empty team VC: ${channel.name} (${oldState.channelId})`);
      }
    } catch (error) {
      console.error(`[VcLeaveCleanupListener] Error cleaning up channel ${oldState.channelId}:`, error);
    }
  });
}