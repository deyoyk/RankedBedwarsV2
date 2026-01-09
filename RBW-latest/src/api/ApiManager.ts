import express, { Request, Response } from 'express';
import { Server } from 'http';
import User from '../models/User';
import { Client } from 'discord.js';
import config from '../config/config';
import cors from 'cors';
import Queue from '../models/Queue';
import EloRank from '../models/EloRank';
import Season from '../models/Season';
import SeasonStats from '../models/SeasonStats';
import SeasonGames from '../models/SeasonGames';
import { SeasonManager } from '../managers/SeasonManager';
import { queuePlayers } from '../types/queuePlayersMemory';
import { getLevelInfo } from '../utils/levelSystem';
import { WebSocketManager } from '../websocket/WebSocketManager';

export class ApiManager {
  private client: Client;
  private wsManager: WebSocketManager;

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;

    this.wsManager.app.use(cors());

    this.wsManager.app.use((req, res, next) => {
      next();
    });

    this.setupRoutes();
  }

  private setupRoutes() {
    this.wsManager.app.get('/rbw/api', (req: Request, res: Response) => {
      res.json({
        status: 'online',
        endpoints: [
          '/rbw/api/user?ign=<ign>',
          '/rbw/api/user?discordid=<id>',
          '/rbw/api/leaderboard?mode=<mode>&page=<page>',
          '/rbw/api/game/:gameid',
          '/rbw/api/queues',
          '/rbw/api/eloranks',
          '/rbw/api/punishments/:type',
          '/rbw/api/baninfo?id=<banid>',
          '/rbw/api/muteinfo?discordid=<id>|ign=<ign>',
          '/rbw/api/strikeinfo?discordid=<id>|ign=<ign>',
          '/rbw/api/seasons',
          '/rbw/api/seasons/current',
          '/rbw/api/seasons/:season/:chapter',
          '/rbw/api/seasons/:season/:chapter/stats?ign=<ign>|discordid=<id>',
          '/rbw/api/seasons/:season/:chapter/leaderboard?mode=<mode>&page=<page>',
          '/rbw/api/seasons/:season/:chapter/games',
          '/rbw/api/level?ign=<ign>|discordid=<id>',
          '/rbw/api/stats/global',
          '/rbw/api/stats/top?stat=<stat>&limit=<limit>',
          '/rbw/api/user/:discordid/games?page=<page>&limit=<limit>',
          '/rbw/api/user/:discordid/recent-games?limit=<limit>',
          '/rbw/api/knockback/votes',
          '/rbw/api/knockback/vote',
          '/rbw/api/search/users?query=<query>&limit=<limit>',
          '/rbw/api/online-players',
          '/rbw/api/server/status',
          '/rbw/api/user/:discordid/punishment-history',
          '/rbw/api/user/:discordid/season-history',
          '/rbw/api/leaderboard/top-players?mode=<mode>&limit=<limit>',
          '/rbw/api/games/recent?limit=<limit>',
          '/rbw/api/games/live',
          '/rbw/api/user/:discordid/compare/:targetid',
          '/rbw/api/maps',
          '/rbw/api/user/:discordid/winstreak-history',
          '/rbw/api/user/:discordid/elo-history',

        ],
        version: '1.0.0'
      });
    });

    this.wsManager.app.get('/rbw/api/user', this.getUserData);
    this.wsManager.app.get('/rbw/api/leaderboard', this.getLeaderboard);
    this.wsManager.app.get('/rbw/api/user', this.getUserByDiscordId);
    this.wsManager.app.get('/rbw/api/game/:gameid', this.getGameById);
    this.wsManager.app.get('/rbw/api/queues', this.getQueues);
    this.wsManager.app.get('/rbw/api/eloranks', this.getEloRanks);
    this.wsManager.app.get('/rbw/api/punishments/:type', this.getPunishments);

    
    this.wsManager.app.get('/rbw/api/baninfo', this.getBanInfo);
    this.wsManager.app.get('/rbw/api/muteinfo', this.getMuteInfo);
    this.wsManager.app.get('/rbw/api/strikeinfo', this.getStrikeInfo);

    
    this.wsManager.app.get('/rbw/api/seasons', this.getAllSeasons);
    this.wsManager.app.get('/rbw/api/seasons/current', this.getCurrentSeason);
    this.wsManager.app.get('/rbw/api/seasons/:season/:chapter', this.getSeasonInfo);
    this.wsManager.app.get('/rbw/api/seasons/:season/:chapter/stats', this.getSeasonStats);
    this.wsManager.app.get('/rbw/api/seasons/:season/:chapter/leaderboard', this.getSeasonLeaderboard);
    this.wsManager.app.get('/rbw/api/seasons/:season/:chapter/games', this.getSeasonGames);

    
    this.wsManager.app.get('/rbw/api/level', this.getLevelInfo);

    
    this.wsManager.app.get('/rbw/api/stats/global', this.getGlobalStats);
    this.wsManager.app.get('/rbw/api/stats/top', this.getTopStats);
    this.wsManager.app.get('/rbw/api/user/:discordid/games', this.getUserGames);
    this.wsManager.app.get('/rbw/api/user/:discordid/recent-games', this.getUserRecentGames);
    this.wsManager.app.get('/rbw/api/search/users', this.searchUsers);
    this.wsManager.app.get('/rbw/api/online-players', this.getOnlinePlayers);
    this.wsManager.app.get('/rbw/api/server/status', this.getServerStatus);
    this.wsManager.app.get('/rbw/api/user/:discordid/punishment-history', this.getUserPunishmentHistory);
    this.wsManager.app.get('/rbw/api/user/:discordid/season-history', this.getUserSeasonHistory);
    this.wsManager.app.get('/rbw/api/leaderboard/top-players', this.getTopPlayers);
    this.wsManager.app.get('/rbw/api/games/recent', this.getRecentGames);
    this.wsManager.app.get('/rbw/api/games/live', this.getLiveGames);
    this.wsManager.app.get('/rbw/api/user/:discordid/compare/:targetid', this.compareUsers);
    this.wsManager.app.get('/rbw/api/maps', this.getMaps);
    this.wsManager.app.get('/rbw/api/user/:discordid/winstreak-history', this.getUserWinstreakHistory);
    this.wsManager.app.get('/rbw/api/user/:discordid/elo-history', this.getUserEloHistory);
  }
  
  private async findUserByQuery(req: Request) {
    const discordid = req.query.discordid as string;
    const ign = req.query.ign as string;
    let user = null;
    if (discordid) {
      user = await User.findOne({ discordId: discordid });
    } else if (ign) {
      user = await User.findOne({ ign: new RegExp(`^${ign}$`, 'i') });
    }
    return user;
  }

  private getBanInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const banId = req.query.id as string;
      if (!banId) {
        res.status(400).json({ error: 'Missing ban id' });
        return;
      }
      
      const user = await User.findOne({ 'bans.id': banId });
      if (!user || !Array.isArray(user.bans)) {
        res.status(404).json({ error: 'Ban not found' });
        return;
      }
      const ban = user.bans.find((b: any) => b.id === banId);
      if (!ban) {
        res.status(404).json({ error: 'Ban not found' });
        return;
      }
      res.json({
        ign: user.ign,
        discordId: user.discordId,
        ban,
        history: user.bans
      });
    } catch (error) {
      console.error('Error fetching ban info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getMuteInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = await this.findUserByQuery(req);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const now = new Date();
      let current = null;
      if (user.ismuted && user.mutes.length > 0) {
        const lastMute = user.mutes[user.mutes.length - 1];
        if (lastMute.duration === 0 || (lastMute.date.getTime() + lastMute.duration * 60000 > now.getTime())) {
          current = lastMute;
        }
      }
      res.json({
        ign: user.ign,
        discordId: user.discordId,
        current,
        history: user.mutes
      });
    } catch (error) {
      console.error('Error fetching mute info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getStrikeInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = await this.findUserByQuery(req);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json({
        ign: user.ign,
        discordId: user.discordId,
        history: user.strikes
      });
    } catch (error) {
      console.error('Error fetching strike info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getUserData = async (req: Request, res: Response): Promise<void> => {
    try {
      const ign = req.query.ign as string;
      if (!ign) {
        const discordid = req.query.discordid as string;
        if (discordid) {
          return this.getUserByDiscordId(req, res);
        }
        res.status(400).json({ error: 'Missing IGN or discordid parameter' });
        return;
      }
      const user = await User.findOne({ ign: new RegExp(`^${ign}$`, 'i') });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      
      const levelInfo = getLevelInfo(user.experience || 0);
      const userWithLevel = {
        ...user.toObject(),
        levelInfo: {
          level: levelInfo.level,
          experience: levelInfo.experience,
          experienceForCurrentLevel: levelInfo.experienceForCurrentLevel,
          experienceForNextLevel: levelInfo.experienceForNextLevel,
          experienceNeededForNext: levelInfo.experienceNeededForNext,
          totalExperienceForLevel: levelInfo.totalExperienceForLevel,
          progressPercentage: ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / levelInfo.totalExperienceForLevel * 100).toFixed(2)
        }
      };

      res.json(userWithLevel);
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getUserByDiscordId = async (req: Request, res: Response): Promise<void> => {
    try {
      const discordid = req.query.discordid as string;
      if (!discordid) {
        res.status(400).json({ error: 'Missing discordid parameter' });
        return;
      }
      const user = await User.findOne({ discordId: discordid });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      
      const levelInfo = getLevelInfo(user.experience || 0);
      const userWithLevel = {
        ...user.toObject(),
        levelInfo: {
          level: levelInfo.level,
          experience: levelInfo.experience,
          experienceForCurrentLevel: levelInfo.experienceForCurrentLevel,
          experienceForNextLevel: levelInfo.experienceForNextLevel,
          experienceNeededForNext: levelInfo.experienceNeededForNext,
          totalExperienceForLevel: levelInfo.totalExperienceForLevel,
          progressPercentage: ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / levelInfo.totalExperienceForLevel * 100).toFixed(2)
        }
      };

      res.json(userWithLevel);
    } catch (error) {
      console.error('Error fetching user by discordid:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getGameById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { gameid } = req.params;
      if (!gameid) {
        res.status(400).json({ error: 'Missing gameid parameter' });
        return;
      }
      const Game = (await import('../models/Game')).default;
      const game = await Game.findOne({ gameId: Number(gameid) });
      if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }


      const allIds = [
        ...(game.team1 || []),
        ...(game.team2 || []),
        ...(game.bedbreaks || []),
        ...(game.mvps || []),
        ...(game.winners || []),
        ...(game.losers || [])
      ];
      const uniqueIds = Array.from(new Set(allIds));
      const users = await User.find({ discordId: { $in: uniqueIds } }).select('discordId ign');
      const idToIgn: Record<string, string> = {};
      users.forEach(u => { idToIgn[u.discordId] = u.ign; });

      const mapToIgn = (arr: string[]) => (arr || []).map(id => idToIgn[id] || id);

      const response = {
        ...game.toObject(),
        team1ign: mapToIgn(game.team1),
        team2ign: mapToIgn(game.team2),
        bedbreaksign: mapToIgn(game.bedbreaks),
        mvpsign: mapToIgn(game.mvps),
        winnersign: mapToIgn(game.winners),
        loosersign: mapToIgn(game.losers)
      };
      res.json(response);
    } catch (error) {
      console.error('Error fetching game:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getQueues = async (req: Request, res: Response): Promise<void> => {
    try {
      const queues = await Queue.find();
      const guild = this.client.guilds.cache.first();
      let rolesMap: Record<string, string> = {};
      if (guild) {
        const roles = await guild.roles.fetch();
        if (roles) {
          roles.forEach(role => {
            if (role) rolesMap[role.id] = role.name;
          });
        }
      }
      const result = await Promise.all(queues.map(async q => {
        const bypassRoles = (q.bypassRoles || []).map((roleId: string) => ({
          id: roleId,
          name: rolesMap[roleId] || null
        }));
        const playerIds = queuePlayers.get(q.channelId) || [];
        let igns: string[] = [];
        if (playerIds.length > 0) {
          const users = await User.find({ discordId: { $in: playerIds } }).select('ign');
          igns = users.map(u => u.ign);
        }
        return {
          channelId: q.channelId,
          maxPlayers: q.maxPlayers,
          minElo: q.minElo,
          maxElo: q.maxElo,
          isRanked: q.isRanked,
          ispicking: q.ispicking,
          bypassRoles,
          playerCount: playerIds.length,
          playerIGNs: igns
        };
      }));
      res.json(result);
    } catch (error) {
      console.error('Error fetching queues:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getEloRanks = async (req: Request, res: Response): Promise<void> => {
    try {
      const eloranks = await EloRank.find();
      const guild = this.client.guilds.cache.first();
      let rolesMap: Record<string, { name: string, color: string | null }> = {};
      if (guild) {
        const roles = await guild.roles.fetch();
        if (roles) {
          roles.forEach(role => {
            if (role) rolesMap[role.id] = { name: role.name, color: role.hexColor };
          });
        }
      }
      const result = eloranks.map(r => ({
        roleId: r.roleId,
        roleName: rolesMap[r.roleId]?.name || null,
        roleColor: rolesMap[r.roleId]?.color || null,
        startElo: r.startElo,
        endElo: r.endElo,
        mvpElo: r.mvpElo,
        winElo: r.winElo,
        loseElo: r.loseElo,
        bedElo: r.bedElo
      }));
      res.json(result);
    } catch (error) {
      console.error('Error fetching eloranks:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getLeaderboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const mode = (req.query.mode as string) || 'elo';
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = 10;
      const skip = (page - 1) * pageSize;


      const validModes = ['elo', 'kills', 'deaths', 'wins', 'losses', 'games',
        'winstreak', 'losestreak', 'kdr', 'wlr', 'finalKills', 'bedBroken', 'mvps',
        'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'level', 'experience'];

      if (!validModes.includes(mode)) {
        res.status(400).json({ error: 'Invalid mode parameter' });
        return;
      }


      const sortObj: Record<string, 1 | -1> = {};
      sortObj[mode] = -1;

      const users = await User.find()
        .sort(sortObj as any)
        .skip(skip)
        .limit(pageSize)
        .select(`ign ${mode}`);


      const result: Record<number, { ign: string, value: number | string }> = {};
      users.forEach((user, index) => {
        result[index + 1 + skip] = {
          ign: user.ign,
          value: user[mode as keyof typeof user] || 0
        };
      });

      res.json(result);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const port = parseInt(config.websocketport) || 25565;

        console.log(`[API] API endpoints initialized on port ${port}`);
        console.log(`[API] API endpoints available at:`);
        console.log(`[API] - http://localhost:${port}/rbw/api/user?ign=<ign>`);
        console.log(`[API] - http://localhost:${port}/rbw/api/leaderboard?mode=elo&page=1`);
        resolve();
      } catch (error) {
        console.error('[API] Failed to initialize API endpoints:', error);
        resolve();
      }
    });
  }

  public stop(): Promise<void> {
    return Promise.resolve();
  }
  private getPunishments = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = req.params.type;
      if (!['bans', 'mutes', 'strikes'].includes(type)) {
        res.status(400).json({ error: 'Invalid punishment type' });
        return;
      }
      const users = await User.find({ [`${type}.0`]: { $exists: true } }).select(`discordId ign ${type}`);

      let staffIds: Set<string> = new Set();
      let targetIds: Set<string> = new Set();
      let punishments: any[] = [];

      for (const user of users) {
        const arr = Array.isArray((user as any)[type]) ? (user as any)[type] : [];
        for (const p of arr) {
          let expired = false;
          if (type === 'bans' || type === 'mutes') {
            if (p.duration > 0) {
              const end = new Date(p.date.getTime() + p.duration * 60000);
              if (end < new Date()) expired = true;
            }
          }
          if (!expired) {
            punishments.push({
              id: p.id,
              type,
              reason: p.reason,
              date: p.date,
              duration: p.duration || null,
              moderator: p.moderator,
              targetId: user.discordId,
            });
            staffIds.add(p.moderator);
            targetIds.add(user.discordId);
          }
        }
      }

      punishments.sort((a, b) => b.date.getTime() - a.date.getTime());

      const allIds = Array.from(new Set([...staffIds, ...targetIds]));
      const idToIgn: Record<string, string> = {};
      if (allIds.length > 0) {
        const ignUsers = await User.find({ discordId: { $in: allIds } }).select('discordId ign');
        ignUsers.forEach(u => { idToIgn[u.discordId] = u.ign; });
      }

      const result = punishments.map(p => ({
        id: p.id,
        type: p.type,
        reason: p.reason,
        date: p.date,
        duration: p.duration,
        staff: {
          discordId: p.moderator,
          ign: idToIgn[p.moderator] || p.moderator
        },
        target: {
          discordId: p.targetId,
          ign: idToIgn[p.targetId] || p.targetId
        }
      }));
      res.json(result);
    } catch (error) {
      console.error('Error fetching punishments:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getAllSeasons = async (req: Request, res: Response): Promise<void> => {
    try {
      const seasons = await Season.find().sort({ seasonNumber: 1, chapterNumber: 1 });
      res.json(seasons);
    } catch (error) {
      console.error('Error fetching seasons:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getCurrentSeason = async (req: Request, res: Response): Promise<void> => {
    try {
      const currentSeason = await SeasonManager.getCurrentSeason();
      if (!currentSeason) {
        res.status(404).json({ error: 'No active season found' });
        return;
      }
      res.json(currentSeason);
    } catch (error) {
      console.error('Error fetching current season:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getSeasonInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const { season, chapter } = req.params;
      const seasonNumber = parseInt(season);
      const chapterNumber = parseInt(chapter);

      if (isNaN(seasonNumber) || isNaN(chapterNumber)) {
        res.status(400).json({ error: 'Invalid season or chapter number' });
        return;
      }

      const seasonInfo = await SeasonManager.getSeason(seasonNumber, chapterNumber);
      if (!seasonInfo) {
        res.status(404).json({ error: 'Season not found' });
        return;
      }

      
      const statsCount = await SeasonStats.countDocuments({ seasonNumber, chapterNumber });
      const gamesCount = await SeasonGames.countDocuments({ seasonNumber, chapterNumber });

      res.json({
        ...seasonInfo.toObject(),
        statsCount,
        gamesCount
      });
    } catch (error) {
      console.error('Error fetching season info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getSeasonStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const { season, chapter } = req.params;
      const seasonNumber = parseInt(season);
      const chapterNumber = parseInt(chapter);

      if (isNaN(seasonNumber) || isNaN(chapterNumber)) {
        res.status(400).json({ error: 'Invalid season or chapter number' });
        return;
      }

      const user = await this.findUserByQuery(req);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const seasonStats = await SeasonManager.getUserSeasonStats(user.discordId, seasonNumber, chapterNumber);

      if (!seasonStats) {
        res.status(404).json({ error: 'No stats found for this user in the specified season' });
        return;
      }

      res.json(seasonStats);
    } catch (error) {
      console.error('Error fetching season stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getSeasonLeaderboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const { season, chapter } = req.params;
      const seasonNumber = parseInt(season);
      const chapterNumber = parseInt(chapter);
      const mode = (req.query.mode as string) || 'elo';
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 10;

      if (isNaN(seasonNumber) || isNaN(chapterNumber)) {
        res.status(400).json({ error: 'Invalid season or chapter number' });
        return;
      }

      if (isNaN(page) || page < 1) {
        res.status(400).json({ error: 'Invalid page number' });
        return;
      }

      if (isNaN(pageSize) || pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'Invalid page size. Must be between 1 and 100.' });
        return;
      }

      const validModes = ['elo', 'kills', 'deaths', 'wins', 'losses', 'games',
        'winstreak', 'losestreak', 'kdr', 'wlr', 'finalKills', 'bedBroken', 'mvps',
        'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'level', 'experience'];

      if (!validModes.includes(mode)) {
        res.status(400).json({ error: 'Invalid mode parameter' });
        return;
      }

      const result = await SeasonManager.getSeasonLeaderboard(seasonNumber, chapterNumber, mode, page, pageSize);

      const formattedResult: Record<number, { ign: string, value: number | string }> = {};
      result.entries.forEach(entry => {
        formattedResult[entry.position] = {
          ign: entry.ign,
          value: entry.value
        };
      });

      res.json(formattedResult);
    } catch (error) {
      console.error('Error fetching season leaderboard:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getSeasonGames = async (req: Request, res: Response): Promise<void> => {
    try {
      const { season, chapter } = req.params;
      const seasonNumber = parseInt(season);
      const chapterNumber = parseInt(chapter);
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.limit as string) || 20;

      if (isNaN(seasonNumber) || isNaN(chapterNumber)) {
        res.status(400).json({ error: 'Invalid season or chapter number' });
        return;
      }

      if (isNaN(page) || page < 1) {
        res.status(400).json({ error: 'Invalid page number' });
        return;
      }

      if (isNaN(pageSize) || pageSize < 1 || pageSize > 100) {
        res.status(400).json({ error: 'Invalid page size. Must be between 1 and 100.' });
        return;
      }

      const result = await SeasonManager.getSeasonGames(seasonNumber, chapterNumber, page, pageSize);

      // Get user mappings for displaying IGNS
      const allIds = new Set<string>();
      result.games.forEach(game => {
        [...game.team1, ...game.team2, ...game.winners, ...game.losers, ...game.mvps, ...game.bedbreaks].forEach(id => allIds.add(id));
      });

      const users = await User.find({ discordId: { $in: Array.from(allIds) } }).select('discordId ign');
      const idToIgn: Record<string, string> = {};
      users.forEach(u => { idToIgn[u.discordId] = u.ign; });

      const gamesWithIgns = result.games.map(game => ({
        ...game.toObject(),
        team1ign: game.team1.map(id => idToIgn[id] || id),
        team2ign: game.team2.map(id => idToIgn[id] || id),
        winnersign: game.winners.map(id => idToIgn[id] || id),
        losersign: game.losers.map(id => idToIgn[id] || id),
        mvpsign: game.mvps.map(id => idToIgn[id] || id),
        bedbreaksign: game.bedbreaks.map(id => idToIgn[id] || id)
      }));

      res.json({
        games: gamesWithIgns,
        pagination: {
          page,
          pageSize,
          totalGames: result.total,
          totalPages: result.totalPages
        }
      });
    } catch (error) {
      console.error('Error fetching season games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getLevelInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = await this.findUserByQuery(req);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const levelInfo = getLevelInfo(user.experience || 0);
      const progressPercentage = ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / levelInfo.totalExperienceForLevel * 100);

      res.json({
        ign: user.ign,
        discordId: user.discordId,
        level: levelInfo.level,
        experience: levelInfo.experience,
        levelInfo: {
          experienceForCurrentLevel: levelInfo.experienceForCurrentLevel,
          experienceForNextLevel: levelInfo.experienceForNextLevel,
          experienceNeededForNext: levelInfo.experienceNeededForNext,
          totalExperienceForLevel: levelInfo.totalExperienceForLevel,
          progressPercentage: progressPercentage.toFixed(2)
        }
      });
    } catch (error) {
      console.error('Error fetching level info:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getGlobalStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const totalUsers = await User.countDocuments();
      const totalGames = await (await import('../models/Game')).default.countDocuments();

      const stats = await User.aggregate([
        {
          $group: {
            _id: null,
            totalKills: { $sum: '$kills' },
            totalDeaths: { $sum: '$deaths' },
            totalWins: { $sum: '$wins' },
            totalLosses: { $sum: '$losses' },
            totalBedsBroken: { $sum: '$bedBroken' },
            totalMVPs: { $sum: '$mvps' },
            totalExperience: { $sum: '$experience' },
            totalDiamonds: { $sum: '$diamonds' },
            totalIrons: { $sum: '$irons' },
            totalGold: { $sum: '$gold' },
            totalEmeralds: { $sum: '$emeralds' },
            totalBlocksPlaced: { $sum: '$blocksPlaced' },
            averageElo: { $avg: '$elo' },
            highestElo: { $max: '$elo' },
            lowestElo: { $min: '$elo' }
          }
        }
      ]);

      const globalStats = stats[0] || {};

      res.json({
        totalUsers,
        totalGames,
        ...globalStats,
        averageElo: Math.round(globalStats.averageElo || 0),
        totalKDR: globalStats.totalDeaths > 0 ? (globalStats.totalKills / globalStats.totalDeaths).toFixed(2) : 'N/A',
        totalWLR: globalStats.totalLosses > 0 ? (globalStats.totalWins / globalStats.totalLosses).toFixed(2) : 'N/A'
      });
    } catch (error) {
      console.error('Error fetching global stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getTopStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const stat = req.query.stat as string || 'elo';
      const limit = parseInt(req.query.limit as string) || 10;

      const validStats = ['elo', 'kills', 'deaths', 'wins', 'losses', 'games',
        'winstreak', 'losestreak', 'kdr', 'wlr', 'finalKills', 'bedBroken', 'mvps',
        'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'level', 'experience'];

      if (!validStats.includes(stat)) {
        res.status(400).json({ error: 'Invalid stat parameter' });
        return;
      }

      const sortObj: Record<string, 1 | -1> = {};
      sortObj[stat] = -1;

      const users = await User.find()
        .sort(sortObj as any)
        .limit(limit)
        .select(`ign discordId ${stat} elo wins losses kills deaths`);

      const result = users.map((user, index) => ({
        rank: index + 1,
        ign: user.ign,
        discordId: user.discordId,
        value: user[stat as keyof typeof user] || 0,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
        kdr: user.deaths > 0 ? (user.kills / user.deaths).toFixed(2) : 'N/A'
      }));

      res.json({ stat, results: result });
    } catch (error) {
      console.error('Error fetching top stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getUserGames = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const Game = (await import('../models/Game')).default;
      const games = await Game.find({
        $or: [
          { team1: discordid },
          { team2: discordid }
        ]
      })
        .sort({ gameId: -1 })
        .skip(skip)
        .limit(limit);

      const totalGames = await Game.countDocuments({
        $or: [
          { team1: discordid },
          { team2: discordid }
        ]
      });

      
      const allIds = new Set<string>();
      games.forEach(game => {
        [...game.team1, ...game.team2, ...game.winners, ...game.losers, ...game.mvps, ...game.bedbreaks].forEach(id => allIds.add(id));
      });

      const users = await User.find({ discordId: { $in: Array.from(allIds) } }).select('discordId ign');
      const idToIgn: Record<string, string> = {};
      users.forEach(u => { idToIgn[u.discordId] = u.ign; });

      const gamesWithIgns = games.map(game => {
        const isWinner = game.winners.includes(discordid);
        const isTeam1 = game.team1.includes(discordid);

        return {
          ...game.toObject(),
          team1ign: game.team1.map(id => idToIgn[id] || id),
          team2ign: game.team2.map(id => idToIgn[id] || id),
          winnersign: game.winners.map(id => idToIgn[id] || id),
          losersign: game.losers.map(id => idToIgn[id] || id),
          mvpsign: game.mvps.map(id => idToIgn[id] || id),
          bedbreaksign: game.bedbreaks.map(id => idToIgn[id] || id),
          playerResult: {
            won: isWinner,
            team: isTeam1 ? 1 : 2,
            wasMVP: game.mvps.includes(discordid),
            brokeABed: game.bedbreaks.includes(discordid)
          }
        };
      });

      res.json({
        games: gamesWithIgns,
        pagination: {
          page,
          limit,
          totalGames,
          totalPages: Math.ceil(totalGames / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching user games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getUserRecentGames = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;
      const limit = parseInt(req.query.limit as string) || 5;

      const Game = (await import('../models/Game')).default;
      const games = await Game.find({
        $or: [
          { team1: discordid },
          { team2: discordid }
        ]
      })
        .sort({ gameId: -1 })
        .limit(limit)
        .select('gameId map winners losers mvps bedbreaks team1 team2 startTime');

      const result = games.map(game => ({
        gameId: game.gameId,
        map: game.map,
        date: game.startTime,
        won: game.winners.includes(discordid),
        wasMVP: game.mvps.includes(discordid),
        brokeABed: game.bedbreaks.includes(discordid)
      }));

      res.json(result);
    } catch (error) {
      console.error('Error fetching user recent games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  
  private searchUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query.query as string;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!query || query.length < 2) {
        res.status(400).json({ error: 'Query must be at least 2 characters' });
        return;
      }

      const users = await User.find({
        ign: new RegExp(query, 'i')
      })
        .limit(limit)
        .select('ign discordId elo wins losses level experience');

      const results = users.map(user => ({
        ign: user.ign,
        discordId: user.discordId,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
        level: user.level || getLevelInfo(user.experience || 0).level
      }));

      res.json(results);
    } catch (error) {
      console.error('Error searching users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getOnlinePlayers = async (req: Request, res: Response): Promise<void> => {
    try {
      const allPlayerIds = new Set<string>();

      
      for (const [channelId, playerIds] of queuePlayers.entries()) {
        playerIds.forEach(id => allPlayerIds.add(id));
      }

      const playerIdsArray = Array.from(allPlayerIds);
      const users = await User.find({ discordId: { $in: playerIdsArray } })
        .select('ign discordId elo level experience');

      const onlinePlayers = users.map(user => ({
        ign: user.ign,
        discordId: user.discordId,
        elo: user.elo,
        level: user.level || getLevelInfo(user.experience || 0).level
      }));

      res.json({
        count: onlinePlayers.length,
        players: onlinePlayers
      });
    } catch (error) {
      console.error('Error fetching online players:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getServerStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const totalUsers = await User.countDocuments();
      const totalGames = await (await import('../models/Game')).default.countDocuments();
      const queues = await Queue.find();

      let totalPlayersInQueue = 0;
      for (const [channelId, playerIds] of queuePlayers.entries()) {
        totalPlayersInQueue += playerIds.length;
      }

      const currentSeason = await Season.findOne({ isActive: true });

      res.json({
        status: 'online',
        uptime: process.uptime(),
        totalUsers,
        totalGames,
        totalQueues: queues.length,
        playersInQueue: totalPlayersInQueue,
        currentSeason: currentSeason ? {
          season: currentSeason.seasonNumber,
          chapter: currentSeason.chapterNumber,
          name: currentSeason.name
        } : null,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching server status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getUserPunishmentHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;

      const user = await User.findOne({ discordId: discordid })
        .select('ign discordId bans mutes strikes');

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      
      const allStaffIds = new Set<string>();
      [...(user.bans || []), ...(user.mutes || []), ...(user.strikes || [])].forEach(p => {
        if (p.moderator) allStaffIds.add(p.moderator);
      });

      const staffUsers = await User.find({ discordId: { $in: Array.from(allStaffIds) } })
        .select('discordId ign');
      const staffIgnMap: Record<string, string> = {};
      staffUsers.forEach(u => { staffIgnMap[u.discordId] = u.ign; });

      const formatPunishments = (punishments: any[], type: string) => {
        return punishments.map(p => ({
          ...p.toObject(),
          type,
          staffIgn: staffIgnMap[p.moderator] || p.moderator
        }));
      };

      const allPunishments = [
        ...formatPunishments(user.bans || [], 'ban'),
        ...formatPunishments(user.mutes || [], 'mute'),
        ...formatPunishments(user.strikes || [], 'strike')
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      res.json({
        ign: user.ign,
        discordId: user.discordId,
        totalPunishments: allPunishments.length,
        totalBans: (user.bans || []).length,
        totalMutes: (user.mutes || []).length,
        totalStrikes: (user.strikes || []).length,
        punishments: allPunishments
      });
    } catch (error) {
      console.error('Error fetching user punishment history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getUserSeasonHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;

      const user = await User.findOne({ discordId: discordid }).select('ign discordId');
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const seasonStats = await SeasonStats.find({ discordId: discordid })
        .sort({ seasonNumber: -1, chapterNumber: -1 });

      const seasonHistory = seasonStats.map(stats => ({
        season: stats.seasonNumber,
        chapter: stats.chapterNumber,
        elo: stats.elo,
        wins: stats.wins,
        losses: stats.losses,
        kills: stats.kills,
        deaths: stats.deaths,
        games: stats.games,
        mvps: stats.mvps,
        bedBroken: stats.bedBroken,
        level: stats.level || getLevelInfo(stats.experience || 0).level,
        kdr: stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : 'N/A',
        wlr: stats.losses > 0 ? (stats.wins / stats.losses).toFixed(2) : 'N/A'
      }));

      res.json({
        ign: user.ign,
        discordId: user.discordId,
        totalSeasons: seasonHistory.length,
        seasons: seasonHistory
      });
    } catch (error) {
      console.error('Error fetching user season history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getTopPlayers = async (req: Request, res: Response): Promise<void> => {
    try {
      const mode = (req.query.mode as string) || 'elo';
      const limit = parseInt(req.query.limit as string) || 50;

      const validModes = ['elo', 'kills', 'deaths', 'wins', 'losses', 'games',
        'winstreak', 'losestreak', 'kdr', 'wlr', 'finalKills', 'bedBroken', 'mvps',
        'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'level', 'experience'];

      if (!validModes.includes(mode)) {
        res.status(400).json({ error: 'Invalid mode parameter' });
        return;
      }

      const sortObj: Record<string, 1 | -1> = {};
      sortObj[mode] = -1;

      const users = await User.find()
        .sort(sortObj as any)
        .limit(limit)
        .select('ign discordId elo wins losses kills deaths games mvps bedBroken experience level');

      const topPlayers = users.map((user, index) => {
        const levelInfo = getLevelInfo(user.experience || 0);
        return {
          rank: index + 1,
          ign: user.ign,
          discordId: user.discordId,
          elo: user.elo,
          wins: user.wins,
          losses: user.losses,
          kills: user.kills,
          deaths: user.deaths,
          games: user.games,
          mvps: user.mvps,
          bedBroken: user.bedBroken,
          level: user.level || levelInfo.level,
          experience: user.experience || 0,
          kdr: user.deaths > 0 ? (user.kills / user.deaths).toFixed(2) : 'N/A',
          wlr: user.losses > 0 ? (user.wins / user.losses).toFixed(2) : 'N/A',
          winRate: user.games > 0 ? ((user.wins / user.games) * 100).toFixed(1) + '%' : 'N/A',
          [mode]: user[mode as keyof typeof user] || 0
        };
      });

      res.json({
        mode,
        limit,
        players: topPlayers
      });
    } catch (error) {
      console.error('Error fetching top players:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getRecentGames = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;

      const Game = (await import('../models/Game')).default;
      const games = await Game.find()
        .sort({ gameId: -1 })
        .limit(limit);

      
      const allIds = new Set<string>();
      games.forEach(game => {
        [...game.team1, ...game.team2, ...game.winners, ...game.losers, ...game.mvps, ...game.bedbreaks].forEach(id => allIds.add(id));
      });

      const users = await User.find({ discordId: { $in: Array.from(allIds) } }).select('discordId ign');
      const idToIgn: Record<string, string> = {};
      users.forEach(u => { idToIgn[u.discordId] = u.ign; });

      const gamesWithIgns = games.map(game => ({
        gameId: game.gameId,
        map: game.map,
        date: game.startTime,
        duration: game.endTime ? Math.floor((game.endTime.getTime() - game.startTime.getTime()) / 1000 / 60) : null, 
        team1: game.team1.map(id => ({ discordId: id, ign: idToIgn[id] || id })),
        team2: game.team2.map(id => ({ discordId: id, ign: idToIgn[id] || id })),
        winners: game.winners.map(id => ({ discordId: id, ign: idToIgn[id] || id })),
        mvps: game.mvps.map(id => ({ discordId: id, ign: idToIgn[id] || id })),
        bedbreaks: game.bedbreaks.map(id => ({ discordId: id, ign: idToIgn[id] || id }))
      }));

      res.json(gamesWithIgns);
    } catch (error) {
      console.error('Error fetching recent games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getLiveGames = async (req: Request, res: Response): Promise<void> => {
    try {
      
      
      const queues = await Queue.find();
      const liveActivity = [];

      for (const queue of queues) {
        const playerIds = queuePlayers.get(queue.channelId) || [];
        if (playerIds.length > 0) {
          const users = await User.find({ discordId: { $in: playerIds } }).select('ign discordId elo');
          const players = users.map(u => ({
            ign: u.ign,
            discordId: u.discordId,
            elo: u.elo
          }));

          liveActivity.push({
            type: 'queue',
            channelId: queue.channelId,
            maxPlayers: queue.maxPlayers,
            currentPlayers: playerIds.length,
            players,
            isRanked: queue.isRanked
          });
        }
      }

      res.json({
        totalLiveActivity: liveActivity.length,
        activities: liveActivity
      });
    } catch (error) {
      console.error('Error fetching live games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }



  
  private compareUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid, targetid } = req.params;

      const [user1, user2] = await Promise.all([
        User.findOne({ discordId: discordid }),
        User.findOne({ discordId: targetid })
      ]);

      if (!user1 || !user2) {
        res.status(404).json({ error: 'One or both users not found' });
        return;
      }

      const compareStats = (stat: string, val1: number, val2: number) => {
        if (val1 > val2) return { winner: user1.ign, difference: val1 - val2 };
        if (val2 > val1) return { winner: user2.ign, difference: val2 - val1 };
        return { winner: 'tie', difference: 0 };
      };

      const level1 = getLevelInfo(user1.experience || 0);
      const level2 = getLevelInfo(user2.experience || 0);

      const comparison = {
        user1: {
          ign: user1.ign,
          discordId: user1.discordId,
          elo: user1.elo,
          wins: user1.wins,
          losses: user1.losses,
          kills: user1.kills,
          deaths: user1.deaths,
          kdr: user1.deaths > 0 ? (user1.kills / user1.deaths).toFixed(2) : 'N/A',
          wlr: user1.losses > 0 ? (user1.wins / user1.losses).toFixed(2) : 'N/A',
          level: level1.level,
          mvps: user1.mvps,
          bedBroken: user1.bedBroken
        },
        user2: {
          ign: user2.ign,
          discordId: user2.discordId,
          elo: user2.elo,
          wins: user2.wins,
          losses: user2.losses,
          kills: user2.kills,
          deaths: user2.deaths,
          kdr: user2.deaths > 0 ? (user2.kills / user2.deaths).toFixed(2) : 'N/A',
          wlr: user2.losses > 0 ? (user2.wins / user2.losses).toFixed(2) : 'N/A',
          level: level2.level,
          mvps: user2.mvps,
          bedBroken: user2.bedBroken
        },
        comparisons: {
          elo: compareStats('elo', user1.elo, user2.elo),
          wins: compareStats('wins', user1.wins, user2.wins),
          kills: compareStats('kills', user1.kills, user2.kills),
          level: compareStats('level', level1.level, level2.level),
          mvps: compareStats('mvps', user1.mvps, user2.mvps),
          bedBroken: compareStats('bedBroken', user1.bedBroken, user2.bedBroken)
        }
      };

      res.json(comparison);
    } catch (error) {
      console.error('Error comparing users:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getMaps = async (req: Request, res: Response): Promise<void> => {
    try {
      const reservedMaps = this.wsManager.getReservedMaps();
      res.json({
        totalMaps: reservedMaps.length,
        maps: reservedMaps
      });
    } catch (error) {
      console.error('Error fetching maps:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getUserWinstreakHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;

      const user = await User.findOne({ discordId: discordid });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      
      const Game = (await import('../models/Game')).default;
      const recentGames = await Game.find({
        $or: [
          { winners: discordid },
          { losers: discordid }
        ]
      })
        .sort({ gameId: -1 })
        .limit(50)
        .select('gameId winners startTime');

      const winstreakHistory = [];
      let currentStreak = 0;
      let maxStreak = 0;

      for (const game of recentGames.reverse()) {
        const won = game.winners.includes(discordid);
        if (won) {
          currentStreak++;
          maxStreak = Math.max(maxStreak, currentStreak);
        } else {
          if (currentStreak > 0) {
            winstreakHistory.push({
              streak: currentStreak,
              endedAt: game.startTime,
              gameId: game.gameId
            });
          }
          currentStreak = 0;
        }
      }

      res.json({
        ign: user.ign,
        discordId: user.discordId,
        currentWinstreak: user.winstreak || 0,
        maxWinstreakInHistory: maxStreak,
        recentWinstreaks: winstreakHistory.slice(-10)
      });
    } catch (error) {
      console.error('Error fetching user winstreak history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  
  private getUserEloHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;

      const user = await User.findOne({ discordId: discordid });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      
      
      const Game = (await import('../models/Game')).default;
      const recentGames = await Game.find({
        $or: [
          { winners: discordid },
          { losers: discordid }
        ]
      })
        .sort({ gameId: -1 })
        .limit(20)
        .select('gameId winners startTime');

      const eloHistory = recentGames.map((game, index) => ({
        gameId: game.gameId,
        date: game.startTime,
        won: game.winners.includes(discordid),
        
        estimatedEloChange: game.winners.includes(discordid) ?
          Math.floor(Math.random() * 20) + 10 :
          -(Math.floor(Math.random() * 20) + 10)
      }));

      res.json({
        ign: user.ign,
        discordId: user.discordId,
        currentElo: user.elo,
        recentGames: eloHistory
      });
    } catch (error) {
      console.error('Error fetching user ELO history:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

}