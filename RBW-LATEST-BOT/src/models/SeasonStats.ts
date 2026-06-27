import mongoose, { Schema, Document } from 'mongoose';
import { recentGameSubdoc, dailyEloSubdoc } from './gameBase';

export interface ISeasonStats extends Document {
  discordId: string;
  seasonNumber: number;
  chapterNumber: number;
  ign: string;
  elo: number;
  level: number;
  experience: number;
  wins: number;
  losses: number;
  games: number;
  mvps: number;
  kills: number;
  deaths: number;
  bedBroken: number;
  finalKills: number;
  diamonds: number;
  irons: number;
  gold: number;
  emeralds: number;
  blocksPlaced: number;
  winstreak: number;
  losestreak: number;
  kdr: number;
  wlr: number;
  recentGames: Array<{
    gameId: number;
    queueid?: number;
    map: string;
    eloGain: number;
    kills: number;
    deaths: number;
    bedBroken: number;
    finalKills: number;
    won?: boolean;
    ismvp?: boolean;
    date: Date;
    state: String;
    startTime: Date;
    endTime?: Date;
    diamonds?: number;
    irons?: number;
    gold?: number;
    emeralds?: number;
    blocksPlaced?: number;
  }>;
  dailyElo: Array<{
    elo: number;
    date: Date;
  }>;
}

const SeasonStatsSchema: Schema = new Schema({
  discordId: { type: String, required: true },
  seasonNumber: { type: Number, required: true },
  chapterNumber: { type: Number, required: true },
  ign: { type: String },
  elo: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  experience: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  games: { type: Number, default: 0 },
  mvps: { type: Number, default: 0 },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  bedBroken: { type: Number, default: 0 },
  finalKills: { type: Number, default: 0 },
  diamonds: { type: Number, default: 0 },
  irons: { type: Number, default: 0 },
  gold: { type: Number, default: 0 },
  emeralds: { type: Number, default: 0 },
  blocksPlaced: { type: Number, default: 0 },
  winstreak: { type: Number, default: 0 },
  losestreak: { type: Number, default: 0 },
  kdr: { type: Number, default: 0 },
  wlr: { type: Number, default: 0 },
  recentGames: [recentGameSubdoc],
  dailyElo: [dailyEloSubdoc],
});


SeasonStatsSchema.index({ discordId: 1, seasonNumber: 1, chapterNumber: 1 }, { unique: true });

export default mongoose.model<ISeasonStats>('SeasonStats', SeasonStatsSchema);