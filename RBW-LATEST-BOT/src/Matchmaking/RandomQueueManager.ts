import { Client, TextChannel } from 'discord.js';
import User from '../models/User';
import Party from '../models/Party';
import { TeamBalanceResult } from '../types/GameTypes';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { MapService } from '../managers/MapManager';
import { GameManager } from './GameManager';
import config from '../config/config';
import { WorkersManager } from '../managers/WorkersManager';

import { CentralizedMatchmaker } from './CentralizedMatchmaker';

export class RandomQueueManager {
  private client: Client;
  private gameManager: GameManager;
  private wsManager: WebSocketManager;
  private mapService: MapService;
  private workersManager: WorkersManager;
  private partyCache: Map<string, { members: string[], timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000;



  constructor(client: Client, centralizedMatchmaker: CentralizedMatchmaker, wsManager: WebSocketManager) {
    this.client = client;
    this.gameManager = centralizedMatchmaker.getGameManager();
    this.wsManager = wsManager;
    this.mapService = new MapService(wsManager);
    this.workersManager = WorkersManager.getInstance();
    this.startCacheCleanup();
  }


  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [partyId, cache] of this.partyCache.entries()) {
        if (now - cache.timestamp > this.CACHE_TTL) {
          this.partyCache.delete(partyId);
        }
      }
    }, 15000);
  }

  public async processQueue(
    players: string[],
    queueData: any,
    maxGames: number = 10
  ): Promise<number> {
    try {
      let gamesCreated = 0;
      let availablePlayers = [...players];

      console.log(`[RandomQueue] Processing ${availablePlayers.length} players, max ${maxGames} games`);

      while (availablePlayers.length >= queueData.maxPlayers && gamesCreated < maxGames) {
        try {
          
          const teamResult = await this.selectBalancedTeams(availablePlayers, queueData);

          if (teamResult.team1.length + teamResult.team2.length !== queueData.maxPlayers) {
            console.warn(`[RandomQueue] Invalid team selection, breaking`);
            break;
          }

          
          const gameId = await this.gameManager.getNextGameId();
          let selectedMap = await this.selectRandomMap(queueData);
          

          
          await this.gameManager.createGame(
            gameId,
            queueData,
            teamResult.team1,
            teamResult.team2,
            selectedMap
          );

          
          const guild = this.client.guilds.cache.first();
          let gameChannel: TextChannel | null = null;
          if (guild) {
            const game = await (await import('../models/Game')).default.findOne({ gameId });
            if (game && game.channels && game.channels.text) {
              const ch = guild.channels.cache.get(game.channels.text);
              if (ch && ch.isTextBased() && ch instanceof TextChannel) {
                gameChannel = ch;
              }
            }
          }

          
          if (gameChannel) {
            await this.gameManager.updateGameMap(gameId, selectedMap);
            await this.gameManager.initiateGameWarp(gameId);
          } else {
            console.warn(`[RandomQueue] No game channel found for game ${gameId}, skipping voting and using default map`);
            
            await this.gameManager.initiateGameWarp(gameId);
          }

          
          const team1Avg = await this.calculateTeamAverageElo(teamResult.team1);
          const team2Avg = await this.calculateTeamAverageElo(teamResult.team2);
          
          const embedGuild = this.client.guilds.cache.first();
          let embedGameChannel: TextChannel | null = null;
          if (embedGuild) {
            const game = await (await import('../models/Game')).default.findOne({ gameId });
            if (game && game.channels && game.channels.text) {
              const ch = embedGuild.channels.cache.get(game.channels.text);
              if (ch && ch instanceof TextChannel) {
                embedGameChannel = ch;
              }
            }
          }
          if (embedGameChannel) {
            const embed = await this.buildGameStartEmbed(
              teamResult.team1,
              teamResult.team2,
              team1Avg,
              team2Avg,
              'Ongoing',
              gameId
            );

            
            if (config.channels.gamesChannel) {
              await this.workersManager.sendMessage(
                config.channels.gamesChannel,
                { embeds: [embed] },
                8 
              );
            }

            
            if (embedGameChannel) {
              await this.workersManager.sendMessage(
                embedGameChannel.id,
                { embeds: [embed] },
                8 
              );
            }
          }

          
          availablePlayers = availablePlayers.filter(p => !teamResult.usedPlayers.has(p));
          gamesCreated++;

          console.log(`[RandomQueue] Created game ${gameId}, ${availablePlayers.length} players remaining`);

          
          if (availablePlayers.length >= queueData.maxPlayers) {
            await this.sleep(1000);
          }

        } catch (error) {
          console.error(`[RandomQueue] Error creating game:`, error);
          break;
        }
      }

      return gamesCreated;

    } catch (error) {
      console.error(`[RandomQueue] Error processing queue:`, error);
      return 0;
    }
  }

  private async selectBalancedTeams(players: string[], queueData: any): Promise<TeamBalanceResult> {
    try {
      if (players.length < queueData.maxPlayers) {
        throw new Error('Not enough players for team selection');
      }

      const userPartyMap = new Map<string, string>();
      const partyGroups = new Map<string, string[]>();

      const users = await User.find({
        discordId: { $in: players }
      }).select('discordId partyId elo').lean();

      if (users.length === 0) {
        throw new Error('No users found in database');
      }

      for (const user of users) {
        if (user.partyId) {
          userPartyMap.set(user.discordId, user.partyId);
          if (!partyGroups.has(user.partyId)) {
            partyGroups.set(user.partyId, []);
          }
          partyGroups.get(user.partyId)!.push(user.discordId);
        }
      }

      const partyPlayers = Array.from(partyGroups.values()).flat();
      const soloPlayers = players.filter(p => !partyPlayers.includes(p));

      const sortedParties = Array.from(partyGroups.entries())
        .sort((a, b) => b[1].length - a[1].length);

      let team1: string[] = [];
      let team2: string[] = [];
      const usedPlayers = new Set<string>();

      const targetTeamSize = queueData.maxPlayers / 2;

      for (const [partyId, members] of sortedParties) {
        if (usedPlayers.size >= queueData.maxPlayers) break;

        if (members.length > targetTeamSize) {
          console.warn(`[RandomQueue] Party ${partyId} too large (${members.length} > ${targetTeamSize})`);
          continue;
        }

        const team1Space = targetTeamSize - team1.length;
        const team2Space = targetTeamSize - team2.length;

        if (team1Space >= members.length && (team1Space >= team2Space || team1.length <= team2.length)) {
          team1.push(...members);
        } else if (team2Space >= members.length) {
          team2.push(...members);
        }

        members.forEach(p => usedPlayers.add(p));
      }

      const remainingSoloPlayers = soloPlayers.filter(p => !usedPlayers.has(p));
      const userEloMap = new Map(users.map(u => [u.discordId, u.elo]));

      remainingSoloPlayers.sort((a, b) => {
        const eloA = userEloMap.get(a) || 0;
        const eloB = userEloMap.get(b) || 0;
        return eloB - eloA;
      });

      for (const playerId of remainingSoloPlayers) {
        if (usedPlayers.size >= queueData.maxPlayers) break;

        if (team1.length < targetTeamSize && team1.length <= team2.length) {
          team1.push(playerId);
        } else if (team2.length < targetTeamSize) {
          team2.push(playerId);
        }

        usedPlayers.add(playerId);
      }

      const team1Elo = await this.calculateTeamAverageElo(team1);
      const team2Elo = await this.calculateTeamAverageElo(team2);
      const averageEloDiff = Math.abs(team1Elo - team2Elo);

      return {
        team1,
        team2,
        usedPlayers,
        averageEloDiff
      };

    } catch (error) {
      console.error(`[RandomQueue] Error selecting balanced teams:`, error);
      throw error;
    }
  }

  private async calculateTeamAverageElo(playerIds: string[]): Promise<number> {
    try {
      if (playerIds.length === 0) return 0;
  
      const users = await User.find({
        discordId: { $in: playerIds }
      }).select('elo');
  
      const totalElo = users.reduce((sum, user) => sum + (user.elo || 0), 0);
      return Math.round(totalElo / playerIds.length); 
    } catch (error) {
      console.error('[PickingQueue] Error calculating team average ELO:', error);
      return 0;
    }
  }
  
  private async selectRandomMap(queueData: any): Promise<string> {
    try {
      const reservedMaps = await this.mapService.getReservedMaps();
      const candidates = reservedMaps.filter(m => (m.maxplayers ?? (m as any).max_players) === queueData.maxPlayers);

      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        console.log(`[RandomQueue] Selected reserved map: ${pick.name}`);
        return pick.name;
      }

      console.warn('[RandomQueue] No reserved maps matching queue size, falling back to unlocked maps');
      const unlockedMaps = await this.mapService.getUnlockedMaps();
      const unlockedCandidates = unlockedMaps.filter(m => (m.maxplayers ?? (m as any).max_players) === queueData.maxPlayers);

      if (unlockedCandidates.length > 0) {
        const pick = unlockedCandidates[Math.floor(Math.random() * unlockedCandidates.length)];
        return pick.name;
      }

      
      if (unlockedMaps.length > 0) {
        const pick = unlockedMaps[Math.floor(Math.random() * unlockedMaps.length)];
        return pick.name;
      }

      return 'Aquarius';

    } catch (error) {
      console.error('[RandomQueue] Error selecting map:', error);
      return 'Aquarius';
    }
  }


  

  public async validatePlayerAvailability(playerIds: string[]): Promise<string[]> {
    try {
      console.log(`[RandomQueue] Validating ${playerIds.length} players: ${playerIds.join(', ')}`);

      const users = await User.find({
        discordId: { $in: playerIds },
        isbanned: false,
        isfrozen: false
      }).select('discordId ign');

      console.log(`[RandomQueue] Found ${users.length} users in database`);

      const validPlayers: string[] = [];

      for (const user of users) {
        if (!user.ign) {
          console.log(`[RandomQueue] User ${user.discordId} has no IGN, skipping`);
          continue;
        }

        try {
          const onlineCheck = await Promise.race([
            this.wsManager.checkPlayerOnline(user.ign),
            new Promise<{ online: boolean }>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 3000)
            )
          ]).catch(() => ({ online: false }));

          if (onlineCheck.online) {
            validPlayers.push(user.discordId);
            console.log(`[RandomQueue] User ${user.ign} (${user.discordId}) is online`);
          } else {
            console.log(`[RandomQueue] User ${user.ign} (${user.discordId}) is offline`);
          }
        } catch (error) {
          console.warn(`[RandomQueue] Could not check online status for ${user.ign}: ${error}`);
        }
      }

      console.log(`[RandomQueue] Validation complete: ${validPlayers.length}/${playerIds.length} players valid`);
      console.log(`[RandomQueue] Valid players: ${validPlayers.join(', ')}`);

      return validPlayers;

    } catch (error) {
      console.error('[RandomQueue] Error validating player availability:', error);
      return [];
    }
  }

  public async getPartyMembers(partyId: string): Promise<string[]> {
    try {
      
      const cached = this.partyCache.get(partyId);
      if (cached) {
        return cached.members;
      }

      
      const party = await Party.findOne({ partyId });
      if (!party || !party.members) {
        return [];
      }

      
      this.partyCache.set(partyId, {
        members: party.members,
        timestamp: Date.now()
      });

      return party.members;

    } catch (error) {
      console.error(`[RandomQueue] Error getting party members for ${partyId}:`, error);
      return [];
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async buildGameStartEmbed(
    team1: string[],
    team2: string[],
    team1Avg: number,
    team2Avg: number,
    status: string = 'Ongoing',
    gameId: number,
  ): Promise<any> {
    const team1Value = [
      ` **Average Elo:** ${team1Avg}`,
      ` **Players:**`,
      ...team1.map(id => `‎ <@${id}>`),
      team1.length === 0 ? '‎ *(No players)*' : ''
    ].filter(Boolean).join('\n');
    const team2Value = [
      `**Average Elo:** ${team2Avg}`,
      `**Players:**`,
      ...team2.map(id => `‎ <@${id}>`),
      team2.length === 0 ? '‎ *(No players)*' : ''
    ].filter(Boolean).join('\n');
    const { EmbedBuilder } = await import('discord.js');
    return new EmbedBuilder()
      .setTitle(`Game #${gameId} Started`)
      .addFields(
        {
          name: '**TEAM GREEN**',
          value: team1Value,
          inline: true
        },
        {
          name: '**TEAM RED**',
          value: team2Value,
          inline: true
        }
      )
      .setFooter({ text: 'Season Beta' })
      .setTimestamp()
      .setColor('#00aaaa');
  }

  public cleanup(): void {
    this.partyCache.clear();
  }
}