import type { Client } from 'discord.js';
import User from '../models/User';
import type { WebSocketManager } from '../websocket/WebSocketManager';
import type { OpenTier } from './CallRoleService';
import { OPEN_TIERS } from './CallControl';
import { CallAction, CallFlow } from './CallFlow';

interface CallPayload {
  type: 'callcmd' | 'callremove';
  call_id?: string;
  callId?: string;
  requester?: string;
  target?: string;
  action?: string;
  muted?: boolean;
  tier?: string;
  vote_id?: string;
}

const ACTIONS: Array<CallAction | 'vote'> = ['add', 'remove', 'unmute', 'mute', 'open', 'close', 'request', 'vote'];

export function actionOf(msg: CallPayload): CallAction | 'vote' | null {
  if (msg.type === 'callremove') return 'remove';
  const action = (msg.action || 'add').toLowerCase() as CallAction | 'vote';
  return ACTIONS.includes(action) ? action : null;
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

  private answer(callId: string, ok: boolean, reason: string): void {
    this.ws.send(ok ? { type: 'callsuccess', call_id: callId, message: reason } : { type: 'callfailure', call_id: callId, reason });
  }

  private async handle(msg: CallPayload): Promise<void> {
    const callId = msg.call_id ?? msg.callId ?? '';
    const requester = (msg.requester || '').trim();
    const target = (msg.target || '').trim();
    const action = actionOf(msg);
    try {
      const needsTarget = action === 'add' || action === 'remove' || action === 'unmute' || action === 'mute' || action === 'request';
      if (!callId || !requester || !action || (needsTarget && !target) || (action === 'vote' && !msg.vote_id)) {
        this.answer(callId, false, 'Missing required fields');
        return;
      }
      const lookup = (ign: string) => User.findOne({ ign }).collation({ locale: 'en', strength: 2 }).select('discordId ign').lean();
      const [requesterUser, targetUser] = await Promise.all([lookup(requester), needsTarget ? lookup(target) : Promise.resolve(null)]);
      if (!requesterUser) {
        this.answer(callId, false, "You're not registered on Discord");
        return;
      }
      if (needsTarget && !targetUser) {
        this.answer(callId, false, `${target} isn't registered on Discord`);
        return;
      }
      if (action === 'vote') {
        const result = await CallFlow.vote(String(msg.vote_id), requesterUser.discordId);
        this.answer(callId, result.ok, clean(result.message));
        return;
      }
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        this.answer(callId, false, 'The Discord server is not available');
        return;
      }
      const tier = (msg.tier || 'everyone').toLowerCase() as OpenTier;
      if (action === 'open' && !OPEN_TIERS.includes(tier)) {
        this.answer(callId, false, `Open it to ${OPEN_TIERS.join(', ')}`);
        return;
      }
      try {
        const result = await CallFlow.run(guild, requesterUser.discordId, action,
          { targetId: targetUser?.discordId, muted: Boolean(msg.muted), tier });
        this.answer(callId, result.ok, clean(result.message));
      } catch (error) {
        console.error('[CallBridge] Could not change voice permissions:', error);
        this.answer(callId, false, 'The bot could not change that voice channel');
      }
    } catch (error) {
      console.error('[CallBridge] /call failed:', error);
      this.answer(callId, false, 'Internal error');
    }
  }
}

function clean(message: string): string {
  return message.replace(/<[@#&]+\d+>/g, 'them').replace(/`/g, '').replace(/\.$/, '');
}
