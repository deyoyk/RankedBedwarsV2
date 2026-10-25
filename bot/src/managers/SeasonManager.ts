import mongoose from 'mongoose';
import Season from '../models/Season';
import SeasonStats from '../models/SeasonStats';
import SeasonGames from '../models/SeasonGames';
import User from '../models/User';
import Game from '../models/Game';
import { ISeason } from '../models/Season';
import { ISeasonStats } from '../models/SeasonStats';
import { ISeasonGames } from '../models/SeasonGames';

import { getLevelInfo } from '../utils/levelSystem';
import { EmbedBuilder } from 'discord.js';
import { validatePositiveInt, validatePageLimit, computePagination } from './validationHelpers';

export interface SeasonStartOptions {
  seasonNumber: number;
  chapterNumber: number;
  name: string;
  description?: string;
}

export interface SeasonEndResult {
  success: boolean;
  message: string;
  usersMigrated: number;
  gamesMigrated: number;
  statsCreated: number;
  seasonInfo?: {
    seasonNumber: number;
    chapterNumber: number;
    name: string;
  };
}

export interface SeasonLevelInfo {
  level: number;
  experience: number;
  experienceForCurrentLevel: number;
  experienceForNextLevel: number;
  experienceNeededForNext: number;
  totalExperienceForLevel: number;
  progressPercentage: string;
}

export type SeasonStatsWithLevel = ISeasonStats & { levelInfo?: SeasonLevelInfo };

export class SeasonManager {

  private static readonly MIGRATION_BATCH_SIZE = 100;

  private static async runInBatches(tasks: Array<() => Promise<unknown>>): Promise<void> {
    for (let i = 0; i < tasks.length; i += SeasonManager.MIGRATION_BATCH_SIZE) {
      await Promise.all(tasks.slice(i, i + SeasonManager.MIGRATION_BATCH_SIZE).map(run => run()));
    }
  }

  private static readonly READ_BATCH_SIZE = 500;
  private static readonly WRITE_CHUNK_SIZE = 500;

  private static chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  private static buildSeasonStatsDoc(user: any, seasonNumber: number, chapterNumber: number): Record<string, unknown> {
    return {
      discordId: user.discordId,
      seasonNumber,
      chapterNumber,
      ign: user.ign,
      elo: user.elo,
      level: user.level || 1,
      experience: user.experience || 0,
      wins: user.wins,
      losses: user.losses,
      games: user.games,
      mvps: user.mvps,
      kills: user.kills,
      deaths: user.deaths,
      bedBroken: user.bedBroken,
      finalKills: user.finalKills,
      finalDeaths: user.finalDeaths,
      diamonds: user.diamonds || 0,
      irons: user.irons || 0,
      gold: user.gold || 0,
      emeralds: user.emeralds || 0,
      blocksPlaced: user.blocksPlaced || 0,
      winStreak: user.winStreak || 0,
      loseStreak: user.loseStreak || 0,
      kdr: user.kdr || 0,
      wlr: user.wlr || 0,
      playtimeSeconds: user.playtimeSeconds || 0,
      peakElo: user.peakElo || 0,
      recentGames: user.recentGames,
      dailyElo: user.dailyElo
    };
  }

  private static buildSeasonGameDoc(game: any, seasonNumber: number, chapterNumber: number): Record<string, unknown> {
    const raw: Record<string, unknown> = game && typeof game.toObject === 'function'
      ? game.toObject()
      : { ...game };
    delete raw._id;
    delete raw.__v;
    return { ...raw, seasonNumber, chapterNumber };
  }

  private static isDuplicateKeyError(error: any): boolean {
    if (!error) return false;
    if (error.code === 11000) return true;
    const writeErrors: any[] = Array.isArray(error.writeErrors) ? error.writeErrors : [];
    return writeErrors.length > 0 && writeErrors.every((e) => (e?.code ?? e?.err?.code) === 11000);
  }

  private static async insertManyIdempotent(targetModel: any, docs: Array<Record<string, unknown>>): Promise<number> {
    if (docs.length === 0) return 0;
    try {
      const inserted: unknown = await targetModel.insertMany(docs, { ordered: false });
      return Array.isArray(inserted) ? inserted.length : docs.length;
    } catch (error) {
      // Unique indexes on (discordId, season, chapter) / (gameId, season, chapter) make
      // retries safe: already-migrated docs raise 11000 while the rest still persist.
      if (SeasonManager.isDuplicateKeyError(error)) return docs.length;
      throw error;
    }
  }

  private static async snapshotCollection(
    sourceModel: any,
    targetModel: any,
    toDoc: (doc: any, seasonNumber: number, chapterNumber: number) => Record<string, unknown>,
    seasonNumber: number,
    chapterNumber: number
  ): Promise<number> {
    const canBulk = typeof targetModel?.insertMany === 'function';
    let migrated = 0;

    const persistBatch = async (batch: any[]): Promise<void> => {
      const docs = batch
        .map((doc) => toDoc(doc, seasonNumber, chapterNumber))
        .filter((doc) => !!doc);
      if (docs.length === 0) return;
      if (canBulk) {
        const tasks = SeasonManager.chunk(docs, SeasonManager.WRITE_CHUNK_SIZE).map((writeChunk) => async () => {
          migrated += await SeasonManager.insertManyIdempotent(targetModel, writeChunk);
        });
        await SeasonManager.runInBatches(tasks);
      } else {
        // Fallback for doubles without insertMany (unit tests): per-doc saves, same concurrency bound.
        const tasks = docs.map((doc) => async () => {
          await new targetModel(doc).save();
          migrated += 1;
        });
        await SeasonManager.runInBatches(tasks);
      }
    };

    const query: any = sourceModel.find({});
    if (query && typeof query.lean === 'function' && typeof query.cursor === 'function') {
      // Large-scale path: stream lean docs through a cursor, never materializing the collection.
      if (typeof query.batchSize === 'function') query.batchSize(SeasonManager.READ_BATCH_SIZE);
      const cursor = query.lean().cursor();
      let batch: any[] = [];
      for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= SeasonManager.READ_BATCH_SIZE) {
          const ready = batch;
          batch = [];
          await persistBatch(ready);
        }
      }
      if (batch.length > 0) await persistBatch(batch);
      return migrated;
    }

    // Fallback path (query doubles in unit tests): array read, still persisted in bounded chunks.
    const all: any = typeof query?.session === 'function' ? await query.session(undefined) : await query;
    const arr: any[] = Array.isArray(all) ? all : [];
    for (const batch of SeasonManager.chunk(arr, SeasonManager.READ_BATCH_SIZE)) {
      await persistBatch(batch);
    }
    return migrated;
  }

  public static async startSeason(
    options: SeasonStartOptions
  ): Promise<{ success: boolean; message: string; embed?: EmbedBuilder }> {
    try {

      if (
        !Number.isInteger(options.seasonNumber) || options.seasonNumber <= 0 ||
        !Number.isInteger(options.chapterNumber) || options.chapterNumber <= 0 ||
        !options.name || typeof options.name !== 'string'
      ) {
        return {
          success: false,
          message: 'Invalid season data provided.'
        };
      }

      const activeSeason = await Season.findOne({ isActive: true });
      if (activeSeason) {
        const embed = new EmbedBuilder()
          .setColor('#00AAAA')
          .setTitle('❌ Error')
          .setDescription(
            `There is already an active season: **${activeSeason.name}** ` +
            `(Season ${activeSeason.seasonNumber} Chapter ${activeSeason.chapterNumber})`
          );

        return {
          success: false,
          message: `There is already an active season.`,
          embed
        };
      }

      const existingSeason = await Season.findOne({
        seasonNumber: options.seasonNumber,
        chapterNumber: options.chapterNumber
      });

      if (existingSeason) {
        const embed = new EmbedBuilder()
          .setColor('#00AAAA')
          .setTitle('❌ Error')
          .setDescription(
            `Season ${options.seasonNumber} Chapter ${options.chapterNumber} already exists!`
          );

        return {
          success: false,
          message: 'Season already exists.',
          embed
        };
      }

      const newSeason = new Season({
        seasonNumber: options.seasonNumber,
        chapterNumber: options.chapterNumber,
        name: options.name,
        description: options.description,
        startDate: new Date(),
        isActive: true
      });

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await newSeason.save({ session });

          await User.updateMany({}, {
            seasonNumber: options.seasonNumber,
            chapterNumber: options.chapterNumber
          }, { session });

          await Game.updateMany({}, {
            seasonNumber: options.seasonNumber,
            chapterNumber: options.chapterNumber
          }, { session });
        });
      } finally {
        await session.endSession();
      }

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎉 Season Started!')
        .setDescription(
          `**${options.name}** has been started as Season ${options.seasonNumber} Chapter ${options.chapterNumber}`
        )
        .addFields(
          { name: 'Season', value: `${options.seasonNumber}`, inline: true },
          { name: 'Chapter', value: `${options.chapterNumber}`, inline: true },
          {
            name: 'Start Date',
            value: `<t:${Math.floor(newSeason.startDate.getTime() / 1000)}:F>`,
            inline: true
          },
          {
            name: 'Description',
            value: options.description || 'No description provided',
            inline: false
          }
        )
        .setTimestamp();

      return {
        success: true,
        message: 'Season started successfully.',
        embed
      };

    } catch (error) {
      console.error('Error starting season:', error);

      const embed = new EmbedBuilder()
        .setColor('#00AAAA')
        .setTitle('❌ Error')
        .setDescription('An error occurred while starting the season.');

      return {
        success: false,
        message: 'Error starting season.',
        embed
      };
    }
  }

  public static async endSeason(): Promise<SeasonEndResult> {
    // Phase 0: resolve the active season without holding a transaction open.
    const lookupSession = await mongoose.startSession();
    let snapshot: { seasonNumber: number; chapterNumber: number; name: string } | null = null;
    try {
      const query: any = Season.findOne({ isActive: true });
      const activeSeason: any = query && typeof query.session === 'function'
        ? await query.session(lookupSession)
        : await query;
      if (!activeSeason) {
        throw new Error('No active season found to end.');
      }
      snapshot = {
        seasonNumber: activeSeason.seasonNumber,
        chapterNumber: activeSeason.chapterNumber,
        name: activeSeason.name
      };
    } finally {
      await lookupSession.endSession();
    }
    if (!snapshot) {
      throw new Error('No active season found to end.');
    }
    const { seasonNumber, chapterNumber } = snapshot;

    // Phase 1: snapshot live collections into season archives in bounded batches.
    // Each insertMany chunk is atomic with ordered:false and duplicate-key tolerant,
    // so a retry after a crash simply skips already-migrated docs (idempotent,
    // re-runnable). No long-lived transaction here: stays well under the 60s limit.
    // Note: writes landing between snapshot and reset below belong to the next
    // season window; pause scoring queues during endSeason for a clean boundary.
    const usersMigrated = await SeasonManager.snapshotCollection(
      User,
      SeasonStats,
      (doc, s, c) => SeasonManager.buildSeasonStatsDoc(doc, s, c),
      seasonNumber,
      chapterNumber
    );

    const gamesMigrated = await SeasonManager.snapshotCollection(
      Game,
      SeasonGames,
      (doc, s, c) => SeasonManager.buildSeasonGameDoc(doc, s, c),
      seasonNumber,
      chapterNumber
    );

    // Phase 2: one short transaction covering only the reset + close writes.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await User.updateMany({}, {
          $set: {
            elo: 0,
            level: 1,
            experience: 0,
            wins: 0,
            losses: 0,
            games: 0,
            mvps: 0,
            kills: 0,
            deaths: 0,
            bedBroken: 0,
            finalKills: 0,
            finalDeaths: 0,
            diamonds: 0,
            irons: 0,
            gold: 0,
            emeralds: 0,
            blocksPlaced: 0,
            winStreak: 0,
            loseStreak: 0,
            kdr: 0,
            wlr: 0,
            playtimeSeconds: 0,
            peakElo: 0,
            recentGames: [],
            dailyElo: [],
            seasonNumber: null,
            chapterNumber: null
          }
        }, { session });

        await Game.deleteMany({ state: { $ne: 'pending' } }, { session });

        const seasonQuery: any = Season.findOne({ seasonNumber, chapterNumber });
        const seasonInTx: any = seasonQuery && typeof seasonQuery.session === 'function'
          ? await seasonQuery.session(session)
          : await seasonQuery;
        if (!seasonInTx) {
          throw new Error('No active season found to end.');
        }
        seasonInTx.endDate = new Date();
        seasonInTx.isActive = false;
        await seasonInTx.save({ session });
      });
    } finally {
      await session.endSession();
    }

    return {
      success: true,
      message: `Season ${seasonNumber} Chapter ${chapterNumber} ended successfully.`,
      usersMigrated,
      gamesMigrated,
      statsCreated: usersMigrated,
      seasonInfo: {
        seasonNumber,
        chapterNumber,
        name: snapshot.name
      }
    };
  }


  public static async getCurrentSeason(): Promise<ISeason | null> {
    return Season.findOne({ isActive: true });
  }


  public static async getSeason(seasonNumber: number, chapterNumber: number): Promise<ISeason | null> {
    try {
      validatePositiveInt(seasonNumber, 'Season number');
      validatePositiveInt(chapterNumber, 'Chapter number');

      return await Season.findOne({ seasonNumber, chapterNumber });
    } catch (error) {
      console.error('Error getting season:', error);
      throw error;
    }
  }



  public static async getUserSeasonStats(
    discordId: string,
    seasonNumber: number,
    chapterNumber: number
  ): Promise<ISeasonStats | null> {
    validatePositiveInt(seasonNumber, 'Season number');
    validatePositiveInt(chapterNumber, 'Chapter number');

    if (!discordId || typeof discordId !== 'string') {
      throw new Error('Discord ID is required and must be a string');
    }

    const seasonStats = await SeasonStats.findOne({
      discordId,
      seasonNumber,
      chapterNumber
    });

    if (!seasonStats) {
      return null;
    }

    const levelInfo = getLevelInfo(seasonStats.experience || 0);
    (seasonStats as SeasonStatsWithLevel).levelInfo = {
      level: levelInfo.level,
      experience: levelInfo.experience,
      experienceForCurrentLevel: levelInfo.experienceForCurrentLevel,
      experienceForNextLevel: levelInfo.experienceForNextLevel,
      experienceNeededForNext: levelInfo.experienceNeededForNext,
      totalExperienceForLevel: levelInfo.totalExperienceForLevel,
      progressPercentage: (
        (levelInfo.experience - levelInfo.experienceForCurrentLevel) /
        levelInfo.totalExperienceForLevel * 100
      ).toFixed(2)
    };

    return seasonStats;
  }



  public static async getSeasonGames(seasonNumber: number, chapterNumber: number, page: number = 1, limit: number = 20): Promise<{ games: ISeasonGames[]; total: number; totalPages: number }> {
    try {
      validatePositiveInt(seasonNumber, 'Season number');
      validatePositiveInt(chapterNumber, 'Chapter number');
      const { page: validPage, limit: validLimit } = validatePageLimit(page, limit);

      const total = await SeasonGames.countDocuments({ seasonNumber, chapterNumber });
      const { skip, totalPages } = computePagination(validPage, validLimit, total);

      const games = await SeasonGames.find({ seasonNumber, chapterNumber })
        .sort({ gameId: -1 })
        .skip(skip)
        .limit(validLimit);

      return {
        games,
        total,
        totalPages
      };
    } catch (error) {
      console.error('Error getting season games:', error);
      throw error;
    }
  }


  public static async getSeasonLeaderboard(seasonNumber: number, chapterNumber: number, mode: string = 'elo', page: number = 1, limit: number = 10): Promise<{ entries: Array<{ position: number; ign: string; value: number | string }>; total: number; totalPages: number }> {
    try {
      validatePositiveInt(seasonNumber, 'Season number');
      validatePositiveInt(chapterNumber, 'Chapter number');
      const { page: validPage, limit: validLimit } = validatePageLimit(page, limit);

      const validModes = ['elo', 'kills', 'deaths', 'wins', 'losses', 'games',
        'winStreak', 'loseStreak', 'kdr', 'wlr', 'finalKills', 'finalDeaths', 'bedBroken', 'mvps',
        'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'level', 'experience',
        'playtimeSeconds', 'peakElo',
        'damageDealt', 'damageTaken', 'assists', 'bestStreak', 'firstBloods'];

      if (!validModes.includes(mode)) {
        throw new Error(`Invalid mode parameter. Valid modes: ${validModes.join(', ')}`);
      }

      const total = await SeasonStats.countDocuments({ seasonNumber, chapterNumber });
      const { skip, totalPages } = computePagination(validPage, validLimit, total);

      const sortObj: Record<string, 1 | -1> = {};
      sortObj[mode] = -1;

      const seasonStats = await SeasonStats.find({ seasonNumber, chapterNumber })
        .sort(sortObj)
        .skip(skip)
        .limit(validLimit)
        .select(`ign ${mode}`);

      const entries = seasonStats.map((stats, index) => ({
        position: index + 1 + skip,
        ign: stats.ign || 'Unknown',
        value: stats[mode as keyof typeof stats] || 0
      }));

      return {
        entries,
        total,
        totalPages
      };
    } catch (error) {
      console.error('Error getting season leaderboard:', error);
      throw error;
    }
  }
}