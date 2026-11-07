import { Client } from 'discord.js';
import User from '../models/User';
import { QueueProcessingResult, TeamBalanceResult } from '../types/GameTypes';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { MapService } from '../managers/MapManager';
import { GameManager } from './GameManager';
import config from '../config/config';
import { WorkersManager } from '../managers/WorkersManager';
import { PresenceService } from '../services/PresenceService';
import { calculateTeamAverageElo, selectRandomMap as selectRandomMapUtil } from './utils';
import { themedEmbed } from '../utils/betterembed';

interface QueueLike {
  id?: unknown;
  channelId: string;
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isRanked?: boolean;
  isPicking?: boolean;
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
    maxGames: number = 10,
    token?: { cancelled: boolean }
  ): Promise<QueueProcessingResult> {
    try {
      let gamesCreated = 0;
      const usedPlayers: string[] = [];
      let availablePlayers = [...players];

      console.log(`[RandomQueue] Processing ${availablePlayers.length} players, max ${maxGames} games`);

      const userDocsById = new Map<string, { discordId: string; partyId?: string | null; elo: number }>();
      const eloById = new Map<string, number>();
      try {
        const fetched = await User.find({
          discordId: { $in: players }
        }).select('discordId partyId elo').lean();
        for (const doc of fetched ?? []) {
          userDocsById.set(doc.discordId, doc);
          if (typeof doc.elo === 'number') {
            eloById.set(doc.discordId, doc.elo);
          }
        }
      } catch (error) {
        console.error(`[RandomQueue] Error batch-fetching users:`, error);
      }
      const preloaded = { userDocsById, eloById };

      while (availablePlayers.length >= queueData.maxPlayers && gamesCreated < maxGames) {
        try {
          if (token?.cancelled) {
            console.warn(`[RandomQueue] Processing cancelled after ${gamesCreated} game(s)`);
            break;
          }
          
          const teamResult = await this.selectBalancedTeams(availablePlayers, queueData, preloaded);

          if (teamResult.team1.length + teamResult.team2.length !== queueData.maxPlayers) {
            console.warn(`[RandomQueue] Invalid team selection, breaking`);
            break;
          }

          const presentTeam = await this.revalidateDraftedPlayers(
            [...teamResult.team1, ...teamResult.team2],
            queueData
          );
          if (presentTeam.length !== queueData.maxPlayers) {
            const missing = new Set(
              [...teamResult.team1, ...teamResult.team2].filter(p => !presentTeam.includes(p))
            );
            if (missing.size === 0) {
              console.warn(`[RandomQueue] Invalid draft after revalidation, breaking`);
              break;
            }
            const missingPartyIds = new Set(
              [...missing]
                .map(p => userDocsById.get(p)?.partyId)
                .filter((id): id is string => Boolean(id))
            );
            console.warn(`[RandomQueue] ${missing.size} drafted player(s) left or entered a game, removing affected party group(s)`);
            availablePlayers = availablePlayers.filter(p => {
              if (missing.has(p)) return false;
              const partyId = userDocsById.get(p)?.partyId;
              return !partyId || !missingPartyIds.has(partyId);
            });
            continue;
          }

          if (token?.cancelled) {
            console.warn(`[RandomQueue] Processing cancelled before game creation`);
            break;
          }

          const gameId = await this.gameManager.getNextGameId();
          const selectedMap = await this.selectRandomMap(queueData, [...teamResult.team1, ...teamResult.team2]);

          if (token?.cancelled) {
            console.warn(`[RandomQueue] Processing cancelled during map selection`);
            break;
          }
          
          const resources = await this.gameManager.createGame(
            gameId,
            queueData,
            teamResult.team1,
            teamResult.team2,
            selectedMap
          );

          availablePlayers = availablePlayers.filter(p => !teamResult.usedPlayers.has(p));
          usedPlayers.push(...Array.from(teamResult.usedPlayers));
          gamesCreated++;

          const gameChannelId = resources?.gameChannel?.id;
          let warpStarted = true;
          try {
            await this.gameManager.initiateGameWarp(gameId);
          } catch (warpError) {
            warpStarted = false;
            console.error(`[RandomQueue] Game ${gameId} created but warp start failed:`, warpError);
            await this.gameManager.voidGame(gameId, 'Warp could not be started after game creation').catch(() => undefined);
          }

          if (warpStarted && gameChannelId) {
            void this.announceGameStart(
              gameId,
              teamResult.team1,
              teamResult.team2,
              gameChannelId,
              selectedMap,
              queueData,
              eloById,
            ).catch((announceError) => {
              console.error(`[RandomQueue] Failed to announce game ${gameId}:`, announceError);
            });
          } else if (!gameChannelId) {
            console.warn(`[RandomQueue] No game channel resource for game ${gameId}; start announcement skipped`);
          }

          
          console.log(`[RandomQueue] Created game ${gameId}, ${availablePlayers.length} players remaining`);

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

  private async selectBalancedTeams(
    players: string[],
    queueData: QueueLike,
    preloaded?: { userDocsById: Map<string, { discordId: string; partyId?: string | null; elo: number }>; eloById: Map<string, number> }
  ): Promise<TeamBalanceResult> {
    try {
      if (players.length < queueData.maxPlayers) {
        throw new Error('Not enough players for team selection');
      }

      const partyGroups = new Map<string, string[]>();

      let users: Array<{ discordId: string; partyId?: string | null; elo: number }>;
      let userEloMap: Map<string, number>;
      if (preloaded && preloaded.userDocsById.size > 0) {
        users = players
          .map(id => preloaded.userDocsById.get(id))
          .filter((u): u is { discordId: string; partyId?: string | null; elo: number } => Boolean(u));
        userEloMap = preloaded.eloById;
      } else {
        const fetched = await User.find({
          discordId: { $in: players }
        }).select('discordId partyId elo').lean();
        users = fetched ?? [];
        userEloMap = new Map(users.map(u => [u.discordId, u.elo]));
      }

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

      const team1Elo = await this.calculateTeamAverageElo(team1, userEloMap);
      const team2Elo = await this.calculateTeamAverageElo(team2, userEloMap);
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

  private async calculateTeamAverageElo(playerIds: string[], eloById?: Map<string, number>): Promise<number> {
    return calculateTeamAverageElo(playerIds, eloById);
  }

  private async selectRandomMap(queueData: QueueLike, playerIds?: string[]): Promise<string> {
    return selectRandomMapUtil(this.mapService, queueData, playerIds ? { playerIds } : undefined);
  }

  private async revalidateDraftedPlayers(drafted: string[], queueData: QueueLike): Promise<string[]> {
    try {
      const unique = [...new Set(drafted)];
      const guild = this.client.guilds.cache.first();
      let present: Set<string> | null = null;
      if (guild) {
        const channel = guild.channels.cache?.get(queueData.channelId) ?? await guild.channels.fetch(queueData.channelId).catch(() => null);
        if (channel && channel.isVoiceBased()) {
          present = new Set(channel.members.keys());
        }
      }
      let alive = present ? unique.filter(p => present.has(p)) : unique;
      if (alive.length === 0) return [];
      const User = (await import('../models/User')).default as unknown as {
        find: (filter: unknown) => unknown;
      };
      const userQuery: unknown = User.find({ discordId: { $in: alive } });
      const uq = userQuery as { select?: (fields: string) => { lean: () => Promise<Array<{ discordId: string; isBanned?: boolean; isFrozen?: boolean; elo?: number; ign?: string }>> }; lean?: () => Promise<Array<{ discordId: string; isBanned?: boolean; isFrozen?: boolean; elo?: number; ign?: string }>> };
      const users = typeof uq.select === 'function'
        ? await uq.select('discordId isBanned isFrozen elo ign').lean()
        : (typeof uq.lean === 'function' ? await uq.lean() : await userQuery as Array<{ discordId: string; isBanned?: boolean; isFrozen?: boolean; elo?: number; ign?: string }>);
      const eligible = new Set(
        (users ?? [])
          .filter(u => !u.isBanned && !u.isFrozen && u.elo !== undefined && u.elo >= queueData.minElo && u.elo <= queueData.maxElo)
          .filter(u => !u.ign || PresenceService.evaluate(u.ign) !== 'offline')
          .map(u => u.discordId)
      );
      alive = alive.filter(p => eligible.has(p));
      if (alive.length === 0) return [];
      const Game = (await import('../models/Game')).default as unknown as {
        findOne: (filter: unknown) => unknown;
      };
      const clashQuery: unknown = Game.findOne({
        $or: [{ team1: { $in: alive } }, { team2: { $in: alive } }],
        state: { $in: ['pending', 'active'] }
      });
      const q = clashQuery as { select?: (fields: string) => { lean: () => Promise<unknown> }; lean?: () => Promise<unknown> };
      const clash = typeof q.select === 'function'
        ? await q.select('team1 team2').lean()
        : (typeof q.lean === 'function' ? await q.lean() : await clashQuery);
      const busy = clash as unknown as { team1?: string[]; team2?: string[] } | null;
      if (busy) {
        const busySet = new Set([...(busy.team1 ?? []), ...(busy.team2 ?? [])]);
        alive = alive.filter(p => !busySet.has(p));
      }
      return alive;
    } catch (error) {
      console.error('[RandomQueue] Error revalidating drafted players, failing closed:', error);
      return [];
    }
  }

  private async announceGameStart(
    gameId: number,
    team1: string[],
    team2: string[],
    gameChannelId: string,
    selectedMap: string,
    queueData: QueueLike,
    eloById: Map<string, number>,
  ): Promise<void> {
    try {
      const team1Avg = await this.calculateTeamAverageElo(team1, eloById);
      const team2Avg = await this.calculateTeamAverageElo(team2, eloById);
      const embed = await this.buildGameStartEmbed(
        team1,
        team2,
        team1Avg,
        team2Avg,
        'Ongoing',
        gameId,
      );

      let startImage: Array<{ attachment: Buffer; name: string }> | undefined;
      try {
        const { fetchGameStartRoster, generateGameStartImageBuffer } = await import('../utils/scoreImage');
        const roster = await fetchGameStartRoster([...team1, ...team2]);
        const toTeam = (ids: string[]) => ids.map(id => {
          const entry = roster.get(id);
          return { discordId: id, username: entry?.username ?? id, elo: entry?.elo ?? 0, isCaptain: false };
        });
        if (roster.size > 0) {
          const buffer = await generateGameStartImageBuffer(gameId, toTeam(team1), toTeam(team2), {
            mapName: selectedMap,
            modeLabel: queueData.isRanked ? 'RANKED' : 'CASUAL',
          });
          startImage = [{ attachment: buffer, name: `game_${gameId}_start.png` }];
        }
      } catch (imageError) {
        console.error(`[RandomQueue] Failed to generate game start image for game ${gameId}:`, imageError);
      }

      if (config.channels.gamesChannel) {
        await this.workersManager.sendMessage(
          config.channels.gamesChannel,
          { embeds: [embed], ...(startImage ? { files: startImage } : {}) },
          8,
        );
      }

      await this.workersManager.sendMessage(
        gameChannelId,
        { embeds: [embed], ...(startImage ? { files: startImage } : {}) },
        8,
      );
    } catch (error) {
      console.error(`[RandomQueue] Error announcing start for game ${gameId}:`, error);
    }
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
    return themedEmbed('info')
      .setTitle(`Game #${gameId} Started`)
      .setDescription(`Game #${gameId} has started.`)
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
      .setColor('info');
  }
}