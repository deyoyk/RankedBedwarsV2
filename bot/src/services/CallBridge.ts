import type { Client, GuildMember, VoiceBasedChannel } from 'discord.js';
import Game from '../models/Game';
import User from '../models/User';
import type { WebSocketManager } from '../websocket/WebSocketManager';
import { callNotifyChannelId, postIn } from '../utils/notifyChannel';

/**
 * /call add|remove <player> from in game (callcmd / callremove): lets a player into the caller's
 * game VC, or takes them out again, then says so in the /call channel (CALL_NOTIFY_CHANNEL_ID, or
 * the bot commands channel). Replaces the bot's built-in callcmd handler.
 */
interface CallPayload {
  type: 'callcmd' | 'callremove';
  call_id?: string;
  callId?: string;
  requester?: string;
  target?: string;
}

export class CallBridge {
  constructor(private readonly client: Client, private readonly ws: WebSocketManager) {}

  start(): void {
    this.ws.setGlobalHandler('callcmd', (msg) => {
      void this.handle(msg as unknown as CallPayload, true);
    });
    this.ws.setGlobalHandler('callremove', (msg) => {
      void this.handle(msg as unknown as CallPayload, false);
    });
    console.log('[CallBridge] In-game /call add|remove is linked');
  }

  private fail(callId: string, reason: string): void {
    this.ws.send({ type: 'callfailure', call_id: callId, reason });
  }

  private async handle(msg: CallPayload, add: boolean): Promise<void> {
    const callId = msg.call_id ?? msg.callId ?? '';
    const requester = (msg.requester || '').trim();
    const target = (msg.target || '').trim();
    try {
      if (!callId || !requester || !target) {
        this.fail(callId, 'Missing required fields');
        return;
      }
      const [requesterUser, targetUser] = await Promise.all([
        User.findOne({ ign: requester }).collation({ locale: 'en', strength: 2 }).select('discordId ign').lean(),
        User.findOne({ ign: target }).collation({ locale: 'en', strength: 2 }).select('discordId ign').lean(),
      ]);
      if (!requesterUser) {
        this.fail(callId, "You're not registered on Discord");
        return;
      }
      if (!targetUser) {
        this.fail(callId, `${target} isn't registered on Discord`);
        return;
      }
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        this.fail(callId, 'The Discord server is not available');
        return;
      }
      const member: GuildMember | null = guild.members.cache.get(requesterUser.discordId)
        ?? await guild.members.fetch(requesterUser.discordId).catch(() => null);
      const voice: VoiceBasedChannel | null | undefined = member?.voice?.channel;
      if (!voice) {
        this.fail(callId, "You're not in a voice channel on Discord");
        return;
      }
      const game = await Game.findOne({
        $or: [
          { 'channels.team1Voice': voice.id },
          { 'channels.team2Voice': voice.id },
          { 'channels.picking': voice.id },
        ],
      }).select('gameId').lean();
      if (!game) {
        this.fail(callId, "You're not in a game voice channel");
        return;
      }
      try {
        if (add) {
          await voice.permissionOverwrites.create(targetUser.discordId, {
            ViewChannel: true,
            Connect: true,
            Speak: true,
            Stream: true,
            UseVAD: true,
          });
        } else {
          await voice.permissionOverwrites.delete(targetUser.discordId);
          const inside = voice.members.get(targetUser.discordId);
          if (inside) await inside.voice.disconnect('Removed with /call remove').catch(() => undefined);
        }
      } catch (error) {
        console.error('[CallBridge] Could not change voice permissions:', error);
        this.fail(callId, 'The bot could not change that voice channel');
        return;
      }
      this.ws.send({ type: 'callsuccess', call_id: callId });
      await CallBridge.announce(this.client, targetUser.discordId, voice.id, add, requesterUser.ign || requester);
    } catch (error) {
      console.error('[CallBridge] /call failed:', error);
      this.fail(callId, 'Internal error');
    }
  }

  /** "@user has been given access to #VC" in the /call channel. Also used by Discord's /call. */
  static async announce(client: Client | undefined, targetId: string, voiceId: string, add: boolean, by?: string): Promise<void> {
    const text = add
      ? `<@${targetId}> has been given access to <#${voiceId}>`
      : `<@${targetId}> no longer has access to <#${voiceId}>`;
    await postIn(client, callNotifyChannelId(), {
      content: by ? `${text} (by ${by})` : text,
      allowedMentions: { users: [targetId] },
    });
  }
}
