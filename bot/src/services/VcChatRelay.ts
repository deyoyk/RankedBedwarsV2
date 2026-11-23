import { ChannelType, type Client, type Message, type VoiceState } from 'discord.js';
import Game from '../models/Game';
import User from '../models/User';
import type { WebSocketManager } from '../websocket/WebSocketManager';

/**
 * Text typed with a "-" in front in a game's team voice channel chat on Discord, by someone in that
 * voice channel, goes to that team's chat in game (vc_chat: game_id, team 1 or 2, ign, elo, message).
 * Called players joining or leaving a team voice channel are told to that team (vc_call).
 */
interface GameLink {
  gameId: number;
  team: 1 | 2;
  players: Set<string>;
}

export interface CallAlert {
  gameId: number;
  team: 1 | 2;
  joined: boolean;
}

/** Someone who isn't playing in the game (called in with /call) joining or leaving one of its team VCs. */
export function callAlerts(memberId: string, from: GameLink | null, to: GameLink | null): CallAlert[] {
  const out: CallAlert[] = [];
  const same = from && to && from.gameId === to.gameId && from.team === to.team;
  if (same) return out;
  if (from && !from.players.has(memberId)) out.push({ gameId: from.gameId, team: from.team, joined: false });
  if (to && !to.players.has(memberId)) out.push({ gameId: to.gameId, team: to.team, joined: true });
  return out;
}

const CACHE_MS = 30_000;
const PREFIX = '-';
const MAX_LENGTH = 200;

/** What goes to the game: only a message starting with "-", from someone in that voice channel, without the "-". */
export function relayText(raw: string, inVoice: boolean): string | null {
  if (!inVoice) return null;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  let text = trimmed.slice(PREFIX.length).trim();
  if (!text) return null;
  if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH - 3) + '...';
  return text;
}

export class VcChatRelay {
  /** Voice channel id -> its game and team (null = not a game VC), for a short while. */
  private readonly links = new Map<string, { link: GameLink | null; until: number }>();

  constructor(private readonly client: Client, private readonly ws: WebSocketManager) {}

  start(): void {
    this.client.on('messageCreate', (message) => {
      void this.onMessage(message);
    });
    this.client.on('voiceStateUpdate', (before, after) => {
      void this.onVoice(before, after);
    });
    console.log('[VcChatRelay] Game VC chat goes to team chat in game');
  }

  private async linkOf(channelId: string): Promise<GameLink | null> {
    const now = Date.now();
    const cached = this.links.get(channelId);
    if (cached && cached.until > now) return cached.link;
    const game = await Game.findOne({
      $or: [{ 'channels.team1Voice': channelId }, { 'channels.team2Voice': channelId }],
      state: { $in: ['pending', 'active'] },
    }).select('gameId channels team1 team2').lean() as {
      gameId: number;
      channels?: { team1Voice?: string; team2Voice?: string };
      team1?: string[];
      team2?: string[];
    } | null;
    const link: GameLink | null = game
      ? {
        gameId: game.gameId,
        team: game.channels?.team1Voice === channelId ? 1 : 2,
        players: new Set([...(game.team1 ?? []), ...(game.team2 ?? [])]),
      }
      : null;
    this.links.set(channelId, { link, until: now + CACHE_MS });
    if (this.links.size > 500) {
      for (const [id, entry] of this.links) {
        if (entry.until <= now) this.links.delete(id);
      }
    }
    return link;
  }

  private async onVoice(before: VoiceState, after: VoiceState): Promise<void> {
    try {
      if (before.channelId === after.channelId || !this.ws.isConnected()) return;
      const member = after.member ?? before.member;
      if (!member || member.user.bot) return;
      const from = before.channelId ? await this.linkOf(before.channelId) : null;
      const to = after.channelId ? await this.linkOf(after.channelId) : null;
      const alerts = callAlerts(member.id, from, to);
      if (alerts.length === 0) return;
      const user = await User.findOne({ discordId: member.id }).select('ign').lean() as { ign?: string } | null;
      const name = user?.ign || member.displayName || member.user.username;
      for (const alert of alerts) {
        this.ws.send({ type: 'vc_call', game_id: alert.gameId, team: alert.team, name, joined: alert.joined });
      }
    } catch (error) {
      console.error('[VcChatRelay] Could not pass on a call join or leave:', error);
    }
  }

  private async onMessage(message: Message): Promise<void> {
    try {
      if (message.author.bot || message.webhookId || !message.guild) return;
      if (message.channel.type !== ChannelType.GuildVoice) return;
      if (!this.ws.isConnected()) return;
      const link = await this.linkOf(message.channel.id);
      if (!link) return;
      const text = relayText(message.cleanContent, message.member?.voice?.channelId === message.channel.id);
      if (!text) return;
      const user = await User.findOne({ discordId: message.author.id }).select('ign elo').lean() as { ign?: string; elo?: number } | null;
      this.ws.send({
        type: 'vc_chat',
        game_id: link.gameId,
        team: link.team,
        ign: user?.ign || message.member?.displayName || message.author.username,
        elo: typeof user?.elo === 'number' ? user.elo : null,
        registered: Boolean(user?.ign),
        message: text,
      });
    } catch (error) {
      console.error('[VcChatRelay] Could not pass on a VC message:', error);
    }
  }
}
