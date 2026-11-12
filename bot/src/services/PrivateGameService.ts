import Game from '../models/Game';
import User from '../models/User';
import { PartyService } from './PartyService';
import { queuePlayers } from '../types/queuePlayersMemory';
import type { WebSocketManager } from '../websocket/WebSocketManager';

export interface PrivateGameStartOptions {
  map?: string;
}

export interface PrivateGameStartResult {
  success: boolean;
  message?: string;
  map?: string;
  /** IGNs that joined the game on the server. */
  players?: string[];
  /** IGNs that weren't on the server or were already in a game. */
  missing?: string[];
}

const ACTIVE_GAME_STATES = ['pending', 'active', 'scoring'];

interface MemberUser {
  discordId: string;
  ign?: string;
  isBanned?: boolean;
  isFrozen?: boolean;
}

/**
 * Private games are hosted by the Minecraft server (BW-RBW's host_private_game): they get no game
 * number, no VCs and no scoring, so they never count as real games.
 */
export class PrivateGameService {
  private static inFlightParties = new Set<string>();

  public static async getActivePrivateGame(partyId: string): Promise<{ gameId: number } | null> {
    if (!partyId) return null;
    try {
      return await Game.findOne({
        privatePartyId: partyId,
        isPrivate: true,
        state: { $in: ACTIVE_GAME_STATES },
      }).select('gameId').lean() as { gameId: number } | null;
    } catch (error) {
      console.error('[PrivateGameService] Error finding active private game:', error);
      return null;
    }
  }

  public static async startPrivateGame(
    leaderId: string,
    wsManager: WebSocketManager,
    options: PrivateGameStartOptions = {},
  ): Promise<PrivateGameStartResult> {
    const validation = await PartyService.validatePartyAccess(leaderId, true);
    if (!validation.isValid || !validation.party) {
      return { success: false, message: validation.error || 'Not in a party' };
    }

    const party = validation.party;
    if (this.inFlightParties.has(party.partyId)) {
      return { success: false, message: 'A private game is already being started for your party' };
    }
    this.inFlightParties.add(party.partyId);
    try {
      const members = await this.loadMembers([party.members]);
      if (typeof members === 'string') return { success: false, message: members };
      return await this.host(wsManager, { map: options.map, players: members[0] });
    } finally {
      this.inFlightParties.delete(party.partyId);
    }
  }

  /** /party duel: the challenger's party against the other party, each on its own team. */
  public static async startDuel(
    challengerPartyId: string,
    targetPartyId: string,
    wsManager: WebSocketManager,
    options: PrivateGameStartOptions = {},
  ): Promise<PrivateGameStartResult> {
    const Party = (await import('../models/Party')).default;
    const [a, b] = await Promise.all([
      Party.findOne({ partyId: challengerPartyId }).lean(),
      Party.findOne({ partyId: targetPartyId }).lean(),
    ]);
    if (!a || !b) {
      return { success: false, message: 'One of the parties no longer exists' };
    }
    if (this.inFlightParties.has(a.partyId) || this.inFlightParties.has(b.partyId)) {
      return { success: false, message: 'A game is already being started for one of the parties' };
    }
    this.inFlightParties.add(a.partyId);
    this.inFlightParties.add(b.partyId);
    try {
      const teams = await this.loadMembers([a.members, b.members]);
      if (typeof teams === 'string') return { success: false, message: teams };
      return await this.host(wsManager, { map: options.map, teams });
    } finally {
      this.inFlightParties.delete(a.partyId);
      this.inFlightParties.delete(b.partyId);
    }
  }

  /** Ends a private game left over from before they were hosted by the server. */
  public static async cancelPrivateGame(
    leaderId: string,
    wsManager: WebSocketManager,
  ): Promise<{ success: boolean; message?: string; gameId?: number }> {
    const validation = await PartyService.validatePartyAccess(leaderId, true);
    if (!validation.isValid || !validation.party) {
      return { success: false, message: validation.error || 'Not in a party' };
    }

    const active = await this.getActivePrivateGame(validation.party.partyId);
    if (!active) {
      return { success: false, message: 'Your party does not have an active private game' };
    }

    const gameManager = wsManager.getGameManager();
    if (!gameManager) {
      return { success: false, message: 'Game manager is not available yet' };
    }

    try {
      await gameManager.voidGame(active.gameId, 'Private game cancelled by party leader');
      return { success: true, gameId: active.gameId };
    } catch (error) {
      console.error(`[PrivateGameService] Error cancelling private game ${active.gameId}:`, error);
      return { success: false, message: 'Failed to cancel the private game' };
    }
  }

  private static async host(
    wsManager: WebSocketManager,
    request: { map?: string; players?: string[]; teams?: string[][] },
  ): Promise<PrivateGameStartResult> {
    const result = await wsManager.hostPrivateGame({
      map: request.map?.trim() || undefined,
      ...(request.teams ? { teams: request.teams } : { players: request.players }),
    });
    if (!result.ok) {
      return { success: false, message: result.message || 'The Minecraft server could not start the private game' };
    }
    return { success: true, message: result.message, map: result.map, players: result.players, missing: result.missing };
  }

  /** Each group's IGNs, or why the game can't start. */
  private static async loadMembers(groups: string[][]): Promise<string[][] | string> {
    const cleaned = groups.map(g => [...new Set((g ?? []).map(id => (id ?? '').trim()).filter(Boolean))]);
    const ids = cleaned.flat();
    if (ids.length < 2) return 'A private game needs at least 2 players';

    let users: MemberUser[];
    try {
      users = await User.find({ discordId: { $in: ids } })
        .select('discordId ign isBanned isFrozen')
        .lean() as MemberUser[];
    } catch (error) {
      console.error('[PrivateGameService] Error loading party members:', error);
      return 'Could not load party members from the database';
    }

    const byId = new Map(users.map(u => [u.discordId, u]));
    if (ids.some(id => !byId.get(id)?.ign)) return 'Some party members are not registered';

    const blocked = users.filter(u => u.isBanned || u.isFrozen);
    if (blocked.length) return `Banned or frozen party members: ${blocked.map(u => u.ign).join(', ')}`;

    const queued = this.findQueuedMembers(ids);
    if (queued.length) return `Party members already in a queue: ${queued.map(id => byId.get(id)!.ign).join(', ')}`;

    return cleaned.map(g => g.map(id => byId.get(id)!.ign!));
  }

  private static findQueuedMembers(memberIds: string[]): string[] {
    const members = new Set(memberIds);
    const queued = new Set<string>();
    for (const players of queuePlayers.values()) {
      for (const id of players) {
        if (members.has(id)) queued.add(id);
      }
    }
    return [...queued];
  }
}
