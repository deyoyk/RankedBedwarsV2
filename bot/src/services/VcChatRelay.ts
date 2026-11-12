import { ChannelType, type Client, type Message } from 'discord.js';
import Game from '../models/Game';
import User from '../models/User';
import type { WebSocketManager } from '../websocket/WebSocketManager';

/**
 * Text typed in a game's team voice channel chat on Discord goes to that team's chat in game
 * (vc_chat: game_id, team 1 or 2, ign, elo, message). The server formats it.
 */
interface GameLink {
  gameId: number;
  team: 1 | 2;
}

const CACHE_MS = 30_000;

export class VcChatRelay {
  /** Voice channel id -> its game and team (null = not a game VC), for a short while. */
  private readonly links = new Map<string, { link: GameLink | null; until: number }>();

  constructor(private readonly client: Client, private readonly ws: WebSocketManager) {}

  start(): void {
    this.client.on('messageCreate', (message) => {
      void this.onMessage(message);
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
    }).select('gameId channels').lean() as { gameId: number; channels?: { team1Voice?: string; team2Voice?: string } } | null;
    const link: GameLink | null = game
      ? { gameId: game.gameId, team: game.channels?.team1Voice === channelId ? 1 : 2 }
      : null;
    this.links.set(channelId, { link, until: now + CACHE_MS });
    if (this.links.size > 500) {
      for (const [id, entry] of this.links) {
        if (entry.until <= now) this.links.delete(id);
      }
    }
    return link;
  }

  private async onMessage(message: Message): Promise<void> {
    try {
      if (message.author.bot || message.webhookId || !message.guild) return;
      if (message.channel.type !== ChannelType.GuildVoice) return;
      if (!this.ws.isConnected()) return;
      const link = await this.linkOf(message.channel.id);
      if (!link) return;
      let text = message.cleanContent.replace(/\s+/g, ' ').trim();
      if (!text && message.attachments.size > 0) text = '[image]';
      if (!text) return;
      if (text.length > 200) text = text.slice(0, 197) + '...';
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
