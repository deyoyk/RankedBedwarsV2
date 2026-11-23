import type { Client } from 'discord.js';
import User from '../models/User';
import type { WebSocketManager } from '../websocket/WebSocketManager';
import { callNotifyChannelId, postIn } from '../utils/notifyChannel';
import type { OpenTier } from './CallRoleService';
import { addToCall, closeCall, findCall, OPEN_TIERS, openCall, removeFromCall, unmuteInCall } from './CallControl';

interface CallPayload {
  type: 'callcmd' | 'callremove';
  call_id?: string;
  callId?: string;
  requester?: string;
  target?: string;
  action?: string;
  muted?: boolean;
  tier?: string;
}

export function actionOf(msg: CallPayload): 'add' | 'remove' | 'unmute' | 'open' | 'close' | null {
  if (msg.type === 'callremove') return 'remove';
  const action = (msg.action || 'add').toLowerCase();
  return action === 'add' || action === 'remove' || action === 'unmute' || action === 'open' || action === 'close' ? action : null;
}

export class CallBridge {
  constructor(private readonly client: Client, private readonly ws: WebSocketManager) {}

  start(): void {
    this.ws.setGlobalHandler('callcmd', (msg) => {
      void this.handle(msg as unknown as CallPayload);
    });
    this.ws.setGlobalHandler('callremove', (msg) => {
      void this.handle(msg as unknown as CallPayload);
    });
    console.log('[CallBridge] In-game /call is linked');
  }

  private fail(callId: string, reason: string): void {
    this.ws.send({ type: 'callfailure', call_id: callId, reason });
  }

  private async handle(msg: CallPayload): Promise<void> {
    const callId = msg.call_id ?? msg.callId ?? '';
    const requester = (msg.requester || '').trim();
    const target = (msg.target || '').trim();
    const action = actionOf(msg);
    try {
      const needsTarget = action === 'add' || action === 'remove' || action === 'unmute';
      if (!callId || !requester || !action || (needsTarget && !target)) {
        this.fail(callId, 'Missing required fields');
        return;
      }
      const lookup = (ign: string) => User.findOne({ ign }).collation({ locale: 'en', strength: 2 }).select('discordId ign').lean();
      const [requesterUser, targetUser] = await Promise.all([lookup(requester), needsTarget ? lookup(target) : Promise.resolve(null)]);
      if (!requesterUser) {
        this.fail(callId, "You're not registered on Discord");
        return;
      }
      if (needsTarget && !targetUser) {
        this.fail(callId, `${target} isn't registered on Discord`);
        return;
      }
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        this.fail(callId, 'The Discord server is not available');
        return;
      }
      const ctx = await findCall(guild, requesterUser.discordId, action === 'open' || action === 'close' || action === 'unmute');
      if ('error' in ctx) {
        this.fail(callId, ctx.error.replace(/\.$/, ''));
        return;
      }
      const tier = (msg.tier || 'everyone').toLowerCase() as OpenTier;
      if (action === 'open' && !OPEN_TIERS.includes(tier)) {
        this.fail(callId, `Open it to ${OPEN_TIERS.join(', ')}`);
        return;
      }
      const targetId = targetUser?.discordId ?? '';
      let result;
      try {
        result = action === 'open' ? await openCall(ctx, tier)
          : action === 'close' ? await closeCall(ctx)
            : action === 'remove' ? await removeFromCall(ctx, targetId)
              : action === 'unmute' ? await unmuteInCall(ctx, targetId)
                : await addToCall(ctx, targetId, Boolean(msg.muted));
      } catch (error) {
        console.error('[CallBridge] Could not change voice permissions:', error);
        this.fail(callId, 'The bot could not change that voice channel');
        return;
      }
      if (!result.ok) {
        this.fail(callId, result.message.replace(/<[@#&]+\d+>/g, 'them').replace(/`/g, ''));
        return;
      }
      this.ws.send({ type: 'callsuccess', call_id: callId });
      if (action === 'add' || action === 'remove') {
        await CallBridge.announce(this.client, targetId, ctx.voice.id, action === 'add', requesterUser.ign || requester);
      }
    } catch (error) {
      console.error('[CallBridge] /call failed:', error);
      this.fail(callId, 'Internal error');
    }
  }

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
