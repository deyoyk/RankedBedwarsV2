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

export class SeasonManager {

  public static async startSeason(
    options: SeasonStartOptions
  ): Promise<{ success: boolean; message: string; embed?: EmbedBuilder }> {
    try {

      // Basic inline validation (replacement for validation.ts)
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

      await newSeason.save();

      await User.updateMany({}, {
        seasonNumber: options.seasonNumber,
        chapterNumber: options.chapterNumber
      });

      await Game.updateMany({}, {
        seasonNumber: options.seasonNumber,
        chapterNumber: options.chapterNumber
      });

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
    const session = await mongoose.startSession();
    let result: SeasonEndResult = {
      success: false,
      message: 'Operation failed',
      usersMigrated: 0,
      gamesMigrated: 0,
      statsCreated: 0
    };

    try {
      await session.withTransaction(async () => {
        const activeSeason = await Season.findOne({ isActive: true }).session(session);
        if (!activeSeason) {
          throw new Error('No active season found to end.');
        }

        const { seasonNumber, chapterNumber } = activeSeason;

        const users = await User.find({}).session(session);

        await Promise.all(users.map(user =>
          new SeasonStats({
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
            diamonds: user.diamonds || 0,
            irons: user.irons || 0,
            gold: user.gold || 0,
            emeralds: user.emeralds || 0,
            blocksPlaced: user.blocksPlaced || 0,
            winstreak: user.winstreak || 0,
            losestreak: user.losestreak || 0,
            kdr: user.kdr || 0,
            wlr: user.wlr || 0,
            recentGames: user.recentGames,
            dailyElo: user.dailyElo
          }).save({ session })
        ));

        const games = await Game.find({}).session(session);

        await Promise.all(games.map(game => {
          const { _id, __v, ...gameData } = game.toObject();
          return new SeasonGames({
            ...gameData,
            seasonNumber,
            chapterNumber
          }).save({ session });
        }));

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
            diamonds: 0,
            irons: 0,
            gold: 0,
            emeralds: 0,
            blocksPlaced: 0,
            winstreak: 0,
            losestreak: 0,
            kdr: 0,
            wlr: 0,
            recentGames: [],
            dailyElo: [],
            seasonNumber: null,
            chapterNumber: null
          }
        }, { session });

        await Game.deleteMany({}, { session });

        activeSeason.endDate = new Date();
        activeSeason.isActive = false;
        await activeSeason.save({ session });

        result = {
          success: true,
          message: `Season ${seasonNumber} Chapter ${chapterNumber} ended successfully.`,
          usersMigrated: users.length,
          gamesMigrated: games.length,
          statsCreated: users.length,
          seasonInfo: {
            seasonNumber,
            chapterNumber,
            name: activeSeason.name
          }
        };
      });

      return result;
    } finally {
      await session.endSession();
    }
  }


  public static async getCurrentSeason(): Promise<ISeason | null> {
    try {
      const season = await Season.findOne({ isActive: true });
      return season;
    } catch (error) {

      throw error;
    }
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
    try {

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
      (seasonStats as any).levelInfo = {
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
    } catch (error) {
      throw error;
    }
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
        'winstreak', 'losestreak', 'kdr', 'wlr', 'finalKills', 'bedBroken', 'mvps',
        'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'level', 'experience'];

      if (!validModes.includes(mode)) {
        throw new Error(`Invalid mode parameter. Valid modes: ${validModes.join(', ')}`);
      }

      const total = await SeasonStats.countDocuments({ seasonNumber, chapterNumber });
      const { skip, totalPages } = computePagination(validPage, validLimit, total);

      const sortObj: Record<string, 1 | -1> = {};
      sortObj[mode] = -1;

      const seasonStats = await SeasonStats.find({ seasonNumber, chapterNumber })
        .sort(sortObj as any)
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