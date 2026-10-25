import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { rateLimit } from 'express-rate-limit';
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
import { escapeRegex } from '../utils/regexEscape';
import botPackage from '../../package.json';
import type { IUser } from '../models/User';
import type { IGame } from '../models/Game';
import type { IGameBase, ICombatEntry } from '../models/gameTypes';
import type { FlattenMaps, Model } from 'mongoose';

type LeanUser = FlattenMaps<IUser>;
type LeanGame = FlattenMaps<IGame>;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

interface CollectedPunishment {
  id: string;
  type: string;
  reason: string;
  date: Date;
  duration: number | null;
  moderator: string;
  targetId: string;
}

interface StoredPunishment {
  id: string;
  reason: string;
  date: Date;
  duration?: number;
  moderator: string;
}

interface ApiStatusError extends Error {
  statusCode?: number;
}

export class ApiManager {
  private client: Client;
  private wsManager: WebSocketManager;
  private gameModel: Model<IGame> | null = null;
  private cache: Map<string, CacheEntry> = new Map();
  private inflight: Map<string, Promise<unknown>> = new Map();

  private globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: parseInt(process.env.RBW_RATE_LIMIT_MAX || '300', 10),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    handler: (req, res) => {
      res.status(429).json({ error: 'Too many requests, slow down' });
    }
  });

  private strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: parseInt(process.env.RBW_RATE_LIMIT_STRICT_MAX || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    handler: (req, res) => {
      res.status(429).json({ error: 'Too many requests, slow down' });
    }
  });

  constructor(client: Client, wsManager: WebSocketManager) {
    this.client = client;
    this.wsManager = wsManager;

    this.wsManager.app.use(cors());

    const webDir = this.resolveWebDir();
    if (webDir) {
      this.wsManager.app.use(express.static(webDir, { index: 'index.html', maxAge: '1h' }));
      console.log(`[API] Serving web UI from ${webDir}`);
    }

    this.wsManager.app.get('/rbw/web/config', (req: Request, res: Response) => {
      res.json({
        apiBase: '',
        apiKeyRequired: process.env.RBW_PUBLIC_API !== 'true',
        rateLimited: true,
        siteVersion: 1
      });
    });

    this.wsManager.app.use(this.globalLimiter);

    this.wsManager.app.use((req, res, next) => {
      if (this.isHeavyEndpoint(req.path)) {
        this.strictLimiter(req, res, next);
        return;
      }
      next();
    });

    this.wsManager.app.use((req, res, next) => {
      const apiKey = req.headers['x-api-key'] || req.query.key;
      const authKey = process.env.AUTH_KEY;
      const publicReadOnly = process.env.RBW_PUBLIC_API === 'true';
      if (authKey && apiKey !== authKey && !(publicReadOnly && !apiKey)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });

    this.setupRoutes();
  }

  private isHeavyEndpoint(path: string): boolean {
    return (
      path.startsWith('/rbw/api/leaderboard') ||
      path === '/rbw/api/stats/top' ||
      /^\/rbw\/api\/seasons\/[^/]+\/[^/]+\/leaderboard$/.test(path) ||
      /^\/rbw\/api\/user\/[^/]+\/compare\/[^/]+$/.test(path) ||
      path === '/rbw/api/search/users'
    );
  }

  private resolveWebDir(): string | null {
    const bases = [
      process.env.RBW_WEB_DIR,
      path.resolve(process.cwd(), '..', 'web'),
      path.resolve(process.cwd(), 'web'),
      path.resolve(__dirname, '..', '..', 'web'),
      path.resolve(__dirname, '..', 'web')
    ];
    for (const base of bases) {
      if (!base) continue;
      try {
        if (fs.existsSync(path.join(base, 'out', 'index.html'))) {
          return path.join(base, 'out');
        }
        if (fs.existsSync(path.join(base, 'index.html'))) {
          return base;
        }
      } catch {
      }
    }
    return null;
  }

  private async getCached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > now) {
      return entry.value as T;
    }
    const ongoing = this.inflight.get(key);
    if (ongoing) {
      return ongoing as Promise<T>;
    }
    const task = (async () => {
      try {
        const value = await fetcher();
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
        if (this.cache.size > 100) {
          const sweepNow = Date.now();
          for (const [k, e] of this.cache) {
            if (e.expiresAt <= sweepNow) this.cache.delete(k);
          }
          while (this.cache.size > 100) {
            const oldest = this.cache.keys().next();
            if (oldest.done) break;
            this.cache.delete(oldest.value);
          }
        }
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, task);
    return task;
  }

  private setupRoutes() {
    this.wsManager.app.get('/rbw/api', (req: Request, res: Response) => {
      res.json({
        status: 'online',
        note: 'New clients: prefer GET /rbw/api/user/:discordid/overview - a single consolidated user profile (stats, recent games, level, streak, season history) that supersedes multiple separate calls.',
        endpoints: [
          '/rbw/api/user?ign=<ign>',
          '/rbw/api/user?discordid=<id>',
          '/rbw/api/user/:discordid/overview',
          '/rbw/api/leaderboard?mode=<mode>&page=<page>',
          '/rbw/api/game/:gameid',
          '/rbw/api/game/:gameid/timeline',
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
        version: botPackage.version
      });
    });

    this.wsManager.app.get('/rbw/api/user', this.getUserData);
    this.wsManager.app.get('/rbw/api/leaderboard', this.getLeaderboard);
    this.wsManager.app.get('/rbw/api/game/:gameid', this.getGameById);
    this.wsManager.app.get('/rbw/api/game/:gameid/timeline', this.getGameTimeline);
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
    this.wsManager.app.get('/rbw/api/user/:discordid/overview', this.getUserOverview);
  }

  private async findUserByQuery(req: Request) {
    const discordid = req.query.discordid as string;
    const ign = req.query.ign as string;
    let user = null;
    if (discordid) {
      user = await User.findOne({ discordId: discordid }).lean();
    } else if (ign) {
      user = await User.findOne({ ign: new RegExp(`^${escapeRegex(ign)}$`, 'i') }).lean();
    }
    return user;
  }

  private validateSeasonChapter(req: Request, res: Response): { seasonNumber: number; chapterNumber: number } | null {
    const { season, chapter } = req.params;
    const seasonNumber = parseInt(season);
    const chapterNumber = parseInt(chapter);
    if (isNaN(seasonNumber) || isNaN(chapterNumber)) {
      res.status(400).json({ error: 'Invalid season or chapter number' });
      return null;
    }
    return { seasonNumber, chapterNumber };
  }

  private validatePagination(req: Request, res: Response, defaultPageSize = 20): { page: number; pageSize: number } | null {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.limit as string || req.query.pageSize as string) || defaultPageSize;
    if (isNaN(page) || page < 1) {
      res.status(400).json({ error: 'Invalid page number' });
      return null;
    }
    if (isNaN(pageSize) || pageSize < 1 || pageSize > 100) {
      res.status(400).json({ error: 'Invalid page size. Must be between 1 and 100.' });
      return null;
    }
    return { page, pageSize };
  }

  private validateMode(req: Request, res: Response): string | null {
    const mode = (req.query.mode as string) || 'elo';
    const validModes = ['elo', 'kills', 'deaths', 'wins', 'losses', 'games',
      'winStreak', 'loseStreak', 'kdr', 'wlr', 'finalKills', 'finalDeaths',
      'bedBroken', 'mvps', 'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced',
      'level', 'experience', 'playtimeSeconds', 'peakElo',
      'damageDealt', 'damageTaken', 'assists', 'bestStreak', 'firstBloods'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: 'Invalid mode parameter' });
      return null;
    }
    return mode;
  }

  private async getGlobalCounts() {
    const totalUsers = await User.countDocuments();
    const Game = await this.getGameModel();
    const totalGames = await Game.countDocuments();
    return { totalUsers, totalGames };
  }

  private async fetchUserWithGameHistory(discordid: string, limit: number) {
    const user = await User.findOne({ discordId: discordid }).lean();
    if (!user) return null;

    const Game = await this.getGameModel();
    const recentGames = await Game.find({
      $or: [
        { winners: discordid },
        { losers: discordid }
      ]
    })
      .sort({ gameId: -1 })
      .limit(limit)
      .select('gameId winners startTime')
      .lean();

    return { user, recentGames };
  }

  private getBanInfo = async (req: Request, res: Response): Promise<void> => {
    try {
      const banId = req.query.id as string;
      if (!banId) {
        res.status(400).json({ error: 'Missing ban id' });
        return;
      }
      if (!/^[0-9a-fA-F]{24}$/.test(banId)) {
        res.status(404).json({ error: 'Ban not found' });
        return;
      }

      const user = await User.findOne({ 'bans.id': banId }).lean();
      if (!user || !Array.isArray(user.bans)) {
        res.status(404).json({ error: 'Ban not found' });
        return;
      }
      const ban = user.bans.find((b) => b.id === banId);
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

  private punishmentTime(value: unknown): number {
    const time = new Date(value as string).getTime();
    return Number.isNaN(time) ? 0 : time;
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
      if (user.isMuted && user.mutes.length > 0) {
        const lastMute = user.mutes[user.mutes.length - 1];
        if (lastMute.duration === 0 || (this.punishmentTime(lastMute.date) + lastMute.duration * 60000 > now.getTime())) {
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

  private buildUserWithLevel(user: LeanUser) {
    const levelInfo = getLevelInfo(user.experience || 0);
    const span = levelInfo.totalExperienceForLevel > 0 ? levelInfo.totalExperienceForLevel : 1;
    return {
      ...user,
      levelInfo: {
        level: levelInfo.level,
        experience: levelInfo.experience,
        experienceForCurrentLevel: levelInfo.experienceForCurrentLevel,
        experienceForNextLevel: levelInfo.experienceForNextLevel,
        experienceNeededForNext: levelInfo.experienceNeededForNext,
        totalExperienceForLevel: levelInfo.totalExperienceForLevel,
        progressPercentage: ((levelInfo.experience - levelInfo.experienceForCurrentLevel) / span * 100).toFixed(2)
      }
    };
  }

  private async getGameModel(): Promise<Model<IGame>> {
    if (!this.gameModel) {
      this.gameModel = (await import('../models/Game')).default;
    }
    return this.gameModel;
  }

  private async resolveGameIgns(games: IGameBase[]): Promise<Record<string, string>> {
    const allIds = new Set<string>();
    for (const game of games) {
      for (const id of [...(game.team1 || []), ...(game.team2 || []), ...(game.bedbreaks || []), ...(game.mvps || []), ...(game.winners || []), ...(game.losers || [])]) {
        allIds.add(id);
      }
      for (const entry of (game.combat || [])) {
        if (entry && entry.player) allIds.add(entry.player);
      }
    }
    if (allIds.size === 0) return {};
    const users = await User.find({ discordId: { $in: Array.from(allIds) } }).select('discordId ign').lean();
    const idToIgn: Record<string, string> = {};
    users.forEach(u => { idToIgn[u.discordId] = u.ign; });
    return idToIgn;
  }

  private mapGameIgns(game: IGameBase, idToIgn: Record<string, string>) {
    const map = (arr: string[]) => (arr || []).map((id: string) => idToIgn[id] || id);
    return {
      team1ign: map(game.team1),
      team2ign: map(game.team2),
      bedbreaksign: map(game.bedbreaks),
      mvpsign: map(game.mvps),
      winnersign: map(game.winners),
      losersign: map(game.losers),
      combatsign: (game.combat || []).map((entry: ICombatEntry) => ({
        ...entry,
        playerign: idToIgn[entry.player] || entry.player
      }))
    };
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
      const user = await User.findOne({ ign: new RegExp(`^${escapeRegex(ign)}$`, 'i') }).lean();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(this.buildUserWithLevel(user));
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
      const user = await User.findOne({ discordId: discordid }).lean();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json(this.buildUserWithLevel(user));
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
      const Game = await this.getGameModel();
      const game = await Game.findOne({ gameId: Number(gameid) }).lean();
      if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      const idToIgn = await this.resolveGameIgns([game]);
      res.json({ ...game, ...this.mapGameIgns(game, idToIgn) });
    } catch (error) {
      console.error('Error fetching game:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getGameTimeline = async (req: Request, res: Response): Promise<void> => {
    try {
      const { gameid } = req.params;
      if (!gameid) {
        res.status(400).json({ error: 'Missing gameid parameter' });
        return;
      }
      const Game = await this.getGameModel();
      const game = await Game.findOne({ gameId: Number(gameid) })
        .select('gameId map state startTime endTime winners losers timeline')
        .lean();
      if (!game) {
        res.status(404).json({ error: 'Game not found' });
        return;
      }

      res.json({
        gameId: game.gameId,
        map: game.map,
        state: game.state,
        startTime: game.startTime,
        endTime: game.endTime || null,
        winners: game.winners || [],
        losers: game.losers || [],
        timeline: game.timeline || []
      });
    } catch (error) {
      console.error('Error fetching game timeline:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getQueues = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.getCached('queues', 5000, async () => {
        const queues = await Queue.find().lean();
        const guild = this.client.guilds.cache.first();
        const rolesMap: Record<string, string> = {};
        if (guild) {
          const roles = guild.roles.cache.size > 0 ? guild.roles.cache : await guild.roles.fetch();
          if (roles) {
            roles.forEach(role => {
              if (role) rolesMap[role.id] = role.name;
            });
          }
        }
        const queuedIds = [...new Set(queues.flatMap(q => queuePlayers.get(q.channelId) || []))];
        const ignById = new Map<string, string>();
        if (queuedIds.length > 0) {
          const users = await User.find({ discordId: { $in: queuedIds } }).select('discordId ign').lean();
          for (const u of users) ignById.set(u.discordId, u.ign);
        }
        return queues.map(q => {
          const bypassRoles = (q.bypassRoles || []).map((roleId: string) => ({
            id: roleId,
            name: rolesMap[roleId] || null
          }));
          const playerIds = queuePlayers.get(q.channelId) || [];
          return {
            channelId: q.channelId,
            maxPlayers: q.maxPlayers,
            minElo: q.minElo,
            maxElo: q.maxElo,
            isRanked: q.isRanked,
            isPicking: q.isPicking ?? (q as unknown as { ispicking?: boolean }).ispicking,
            bypassRoles,
            playerCount: playerIds.length,
            playerIGNs: playerIds.map(id => ignById.get(id)).filter(Boolean)
          };
        });
      });
      res.json(result);
    } catch (error) {
      console.error('Error fetching queues:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getEloRanks = async (req: Request, res: Response): Promise<void> => {
    try {
      const eloranks = await EloRank.find().lean();
      const guild = this.client.guilds.cache.first();
      const rolesMap: Record<string, { name: string, color: string | null }> = {};
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
      const mode = this.validateMode(req, res);
      if (!mode) return;

      const pagination = this.validatePagination(req, res, 10);
      if (!pagination) return;
      const { page, pageSize } = pagination;
      const skip = (page - 1) * pageSize;

      const result = await this.getCached(`leaderboard:${mode}:${page}:${pageSize}`, 10000, async () => {
        const sortObj: Record<string, 1 | -1> = {};
        sortObj[mode] = -1;

        const users = await User.find()
          .sort(sortObj)
          .skip(skip)
          .limit(pageSize)
          .select(`ign ${mode}`)
          .lean();

        const formatted: Record<number, { ign: string, value: number | string }> = {};
        users.forEach((user, index) => {
          const rawValue: unknown = user[mode as keyof typeof user];
          formatted[index + 1 + skip] = {
            ign: user.ign,
            value: typeof rawValue === 'number' || typeof rawValue === 'string' ? rawValue : 0
          };
        });

        return formatted;
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
        const port = parseInt(config.websocketport, 10) || 25565;

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

  private getPunishments = async (req: Request, res: Response): Promise<void> => {
    try {
      const type = req.params.type;
      if (!['bans', 'mutes', 'strikes'].includes(type)) {
        res.status(400).json({ error: 'Invalid punishment type' });
        return;
      }
      const result = await this.getCached(`punishments:${type}`, 30000, async () => {
        return this.collectPunishments(type);
      });
      res.json(result);
    } catch (error) {
      console.error('Error fetching punishments:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async collectPunishments(type: string) {
      const users = await User.find({ [`${type}.0`]: { $exists: true } }).select(`discordId ign ${type}`).lean();

      const staffIds: Set<string> = new Set();
      const targetIds: Set<string> = new Set();
      const punishments: CollectedPunishment[] = [];

      const getUserPunishments = (user: LeanUser): StoredPunishment[] => {
        if (type === 'bans') return user.bans ?? [];
        if (type === 'mutes') return user.mutes ?? [];
        return user.strikes ?? [];
      };

      for (const user of users) {
        const arr = getUserPunishments(user);
        for (const p of arr) {
          let expired = false;
          if (type === 'bans' || type === 'mutes') {
            if ((p.duration ?? 0) > 0) {
              const end = this.punishmentTime(p.date) + (p.duration ?? 0) * 60000;
              if (end < Date.now()) expired = true;
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

      punishments.sort((a, b) => this.punishmentTime(b.date) - this.punishmentTime(a.date));

      const allIds = Array.from(new Set([...staffIds, ...targetIds]));
      const idToIgn: Record<string, string> = {};
      if (allIds.length > 0) {
        const ignUsers = await User.find({ discordId: { $in: allIds } }).select('discordId ign').lean();
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
      return result;
  }


  private getAllSeasons = async (req: Request, res: Response): Promise<void> => {
    try {
      const seasons = await Season.find().sort({ seasonNumber: 1, chapterNumber: 1 }).lean();
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
      const seasonParams = this.validateSeasonChapter(req, res);
      if (!seasonParams) return;
      const { seasonNumber, chapterNumber } = seasonParams;

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
      const seasonParams = this.validateSeasonChapter(req, res);
      if (!seasonParams) return;
      const { seasonNumber, chapterNumber } = seasonParams;

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
      const seasonParams = this.validateSeasonChapter(req, res);
      if (!seasonParams) return;
      const { seasonNumber, chapterNumber } = seasonParams;

      const mode = this.validateMode(req, res);
      if (!mode) return;

      const pagination = this.validatePagination(req, res, 10);
      if (!pagination) return;
      const { page, pageSize } = pagination;

      const result = await this.getCached(`seasonLeaderboard:${seasonNumber}:${chapterNumber}:${mode}:${page}:${pageSize}`, 30000, async () => {
        try {
          return await SeasonManager.getSeasonLeaderboard(seasonNumber, chapterNumber, mode, page, pageSize);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Invalid mode parameter')) {
            const err: ApiStatusError = new Error('Invalid mode parameter');
            err.statusCode = 400;
            throw err;
          }
          throw error;
        }
      });

      const formattedResult: Record<number, { ign: string, value: number | string }> = {};
      result.entries.forEach(entry => {
        formattedResult[entry.position] = {
          ign: entry.ign,
          value: entry.value
        };
      });

      res.json(formattedResult);
    } catch (error) {
      const statusCode = error instanceof Error ? (error as ApiStatusError).statusCode : undefined;
      if (statusCode === 400) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid mode parameter' });
        return;
      }
      console.error('Error fetching season leaderboard:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private getSeasonGames = async (req: Request, res: Response): Promise<void> => {
    try {
      const seasonParams = this.validateSeasonChapter(req, res);
      if (!seasonParams) return;
      const { seasonNumber, chapterNumber } = seasonParams;

      const pagination = this.validatePagination(req, res);
      if (!pagination) return;
      const { page, pageSize } = pagination;

      const response = await this.getCached(`seasonGames:${seasonNumber}:${chapterNumber}:${page}:${pageSize}`, 10000, async () => {
        const result = await SeasonManager.getSeasonGames(seasonNumber, chapterNumber, page, pageSize);

        const idToIgn = await this.resolveGameIgns(result.games);

        const gamesWithIgns = result.games.map(game => ({
          ...game.toObject(),
          ...this.mapGameIgns(game, idToIgn)
        }));

        return {
          games: gamesWithIgns,
          pagination: {
            page,
            pageSize,
            totalGames: result.total,
            totalPages: result.totalPages
          }
        };
      });

      res.json(response);
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
      const result = await this.getCached('globalStats', 10000, async () => {
        const { totalUsers, totalGames } = await this.getGlobalCounts();

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

        return {
          totalUsers,
          totalGames,
          ...globalStats,
          averageElo: Math.round(globalStats.averageElo || 0),
          totalKDR: globalStats.totalDeaths > 0 ? (globalStats.totalKills / globalStats.totalDeaths).toFixed(2) : 'N/A',
          totalWLR: globalStats.totalLosses > 0 ? (globalStats.totalWins / globalStats.totalLosses).toFixed(2) : 'N/A'
        };
      });

      res.json(result);
    } catch (error) {
      console.error('Error fetching global stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  private getTopStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const stat = req.query.stat as string || 'elo';
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 100);

      const validStats = ['elo', 'kills', 'deaths', 'wins', 'losses', 'games',
        'winStreak', 'loseStreak', 'kdr', 'wlr', 'finalKills', 'finalDeaths',
        'bedBroken', 'mvps', 'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced',
        'level', 'experience', 'playtimeSeconds', 'peakElo',
        'damageDealt', 'damageTaken', 'assists', 'bestStreak', 'firstBloods'];

      if (!validStats.includes(stat)) {
        res.status(400).json({ error: 'Invalid stat parameter' });
        return;
      }

      const result = await this.getCached(`topStats:${stat}:${limit}`, 10000, async () => {
        const sortObj: Record<string, 1 | -1> = {};
        sortObj[stat] = -1;

        const users = await User.find()
          .sort(sortObj)
          .limit(limit)
          .select(`ign discordId ${stat} elo wins losses kills deaths finalDeaths playtimeSeconds peakElo`)
          .lean();

        return users.map((user, index) => {
          const rawValue: unknown = user[stat as keyof typeof user];
          return {
            rank: index + 1,
            ign: user.ign,
            discordId: user.discordId,
            value: typeof rawValue === 'number' || typeof rawValue === 'string' ? rawValue : 0,
            elo: user.elo,
            wins: user.wins,
            losses: user.losses,
            kdr: user.deaths > 0 ? (user.kills / user.deaths).toFixed(2) : 'N/A',
            finalDeaths: user.finalDeaths || 0,
            playtimeSeconds: user.playtimeSeconds || 0,
            peakElo: user.peakElo || 0
          };
        });
      });

      res.json({ stat, results: result });
    } catch (error) {
      console.error('Error fetching top stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  private getUserGames = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;

      const pagination = this.validatePagination(req, res, 20);
      if (!pagination) return;
      const { page, pageSize } = pagination;
      const skip = (page - 1) * pageSize;

      const response = await this.getCached(`userGames:${discordid}:${page}:${pageSize}`, 10000, async () => {
        const Game = await this.getGameModel();
        const filter = {
          $or: [
            { team1: discordid },
            { team2: discordid }
          ]
        };
        const games = await Game.find(filter)
          .sort({ gameId: -1 })
          .skip(skip)
          .limit(pageSize)
          .lean();

        const totalGames = await Game.countDocuments(filter);

        const idToIgn = await this.resolveGameIgns(games);

        const gamesWithIgns = games.map((game: LeanGame) => ({
          ...game,
          ...this.mapGameIgns(game, idToIgn),
          playerResult: {
            won: game.winners.includes(discordid),
            team: game.team1.includes(discordid) ? 1 : 2,
            wasMVP: game.mvps.includes(discordid),
            brokeABed: game.bedbreaks.includes(discordid)
          }
        }));

        return {
          games: gamesWithIgns,
          pagination: {
            page,
            limit: pageSize,
            totalGames,
            totalPages: Math.ceil(totalGames / pageSize)
          }
        };
      });

      res.json(response);
    } catch (error) {
      console.error('Error fetching user games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  private getUserRecentGames = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 5, 1), 100);

      const response = await this.getCached(`userRecentGames:${discordid}:${limit}`, 10000, async () => {
        const Game = await this.getGameModel();
        const games = await Game.find({
          $or: [
            { team1: discordid },
            { team2: discordid }
          ]
        })
          .sort({ gameId: -1 })
          .limit(limit)
          .select('gameId map winners losers mvps bedbreaks team1 team2 startTime combat')
          .lean();

        return games.map((game: LeanGame) => {
        const entry = (game.combat || []).find((c) => c.player === discordid);
        return {
          gameId: game.gameId,
          map: game.map,
          date: game.startTime,
          won: game.winners.includes(discordid),
          wasMVP: game.mvps.includes(discordid),
          brokeABed: game.bedbreaks.includes(discordid),
          damageDealt: entry?.damageDealt || 0,
          damageTaken: entry?.damageTaken || 0,
          assists: entry?.assists || 0,
          fights: entry && Array.isArray(entry.fights) ? entry.fights.length : 0
        };
      });
      });

      res.json(response);
    } catch (error) {
      console.error('Error fetching user recent games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }



  private searchUsers = async (req: Request, res: Response): Promise<void> => {
    try {
      const query = req.query.query as string;
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 10, 1), 100);

      if (!query || query.length < 2) {
        res.status(400).json({ error: 'Query must be at least 2 characters' });
        return;
      }

      const users = await User.find({
        ign: new RegExp(escapeRegex(query), 'i')
      })
        .limit(limit)
        .select('ign discordId elo wins losses level experience')
        .lean();

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
      const result = await this.getCached('onlinePlayers', 5000, async () => {
        const allPlayerIds = new Set<string>();


        for (const [, playerIds] of queuePlayers.entries()) {
          playerIds.forEach(id => allPlayerIds.add(id));
        }

        const playerIdsArray = Array.from(allPlayerIds);
        const users = await User.find({ discordId: { $in: playerIdsArray } })
          .select('ign discordId elo level experience')
          .lean();

        const onlinePlayers = users.map(user => ({
          ign: user.ign,
          discordId: user.discordId,
          elo: user.elo,
          level: user.level || getLevelInfo(user.experience || 0).level
        }));

        return {
          count: onlinePlayers.length,
          players: onlinePlayers
        };
      });

      res.json(result);
    } catch (error) {
      console.error('Error fetching online players:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  private getServerStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.getCached('serverStatus', 5000, async () => {
        const { totalUsers, totalGames } = await this.getGlobalCounts();
        const queues = await Queue.find().lean();

        let totalPlayersInQueue = 0;
        for (const [, playerIds] of queuePlayers.entries()) {
          totalPlayersInQueue += playerIds.length;
        }

        const currentSeason = await Season.findOne({ isActive: true }).lean();

        return {
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
        };
      });

      res.json(result);
    } catch (error) {
      console.error('Error fetching server status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  private getUserPunishmentHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;

      const user = await User.findOne({ discordId: discordid })
        .select('ign discordId bans mutes strikes')
        .lean();

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }


      const allStaffIds = new Set<string>();
      [...(user.bans || []), ...(user.mutes || []), ...(user.strikes || [])].forEach(p => {
        if (p.moderator) allStaffIds.add(p.moderator);
      });

      const staffUsers = await User.find({ discordId: { $in: Array.from(allStaffIds) } })
        .select('discordId ign')
        .lean();
      const staffIgnMap: Record<string, string> = {};
      staffUsers.forEach(u => { staffIgnMap[u.discordId] = u.ign; });

      const formatPunishments = (punishments: StoredPunishment[], type: string) => {
        return punishments.map(p => ({
          ...p,
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

      const user = await User.findOne({ discordId: discordid }).select('ign discordId').lean();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const seasonStats = await SeasonStats.find({ discordId: discordid })
        .sort({ seasonNumber: -1, chapterNumber: -1 })
        .lean();

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
      const mode = this.validateMode(req, res);
      if (!mode) return;

      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);

      const topPlayers = await this.getCached(`topPlayers:${mode}:${limit}`, 10000, async () => {
        const sortObj: Record<string, 1 | -1> = {};
        sortObj[mode] = -1;

        const users = await User.find()
          .sort(sortObj)
          .limit(limit)
          .select('ign discordId elo wins losses kills deaths games mvps bedBroken experience level finalDeaths playtimeSeconds peakElo damageDealt damageTaken assists bestStreak firstBloods')
          .lean();

        return users.map((user, index) => {
          const levelInfo = getLevelInfo(user.experience || 0);
          const rawValue: unknown = user[mode as keyof typeof user];
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
            finalDeaths: user.finalDeaths || 0,
            playtimeSeconds: user.playtimeSeconds || 0,
            peakElo: user.peakElo || 0,
            level: user.level || levelInfo.level,
            experience: user.experience || 0,
            kdr: user.deaths > 0 ? (user.kills / user.deaths).toFixed(2) : 'N/A',
            wlr: user.losses > 0 ? (user.wins / user.losses).toFixed(2) : 'N/A',
            winRate: user.games > 0 ? ((user.wins / user.games) * 100).toFixed(1) + '%' : 'N/A',
            [mode]: typeof rawValue === 'number' || typeof rawValue === 'string' ? rawValue : 0
          };
        });
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
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);

      const gamesWithIgns = await this.getCached(`recentGames:${limit}`, 10000, async () => {
        const Game = await this.getGameModel();
        const games = await Game.find()
          .sort({ gameId: -1 })
          .limit(limit)
          .lean();

        const idToIgn = await this.resolveGameIgns(games);

        return games.map((game: LeanGame) => ({
          gameId: game.gameId,
          map: game.map,
          date: game.startTime,
          duration: game.endTime ? Math.floor((game.endTime.getTime() - game.startTime.getTime()) / 1000 / 60) : null,
          team1: game.team1.map((id: string) => ({ discordId: id, ign: idToIgn[id] || id })),
          team2: game.team2.map((id: string) => ({ discordId: id, ign: idToIgn[id] || id })),
          winners: game.winners.map((id: string) => ({ discordId: id, ign: idToIgn[id] || id })),
          mvps: game.mvps.map((id: string) => ({ discordId: id, ign: idToIgn[id] || id })),
          bedbreaks: game.bedbreaks.map((id: string) => ({ discordId: id, ign: idToIgn[id] || id }))
        }));
      });

      res.json(gamesWithIgns);
    } catch (error) {
      console.error('Error fetching recent games:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  private getLiveGames = async (req: Request, res: Response): Promise<void> => {
    try {


      const queues = await Queue.find().lean();
      const liveActivity = [];

      const queuedIds = [...new Set(queues.flatMap(q => queuePlayers.get(q.channelId) || []))];
      const queuedUsers = queuedIds.length > 0
        ? await User.find({ discordId: { $in: queuedIds } }).select('ign discordId elo').lean()
        : [];
      const queuedById = new Map(queuedUsers.map(u => [u.discordId, u]));

      for (const queue of queues) {
        const playerIds = queuePlayers.get(queue.channelId) || [];
        if (playerIds.length > 0) {
          const players = playerIds.map(id => {
            const u = queuedById.get(id);
            return u ? { ign: u.ign, discordId: u.discordId, elo: u.elo } : null;
          }).filter((p): p is { ign: string; discordId: string; elo: number } => p !== null);

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
        User.findOne({ discordId: discordid }).lean(),
        User.findOne({ discordId: targetid }).lean()
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
      const result = await this.getCached('maps', 5000, async () => {
        const allMaps = this.wsManager.getAllMaps();
        return {
          totalMaps: allMaps.length,
          reservedCount: this.wsManager.getReservedMaps().length,
          lockedCount: this.wsManager.getLockedMaps().length,
          disabledCount: this.wsManager.getDisabledMaps().length,
          maps: allMaps
        };
      });

      res.json(result);
    } catch (error) {
      console.error('Error fetching maps:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }


  private getUserWinstreakHistory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;
      const data = await this.fetchUserWithGameHistory(discordid, 50);
      if (!data) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const { user, recentGames } = data;

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
        currentWinstreak: (user.winStreak ?? (user as unknown as { winstreak?: number }).winstreak) || 0,
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
      const user = await User.findOne({ discordId: discordid }).lean();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const recentGames = (user.recentGames || []).slice(0, 20);
      const eloHistory = recentGames.map((game) => {
        const g = game as typeof game & { oldElo?: number; newElo?: number };
        const before = typeof g.elo_before === 'number' ? g.elo_before : (typeof g.oldElo === 'number' ? g.oldElo : null);
        const after = typeof g.elo_after === 'number' ? g.elo_after : (typeof g.newElo === 'number' ? g.newElo : null);
        return {
          gameId: game.gameId,
          date: game.date,
          won: game.won,
          eloChange: typeof game.eloGain === 'number' ? game.eloGain : null,
          elo_before: before,
          elo_after: after,
          oldElo: before,
          newElo: after
        };
      });

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

  private getUserOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const { discordid } = req.params;

      const overview = await this.getCached(`userOverview:${discordid}`, 5000, async () => {
        const user = await User.findOne({ discordId: discordid }).lean();
        if (!user) return null;

        const wins = user.wins || 0;
        const losses = user.losses || 0;
        const kills = user.kills || 0;
        const deaths = user.deaths || 0;
        const games = user.games || 0;

        const levelInfo = getLevelInfo(user.experience || 0);

        const seasonStats = await SeasonStats.find({ discordId: discordid })
          .sort({ seasonNumber: -1, chapterNumber: -1 })
          .limit(10)
          .lean();

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
          finalDeaths: stats.finalDeaths,
          playtimeSeconds: stats.playtimeSeconds,
          peakElo: stats.peakElo,
          level: stats.level || getLevelInfo(stats.experience || 0).level,
          kdr: stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : 'N/A',
          wlr: stats.losses > 0 ? (stats.wins / stats.losses).toFixed(2) : 'N/A'
        }));

        return {
          discordId: user.discordId,
          ign: user.ign,
          profile: {
            ...user,
            winRate: games > 0 ? ((wins / games) * 100).toFixed(1) + '%' : 'N/A',
            kdr: deaths > 0 ? (kills / deaths).toFixed(2) : 'N/A',
            wlr: losses > 0 ? (wins / losses).toFixed(2) : 'N/A',
            levelInfo
          },
          recentGames: (user.recentGames || []).slice(0, 10),
          dailyElo: user.dailyElo || [],
          level: {
            level: levelInfo.level,
            experience: levelInfo.experience,
            levelInfo
          },
          currentStreak: {
            winStreak: user.winStreak ?? (user as unknown as { winstreak?: number }).winstreak ?? 0,
            loseStreak: user.loseStreak ?? (user as unknown as { losestreak?: number }).losestreak ?? 0
          },
          seasonHistory: {
            totalSeasons: seasonHistory.length,
            seasons: seasonHistory
          }
        };
      });

      if (!overview) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json(overview);
    } catch (error) {
      console.error('Error fetching user overview:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

}
