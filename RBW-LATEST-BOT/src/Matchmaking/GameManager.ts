import { Client, TextChannel, VoiceChannel, Guild, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import Game, { IGame } from '../models/Game';
import User, { IUser } from '../models/User';
import Queue from '../models/Queue';
import EloRank, { IEloRank } from '../models/EloRank';
import config from '../config/config';
import { GameState, GameResources, WarpRequestData, GameResult, VoidResult, PlayerData } from '../types/GameTypes';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { MapService } from '../managers/MapManager';
import { fix } from '../utils/fix';
import { generateScoreImageBuffer } from '../utils/scoreImage';
import {
  getLevelInfo,
  checkLevelUp,
  EXPERIENCE_REWARDS
} from '../utils/levelSystem';
import { WorkersManager } from '../managers/WorkersManager';

import axios from 'axios';

interface PlayerScoreData {
  player: IUser;
  isWinner: boolean;
  isMvp: boolean;
  isBedBreaker: boolean;
  eloChange: number;
  oldElo: number;
  newElo: number;
  stats: PlayerData;
  experienceGained: number;
  oldLevel: number;
  newLevel: number;
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
  oldElo: number;
  newElo: number;
  experienceToRevert: number;
  oldLevel: number;
  newLevel: number;
  gameStats: any;  
}

interface GameVoidContext {
  game: IGame;
  players: IUser[];
  reason: string;
}

export class GameManager {
  private client: Client;
  private wsManager: WebSocketManager;
  private mapService: MapService;
  
  private workersManager: WorkersManager;
  private activeGames: Map<number, GameResources> = new Map();
  private warpRequests: Map<string, WarpRequestData> = new Map();
  private readonly MAX_CONCURRENT_GAMES = 50;
  private readonly WARP_TIMEOUT = 60000;
  private readonly MAX_WARP_RETRIES = 3;
  private readonly WARP_RETRY_DELAY = 5000;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.mapService = new MapService(wsManager);
    
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
    queueData: any,
    team1: string[],
    team2: string[],
    selectedMap: string
  ): Promise<GameResources> {
    try {
      console.log(`[GameManager] Creating game ${gameId} with map ${selectedMap}`);
      const guild = await this.getGuild();
      if (!guild) throw new Error('Guild not found');
      const resources = await this.createGameResources(guild, gameId, selectedMap, [...team1, ...team2], queueData);
      await this.createGameInDatabaseAndUpdateUsers(resources, queueData, selectedMap, team1, team2);
      await this.movePlayersToVoiceChannels(guild, team1, team2, resources);
      this.activeGames.set(gameId, resources);
      console.log(`[GameManager] Successfully created game ${gameId}`);
      return resources;
    } catch (error) {
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
      await this.updateGameState(context.game, context.winningTeam, context.mvpsIds, context.bedbreaksIds, gameResult.reason);

      const playerScoreData = await this.processAllPlayers(context);

      try {
        await this.updatePlayerStats(playerScoreData, context.game);
      } catch (e) {
        console.error('[GameManager] Failed to persist player scoring updates:', e);
      }

      await this.sendScoreNotifications(context, playerScoreData);

      try {
        await this.updatePlayerRoles(playerScoreData.map(p => ({ player: p.player } as any)));
      } catch (e) {
        console.warn('[GameManager] Skipping role updates due to error (non-blocking):', e);
      }
      try {
        const allPlayerIGNs = context.players.map(p => p.ign).filter(Boolean);
        if (allPlayerIGNs.length > 0) {
          this.wsManager.send({
            type: 'scoringsuccess',
            gameid: gameResult.gameId,
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
        winningTeam: gameResult.winningTeam,
        mvps: gameResult.mvps,
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


      await this.revertPlayerStats(playerVoidData, gameId);


      await this.updateGameStateToVoided(context.game, reason);
      await this.updatePlayerRolesForVoid(playerVoidData);
      await this.sendVoidNotifications(context, playerVoidData);
      try {
        const allPlayerIGNs = context.players.map(p => p.ign).filter(Boolean);
        if (allPlayerIGNs.length > 0) {
          this.wsManager.send({
            type: 'gamevoided',
            gameid: gameId,
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
        revertedPlayers: playerVoidData.map(p => ({ discordId: p.player.discordId, elo: p.newElo }))
      };
    } catch (error) {
      console.error(`[GameManager] Error voiding game ${gameId}:`, error);
      throw error;
    }
  }

  public async getNextGameId(): Promise<number> {
    try {
      const lastGame = await Game.findOne().sort({ gameId: -1 }).select('gameId');
      return (lastGame?.gameId || 0) + 1;
    } catch (error) {
      console.error('[GameManager] Error getting next game ID:', error);
      return 1;
    }
  }

  public getActiveGameCount(): number {
    return this.activeGames.size;
  }

  public isGameActive(gameId: number): boolean {
    return this.activeGames.has(gameId);
  }

  public getGameResources(gameId: number): GameResources | undefined {
    return this.activeGames.get(gameId);
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

      this.wsManager.send({
        type: 'warp_players',
        game_id: gameId.toString(),
        map: game.map,
        is_ranked: game.isRanked || false,
        team1: {
          players: team1IGNs
        },
        team2: {
          players: team2IGNs
        }
      });

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
    queue: any
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
    queue: any,
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
      const users = await User.find({ discordId: { $in: allPlayers } });
      const updatePromises = users.map(async (user) => {
        user.games = (user.games || 0) + 1;
        user.recentGames = user.recentGames || [];
        user.recentGames.unshift({
          gameId: resources.gameId,
          queueid: typeof queue.id === 'number' ? queue.id : parseInt(queue.id, 10),
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
          ismvp: false
        });
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
    queue: any,
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


  private async handleWarpSuccess(msg: any): Promise<void> {
    try {
      const { gameId } = msg;
      if (!gameId || isNaN(Number(gameId))) {
        console.error('[GameManager] handleWarpSuccess: Invalid or missing gameId in msg:', msg);
        return;
      }
      console.log(`[GameManager] Warp successful for game ${gameId}`);

      const warpData = this.warpRequests.get(gameId);
      if (warpData) {
        clearTimeout(warpData.timeout);
        this.warpRequests.delete(gameId);
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

  private async handleWarpFailedArena(msg: any): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Warp failed (arena not found) for game ${gameId}`);
      await this.handleWarpFailure(gameId, 'Arena not found');
    } catch (error) {
      console.error('[GameManager] Error handling arena not found:', error);
    }
  }

  private async handleWarpFailedOffline(msg: any): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Warp failed (offline players) for game ${gameId}`);
      await this.handleWarpFailure(gameId, 'Some players are offline');
    } catch (error) {
      console.error('[GameManager] Error handling offline players:', error);
    }
  }

  private async handleWarpFailureUnknown(msg: any): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Warp failed (unknown reason) for game ${gameId}`);
      await this.handleWarpFailure(gameId, 'Unknown warp failure');
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

      if (warpData.attempts < this.MAX_WARP_RETRIES) {

        warpData.attempts++;
        console.log(`[GameManager] Retrying warp for game ${gameId} (attempt ${warpData.attempts})`);

        setTimeout(() => {
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
        await this.voidGame(parseInt(gameId), `Warp failed: ${reason}`);
      }

    } catch (error) {
      console.error(`[GameManager] Error handling warp failure for game ${gameId}:`, error);
    }
  }

  private async handleRetryGame(msg: any): Promise<void> {
    try {
      const { gameId } = msg;
      console.log(`[GameManager] Retry game request for game ${gameId}`);

      const warpData = this.warpRequests.get(gameId);
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


      this.warpRequests.delete(gameId.toString());


      setTimeout(async () => {
        try {
          if (resources.gameChannel) {
            await this.workersManager.deleteChannel(resources.gameChannel.id, 2);
          }
          if (resources.pickingChannel) {
            await this.workersManager.deleteChannel(resources.pickingChannel.id, 2);
          }
        } catch (error) {
          console.error(`[GameManager] Error cleaning up channels for game ${gameId}:`, error);
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
    queueData: any,
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
            queueid: typeof queueData.id === 'number' ? queueData.id : parseInt(queueData.id, 10),
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
            ismvp: false
          };

          user.recentGames.unshift(recentGame);



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

  private async loadGameContext(gameResult: GameResult): Promise<GameScoreContext> {
    try {

      const game = await Game.findOne({ gameId: gameResult.gameId });
      if (!game) {
        throw new Error(`Game ${gameResult.gameId} not found`);
      }


      const allPlayerIds = [...game.team1, ...game.team2];
      const players = await User.find({ discordId: { $in: allPlayerIds } });

      if (players.length !== allPlayerIds.length) {
        throw new Error('Some players not found in database');
      }


      const eloRanks = await EloRank.find().sort({ startElo: 1 });


      const ignToId: Record<string, string> = {};
      const idToIgn: Record<string, string> = {};

      for (const player of players) {
        if (player.ign) {
          ignToId[player.ign] = player.discordId;
          idToIgn[player.discordId] = player.ign;
        }
      }

      let winningTeam = gameResult.winningTeam;

      if (gameResult.winningTeamIGNs && gameResult.winningTeamIGNs.length > 0) {
        const winningPlayerIds = gameResult.winningTeamIGNs
          .map(ign => ignToId[ign])
          .filter(Boolean);

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
            winningTeam = 2;
          }

          console.log(`[GameManager] Determined winning team ${winningTeam} from IGNs: ${gameResult.winningTeamIGNs.join(', ')}`);
        }
      }

      if (winningTeam !== 1 && winningTeam !== 2) {
        throw new Error('Winning team must be 1 or 2');
      }

      const mvpsIds = gameResult.mvps.map(ign => ignToId[ign]).filter(Boolean);
      const bedbreaksIds = (gameResult.bedbreaks || []).map(ign => ignToId[ign]).filter(Boolean);

      return {
        game,
        players,
        eloRanks,
        ignToId,
        idToIgn,
        mvpsIds,
        bedbreaksIds,
        winningTeam,
        playerData: gameResult.playerData || {}
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

    if (game.state === GameState.SCORED) {
      throw new Error('Game is already scored');
    }

    if (!game.team1 || !game.team2 || game.team1.length === 0 || game.team2.length === 0) {
      throw new Error('Game has invalid team data');
    }
  }

  private async updateGameState(
    game: IGame,
    winningTeam: number,
    mvpsIds: string[],
    bedbreaksIds: string[],
    reason?: string
  ): Promise<void> {
    try {
      game.state = GameState.SCORED;
      game.mvps = mvpsIds;
      game.bedbreaks = bedbreaksIds;
      game.reason = reason || '';
      game.winners = (winningTeam === 1 ? game.team1 : game.team2);
      game.losers = (winningTeam === 1 ? game.team2 : game.team1);
      game.endTime = new Date();

      await game.save();
      console.log(`[GameManager] Game ${game.gameId} state updated to scored`);
    } catch (error) {
      console.error('[GameManager] Error updating game state:', error);
      throw error;
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
      const stats = { ...(context.playerData[playerIgn] || {}) };
      if (isBedBreaker) {
        stats.bedBroken = (typeof stats.bedBroken === 'number' ? stats.bedBroken : 0) + 1;
      }

      const experienceGained = this.calculateExperienceGained(isWinner, isMvp, isBedBreaker, stats);
      const oldExperience = player.experience || 0;
      const newExperience = oldExperience + experienceGained;

      const levelUpInfo = checkLevelUp(oldExperience, newExperience);

      const oldElo = player.elo;
      const newElo = Math.max(0, player.elo + eloChange);

      return {
        player,
        isWinner,
        isMvp,
        isBedBreaker,
        eloChange,
        oldElo,
        newElo,
        stats,
        experienceGained,
        oldLevel: levelUpInfo.oldLevel,
        newLevel: levelUpInfo.newLevel,
        leveledUp: levelUpInfo.leveledUp
      };
    } catch (error) {
      console.error(`[GameManager] Error processing player ${player.discordId}:`, error);
      throw error;
    }
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
    stats: PlayerData
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

  private async updatePlayerStats(playerScoreData: PlayerScoreData[], game: IGame): Promise<void> {
    try {
      const updatePromises = playerScoreData.map(async (scoreData) => {
        try {
          const player = scoreData.player;

          
          player.elo = scoreData.newElo;

          
          player.experience = (player.experience || 0) + scoreData.experienceGained;
          player.level = scoreData.newLevel;


          if (scoreData.isWinner) {
            player.wins = (player.wins || 0) + 1;
            player.winstreak = (player.winstreak || 0) + 1;
            player.losestreak = 0;
          } else {
            player.losses = (player.losses || 0) + 1;
            player.losestreak = (player.losestreak || 0) + 1;
            player.winstreak = 0;
          }

          if (scoreData.isMvp) {
            player.mvps = (player.mvps || 0) + 1;
          }

          this.updatePlayerGameStats(player, scoreData.stats);

          player.kdr = player.deaths && player.deaths > 0 ? player.kills / player.deaths : player.kills;
          player.wlr = player.losses && player.losses > 0 ? player.wins / player.losses : player.wins;

          await this.updatePlayerRecentGames(player, scoreData, game);

          await this.updatePlayerDailyElo(player);

          await player.save();

          
          if (scoreData.leveledUp) {
            console.log(`[GameManager] Player ${player.ign || player.discordId} leveled up from ${scoreData.oldLevel} to ${scoreData.newLevel}!`);

            
            
            
            
            
            
            
          }
        } catch (error) {
          console.error(`[GameManager] Error updating player ${scoreData.player.discordId}:`, error);
        }
      });
      await Promise.allSettled(updatePromises);
    } catch (error) {
      console.error('[GameManager] Error updating player stats:', error);
      throw error;
    }
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
    } catch (error) {
      console.error('[GameManager] Error updating player game stats:', error);
    }
  }

  private async updatePlayerRecentGames(player: IUser, scoreData: PlayerScoreData, game: IGame): Promise<void> {
    try {
      const now = new Date();
      const entry = {
        gameId: game.gameId,
        queueid: typeof game.queueId === 'number' ? game.queueId : parseInt(game.queueId as any, 10),
        map: game.map,
        eloGain: scoreData.eloChange,
        kills: scoreData.stats.kills || 0,
        deaths: scoreData.stats.deaths || 0,
        bedBroken: scoreData.stats.bedBroken || 0,
        finalKills: scoreData.stats.finalKills || 0,
        won: scoreData.isWinner,
        ismvp: scoreData.isMvp,
        date: now,
        state: 'scored',
        startTime: game.startTime,
        endTime: now,
        diamonds: scoreData.stats.diamonds || 0,
        irons: scoreData.stats.irons || 0,
        gold: scoreData.stats.gold || 0,
        emeralds: scoreData.stats.emeralds || 0,
        blocksPlaced: scoreData.stats.blocksPlaced || 0
      } as any;

      if (!player.recentGames) player.recentGames = [];

      const idx = player.recentGames.findIndex((g: any) => g.gameId === game.gameId);
      if (idx !== -1) {
        player.recentGames[idx] = entry;
      } else {
        player.recentGames.unshift(entry);
      }


    } catch (error) {
      console.error(`[GameManager] Error updating recent games for ${player.discordId}:`, error);
    }
  }

  private async updatePlayerDailyElo(player: IUser): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (!player.dailyElo) {
        player.dailyElo = [];
      }

      const existingEntry = player.dailyElo.find(entry => {
        const entryDate = new Date(entry.date);
        entryDate.setHours(0, 0, 0, 0);
        return entryDate.getTime() === today.getTime();
      });

      if (existingEntry) {
        existingEntry.elo = player.elo;
      } else {
        player.dailyElo.push({
          date: today,
          elo: player.elo
        });
      }


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
          oldElo: p.oldElo,
          newElo: p.newElo,
          mvp: p.isMvp
        }));

      const losers = playerScoreData
        .filter(p => losersIds.includes(p.player.discordId))
        .map(p => ({
          discordId: p.player.discordId,
          username: context.idToIgn[p.player.discordId] || 'Unknown',
          team: 'losing' as const,
          oldElo: p.oldElo,
          newElo: p.newElo,
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
        const message: any = { content: mentions };
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
        const message: any = { content: mentions };
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
      const game = await Game.findOne({ gameId });
      if (!game) {
        throw new Error(`Game ${gameId} not found`);
      }

      const allPlayerIds = [...game.team1, ...game.team2];
      const players = await User.find({ discordId: { $in: allPlayerIds } });
      if (players.length !== allPlayerIds.length) {
        throw new Error('Some players not found in database');
      }

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

    if (game.state === GameState.VOIDED) {
      throw new Error('Game is already voided');
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

      const oldElo = player.elo;
      let eloChange = 0;
      let gameStats: any = null;
      let experienceToRevert = 0;

      
      const recentGameIdx = player.recentGames.findIndex(g => g.gameId === context.game.gameId);
      if (recentGameIdx !== -1) {
        const recentGame = player.recentGames[recentGameIdx];
        gameStats = recentGame;

        if (recentGame.state === 'scored') {
          eloChange = -recentGame.eloGain;

          experienceToRevert = this.calculateExperienceGained(
            recentGame.won || false,
            recentGame.ismvp || false,
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

      const newElo = Math.max(0, player.elo + eloChange);

      const currentExperience = player.experience || 0;
      const newExperience = Math.max(0, currentExperience - experienceToRevert);
      const oldLevel = player.level || 1;
      const levelInfo = checkLevelUp(0, newExperience);
      const newLevel = levelInfo.newLevel;

      return {
        player,
        isWinner,
        isMvp,
        isBedBreaker,
        eloChange,
        oldElo,
        newElo,
        experienceToRevert,
        oldLevel,
        newLevel,
        gameStats
      };
    } catch (error) {
      console.error(`[GameManager] Error processing player void ${player.discordId}:`, error);
      throw error;
    }
  }

  private async revertPlayerStats(playerVoidData: PlayerVoidData[], gameId?: number): Promise<void> {
    try {
      const updatePromises = playerVoidData.map(async (voidData) => {
        try {
          const player = voidData.player;
          player.elo = voidData.newElo;

          await this.revertPlayerGameStats(player, voidData);
          await this.updatePlayerRecentGamesForVoid(player, voidData, gameId);
          await this.updatePlayerDailyElo(player);
          await player.save();
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

  private async revertPlayerGameStats(player: IUser, voidData: PlayerVoidData): Promise<void> {
    try {
      const gameStats = voidData.gameStats;
      if (!gameStats) {
        console.warn(`[GameManager] No game stats found for player ${player.discordId} to revert`);
        return;
      }

      if (gameStats.state !== 'scored') {
        console.warn(`[GameManager] Game ${gameStats.gameId} for player ${player.discordId} is not in scored state: ${gameStats.state}`);
        return;
      }

      if (typeof gameStats.kills === 'number') player.kills = Math.max(0, (player.kills || 0) - gameStats.kills);
      if (typeof gameStats.deaths === 'number') player.deaths = Math.max(0, (player.deaths || 0) - gameStats.deaths);
      if (typeof gameStats.finalKills === 'number') player.finalKills = Math.max(0, (player.finalKills || 0) - gameStats.finalKills);
      if (typeof gameStats.bedBroken === 'number') player.bedBroken = Math.max(0, (player.bedBroken || 0) - gameStats.bedBroken);
      if (typeof gameStats.diamonds === 'number') player.diamonds = Math.max(0, (player.diamonds || 0) - gameStats.diamonds);
      if (typeof gameStats.irons === 'number') player.irons = Math.max(0, (player.irons || 0) - gameStats.irons);
      if (typeof gameStats.gold === 'number') player.gold = Math.max(0, (player.gold || 0) - gameStats.gold);
      if (typeof gameStats.emeralds === 'number') player.emeralds = Math.max(0, (player.emeralds || 0) - gameStats.emeralds);
      if (typeof gameStats.blocksPlaced === 'number') player.blocksPlaced = Math.max(0, (player.blocksPlaced || 0) - gameStats.blocksPlaced);

      if (gameStats.won === true) {
        player.wins = Math.max(0, (player.wins || 0) - 1);
        
      } else if (gameStats.won === false) {
        player.losses = Math.max(0, (player.losses || 0) - 1);
        
      }

      if (gameStats.ismvp) {
        player.mvps = Math.max(0, (player.mvps || 0) - 1);
      }

      player.games = Math.max(0, (player.games || 0) - 1);

      player.experience = Math.max(0, (player.experience || 0) - voidData.experienceToRevert);
      player.level = voidData.newLevel;

      
      player.kdr = player.deaths && player.deaths > 0 ? Number((player.kills / player.deaths).toFixed(2)) : (player.kills || 0);
      player.wlr = player.losses && player.losses > 0 ? Number((player.wins / player.losses).toFixed(2)) : (player.wins || 0);

      console.log(`[GameManager] Reverted stats for player ${player.discordId}: -${voidData.experienceToRevert} XP (Lv.${voidData.oldLevel}→${voidData.newLevel}), ${voidData.eloChange} ELO`);
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
          existing.ismvp = false;
        } else {
          console.warn(`[GameManager] Game ${targetGameId} for player ${player.discordId} is not in scored/pending state: ${existing.state}`);
        }
      } else {
        
        player.recentGames.unshift({
          gameId: targetGameId,
          queueid: 0,
          map: 'Unknown',
          eloGain: 0,
          kills: 0,
          deaths: 0,
          bedBroken: 0,
          finalKills: 0,
          won: false,
          ismvp: false,
          date: new Date(),
          state: 'voided',
          startTime: new Date(),
          endTime: new Date(),
          diamonds: 0,
          irons: 0,
          gold: 0,
          emeralds: 0,
          blocksPlaced: 0
        } as any);
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
          const member = await guild.members.fetch(voidData.player.discordId);
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

  private async updateGameStateToVoided(game: IGame, reason: string): Promise<void> {
    try {
      game.state = GameState.VOIDED;
      game.reason = reason;
      game.mvps = [];
      game.winners = [];
      game.losers = [];
      game.bedbreaks = [];
      game.endTime = new Date();
      await game.save();
      console.log(`[GameManager] Game ${game.gameId} state updated to voided`);
    } catch (error) {
      console.error('[GameManager] Error updating game state to voided:', error);
      throw error;
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
        const levelChangeStr = voidData.oldLevel !== voidData.newLevel ? ` (Lv.${voidData.oldLevel}→${voidData.newLevel})` : '';
        return `<@${voidData.player.discordId}>: ${voidData.oldElo} → ${voidData.newElo} (${eloChangeStr})${expChangeStr}${levelChangeStr}`;
      };

      const voidedSummary = playerVoidData.map(formatPlayer).join('\n');
      const rawMap = context.game.map; 
      const mapName = rawMap.split(/(\d+v\d+)/).pop(); 
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

  private async updateAllUsersForScoring(context: GameScoreContext, gameResult: GameResult): Promise<void> {
    const { game, playerData, idToIgn, players: contextPlayers } = context;
    const User = (await import('../models/User')).default;
    const users = contextPlayers && contextPlayers.length
      ? contextPlayers
      : await User.find({ discordId: { $in: [...game.team1, ...game.team2] } });
    const now = new Date();
    const updatePromises = users.map(async (user) => {
      const userIgn = idToIgn[user.discordId];
      const stats = (userIgn && playerData[userIgn]) || {};
      const isWinner = (context.winningTeam === 1 && game.team1.includes(user.discordId)) || (context.winningTeam === 2 && game.team2.includes(user.discordId));
      const isMvp = userIgn ? (gameResult.mvps || []).map(x => x.toLowerCase()).includes(userIgn.toLowerCase()) : false;
      const isBedBreaker = userIgn ? (gameResult.bedbreaks || []).map(x => x.toLowerCase()).includes(userIgn.toLowerCase()) : false;
      const eloRanks = context.eloRanks;
      const rank = eloRanks.find(r => user.elo >= r.startElo && user.elo <= r.endElo);
      let eloChange = 0;
      if (rank) eloChange = this.calculateScoreElo(user, rank, isWinner, isMvp, isBedBreaker);

      const experienceGained = this.calculateExperienceGained(isWinner, isMvp, isBedBreaker, stats);
      const oldExperience = user.experience || 0;
      const newExperience = oldExperience + experienceGained;
      const levelUpInfo = checkLevelUp(oldExperience, newExperience);

      user.kills = (user.kills || 0) + (stats.kills ?? 0);
      user.deaths = (user.deaths || 0) + (stats.deaths ?? 0);
      user.finalKills = (user.finalKills || 0) + (stats.finalKills ?? 0);
      user.bedBroken = (user.bedBroken || 0) + (stats.bedBroken ?? 0);
      user.diamonds = (user.diamonds || 0) + (stats.diamonds ?? 0);
      user.irons = (user.irons || 0) + (stats.irons ?? 0);
      user.gold = (user.gold || 0) + (stats.gold ?? 0);
      user.emeralds = (user.emeralds || 0) + (stats.emeralds ?? 0);
      user.blocksPlaced = (user.blocksPlaced || 0) + (stats.blocksPlaced ?? 0);
      if (isWinner) {
        user.wins = (user.wins || 0) + 1;
        user.winstreak = (user.winstreak || 0) + 1;
        user.losestreak = 0;
      } else {
        user.losses = (user.losses || 0) + 1;
        user.losestreak = (user.losestreak || 0) + 1;
        user.winstreak = 0;
      }
      if (isMvp) user.mvps = (user.mvps || 0) + 1;
      user.kdr = user.deaths && user.deaths > 0 ? user.kills / user.deaths : user.kills;
      user.wlr = user.losses && user.losses > 0 ? user.wins / user.losses : user.wins;
      user.elo = Math.max(0, user.elo + eloChange);
      user.experience = newExperience;
      user.level = levelUpInfo.newLevel;
      user.games = (user.games || 0) + 1;

      
      if (levelUpInfo.leveledUp) {
        console.log(`[GameManager] Player ${user.ign || user.discordId} leveled up from ${levelUpInfo.oldLevel} to ${levelUpInfo.newLevel}!`);

        
        
        
        
        
        
        
      }
      await this.updatePlayerDailyElo(user);
      
      if (!user.recentGames) user.recentGames = [];
      const idx = user.recentGames.findIndex((g: any) => g.gameId === game.gameId);
      const entry = {
        gameId: game.gameId,
        queueid: typeof game.queueId === 'number' ? game.queueId : parseInt(game.queueId, 10),
        map: game.map,
        eloGain: eloChange,
        kills: stats.kills ?? 0,
        deaths: stats.deaths ?? 0,
        bedBroken: stats.bedBroken ?? 0,
        finalKills: stats.finalKills ?? 0,
        won: isWinner,
        ismvp: isMvp,
        date: now,
        state: 'scored',
        startTime: game.startTime,
        endTime: now,
        diamonds: stats.diamonds ?? 0,
        irons: stats.irons ?? 0,
        gold: stats.gold ?? 0,
        emeralds: stats.emeralds ?? 0,
        blocksPlaced: stats.blocksPlaced ?? 0
      };
      if (idx !== -1) {
        user.recentGames[idx] = entry;
      } else {
        user.recentGames.unshift(entry);
      }
      await user.save();
    });
    await Promise.allSettled(updatePromises);
  }

  private async getPlayerScoreDataForContext(context: GameScoreContext, gameResult: GameResult): Promise<PlayerScoreData[]> {
    const { players, winningTeam, mvpsIds, bedbreaksIds, idToIgn, playerData, eloRanks, game } = context;
    return players.map(player => {
      const isWinner = (winningTeam === 1 && game.team1.includes(player.discordId)) || (winningTeam === 2 && game.team2.includes(player.discordId));
      const isMvp = mvpsIds.includes(player.discordId);
      const isBedBreaker = bedbreaksIds.includes(player.discordId);
      const rank = eloRanks.find(r => player.elo >= r.startElo && player.elo <= r.endElo);
      let eloChange = 0;
      if (rank) eloChange = this.calculateScoreElo(player, rank, isWinner, isMvp, isBedBreaker);

      const playerIgn = idToIgn[player.discordId];
      const stats = playerData[playerIgn] || {};

      const experienceGained = this.calculateExperienceGained(isWinner, isMvp, isBedBreaker, stats);
      const oldExperience = player.experience || 0;
      const newExperience = oldExperience + experienceGained;
      const levelUpInfo = checkLevelUp(oldExperience, newExperience);

      const oldElo = player.elo;
      const newElo = Math.max(0, player.elo + eloChange);

      return {
        player,
        isWinner,
        isMvp,
        isBedBreaker,
        eloChange,
        oldElo,
        newElo,
        stats,
        experienceGained,
        oldLevel: levelUpInfo.oldLevel,
        newLevel: levelUpInfo.newLevel,
        leveledUp: levelUpInfo.leveledUp
      };
    });
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

          const pickingId = (game.channels as any).picking as string | undefined;
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