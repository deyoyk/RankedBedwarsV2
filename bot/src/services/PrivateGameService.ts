import type { Guild } from 'discord.js';
import Game from '../models/Game';
import User from '../models/User';
import config from '../config/config';
import { MapService } from '../managers/MapManager';
import { claimMapPick, getRecentMapPicks } from '../Matchmaking/utils';
import { PartyService } from './PartyService';
import { PresenceService } from './PresenceService';
import { queuePlayers } from '../types/queuePlayersMemory';
import type { WebSocketManager } from '../websocket/WebSocketManager';
import type { MapInfo } from '../types/MapInfoMemory';

export interface PrivateGamePlayer {
  discordId: string;
  ign: string;
  elo: number;
}

export interface PrivateGameStartOptions {
  map?: string;
}

export interface PrivateGameStartResult {
  success: boolean;
  message?: string;
  gameId?: number;
  map?: string;
  team1?: string[];
  team2?: string[];
}

const ACTIVE_GAME_STATES = ['pending', 'active', 'scoring'];

export class PrivateGameService {
  private static inFlightParties = new Set<string>();

  public static maxPartySize(): number {
    const configured = Number.isInteger(config.CommonPartySize) && config.CommonPartySize > 0
      ? config.CommonPartySize
      : 8;
    return Math.max(2, configured);
  }

  public static splitTeams(players: PrivateGamePlayer[]): { team1: string[]; team2: string[] } {
    const sorted = [...players].sort((a, b) => {
      const eloDiff = (b.elo || 0) - (a.elo || 0);
      return eloDiff !== 0 ? eloDiff : a.discordId.localeCompare(b.discordId);
    });
    const perTeam = Math.floor(sorted.length / 2);
    const team1: string[] = [];
    const team2: string[] = [];
    let team1Elo = 0;
    let team2Elo = 0;

    for (const player of sorted) {
      const elo = Number.isFinite(player.elo) ? player.elo : 0;
      if (team1.length >= perTeam) {
        team2.push(player.discordId);
        team2Elo += elo;
        continue;
      }
      if (team2.length >= perTeam) {
        team1.push(player.discordId);
        team1Elo += elo;
        continue;
      }
      if (team1Elo <= team2Elo) {
        team1.push(player.discordId);
        team1Elo += elo;
      } else {
        team2.push(player.discordId);
        team2Elo += elo;
      }
    }

    return { team1, team2 };
  }

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
    guild: Guild,
    wsManager: WebSocketManager,
    options: PrivateGameStartOptions = {},
  ): Promise<PrivateGameStartResult> {
    const validation = await PartyService.validatePartyAccess(leaderId, true);
    if (!validation.isValid || !validation.party) {
      return { success: false, message: validation.error || 'Not in a party' };
    }

    const party = validation.party;
    const partyId = party.partyId;
    if (this.inFlightParties.has(partyId)) {
      return { success: false, message: 'A private game is already being created for your party' };
    }
    this.inFlightParties.add(partyId);

    try {
      return await this.createPrivateGame(partyId, party.members, party.maxMembers, guild, wsManager, options);
    } finally {
      this.inFlightParties.delete(partyId);
    }
  }

  private static async createPrivateGame(
    partyId: string,
    rawMembers: string[],
    partyMaxMembers: number,
    guild: Guild,
    wsManager: WebSocketManager,
    options: PrivateGameStartOptions,
  ): Promise<PrivateGameStartResult> {
    const memberIds = [...new Set((rawMembers ?? []).map(id => (id ?? '').trim()).filter(Boolean))];
    if (memberIds.length < 2) {
      return { success: false, message: 'A private game needs at least 2 party members' };
    }
    if (memberIds.length % 2 !== 0) {
      return { success: false, message: 'Private games need an even number of players (2, 4, 6, or 8)' };
    }

    const maxSize = Math.min(
      this.maxPartySize(),
      Number.isInteger(partyMaxMembers) && partyMaxMembers > 0 ? partyMaxMembers : this.maxPartySize(),
    );
    if (memberIds.length > maxSize) {
      return { success: false, message: `Party size ${memberIds.length} exceeds the private game limit of ${maxSize}` };
    }

    const users = await (async () => {
      try {
        return await User.find({ discordId: { $in: memberIds } })
          .select('discordId ign elo isBanned isFrozen')
          .lean() as Array<{
            discordId: string;
            ign?: string;
            elo?: number;
            isBanned?: boolean;
            isFrozen?: boolean;
          }>;
      } catch (error) {
        console.error('[PrivateGameService] Error loading party members:', error);
        return null;
      }
    })();

    if (!users) {
      return { success: false, message: 'Could not load party members from the database' };
    }

    if (users.length !== memberIds.length) {
      return { success: false, message: 'Some party members are not registered' };
    }

    const usersById = new Map(users.map(user => [user.discordId, user]));
    const missingIgn = memberIds.filter(id => !usersById.get(id)?.ign);
    if (missingIgn.length > 0) {
      return { success: false, message: 'Some party members do not have a valid IGN' };
    }

    const blocked = users.filter(user => user.isBanned || user.isFrozen);
    if (blocked.length > 0) {
      return {
        success: false,
        message: `Banned or frozen party members: ${blocked.map(user => user.ign || user.discordId).join(', ')}`,
      };
    }

    const offline = users.filter(user => PresenceService.evaluate(user.ign) === 'offline');
    if (offline.length > 0) {
      return {
        success: false,
        message: `Party members offline in Minecraft: ${offline.map(user => user.ign || user.discordId).join(', ')}`,
      };
    }

    const queuedIds = this.findQueuedMembers(memberIds);
    if (queuedIds.length > 0) {
      return {
        success: false,
        message: `Party members already in a queue: ${queuedIds.map(id => usersById.get(id)?.ign || id).join(', ')}`,
      };
    }

    let activeGame: { gameId: number; isPrivate?: boolean; privatePartyId?: string } | null;
    try {
      activeGame = await Game.findOne({
        $or: [
          { team1: { $in: memberIds } },
          { team2: { $in: memberIds } },
        ],
        state: { $in: ACTIVE_GAME_STATES },
      }).select('gameId isPrivate privatePartyId').lean() as {
        gameId: number;
        isPrivate?: boolean;
        privatePartyId?: string;
      } | null;
    } catch (error) {
      console.error('[PrivateGameService] Error checking active games:', error);
      return { success: false, message: 'Could not verify whether party members are already in a game' };
    }

    if (activeGame) {
      return {
        success: false,
        message: activeGame.privatePartyId === partyId
          ? `Your party already has an active private game #${activeGame.gameId}`
          : `A party member is already in game #${activeGame.gameId}`,
      };
    }

    if (!guild) {
      return { success: false, message: 'Discord guild not available' };
    }

    const guildMembers = await Promise.all(memberIds.map(async (id) => {
      const cached = guild.members.cache?.get(id);
      if (cached) return cached;
      if (typeof guild.members.fetch !== 'function') return null;
      return guild.members.fetch(id).catch(() => null);
    }));
    const missingMembers = memberIds
      .filter((_, index) => !guildMembers[index])
      .map(id => usersById.get(id)?.ign || id);
    if (missingMembers.length > 0) {
      return { success: false, message: `Not in the Discord server: ${missingMembers.join(', ')}` };
    }

    const gameManager = wsManager.getGameManager();
    if (!gameManager) {
      return { success: false, message: 'Game manager is not available yet' };
    }

    const mapResult = await this.resolveMap(
      MapService.getSharedInstance(wsManager),
      options.map,
      memberIds.length,
    );
    if (!mapResult.map) {
      return { success: false, message: mapResult.error || 'No map is available for this private game' };
    }

    const players: PrivateGamePlayer[] = memberIds.map(id => ({
      discordId: id,
      ign: usersById.get(id)!.ign!,
      elo: typeof usersById.get(id)!.elo === 'number' ? usersById.get(id)!.elo! : 0,
    }));
    const { team1, team2 } = this.splitTeams(players);

    let gameId: number;
    try {
      const resources = await gameManager.createPrivateGame({
        partyId,
        map: mapResult.map,
        team1,
        team2,
      });
      gameId = resources.gameId;
    } catch (error) {
      console.error('[PrivateGameService] Error creating private game:', error);
      return { success: false, message: 'Failed to create the private game' };
    }

    try {
      await gameManager.initiateGameWarp(gameId);
    } catch (error) {
      console.error(`[PrivateGameService] Error starting private game ${gameId}:`, error);
      await gameManager.abortGame(gameId, 'Private game warp failed').catch(() => undefined);
      return { success: false, message: 'The private game could not be started and has been cancelled' };
    }

    return {
      success: true,
      gameId,
      map: mapResult.map,
      team1,
      team2,
    };
  }

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

  private static mapCapacity(map: MapInfo): number | undefined {
    return typeof map.maxplayers === 'number' ? map.maxplayers : undefined;
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

  private static mapKey(map: MapInfo): string {
    return map.physical_name ?? map.name;
  }

  private static async resolveMap(
    mapService: MapService,
    requested: string | undefined,
    playerCount: number,
  ): Promise<{ map?: string; error?: string }> {
    try {
      const maps = await mapService.getAllMaps();
      if (!maps.length) {
        return { error: 'No maps are currently available' };
      }

      const requestedName = (requested ?? '').trim();
      if (requestedName) {
        const normalized = requestedName.toLowerCase();
        const target = maps.find(map =>
          [map.name, map.physical_name]
            .filter((name): name is string => Boolean(name))
            .some(name => name.toLowerCase() === normalized),
        );
        if (!target) {
          return { error: `Map "${requestedName}" was not found` };
        }
        if (target.locked) {
          return { error: `Map "${requestedName}" is currently locked` };
        }
        const capacity = this.mapCapacity(target);
        if (capacity !== undefined && capacity !== playerCount) {
          return {
            error: `Map "${requestedName}" supports ${capacity} players, but this party has ${playerCount}`,
          };
        }
        const map = this.mapKey(target);
        mapService.claimMap(map);
        claimMapPick(map);
        return { map };
      }

      const eligible = maps.filter(map =>
        !map.locked && (this.mapCapacity(map) === undefined || this.mapCapacity(map) === playerCount),
      );
      if (!eligible.length) {
        return { error: `No available map supports ${playerCount} players` };
      }

      const recent = getRecentMapPicks();
      const open = eligible.filter(map => !recent.has(this.mapKey(map)));
      const pool = open.length > 0 ? open : eligible;
      const chosen = pool[Math.floor(Math.random() * pool.length)];
      const map = this.mapKey(chosen);
      mapService.claimMap(map);
      claimMapPick(map);
      return { map };
    } catch (error) {
      console.error('[PrivateGameService] Error resolving map:', error);
      return { error: 'Could not load available maps' };
    }
  }
}
