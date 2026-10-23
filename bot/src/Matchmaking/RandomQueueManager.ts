import { Client, TextChannel } from 'discord.js';
import User from '../models/User';
import { TeamBalanceResult, QueueProcessingResult } from '../types/GameTypes';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { MapService } from '../managers/MapManager';
import { GameManager } from './GameManager';
import config from '../config/config';
import { WorkersManager } from '../managers/WorkersManager';
import { calculateTeamAverageElo, selectRandomMap as selectRandomMapUtil } from './utils';

interface QueueLike {
  id?: unknown;
  channelId: string;
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isRanked?: boolean;
  ispicking?: boolean;
  queueType?: string;
  bypassRoles: string[];
}

export class RandomQueueManager {
  private client: Client;
  private gameManager: GameManager;
  private wsManager: WebSocketManager;
  private mapService: MapService;
  private workersManager: WorkersManager;



  constructor(client: Client, gameManager: GameManager, wsManager: WebSocketManager) {
    this.client = client;
    this.gameManager = gameManager;
    this.wsManager = wsManager;
    this.mapService = new MapService(wsManager);
    this.workersManager = WorkersManager.getInstance();
  }

  public async processQueue(
    players: string[],
    queueData: QueueLike,
    maxGames: number = 10
  ): Promise<QueueProcessingResult> {
    try {
      let gamesCreated = 0;
      const usedPlayers: string[] = [];
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
          const selectedMap = await this.selectRandomMap(queueData);
          

          
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
          usedPlayers.push(...Array.from(teamResult.usedPlayers));
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

      return { gamesCreated, usedPlayers };

    } catch (error) {
      console.error(`[RandomQueue] Error processing queue:`, error);
      return { gamesCreated: 0, usedPlayers: [] };
    }
  }

  private async selectBalancedTeams(players: string[], queueData: QueueLike): Promise<TeamBalanceResult> {
    try {
      if (players.length < queueData.maxPlayers) {
        throw new Error('Not enough players for team selection');
      }

      const partyGroups = new Map<string, string[]>();

      const users = await User.find({
        discordId: { $in: players }
      }).select('discordId partyId elo').lean();

      if (users.length === 0) {
        throw new Error('No users found in database');
      }

      const foundIds = new Set(users.map(u => u.discordId));
      const missing = players.filter(p => !foundIds.has(p));
      if (missing.length > 0) {
        throw new Error(`${missing.length} queued player(s) missing from database, aborting draft`);
      }

      for (const user of users) {
        if (user.partyId) {
          if (!partyGroups.has(user.partyId)) {
            partyGroups.set(user.partyId, []);
          }
          partyGroups.get(user.partyId)!.push(user.discordId);
        }
      }

      const partyPlayerSet = new Set(Array.from(partyGroups.values()).flat());
      const soloPlayers = players.filter(p => !partyPlayerSet.has(p));

      const sortedParties = Array.from(partyGroups.entries())
        .sort((a, b) => b[1].length - a[1].length);

      const team1: string[] = [];
      const team2: string[] = [];
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
          members.forEach(p => usedPlayers.add(p));
        } else if (team2Space >= members.length) {
          team2.push(...members);
          members.forEach(p => usedPlayers.add(p));
        } else {
          console.warn(`[RandomQueue] Party ${partyId} (${members.length} members) does not fit in either team, keeping in queue`);
        }
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
    return calculateTeamAverageElo(playerIds);
  }

  private async selectRandomMap(queueData: QueueLike): Promise<string> {
    return selectRandomMapUtil(this.mapService, queueData);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async buildGameStartEmbed(
    team1: string[],
    team2: string[],
    team1Avg: number,
    team2Avg: number,
    _status: string = 'Ongoing',
    gameId: number,
  ): Promise<import('discord.js').EmbedBuilder> {
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
}