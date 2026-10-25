import { Client, TextChannel, Guild, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import type { MessageCreateOptions } from 'discord.js';
import Game, { IGame } from '../models/Game';
import User, { IUser } from '../models/User';
import EloRank, { IEloRank } from '../models/EloRank';
import { getNextSequence, Counter } from '../models/Counter';
import config from '../config/config';
import { GameState, GameResources, WarpRequestData, GameResult, VoidResult, PlayerData } from '../types/GameTypes';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { fix } from '../utils/fix';
import { normalizeTeams } from './utils';
import { generateScoreImageBuffer } from '../utils/scoreImage';
import {
  checkLevelUp,
  EXPERIENCE_REWARDS
} from '../utils/levelSystem';
import { WorkersManager } from '../managers/WorkersManager';
import { updateDailyElo } from '../utils/userStats';
import type { IRecentGame } from '../models/gameBase';
import type { ICombatEntry } from '../models/gameTypes';

interface PlayerScoreData {
  player: IUser;
  isWinner: boolean;
  isMvp: boolean;
  isBedBreaker: boolean;
  eloChange: number;
  elo_before: number;
  elo_after: number;
  stats: PlayerData;
  finalDeaths: number;
  experienceGained: number;
  level_before: number;
  level_after: number;
  leveledUp: boolean;
}

interface GameScoreContext {
  game: IGame;
  players: IUser[];
  eloRanks: IEloRank[];
  ignToId: Record<string, string>;
  idToIgn: Record<string, string>;
  mvpsIds: string[];
  bedbreaksIds: string[];
  winningTeam: number;
  playerData: Record<string, PlayerData>;
}

interface PlayerVoidData {
  player: IUser;
  isWinner: boolean;
  isMvp: boolean;
  isBedBreaker: boolean;
  eloChange: number;
  elo_before: number;
  elo_after: number;
  experienceToRevert: number;
  level_before: number;
  level_after: number;
  gameStats: VoidableGameStats | null;
}

interface VoidableGameStats {
  gameId: number;
  state: string;
  eloGain: number;
  elo_before?: number;
  elo_after?: number;
  oldElo?: number;
  newElo?: number;
  won?: boolean;
  isMvp?: boolean;
  ismvp?: boolean;
  kills: number;
  deaths: number;
  bedBroken: number;
  finalKills: number;
  finalDeaths?: number;
  map: string;
  diamonds?: number;
  irons?: number;
  gold?: number;
  emeralds?: number;
  blocksPlaced?: number;
  damageDealt?: number;
  damageTaken?: number;
  assists?: number;
  maxStreak?: number;
  firstBlood?: boolean;
}

interface QueueLike {
  id?: unknown;
  channelId: string;
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isRanked?: boolean;
  isPicking?: boolean;
  ispicking?: boolean;
  queueType?: string;
  bypassRoles: string[];
}

interface WarpEventMessage {
  type?: string;
  gameId?: string | number;
}

interface FightStatRow {
  kills?: number;
  damage_dealt?: number;
  damageDealt?: number;
  damage?: number;
}

interface GameVoidContext {
  game: IGame;
  players: IUser[];
  reason: string;
}

let cachedEloRanks: IEloRank[] | null = null;
let cachedEloRanksAt = 0;
let inFlightEloRanks: Promise<IEloRank[]> | null = null;
const ELO_RANK_CACHE_TTL_MS = 30000;

async function getCachedEloRanks(): Promise<IEloRank[]> {
  const now = Date.now();
  if (cachedEloRanks && now - cachedEloRanksAt < ELO_RANK_CACHE_TTL_MS) {
    return cachedEloRanks;
  }
  if (inFlightEloRanks) {
    return inFlightEloRanks;
  }
  inFlightEloRanks = (EloRank.find().sort({ startElo: 1 }) as unknown as Promise<IEloRank[]>)
    .then((ranks) => {
      cachedEloRanks = ranks;
      cachedEloRanksAt = Date.now();
      inFlightEloRanks = null;
      return ranks;
    })
    .catch((err) => {
      inFlightEloRanks = null;
      throw err;
    });
  return inFlightEloRanks;
}

const RECENT_GAMES_CAP = 50;

export class GameManager {
  private client: Client;
  private wsManager: WebSocketManager;
  
  private workersManager: WorkersManager;
  private activeGames: Map<number, GameResources> = new Map();
  private cleaningGames: Set<number> = new Set();
  private warpRequests: Map<string, WarpRequestData> = new Map();
  private readonly MAX_CONCURRENT_GAMES = 100;
  private readonly WARP_TIMEOUT = 60000;
  private readonly MAX_WARP_RETRIES = 3;
  private readonly WARP_RETRY_DELAY = 5000;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;
    
    this.workersManager = WorkersManager.getInstance();
    this.setupWarpHandlers();
  }

  private setupWarpHandlers(): void {
    const handlers = {
      'warp_success': this.handleWarpSuccess.bind(this),
      'warp_failed_arena_not_found': this.handleWarpFailedArena.bind(this),
      'warp_failed_offline_players': this.handleWarpFailedOffline.bind(this),
      'warp_failure_unknown': this.handleWarpFailureUnknown.bind(this),
      'retrygame': this.handleRetryGame.bind(this)
    };

    for (const [event, handler] of Object.entries(handlers)) {
      this.wsManager.setGlobalHandler(event, handler);
    }
  }

  public async createGame(
    gameId: number,
    queueData: Partial<QueueLike> | null,
    team1: string[],
    team2: string[],
    selectedMap: string
  ): Promise<GameResources> {
    let reserved = false;
    try {
      const raw1 = (team1 ?? []).map(id => (id ?? '').trim()).filter(Boolean);
      const raw2 = (team2 ?? []).map(id => (id ?? '').trim()).filter(Boolean);
      if (new Set(raw1).size !== raw1.length || new Set(raw2).size !== raw2.length) throw new Error('Duplicate players inside a team');
      if (raw1.some(id => raw2.includes(id))) throw new Error('Player cannot be on both teams');
      const teams = normalizeTeams(team1, team2);
      if (teams.team1.length === 0 || teams.team2.length === 0) throw new Error('Both teams must have at least one player');
      if (teams.team1.length !== teams.team2.length) throw new Error('Teams must be equal size');
      if (queueData?.maxPlayers && teams.team1.length * 2 !== queueData.maxPlayers) throw new Error(`Teams must match queue size ${queueData.maxPlayers}`);
      if (this.activeGames.has(gameId)) throw new Error(`Game ${gameId} is already being created`);
      if (this.activeGames.size >= this.MAX_CONCURRENT_GAMES) throw new Error('Server is at max concurrent games');
      this.activeGames.set(gameId, {} as GameResources);
      reserved = true;
      team1 = teams.team1;
      team2 = teams.team2;
      console.log(`[GameManager] Creating game ${gameId} with map ${selectedMap}`);
      const guild = await this.getGuild();
      if (!guild) throw new Error('Guild not found');
      const resources = await this.createGameResources(guild, gameId, selectedMap, [...team1, ...team2], queueData);
      await this.createGameInDatabaseAndUpdateUsers(resources, queueData as QueueLike, selectedMap, team1, team2);
      await this.movePlayersToVoiceChannels(guild, team1, team2, resources);
      this.activeGames.set(gameId, resources);
      console.log(`[GameManager] Successfully created game ${gameId}`);
      return resources;
    } catch (error) {
      if (reserved) this.activeGames.delete(gameId);
      console.error(`[GameManager] Error creating game ${gameId}:`, error);
      throw error;
    }
  }

  public async scoreGame(gameResult: GameResult): Promise<{
    gameId: number;
    winningTeam: number;
    mvps: string[];
    updatedPlayers: Array<{ discordId: string; elo: number }>
  }> {
    console.log(`[GameManager] Starting to score game ${gameResult.gameId}`);
    try {
      if (!gameResult.gameId) throw new Error('Invalid game result data - missing gameId');

      if (!gameResult.winningTeam && (!gameResult.winningTeamIGNs || gameResult.winningTeamIGNs.length === 0)) {
        throw new Error('Either winningTeam number or winningTeamIGNs must be provided');
      }

      const context = await this.loadGameContext(gameResult);

      if (context.winningTeam !== 1 && context.winningTeam !== 2) {
        throw new Error('Winning team must be 1 or 2');
      }
      await this.validateGameForScoring(context.game);

      const combatEntries = this.buildCombatEntries(context);

      const claimedGame = await this.claimGameForSettling(context.game.gameId, (game) => {
        game.state = GameState.SCORED;
        game.mvps = context.mvpsIds;
        game.bedbreaks = context.bedbreaksIds;
        game.reason = gameResult.reason || '';
        game.timeline = gameResult.timeline || [];
        game.winners = (context.winningTeam === 1 ? game.team1 : game.team2);
        game.losers = (context.winningTeam === 1 ? game.team2 : game.team1);
        game.combat = combatEntries;
        game.endTime = new Date();
      });
      context.game = claimedGame;

      const playerScoreData = await this.processAllPlayers(context);

      await this.updatePlayerStats(playerScoreData, context.game);

      await this.sendScoreNotifications(context, playerScoreData);

      try {
        await this.updatePlayerRoles(playerScoreData);
      } catch (e) {
        console.warn('[GameManager] Skipping role updates due to error (non-blocking):', e);
      }
      try {
        const allPlayerIGNs = context.players.map(p => p.ign).filter(Boolean);
        if (allPlayerIGNs.length > 0) {
          this.wsManager.send({
            type: 'scoringsuccess',
            game_id: gameResult.gameId,
            players: allPlayerIGNs
          });
        }
      } catch (e) {
        console.error('[GameManager] Failed to send scoringsuccess:', e);
      }
      await this.scheduleGameChannelCleanup(context.game, gameResult.gameId);
      await this.cleanupGame(gameResult.gameId);
      console.log(`[GameManager] Successfully scored game ${gameResult.gameId}`);
      return {
        gameId: gameResult.gameId,
        winningTeam: context.winningTeam,
        mvps: context.mvpsIds.map(id => context.idToIgn[id] ?? id),
        updatedPlayers: context.players.map(p => ({ discordId: p.discordId, elo: p.elo }))
      };
    } catch (error) {
      console.error(`[GameManager] Error scoring game ${gameResult.gameId}:`, error);
      throw error;
    }
  }

  
  public async voidGame(gameId: number, reason: string): Promise<VoidResult> {
    console.log(`[GameManager] Starting to void game ${gameId}: ${reason}`);
    try {
      if (!gameId || !reason) throw new Error('Invalid void parameters');
      const context = await this.loadGameVoidContext(gameId, reason);
      await this.validateGameForVoiding(context.game);

      const playerVoidData = await this.processAllPlayersForVoiding(context);

      const claimedGame = await this.claimGameForSettling(gameId, (game) => {
        game.state = GameState.VOIDED;
        game.reason = reason;
        game.mvps = [];
        game.winners = [];
        game.losers = [];
        game.bedbreaks = [];
        game.endTime = new Date();
      });
      context.game = claimedGame;

      await this.revertPlayerStats(playerVoidData, gameId);
      await this.updatePlayerRolesForVoid(playerVoidData);
      await this.sendVoidNotifications(context, playerVoidData);
      try {
        const allPlayerIGNs = context.players.map(p => p.ign).filter(Boolean);
        if (allPlayerIGNs.length > 0) {
          this.wsManager.send({
            type: 'gamevoided',
            game_id: gameId,
            players: allPlayerIGNs,
            reason
          });
        }
      } catch (e) {
        console.error('[GameManager] Failed to send gamevoided:', e);
      }
      await this.scheduleGameChannelCleanup(context.game, gameId);
      await this.cleanupGame(gameId);
      console.log(`[GameManager] Successfully voided game ${gameId}`);
      return {
        gameId,
        reason,
        revertedPlayers: playerVoidData.map(p => ({ discordId: p.player.discordId, elo: p.elo_after }))
      };
    } catch (error) {
      console.error(`[GameManager] Error voiding game ${gameId}:`, error);
      throw error;
    }
  }

  public async getNextGameId(): Promise<number> {
    try {
      return await getNextSequence('gameId');
    } catch (error) {
      console.error('[GameManager] Error getting next game ID:', error);
      const lastGame = await Game.findOne().sort({ gameId: -1 }).select('gameId');
      const nextId = (lastGame?.gameId || 0) + 1;
      try {
        await Counter.updateOne({ _id: 'gameId' }, { $max: { seq: nextId } }, { upsert: true });
      } catch (counterError) {
        console.error('[GameManager] Failed to persist fallback game ID counter:', counterError);
      }
      return nextId;
    }
  }

  public getActiveGameCount(): number {
    return this.activeGames.size;
  }

  public async updateGameMap(gameId: number, newMap: string): Promise<void> {
    try {
      await Game.updateOne({ gameId }, { map: newMap });

      const resources = this.activeGames.get(gameId);
      if (resources && resources.game) {
        resources.game.map = newMap;
      }

      console.log(`[GameManager] Updated game ${gameId} map to: ${newMap}`);
    } catch (error) {
      console.error(`[GameManager] Error updating game ${gameId} map:`, error);
      throw error;
    }
  }

  public async initiateGameWarp(gameId: number): Promise<void> {
    try {
      const resources = this.activeGames.get(gameId);
      if (!resources || !resources.game) {
        throw new Error(`Game ${gameId} not found in active games`);
      }

      const game = resources.game;
      const team1IGNs = await this.getPlayerIGNs(game.team1);
      const team2IGNs = await this.getPlayerIGNs(game.team2);

      this.sendWarpRequest(gameId.toString(), game.map, game.isRanked || false, team1IGNs, team2IGNs);

      console.log(`[GameManager] Initiated warp request for game ${gameId} with map ${game.map}`);
    } catch (error) {
      console.error(`[GameManager] Error initiating game warp for ${gameId}:`, error);
      throw error;
    }
  }

  private async createGameResources(
    guild: Guild,
    gameId: number,
    selectedMap: string,
    allPlayers: string[],
    _queue: Partial<QueueLike> | null
  ): Promise<GameResources> {
    try {
      console.log(`[GameManager] Creating game resources for game ${gameId} using WorkersManager`);

      const [gameChannel, team1Voice, team2Voice] = await Promise.all([
        this.workersManager.createChannel({
          name: `game-${gameId}`,
          type: ChannelType.GuildText,
          parent: config.categories.gameCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            ...allPlayers.map(playerId => ({
              id: playerId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
              ]
            }))
          ]
        }, 9),  

        this.workersManager.createChannel({
          name: `Team 1 - Game ${gameId}`,
          type: ChannelType.GuildVoice,
          parent: config.categories.voiceCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
              allow: [PermissionFlagsBits.Speak]
            },
            ...allPlayers.map(playerId => ({
              id: playerId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.UseVAD,
                PermissionFlagsBits.Stream
              ]
            }))
          ]
        }, 8),  

        this.workersManager.createChannel({
          name: `Team 2 - Game ${gameId}`,
          type: ChannelType.GuildVoice,
          parent: config.categories.voiceCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
              allow: [PermissionFlagsBits.Speak]
            },
            ...allPlayers.map(playerId => ({
              id: playerId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.UseVAD,
                PermissionFlagsBits.Stream
              ]
            }))
          ]
        }, 8) 
      ]);

      console.log(`[GameManager] Successfully created all channels for game ${gameId}`);

      return {
        gameId,
        gameChannel,
        team1Voice,
        team2Voice,
        game: null
      };

    } catch (error) {
      console.error(`[GameManager] Error creating game resources for game ${gameId}:`, error);
      throw error;
    }
  }

  
  private async createGameInDatabaseAndUpdateUsers(
    resources: GameResources,
    queue: QueueLike,
    selectedMap: string,
    team1: string[],
    team2: string[]
  ): Promise<void> {
    try {
      const partiesInGame = await this.getPartiesInGame(team1, team2);
      const startTime = new Date();
      const game = new Game({
        gameId: resources.gameId,
        map: selectedMap,
        team1,
        team2,
        winners: [],
        losers: [],
        mvps: [],
        bedbreaks: [],
        startTime,
        state: GameState.PENDING,
        channels: {
          text: resources.gameChannel.id,
          team1Voice: resources.team1Voice.id,
          team2Voice: resources.team2Voice.id
        },
        queueId: queue.channelId,
        isRanked: queue.isRanked || false,
        partiesInThisGame: partiesInGame,
        reason: ''
        });
      await game.save();
      resources.game = game;
      const allPlayers = [...team1, ...team2];
      const queueIdStr = String(typeof queue.id === 'number' ? queue.id : parseInt(String(queue.id), 10));
      const UserModel = User as unknown as {
        bulkWrite?: (ops: Record<string, unknown>[]) => Promise<unknown>;
      };
      if (typeof UserModel.bulkWrite === 'function') {
        const pendingEntry = {
          gameId: resources.gameId,
          queueId: queueIdStr,
          map: selectedMap,
          eloGain: 0,
          kills: 0,
          deaths: 0,
          bedBroken: 0,
          finalKills: 0,
          date: startTime,
          state: 'pending',
          startTime,
          won: false,
          isMvp: false
        };
        const ops = allPlayers.map((discordId) => ({
          updateOne: {
            filter: { discordId },
            update: {
              $inc: { games: 1 },
              $push: { recentGames: { $each: [pendingEntry], $position: 0, $slice: RECENT_GAMES_CAP } }
            }
          }
        }));
        await UserModel.bulkWrite(ops);
        console.log(`[GameManager] Game ${resources.gameId} saved to database and users updated`);
        return;
      }
      const users = await User.find({ discordId: { $in: allPlayers } });
      const updatePromises = users.map(async (user) => {
        user.games = (user.games || 0) + 1;
        user.recentGames = user.recentGames || [];
        user.recentGames.unshift({
          gameId: resources.gameId,
          queueId: queueIdStr,
          map: selectedMap,
          eloGain: 0,
          kills: 0,
          deaths: 0,
          bedBroken: 0,
          finalKills: 0,
          date: startTime,
          state: 'pending',
          startTime: startTime,
          won: false,
          isMvp: false
        });
        if (user.recentGames.length > RECENT_GAMES_CAP) {
          user.recentGames = user.recentGames.slice(0, RECENT_GAMES_CAP);
        }
        await user.save();
      });
      await Promise.allSettled(updatePromises);
      console.log(`[GameManager] Game ${resources.gameId} saved to database and users updated`);
    } catch (error) {
      console.error(`[GameManager] Error creating game in database and updating users:`, error);
      throw error;
    }
  }

  private async getPartiesInGame(team1: string[], team2: string[]): Promise<string> {
    try {
      const allPlayers = [...team1, ...team2];
      const users = await User.find({
        discordId: { $in: allPlayers },
        partyId: { $exists: true, $ne: null }
      }).select('partyId');

      const partyIds = [...new Set(users.map(u => u.partyId).filter(Boolean))];
      return partyIds.join(',');
    } catch (error) {
      console.error('[GameManager] Error getting parties in game:', error);
      return '';
    }
  }

  private async movePlayersToVoiceChannels(
    guild: Guild,
    team1: string[],
    team2: string[],
    resources: GameResources
  ): Promise<void> {
    try {
      const movePromises = [
        this.movePlayersToVoice(guild, team1, resources.team1Voice.id),
        this.movePlayersToVoice(guild, team2, resources.team2Voice.id)
      ];

      await Promise.allSettled(movePromises);
      console.log(`[GameManager] Moved players to voice channels for game ${resources.gameId}`);

    } catch (error) {
      console.error(`[GameManager] Error moving players to voice channels:`, error);
    }
  }

  private async movePlayersToVoice(guild: Guild, playerIds: string[], voiceChannelId: string): Promise<void> {
    try {
      console.log(`[GameManager] Moving ${playerIds.length} players to voice channel ${voiceChannelId} using WorkersManager`);

      await this.workersManager.moveMembers(playerIds, voiceChannelId, 7);  

      console.log(`[GameManager] Successfully moved players to voice channel`);
    } catch (error) {
      console.error('[GameManager] Error in movePlayersToVoice:', error);
    }
  }




  private async initiatePlayerWarp(
    resources: GameResources,
    selectedMap: string,
    queue: QueueLike,
    team1: string[],
    team2: string[]
  ): Promise<void> {
    try {
      const team1IGNs = await this.getPlayerIGNs(team1);
      const team2IGNs = await this.getPlayerIGNs(team2);


      this.wsManager.send({
        type: 'warp_players',
        game_id: resources.gameId.toString(),
        map: selectedMap,
        is_ranked: queue.isRanked || false,
        team1: {
          players: team1IGNs
        },
        team2: {
          players: team2IGNs
        }
      });

      console.log(`[GameManager] Initiated warp request for game ${resources.gameId}`);

    } catch (error) {
      console.error(`[GameManager] Error initiating player warp:`, error);
      throw error;
    }
  }

  private async getPlayerIGNs(playerIds: string[]): Promise<string[]> {
    try {
      const users = await User.find({
        discordId: { $in: playerIds }
      }).select('discordId ign');

      const ignMap = new Map(users.map(u => [u.discordId, u.ign]));
      return playerIds.map(id => ignMap.get(id)).filter(Boolean) as string[];

    } catch (error) {
      console.error('[GameManager] Error getting player IGNs:', error);
      return [];
    }
  }

  private sendWarpRequest(
    gameId: string,
    map: string,
    isRanked: boolean,
    team1IGNs: string[],
    team2IGNs: string[]
  ): void {
    try {
      const warpData: WarpRequestData = {
        gameId,
        timeout: setTimeout(() => this.handleWarpTimeout(gameId), this.WARP_TIMEOUT),
        attempts: 0,
        team1IGNs,
        team2IGNs,
        map,
        isRanked,
        timestamp: Date.now()
      };

      this.warpRequests.set(gameId, warpData);


      this.wsManager.send({
        type: 'warp_players',
        game_id: gameId,
        map,
        is_ranked: isRanked,
        team1: {
          players: team1IGNs
        },
        team2: {
          players: team2IGNs
        }
      });

      console.log(`[GameManager] Sent warp request for game ${gameId}`);

    } catch (error) {
      console.error(`[GameManager] Error sending warp request for game ${gameId}:`, error);
    }
  }


  private async handleWarpSuccess(msg: WarpEventMessage): Promise<void> {
    try {
      const { gameId } = msg;
      if (!gameId || isNaN(Number(gameId))) {
        console.error('[GameManager] handleWarpSuccess: Invalid or missing gameId in msg:', msg);
        return;
      }
      console.log(`[GameManager] Warp successful for game ${gameId}`);

      const warpData = this.warpRequests.get(gameId as string);
      if (warpData) {
        clearTimeout(warpData.timeout);
        this.warpRequests.delete(gameId as string);
      }

      const game = await Game.findOne({ gameId: Number(gameId) });
      if (game) {
        game.state = GameState.PENDING;
        await game.save();
      }

    } catch (error) {
      console.error('[GameManager] Error handling warp success:', error);
    }
  }

  private async handleWarpFailedArena(msg: WarpEventMessage): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Warp failed (arena not found) for game ${gameId}`);
      await this.handleWarpFailure(gameId as string, 'Arena not found');
    } catch (error) {
      console.error('[GameManager] Error handling arena not found:', error);
    }
  }

  private async handleWarpFailedOffline(msg: WarpEventMessage): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Warp failed (offline players) for game ${gameId}`);
      await this.handleWarpFailure(gameId as string, 'Some players are offline');
    } catch (error) {
      console.error('[GameManager] Error handling offline players:', error);
    }
  }

  private async handleWarpFailureUnknown(msg: WarpEventMessage): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Warp failed (unknown reason) for game ${gameId}`);
      await this.handleWarpFailure(gameId as string, 'Unknown warp failure');
    } catch (error) {
      console.error('[GameManager] Error handling unknown warp failure:', error);
    }
  }

  private async handleWarpTimeout(gameId: string): Promise<void> {
    try {
      console.log(`[GameManager] Warp timeout for game ${gameId}`);
      await this.handleWarpFailure(gameId, 'Warp timeout');
    } catch (error) {
      console.error('[GameManager] Error handling warp timeout:', error);
    }
  }

  private async handleWarpFailure(gameId: string, reason: string): Promise<void> {
    try {
      const warpData = this.warpRequests.get(gameId);
      if (!warpData) return;

      if (warpData.retrying) {
        console.log(`[GameManager] Warp retry already in progress for game ${gameId}, ignoring duplicate failure`);
        return;
      }

      clearTimeout(warpData.timeout);

      if (warpData.attempts < this.MAX_WARP_RETRIES) {

        warpData.attempts++;
        warpData.retrying = true;
        warpData.timeout = setTimeout(() => this.handleWarpTimeout(gameId), this.WARP_TIMEOUT);
        console.log(`[GameManager] Retrying warp for game ${gameId} (attempt ${warpData.attempts})`);

        setTimeout(() => {
          warpData.retrying = false;
          this.wsManager.send({
            type: 'warp_players',
            game_id: gameId,
            map: warpData.map,
            is_ranked: warpData.isRanked,
            team1: {
              players: warpData.team1IGNs
            },
            team2: {
              players: warpData.team2IGNs
            }
          });
          console.log(`[GameManager] Sent warp request for game ${gameId} (retry)`);
        }, this.WARP_RETRY_DELAY);

      } else {

        console.log(`[GameManager] Max warp retries reached for game ${gameId}, voiding game`);
        this.warpRequests.delete(gameId);
        await this.voidGame(parseInt(gameId), `Warp failed: ${reason}`);
      }

    } catch (error) {
      console.error(`[GameManager] Error handling warp failure for game ${gameId}:`, error);
    }
  }

  private async handleRetryGame(msg: WarpEventMessage): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Retry game request for game ${gameId}`);

      const warpData = this.warpRequests.get(gameId as string);
      if (warpData) {
        this.wsManager.send({
          type: 'warp_players',
          game_id: gameId,
          map: warpData.map,
          is_ranked: warpData.isRanked,
          team1: {
            players: warpData.team1IGNs
          },
          team2: {
            players: warpData.team2IGNs
          }
        });
        console.log(`[GameManager] Sent warp request for game ${gameId} (retry)`);
      }

    } catch (error) {
      console.error('[GameManager] Error handling retry game:', error);
    }
  }

  private async cleanupGame(gameId: number): Promise<void> {
    try {
      const resources = this.activeGames.get(gameId);
      if (!resources) return;

      this.activeGames.delete(gameId);
      this.cleaningGames.add(gameId);

      this.warpRequests.delete(gameId.toString());

      setTimeout(async () => {
        try {
          const deletions: Array<Promise<unknown>> = [];
          if (resources.gameChannel) {
            deletions.push(this.workersManager.deleteChannel(resources.gameChannel.id, 2));
          }
          if (resources.pickingChannel) {
            deletions.push(this.workersManager.deleteChannel(resources.pickingChannel.id, 2));
          }
          if (resources.team1Voice) {
            deletions.push(this.workersManager.deleteChannel(resources.team1Voice.id, 2));
          }
          if (resources.team2Voice) {
            deletions.push(this.workersManager.deleteChannel(resources.team2Voice.id, 2));
          }
          await Promise.allSettled(deletions);
        } catch (error) {
          console.error(`[GameManager] Error cleaning up channels for game ${gameId}:`, error);
        } finally {
          this.cleaningGames.delete(gameId);
        }
      }, 30000);

      console.log(`[GameManager] Cleaned up game ${gameId}`);

    } catch (error) {
      console.error(`[GameManager] Error cleaning up game ${gameId}:`, error);
    }
  }

  private async getGuild(): Promise<Guild | null> {
    try {
      return this.client.guilds.cache.first() || null;
    } catch (error) {
      console.error('[GameManager] Error getting guild:', error);
      return null;
    }
  }

  private async getGamesChannel(): Promise<TextChannel | null> {
    try {
      const channel = this.client.channels.cache.get(config.channels.gamesChannel);
      return channel instanceof TextChannel ? channel : null;
    } catch (error) {
      console.error('[GameManager] Error getting games channel:', error);
      return null;
    }
  }

  private async updateUserRecentGames(
    gameId: number,
    team1: string[],
    team2: string[],
    queueData: QueueLike,
    selectedMap: string,
    startTime: Date
  ): Promise<void> {
    try {
      const allPlayers = [...team1, ...team2];
      console.log(`[GameManager] Updating recent games for ${allPlayers.length} players in game ${gameId}`);

      const updatePromises = allPlayers.map(async (discordId) => {
        try {
          const user = await User.findOne({ discordId });
          if (!user) {
            console.warn(`[GameManager] User not found for ID: ${discordId} when updating recent games`);
            return;
          }

          user.games += 1;

          const recentGame = {
            gameId,
            queueId: String(typeof queueData.id === 'number' ? queueData.id : parseInt(String(queueData.id), 10)),
            map: selectedMap,
            eloGain: 0,
            kills: 0,
            deaths: 0,
            bedBroken: 0,
            finalKills: 0,
            date: startTime,
            state: 'pending',
            startTime: startTime,
            won: false,
            isMvp: false
          };

          user.recentGames.unshift(recentGame);



          if (user.recentGames.length > RECENT_GAMES_CAP) {
            user.recentGames = user.recentGames.slice(0, RECENT_GAMES_CAP);
          }

          await user.save();
          console.log(`[GameManager] Updated recent games for user ${user.ign || discordId}`);
        } catch (error) {
          console.error(`[GameManager] Error updating user ${discordId} recent games:`, error);
        }
      });

      await Promise.allSettled(updatePromises);
      console.log(`[GameManager] Completed updating recent games for game ${gameId}`);
    } catch (error) {
      console.error(`[GameManager] Error updating user recent games:`, error);
    }
  }

  public cleanup(): void {
    try {

      for (const warpData of this.warpRequests.values()) {
        clearTimeout(warpData.timeout);
      }
      this.warpRequests.clear();

      

      console.log('[GameManager] Cleanup completed');
    } catch (error) {
      console.error('[GameManager] Error during cleanup:', error);
    }
  }

  private async loadGameWithPlayers(gameId: number) {
    const game = await Game.findOne({ gameId });
    if (!game) {
      throw new Error(`Game ${gameId} not found`);
    }

    const allPlayerIds = [...game.team1, ...game.team2];
    const players = await User.find({ discordId: { $in: allPlayerIds } });

    if (players.length !== allPlayerIds.length) {
      throw new Error('Some players not found in database');
    }

    return { game, players };
  }

  private async loadGameContext(gameResult: GameResult): Promise<GameScoreContext> {
    try {
      const { game, players } = await this.loadGameWithPlayers(gameResult.gameId);


      const eloRanks = await getCachedEloRanks();


      const ignToId: Record<string, string> = {};
      const idToIgn: Record<string, string> = {};

      for (const player of players) {
        if (player.ign) {
          ignToId[player.ign.toLowerCase()] = player.discordId;
          idToIgn[player.discordId] = player.ign;
        }
      }

      let winningTeam = gameResult.winningTeam;

      if (gameResult.winningTeamIGNs && gameResult.winningTeamIGNs.length > 0) {
        const winningPlayerIds = gameResult.winningTeamIGNs
          .map(ign => ignToId[String(ign).toLowerCase()])
          .filter(Boolean);

        if (winningPlayerIds.length === 0) {
          throw new Error(`Winning team could not be determined from IGNs: ${gameResult.winningTeamIGNs.join(', ')}`);
        }

        if (winningPlayerIds.length > 0) {
          const team1Winners = winningPlayerIds.filter(id => game.team1.includes(id));
          const team2Winners = winningPlayerIds.filter(id => game.team2.includes(id));

          if (team1Winners.length > team2Winners.length) {
            winningTeam = 1;
          } else if (team2Winners.length > team1Winners.length) {
            winningTeam = 2;
          } else if (team1Winners.length > 0) {
            winningTeam = 1;
          } else {
            throw new Error('Winning team could not be determined from IGNs');
          }

          console.log(`[GameManager] Determined winning team ${winningTeam} from IGNs: ${gameResult.winningTeamIGNs.join(', ')}`);
        }
      }

      if (winningTeam !== 1 && winningTeam !== 2) {
        throw new Error('Winning team must be 1 or 2');
      }

      const mvpsIds = (gameResult.mvps || []).map(ign => ignToId[String(ign).toLowerCase()]).filter(Boolean);
      const bedbreaksIds = (gameResult.bedbreaks || []).map(ign => ignToId[String(ign).toLowerCase()]).filter(Boolean);

      const playerData: Record<string, PlayerData> = {};
      for (const [ign, data] of Object.entries(gameResult.playerData || {})) {
        playerData[ign.toLowerCase()] = data;
      }

      return {
        game,
        players,
        eloRanks,
        ignToId,
        idToIgn,
        mvpsIds,
        bedbreaksIds,
        winningTeam,
        playerData
      };

    } catch (error) {
      console.error('[GameManager] Error loading game context:', error);
      throw error;
    }
  }

  private async validateGameForScoring(game: IGame): Promise<void> {
    if (!game) {
      throw new Error('Game not found');
    }

    if (!game.team1 || !game.team2 || game.team1.length === 0 || game.team2.length === 0) {
      throw new Error('Game has invalid team data');
    }
  }

  /**
   * Atomically claims a game for scoring/voiding so that concurrent callers
   * can never settle the same game twice. The transition itself is performed
   * with a conditional findOneAndUpdate; exactly one caller wins, the rest get
   * an error. Returns the claimed (pre-transition) game document.
   */
  private async claimGameForSettling(gameId: number, mutate: (game: IGame) => void): Promise<IGame> {
    const claimed = await Game.findOneAndUpdate(
      { gameId, state: GameState.PENDING },
      { $set: { endTime: new Date(), state: GameState.SCORING } },
      { new: true }
    );
    if (!claimed) {
      throw new Error(`Game ${gameId} is already settled (scored or voided)`);
    }
    mutate(claimed);
    await claimed.save();
    return claimed;
  }

  private buildCombatEntries(context: GameScoreContext): ICombatEntry[] {
    try {
      const statsByIgn: Record<string, PlayerData> = {};
      for (const [key, value] of Object.entries(context.playerData || {})) {
        statsByIgn[String(key).toLowerCase()] = value as PlayerData;
      }
      const fightsOf = (ign: string): Record<string, FightStatRow> => {
        const stats = statsByIgn[ign.toLowerCase()];
        return (stats && stats.fights && typeof stats.fights === 'object') ? stats.fights : {};
      };
      return context.players.map((player) => {
        const ign = context.idToIgn[player.discordId] || '';
        const stats = statsByIgn[ign.toLowerCase()] || {};
        const ownFights = fightsOf(ign);
        const fights = Object.entries(ownFights).slice(0, 16).map(([opponent, row]) => {
          const mirrorRows = fightsOf(opponent);
          const mirrorKey = Object.keys(mirrorRows).find((k) => k.toLowerCase() === ign.toLowerCase());
          const mirrorRow = mirrorKey ? mirrorRows[mirrorKey] : undefined;
          const rowDamage = row.damage_dealt ?? row.damageDealt ?? row.damage ?? 0;
          const mirrorDamage = mirrorRow?.damage_dealt ?? mirrorRow?.damageDealt ?? mirrorRow?.damage;
          return {
            opponent,
            kills: row.kills || 0,
            deaths: mirrorRow && typeof mirrorRow.kills === 'number' ? mirrorRow.kills : 0,
            damageDealt: typeof rowDamage === 'number' && rowDamage >= 0 ? rowDamage : 0,
            damageTaken: typeof mirrorDamage === 'number' ? mirrorDamage : 0,
          };
        });
        const num = (v: unknown): number => (typeof v === 'number' && v >= 0 ? v : 0);
        return {
          player: player.discordId,
          kills: num(stats.kills),
          deaths: num(stats.deaths),
          damageDealt: num(stats.damageDealt),
          damageTaken: num(stats.damageTaken),
          assists: num(stats.assists),
          maxStreak: num(stats.maxStreak),
          firstBlood: stats.firstBlood === true,
          fights,
        };
      });
    } catch (error) {
      console.error('[GameManager] Error building combat entries:', error);
      return [];
    }
  }

  private async processAllPlayers(context: GameScoreContext): Promise<PlayerScoreData[]> {
    try {
      const playerScoreData: PlayerScoreData[] = [];

      for (const player of context.players) {
        const scoreData = await this.processPlayerScore(player, context);
        playerScoreData.push(scoreData);
      }

      return playerScoreData;
    } catch (error) {
      console.error('[GameManager] Error processing players:', error);
      throw error;
    }
  }

  private async processPlayerScore(player: IUser, context: GameScoreContext): Promise<PlayerScoreData> {
    try {
      const isWinner = (context.winningTeam === 1 && context.game.team1.includes(player.discordId)) ||
        (context.winningTeam === 2 && context.game.team2.includes(player.discordId));
      const isMvp = context.mvpsIds.includes(player.discordId);
      const isBedBreaker = context.bedbreaksIds.includes(player.discordId);

      const rank = context.eloRanks.find(r => player.elo >= r.startElo && player.elo <= r.endElo);

      let eloChange = 0;
      if (rank) {
        eloChange = this.calculateScoreElo(player, rank, isWinner, isMvp, isBedBreaker);
      }

      const playerIgn = context.idToIgn[player.discordId];
      const stats = { ...(playerIgn ? context.playerData[playerIgn.toLowerCase()] || {} : {}) };
      if (isBedBreaker) {
        stats.bedBroken = Math.max(typeof stats.bedBroken === 'number' ? stats.bedBroken : 0, 1);
      }

      return this.buildPlayerScoreData(player, isWinner, isMvp, isBedBreaker, eloChange, stats);
    } catch (error) {
      console.error('[GameManager] Error processing player:', error);
      throw error;
    }
  }

  private buildPlayerScoreData(
    player: IUser, isWinner: boolean, isMvp: boolean, isBedBreaker: boolean,
    eloChange: number, stats: PlayerData & { finalDeaths?: unknown; finaldeaths?: unknown }
  ) {
    const experienceGained = this.calculateExperienceGained(isWinner, isMvp, isBedBreaker, stats);
    const oldExperience = player.experience || 0;
    const newExperience = oldExperience + experienceGained;
    const levelUpInfo = checkLevelUp(oldExperience, newExperience);

    const finalDeaths = typeof stats.finalDeaths === 'number'
      ? stats.finalDeaths
      : (typeof stats.finaldeaths === 'number' ? stats.finaldeaths : 0);

    return {
      player,
      isWinner,
      isMvp,
      isBedBreaker,
      eloChange,
      elo_before: player.elo,
      elo_after: Math.max(0, player.elo + eloChange),
      stats,
      finalDeaths,
      experienceGained,
      level_before: levelUpInfo.level_before ?? levelUpInfo.oldLevel,
      level_after: levelUpInfo.level_after ?? levelUpInfo.newLevel,
      leveledUp: levelUpInfo.leveledUp
    };
  }

  private calculateScoreElo(
    player: IUser,
    rank: IEloRank,
    isWinner: boolean,
    isMvp: boolean,
    isBedBreaker: boolean = false
  ): number {
    try {
      let eloChange = 0;


      if (isWinner) {
        eloChange = rank.winElo || 0;
      } else {
        eloChange = -(rank.loseElo || 0);
      }


      if (isMvp) {
        eloChange += rank.mvpElo || 0;
      }


      if (isBedBreaker) {
        eloChange += rank.bedElo || 0;
      }

      return eloChange;
    } catch (error) {
      console.error('[GameManager] Error calculating ELO change:', error);
      return 0;
    }
  }

  private calculateExperienceGained(
    isWinner: boolean,
    isMvp: boolean,
    isBedBreaker: boolean,
    stats: { kills?: number; finalKills?: number }
  ): number {
    try {
      let experience = 0;

      if (isWinner) {
        experience += EXPERIENCE_REWARDS.WIN;
      } else {
        experience += EXPERIENCE_REWARDS.LOSS;
      }

      
      if (isMvp) {
        experience += EXPERIENCE_REWARDS.MVP;
      }

      
      if (isBedBreaker) {
        experience += EXPERIENCE_REWARDS.BED_BREAK;
      }

      
      if (typeof stats.kills === 'number') {
        experience += stats.kills * EXPERIENCE_REWARDS.KILL;
      }

      if (typeof stats.finalKills === 'number') {
        experience += stats.finalKills * EXPERIENCE_REWARDS.FINAL_KILL;
      }

      return Math.max(0, experience);
    } catch (error) {
      console.error('[GameManager] Error calculating experience gained:', error);
      return 0;
    }
  }

  private buildRecentGameEntry(scoreData: PlayerScoreData, game: IGame, now: Date): IRecentGame {
    return {
      gameId: game.gameId,
      queueId: String(parseInt(game.queueId, 10)),
      map: game.map,
      eloGain: scoreData.eloChange,
      elo_before: scoreData.elo_before,
      elo_after: scoreData.elo_after,
      kills: scoreData.stats.kills || 0,
      deaths: scoreData.stats.deaths || 0,
      bedBroken: scoreData.stats.bedBroken || 0,
      finalKills: scoreData.stats.finalKills || 0,
      finalDeaths: scoreData.finalDeaths || 0,
      won: scoreData.isWinner,
      isMvp: scoreData.isMvp,
      date: now,
      state: 'scored',
      startTime: game.startTime,
      endTime: now,
      diamonds: scoreData.stats.diamonds || 0,
      irons: scoreData.stats.irons || 0,
      gold: scoreData.stats.gold || 0,
      emeralds: scoreData.stats.emeralds || 0,
      blocksPlaced: scoreData.stats.blocksPlaced || 0,
      damageDealt: scoreData.stats.damageDealt || 0,
      damageTaken: scoreData.stats.damageTaken || 0,
      assists: scoreData.stats.assists || 0,
      maxStreak: scoreData.stats.maxStreak || 0,
      firstBlood: scoreData.stats.firstBlood === true,
      fights: scoreData.stats.fights ? Object.keys(scoreData.stats.fights).length : 0
    };
  }

  private applyScoreDataToPlayer(player: IUser, scoreData: PlayerScoreData, game: IGame, gameDurationSeconds: number): IRecentGame {
    const now = new Date();
    player.elo = scoreData.elo_after;

    player.experience = (player.experience || 0) + scoreData.experienceGained;
    player.level = scoreData.level_after;

    if (scoreData.isWinner) {
      player.wins = (player.wins || 0) + 1;
      player.winStreak = (player.winStreak || 0) + 1;
      player.loseStreak = 0;
    } else {
      player.losses = (player.losses || 0) + 1;
      player.loseStreak = (player.loseStreak || 0) + 1;
      player.winStreak = 0;
    }

    if (scoreData.isMvp) {
      player.mvps = (player.mvps || 0) + 1;
    }

    this.updatePlayerGameStats(player, scoreData.stats);

    player.finalDeaths = (player.finalDeaths || 0) + (scoreData.finalDeaths || 0);
    player.playtimeSeconds = (player.playtimeSeconds || 0) + gameDurationSeconds;
    player.peakElo = Math.max(player.peakElo || 0, scoreData.elo_after);

    player.kdr = player.deaths && player.deaths > 0 ? player.kills / player.deaths : player.kills;
    player.wlr = player.losses && player.losses > 0 ? player.wins / player.losses : player.wins;

    const entry = this.buildRecentGameEntry(scoreData, game, now);
    if (!player.recentGames) player.recentGames = [];
    const idx = player.recentGames.findIndex((g) => g.gameId === game.gameId);
    if (idx !== -1) {
      player.recentGames[idx] = entry;
    } else {
      player.recentGames.unshift(entry);
    }
    if (player.recentGames.length > RECENT_GAMES_CAP) {
      player.recentGames = player.recentGames.slice(0, RECENT_GAMES_CAP);
    }

    this.updatePlayerDailyEloSync(player);

    return entry;
  }

  private updatePlayerDailyEloSync(player: IUser): void {
    try {
      if (!player.dailyElo) {
        player.dailyElo = [];
      }
      updateDailyElo(player, player.elo);
      if (player.dailyElo.length > 30) {
        player.dailyElo = player.dailyElo.slice(-30);
      }
    } catch (error) {
      console.error(`[GameManager] Error updating daily ELO for ${player.discordId}:`, error);
    }
  }

  private scalarSetsForScoredPlayer(player: IUser): Record<string, unknown> {
    return {
      elo: player.elo,
      experience: player.experience,
      level: player.level,
      wins: player.wins,
      losses: player.losses,
      winStreak: player.winStreak,
      loseStreak: player.loseStreak,
      mvps: player.mvps,
      kills: player.kills,
      deaths: player.deaths,
      finalKills: player.finalKills,
      bedBroken: player.bedBroken,
      diamonds: player.diamonds,
      irons: player.irons,
      gold: player.gold,
      emeralds: player.emeralds,
      blocksPlaced: player.blocksPlaced,
      damageDealt: player.damageDealt,
      damageTaken: player.damageTaken,
      assists: player.assists,
      bestStreak: player.bestStreak,
      firstBloods: player.firstBloods,
      finalDeaths: player.finalDeaths,
      playtimeSeconds: player.playtimeSeconds,
      peakElo: player.peakElo,
      kdr: player.kdr,
      wlr: player.wlr,
      dailyElo: player.dailyElo
    };
  }

  private async updatePlayerStats(playerScoreData: PlayerScoreData[], game: IGame): Promise<void> {
    try {
      const gameDurationSeconds = this.computeGameDurationSeconds(game);
      const entries = new Map<string, IRecentGame>();
      for (const scoreData of playerScoreData) {
        const entry = this.applyScoreDataToPlayer(scoreData.player, scoreData, game, gameDurationSeconds);
        entries.set(scoreData.player.discordId, entry);
      }

      const UserModel = User as unknown as {
        bulkWrite?: (ops: Record<string, unknown>[]) => Promise<unknown>;
      };
      if (typeof UserModel.bulkWrite === 'function') {
        try {
          const ops: Record<string, unknown>[] = [];
          for (const scoreData of playerScoreData) {
            const entry = entries.get(scoreData.player.discordId);
            ops.push({
              updateOne: {
                filter: { discordId: scoreData.player.discordId },
                update: { $pull: { recentGames: { gameId: game.gameId } } }
              }
            });
            ops.push({
              updateOne: {
                filter: { discordId: scoreData.player.discordId },
                update: {
                  $set: this.scalarSetsForScoredPlayer(scoreData.player),
                  $push: { recentGames: { $each: [entry], $position: 0, $slice: RECENT_GAMES_CAP } }
                }
              }
            });
          }
          await UserModel.bulkWrite(ops);
        } catch (error) {
          console.error('[GameManager] Error bulk-updating player stats:', error);
          throw new Error(`Failed to persist ${playerScoreData.length}/${playerScoreData.length} player updates`);
        }
        for (const scoreData of playerScoreData) {
          if (scoreData.leveledUp) {
            console.log(`[GameManager] Player ${scoreData.player.ign || scoreData.player.discordId} leveled up from ${scoreData.level_before} to ${scoreData.level_after}!`);
          }
        }
        return;
      }

      const updatePromises = playerScoreData.map(async (scoreData) => {
        await scoreData.player.save();

        if (scoreData.leveledUp) {
          console.log(`[GameManager] Player ${scoreData.player.ign || scoreData.player.discordId} leveled up from ${scoreData.level_before} to ${scoreData.level_after}!`);
        }
      });
      const results = await Promise.allSettled(updatePromises);
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        throw new Error(`Failed to persist ${failures.length}/${results.length} player updates`);
      }
    } catch (error) {
      console.error('[GameManager] Error updating player stats:', error);
      throw error;
    }
  }

  private computeGameDurationSeconds(game: IGame): number {
    if (game.endTime && game.startTime) {
      return Math.max(0, Math.floor((game.endTime.getTime() - game.startTime.getTime()) / 1000));
    }
    return 600;
  }

  private updatePlayerGameStats(player: IUser, stats: PlayerData): void {
    try {
      if (typeof stats.kills === 'number') player.kills = (player.kills || 0) + stats.kills;
      if (typeof stats.deaths === 'number') player.deaths = (player.deaths || 0) + stats.deaths;
      if (typeof stats.finalKills === 'number') player.finalKills = (player.finalKills || 0) + stats.finalKills;
      if (typeof stats.bedBroken === 'number') player.bedBroken = (player.bedBroken || 0) + stats.bedBroken;
      if (typeof stats.diamonds === 'number') player.diamonds = (player.diamonds || 0) + stats.diamonds;
      if (typeof stats.irons === 'number') player.irons = (player.irons || 0) + stats.irons;
      if (typeof stats.gold === 'number') player.gold = (player.gold || 0) + stats.gold;
      if (typeof stats.emeralds === 'number') player.emeralds = (player.emeralds || 0) + stats.emeralds;
      if (typeof stats.blocksPlaced === 'number') player.blocksPlaced = (player.blocksPlaced || 0) + stats.blocksPlaced;
      if (typeof stats.damageDealt === 'number') player.damageDealt = (player.damageDealt || 0) + stats.damageDealt;
      if (typeof stats.damageTaken === 'number') player.damageTaken = (player.damageTaken || 0) + stats.damageTaken;
      if (typeof stats.assists === 'number') player.assists = (player.assists || 0) + stats.assists;
      if (typeof stats.maxStreak === 'number') player.bestStreak = Math.max(player.bestStreak || 0, stats.maxStreak);
      if (stats.firstBlood === true) player.firstBloods = (player.firstBloods || 0) + 1;
    } catch (error) {
      console.error('[GameManager] Error updating player game stats:', error);
    }
  }

  private async updatePlayerRecentGames(player: IUser, scoreData: PlayerScoreData, game: IGame): Promise<void> {
    try {
      const now = new Date();
      const entry: IRecentGame = {
        gameId: game.gameId,
        queueId: String(parseInt(game.queueId, 10)),
        map: game.map,
        eloGain: scoreData.eloChange,
        elo_before: scoreData.elo_before,
        elo_after: scoreData.elo_after,
        kills: scoreData.stats.kills || 0,
        deaths: scoreData.stats.deaths || 0,
        bedBroken: scoreData.stats.bedBroken || 0,
        finalKills: scoreData.stats.finalKills || 0,
        finalDeaths: scoreData.finalDeaths || 0,
        won: scoreData.isWinner,
        isMvp: scoreData.isMvp,
        date: now,
        state: 'scored',
        startTime: game.startTime,
        endTime: now,
        diamonds: scoreData.stats.diamonds || 0,
        irons: scoreData.stats.irons || 0,
        gold: scoreData.stats.gold || 0,
        emeralds: scoreData.stats.emeralds || 0,
        blocksPlaced: scoreData.stats.blocksPlaced || 0,
        damageDealt: scoreData.stats.damageDealt || 0,
        damageTaken: scoreData.stats.damageTaken || 0,
        assists: scoreData.stats.assists || 0,
        maxStreak: scoreData.stats.maxStreak || 0,
        firstBlood: scoreData.stats.firstBlood === true,
        fights: scoreData.stats.fights ? Object.keys(scoreData.stats.fights).length : 0
      };

      if (!player.recentGames) player.recentGames = [];

      const idx = player.recentGames.findIndex((g) => g.gameId === game.gameId);
      if (idx !== -1) {
        player.recentGames[idx] = entry;
      } else {
        player.recentGames.unshift(entry);
      }
      if (player.recentGames.length > RECENT_GAMES_CAP) {
        player.recentGames = player.recentGames.slice(0, RECENT_GAMES_CAP);
      }


    } catch (error) {
      console.error(`[GameManager] Error updating recent games for ${player.discordId}:`, error);
    }
  }

  private async updatePlayerDailyElo(player: IUser): Promise<void> {
    try {
      if (!player.dailyElo) {
        player.dailyElo = [];
      }

      updateDailyElo(player, player.elo);

      if (player.dailyElo.length > 30) {
        player.dailyElo = player.dailyElo.slice(-30);
      }
    } catch (error) {
      console.error(`[GameManager] Error updating daily ELO for ${player.discordId}:`, error);
    }
  }

  private async updatePlayerRoles(playerScoreData: PlayerScoreData[]): Promise<void> {
    try {
      console.log('[GameManager] Updating player roles and nicknames using fix utility');

      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.warn('[GameManager] No guild found for role updates');
        return;
      }


      const updatePromises = playerScoreData.map(async (scoreData) => {
        try {
          await fix(guild, scoreData.player.discordId);
        } catch (error) {
          console.warn(`[GameManager] Could not update roles/nickname for ${scoreData.player.discordId}:`, error);
        }
      });

      await Promise.allSettled(updatePromises);
      console.log('[GameManager] Completed updating player roles and nicknames');
    } catch (error) {
      console.error('[GameManager] Error updating player roles:', error);
    }
  }

  private async sendScoreNotifications(
    context: GameScoreContext,
    playerScoreData: PlayerScoreData[]
  ): Promise<void> {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) return;

      const mentions = this.getMentionString(playerScoreData);

      const winnersIds = context.winningTeam === 1 ? context.game.team1 : context.game.team2;
      const losersIds = context.winningTeam === 1 ? context.game.team2 : context.game.team1;

      const winners = playerScoreData
        .filter(p => winnersIds.includes(p.player.discordId))
        .map(p => ({
          discordId: p.player.discordId,
          username: context.idToIgn[p.player.discordId] || 'Unknown',
          team: 'winning' as const,
          elo_before: p.elo_before,
          elo_after: p.elo_after,
          oldElo: p.elo_before,
          newElo: p.elo_after,
          mvp: p.isMvp
        }));

      const losers = playerScoreData
        .filter(p => losersIds.includes(p.player.discordId))
        .map(p => ({
          discordId: p.player.discordId,
          username: context.idToIgn[p.player.discordId] || 'Unknown',
          team: 'losing' as const,
          elo_before: p.elo_before,
          elo_after: p.elo_after,
          oldElo: p.elo_before,
          newElo: p.elo_after,
          mvp: p.isMvp
        }));

      let imageBuffer: Buffer | null = null;
      try {
        imageBuffer = await generateScoreImageBuffer(context.game.gameId, winners, losers);
      } catch (e) {
        console.error('[GameManager] Failed generating score image, sending embed only:', e);
      }

      await this.sendToScoringChannel(guild, mentions, imageBuffer);
      await this.sendToGameChannel(guild, context.game, null, mentions, imageBuffer);

    } catch (error) {
      console.error('[GameManager] Error sending score notifications:', error);
    }
  }



  private getMentionString(playerScoreData: PlayerScoreData[]): string {
    try {
      return playerScoreData.map(p => `<@${p.player.discordId}>`).join(' ');
    } catch (error) {
      console.error('[GameManager] Error getting mention string:', error);
      return '';
    }
  }

  private async sendToScoringChannel(
    guild: Guild,
    mentions: string,
    imageBuffer?: Buffer | null
  ): Promise<void> {
    try {
      if (config.channels.scoringChannel) {
        const message: MessageCreateOptions = { content: mentions };
        if (imageBuffer) {
          message.files = [{ attachment: imageBuffer, name: `game_${Date.now()}_results.png` }];
        }
        await this.workersManager.sendMessage(config.channels.scoringChannel, message, 8);
      }
    } catch (error) {
      console.error('[GameManager] Error sending to scoring channel:', error);
    }
  }

  private async sendToGameChannel(
    guild: Guild,
    game: IGame,
    embed?: EmbedBuilder | null,
    mentions?: string,
    imageBuffer?: Buffer | null
  ): Promise<void> {
    try {
      if (game.channels?.text) {
        const message: MessageCreateOptions = { content: mentions };
        if (embed) {
          message.embeds = [embed];
        }
        if (imageBuffer) {
          message.files = [{ attachment: imageBuffer, name: `game_${game.gameId}_results.png` }];
        }
        await this.workersManager.sendMessage(game.channels.text, message, 8);
      }
    } catch (error) {
      console.error('[GameManager] Error sending to game channel:', error);
    }
  }

  
  private async loadGameVoidContext(gameId: number, reason: string): Promise<GameVoidContext> {
    try {
      const { game, players } = await this.loadGameWithPlayers(gameId);

      return {
        game,
        players,
        reason
      };
    } catch (error) {
      console.error('[GameManager] Error loading game void context:', error);
      throw error;
    }
  }

  private async validateGameForVoiding(game: IGame): Promise<void> {
    if (!game) {
      throw new Error('Game not found');
    }

    if (!game.team1 || !game.team2 || game.team1.length === 0 || game.team2.length === 0) {
      throw new Error('Game has invalid team data');
    }
  }

  private async processAllPlayersForVoiding(context: GameVoidContext): Promise<PlayerVoidData[]> {
    try {
      const playerVoidData: PlayerVoidData[] = [];
      for (const player of context.players) {
        const voidData = await this.processPlayerVoid(player, context);
        playerVoidData.push(voidData);
      }
      return playerVoidData;
    } catch (error) {
      console.error('[GameManager] Error processing players for voiding:', error);
      throw error;
    }
  }

  private async processPlayerVoid(player: IUser, context: GameVoidContext): Promise<PlayerVoidData> {
    try {
      const isWinner = context.game.winners?.includes(player.discordId) || false;
      const isMvp = Array.isArray(context.game.mvps) && context.game.mvps.includes(player.discordId);
      const isBedBreaker = Array.isArray(context.game.bedbreaks) && context.game.bedbreaks.includes(player.discordId);

      const elo_before = player.elo;
      let eloChange = 0;
      let restoredElo: number | null = null;
      let gameStats: VoidableGameStats | null = null;
      let experienceToRevert = 0;

      
      const recentGameIdx = player.recentGames.findIndex(g => g.gameId === context.game.gameId);
      if (recentGameIdx !== -1) {
        const recentGame = player.recentGames[recentGameIdx] as IRecentGame & { oldElo?: number; ismvp?: boolean };
        gameStats = recentGame;

        if (recentGame.state === 'scored') {
          const before = recentGame.elo_before ?? recentGame.oldElo;
          if (typeof before === 'number') {
            restoredElo = before;
          } else {
            eloChange = -recentGame.eloGain;
          }

          experienceToRevert = this.calculateExperienceGained(
            recentGame.won || false,
            recentGame.isMvp ?? recentGame.ismvp ?? false,
            isBedBreaker,
            recentGame
          );
        } else {
          console.warn(`[GameManager] Game ${context.game.gameId} for player ${player.discordId} is not in scored state: ${recentGame.state}`);
          eloChange = 0;
          experienceToRevert = 0;
        }
      } else {
        console.warn(`[GameManager] No recent game found for player ${player.discordId} in game ${context.game.gameId}`);
        eloChange = 0;
        experienceToRevert = 0;
      }

      const elo_after = restoredElo !== null ? restoredElo : Math.max(0, player.elo + eloChange);

      const currentExperience = player.experience || 0;
      const newExperience = Math.max(0, currentExperience - experienceToRevert);
      const level_before = player.level || 1;
      const levelInfo = checkLevelUp(0, newExperience);
      const level_after = levelInfo.level_after ?? levelInfo.newLevel;

      return {
        player,
        isWinner,
        isMvp,
        isBedBreaker,
        eloChange,
        elo_before,
        elo_after,
        experienceToRevert,
        level_before,
        level_after,
        gameStats
      };
    } catch (error) {
      console.error(`[GameManager] Error processing player void ${player.discordId}:`, error);
      throw error;
    }
  }

  private applyVoidDataToPlayer(voidData: PlayerVoidData, gameId?: number): { targetGameId: number | null; hadExisting: boolean } {
    const player = voidData.player;
    player.elo = voidData.elo_after;

    this.applyRevertPlayerGameStats(player, voidData);
    const result = this.applyRecentGamesForVoid(player, voidData, gameId);
    this.updatePlayerDailyEloSync(player);
    return result;
  }

  private applyRevertPlayerGameStats(player: IUser, voidData: PlayerVoidData): void {
    const gameStats = voidData.gameStats;
    if (!gameStats) {
      return;
    }
    if (gameStats.state !== 'scored') {
      player.games = Math.max(0, (player.games || 0) - 1);
      return;
    }
    this.revertStatFields(player, gameStats);
    player.experience = Math.max(0, (player.experience || 0) - voidData.experienceToRevert);
    player.level = voidData.level_after;
    player.kdr = player.deaths && player.deaths > 0 ? Number((player.kills / player.deaths).toFixed(2)) : (player.kills || 0);
    player.wlr = player.losses && player.losses > 0 ? Number((player.wins / player.losses).toFixed(2)) : (player.wins || 0);
  }

  private applyRecentGamesForVoid(player: IUser, voidData: PlayerVoidData, gameId?: number): { targetGameId: number | null; hadExisting: boolean } {
    const gameStats = voidData.gameStats;
    if (!player.recentGames) player.recentGames = [];
    const targetGameId = gameStats ? gameStats.gameId : gameId;
    if (!targetGameId) {
      return { targetGameId: null, hadExisting: false };
    }
    const recentGameIdx = player.recentGames.findIndex(g => g.gameId === targetGameId);
    if (recentGameIdx !== -1) {
      const existing = player.recentGames[recentGameIdx];
      if (existing.state === 'scored' || existing.state === 'pending') {
        existing.state = 'voided';
        existing.eloGain = 0;
        existing.won = false;
        existing.isMvp = false;
      }
      return { targetGameId, hadExisting: true };
    }
    player.recentGames.unshift({
      gameId: targetGameId,
      queueId: '0',
      map: 'Unknown',
      eloGain: 0,
      kills: 0,
      deaths: 0,
      bedBroken: 0,
      finalKills: 0,
      won: false,
      isMvp: false,
      date: new Date(),
      state: 'voided',
      startTime: new Date(),
      endTime: new Date(),
      diamonds: 0,
      irons: 0,
      gold: 0,
      emeralds: 0,
      blocksPlaced: 0
    });
    if (player.recentGames.length > RECENT_GAMES_CAP) {
      player.recentGames = player.recentGames.slice(0, RECENT_GAMES_CAP);
    }
    return { targetGameId, hadExisting: false };
  }

  private scalarSetsForVoidedPlayer(player: IUser): Record<string, unknown> {
    return {
      elo: player.elo,
      experience: player.experience,
      level: player.level,
      wins: player.wins,
      losses: player.losses,
      winStreak: player.winStreak,
      loseStreak: player.loseStreak,
      mvps: player.mvps,
      kills: player.kills,
      deaths: player.deaths,
      finalKills: player.finalKills,
      finalDeaths: player.finalDeaths,
      bedBroken: player.bedBroken,
      diamonds: player.diamonds,
      irons: player.irons,
      gold: player.gold,
      emeralds: player.emeralds,
      blocksPlaced: player.blocksPlaced,
      damageDealt: player.damageDealt,
      damageTaken: player.damageTaken,
      assists: player.assists,
      bestStreak: player.bestStreak,
      firstBloods: player.firstBloods,
      games: player.games,
      kdr: player.kdr,
      wlr: player.wlr,
      dailyElo: player.dailyElo
    };
  }

  private async revertPlayerStats(playerVoidData: PlayerVoidData[], gameId?: number): Promise<void> {
    try {
      const meta = new Map<string, { targetGameId: number | null; hadExisting: boolean }>();
      for (const voidData of playerVoidData) {
        try {
          meta.set(voidData.player.discordId, this.applyVoidDataToPlayer(voidData, gameId));
        } catch (error) {
          console.error(`[GameManager] Error reverting player ${voidData.player.discordId}:`, error);
        }
      }

      const UserModel = User as unknown as {
        bulkWrite?: (ops: Record<string, unknown>[]) => Promise<unknown>;
      };
      if (typeof UserModel.bulkWrite === 'function') {
        const ops: Record<string, unknown>[] = [];
        for (const voidData of playerVoidData) {
          const player = voidData.player;
          const info = meta.get(player.discordId);
          const targetGameId = info?.targetGameId ?? (voidData.gameStats ? voidData.gameStats.gameId : gameId);
          if (!targetGameId) {
            continue;
          }
          if (info?.hadExisting) {
            ops.push({
              updateOne: {
                filter: { discordId: player.discordId, 'recentGames.gameId': targetGameId },
                update: {
                  $set: {
                    ...this.scalarSetsForVoidedPlayer(player),
                    'recentGames.$.state': 'voided',
                    'recentGames.$.eloGain': 0,
                    'recentGames.$.won': false,
                    'recentGames.$.isMvp': false
                  }
                }
              }
            });
          } else {
            ops.push({
              updateOne: {
                filter: { discordId: player.discordId },
                update: {
                  $set: this.scalarSetsForVoidedPlayer(player),
                  $push: {
                    recentGames: {
                      $each: [{
                        gameId: targetGameId,
                        queueId: '0',
                        map: 'Unknown',
                        eloGain: 0,
                        kills: 0,
                        deaths: 0,
                        bedBroken: 0,
                        finalKills: 0,
                        won: false,
                        isMvp: false,
                        date: new Date(),
                        state: 'voided',
                        startTime: new Date(),
                        endTime: new Date(),
                        diamonds: 0,
                        irons: 0,
                        gold: 0,
                        emeralds: 0,
                        blocksPlaced: 0
                      }],
                      $position: 0,
                      $slice: RECENT_GAMES_CAP
                    }
                  }
                }
              }
            });
          }
        }
        if (ops.length > 0) {
          await UserModel.bulkWrite(ops);
        }
        return;
      }

      const updatePromises = playerVoidData.map(async (voidData) => {
        try {
          await voidData.player.save();
        } catch (error) {
          console.error(`[GameManager] Error reverting player ${voidData.player.discordId}:`, error);
        }
      });
      await Promise.allSettled(updatePromises);
    } catch (error) {
      console.error('[GameManager] Error reverting player stats:', error);
      throw error;
    }
  }

  private revertStatFields(player: IUser, gameStats: VoidableGameStats): void {
    const statFields = ['kills', 'deaths', 'finalKills', 'finalDeaths', 'bedBroken', 'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'damageDealt', 'damageTaken', 'assists'] as const;
    for (const field of statFields) {
      const value = gameStats[field];
      if (typeof value === 'number') {
        const current = player[field];
        player[field] = Math.max(0, (typeof current === 'number' ? current : 0) - value);
      }
    }
    if (gameStats.won === true) {
      player.wins = Math.max(0, (player.wins || 0) - 1);
      player.winStreak = Math.max(0, (player.winStreak || 0) - 1);
    } else if (gameStats.won === false) {
      player.losses = Math.max(0, (player.losses || 0) - 1);
      player.loseStreak = Math.max(0, (player.loseStreak || 0) - 1);
    }
    if (gameStats.isMvp ?? gameStats.ismvp) {
      player.mvps = Math.max(0, (player.mvps || 0) - 1);
    }
    if (gameStats.firstBlood) {
      player.firstBloods = Math.max(0, (player.firstBloods || 0) - 1);
    }
    player.games = Math.max(0, (player.games || 0) - 1);
  }

  private async revertPlayerGameStats(player: IUser, voidData: PlayerVoidData): Promise<void> {
    try {
      const gameStats = voidData.gameStats;
      if (!gameStats) {
        console.warn(`[GameManager] No game stats found for player ${player.discordId} to revert`);
        return;
      }

      if (gameStats.state !== 'scored') {
        console.warn(`[GameManager] Game ${gameStats.gameId} for player ${player.discordId} is not in scored state: ${gameStats.state}`);
        player.games = Math.max(0, (player.games || 0) - 1);
        return;
      }

      this.revertStatFields(player, gameStats);

      player.experience = Math.max(0, (player.experience || 0) - voidData.experienceToRevert);
      player.level = voidData.level_after;
      player.kdr = player.deaths && player.deaths > 0 ? Number((player.kills / player.deaths).toFixed(2)) : (player.kills || 0);
      player.wlr = player.losses && player.losses > 0 ? Number((player.wins / player.losses).toFixed(2)) : (player.wins || 0);

      console.log(`[GameManager] Reverted stats for player ${player.discordId}: -${voidData.experienceToRevert} XP (Lv.${voidData.level_before}â†’${voidData.level_after}), ${voidData.eloChange} ELO`);
    } catch (error) {
      console.error(`[GameManager] Error reverting game stats for player ${player.discordId}:`, error);
    }
  }

  private async updatePlayerRecentGamesForVoid(player: IUser, voidData: PlayerVoidData, gameId?: number): Promise<void> {
    try {
      const gameStats = voidData.gameStats;
      if (!player.recentGames) player.recentGames = [];

      const targetGameId = gameStats ? gameStats.gameId : gameId;
      if (!targetGameId) {
        console.warn(`[GameManager] No gameId available to update recentGames for ${player.discordId}`);
        return;
      }

      const recentGameIdx = player.recentGames.findIndex(g => g.gameId === targetGameId);
      if (recentGameIdx !== -1) {
        const existing = player.recentGames[recentGameIdx];
        if (existing.state === 'scored' || existing.state === 'pending') {
          existing.state = 'voided';
          existing.eloGain = 0;
          existing.won = false;
          existing.isMvp = false;
        } else {
          console.warn(`[GameManager] Game ${targetGameId} for player ${player.discordId} is not in scored/pending state: ${existing.state}`);
        }
      } else {
        
        player.recentGames.unshift({
          gameId: targetGameId,
          queueId: '0',
          map: 'Unknown',
          eloGain: 0,
          kills: 0,
          deaths: 0,
          bedBroken: 0,
          finalKills: 0,
          won: false,
          isMvp: false,
          date: new Date(),
          state: 'voided',
          startTime: new Date(),
          endTime: new Date(),
          diamonds: 0,
          irons: 0,
          gold: 0,
          emeralds: 0,
          blocksPlaced: 0
        });
        if (player.recentGames.length > RECENT_GAMES_CAP) {
          player.recentGames = player.recentGames.slice(0, RECENT_GAMES_CAP);
        }
      }
    } catch (error) {
      console.error(`[GameManager] Error updating recent games for void ${player.discordId}:`, error);
    }
  }

  private async updatePlayerRolesForVoid(playerVoidData: PlayerVoidData[]): Promise<void> {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.warn('[GameManager] No guild found for role updates');
        return;
      }

      const updatePromises = playerVoidData.map(async (voidData) => {
        try {
          const member = guild.members.cache.get(voidData.player.discordId)
            ?? await guild.members.fetch(voidData.player.discordId).catch(() => null);
          if (member) {

            await fix(guild, voidData.player.discordId);
            console.log(`[GameManager] Updated roles and nickname for player ${voidData.player.discordId}`);
          }
        } catch (error) {
          console.warn(`[GameManager] Could not update roles for ${voidData.player.discordId}:`, error);
        }
      });

      await Promise.allSettled(updatePromises);
    } catch (error) {
      console.error('[GameManager] Error updating player roles:', error);
    }
  }

  private async sendVoidNotifications(
    context: GameVoidContext,
    playerVoidData: PlayerVoidData[]
  ): Promise<void> {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) return;

      const embed = this.createVoidEmbed(context, playerVoidData);
      const mentions = this.getMentionStringForVoid(playerVoidData);

      await this.sendToVoidingChannel(guild, embed, mentions);
      await this.sendToGameChannel(guild, context.game, embed, mentions);
    } catch (error) {
      console.error('[GameManager] Error sending void notifications:', error);
    }
  }

  private createVoidEmbed(context: GameVoidContext, playerVoidData: PlayerVoidData[]): EmbedBuilder {
    try {
      const formatPlayer = (voidData: PlayerVoidData): string => {
        const eloChangeStr = voidData.eloChange >= 0 ? `+${voidData.eloChange}` : `${voidData.eloChange}`;
        const expChangeStr = voidData.experienceToRevert > 0 ? ` (-${voidData.experienceToRevert} XP)` : '';
        const levelChangeStr = voidData.level_before !== voidData.level_after ? ` (Lv.${voidData.level_before}â†’${voidData.level_after})` : '';
        return `<@${voidData.player.discordId}>: ${voidData.elo_before} â†’ ${voidData.elo_after} (${eloChangeStr})${expChangeStr}${levelChangeStr}`;
      };

      const voidedSummary = playerVoidData.map(formatPlayer).join('\n');
      const rawMap = context.game.map; 
      const versionMatch = rawMap.match(/(\d+v\d+)/);
      const mapName = versionMatch ? rawMap.slice(0, versionMatch.index).trim() || rawMap : rawMap;
      return new EmbedBuilder()
        .setTitle(`Game #${context.game.gameId} Voided`)
        .setDescription(`**Reason:** ${context.reason}\n**Map:** ${mapName}`)
        .addFields([
          { name: 'Stats Reverted', value: voidedSummary || 'None', inline: false }
        ])
        .setColor('#00AAAA')
        .setTimestamp();
    } catch (error) {
      console.error('[GameManager] Error creating void embed:', error);
      return new EmbedBuilder().setTitle('Error').setDescription('Could not create void embed');
    }
  }

  private getMentionStringForVoid(playerVoidData: PlayerVoidData[]): string {
    try {
      return playerVoidData.map(p => `<@${p.player.discordId}>`).join(' ');
    } catch (error) {
      console.error('[GameManager] Error getting mention string:', error);
      return '';
    }
  }

  private async sendToVoidingChannel(
    guild: Guild,
    embed: EmbedBuilder,
    mentions: string
  ): Promise<void> {
    try {
      if (config.channels.voidingChannel) {
        await this.workersManager.sendMessage(
          config.channels.voidingChannel,
          { content: mentions, embeds: [embed] },
          8 
        );
      }
    } catch (error) {
      console.error('[GameManager] Error sending to voiding channel:', error);
    }
  }

  private async scheduleGameChannelCleanup(game: IGame, gameId: number): Promise<void> {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild || !game.channels) return;

      const deletionEmbed = new EmbedBuilder()
        .setTitle('Game Channels Deletion')
        .setDescription('This game\'s channels will be deleted in 30 seconds.')
        .setColor('#FF9900')
        .setTimestamp(new Date(Date.now() + 30000));

      if (game.channels.text) {
        await this.workersManager.sendMessage(
          game.channels.text,
          { embeds: [deletionEmbed] },
          5 
        ).catch(() => { });
      }

      setTimeout(async () => {
        try {
          if (game.channels?.text) {
            await this.workersManager.deleteChannel(game.channels.text, 2);
            console.log(`[GameManager] Deleted text channel for game ${gameId}`);
          }

          const pickingId = game.channels.picking;
          if (pickingId) {
            await this.workersManager.deleteChannel(pickingId, 2);
            console.log(`[GameManager] Deleted picking channel for game ${gameId}`);
          }
        } catch (error) {
          console.error(`[GameManager] Error cleaning up channels for game ${gameId}:`, error);
        }
      }, 30000);
    } catch (error) {
      console.error(`[GameManager] Error scheduling game channel cleanup for game ${gameId}:`, error);
    }
  }

}
