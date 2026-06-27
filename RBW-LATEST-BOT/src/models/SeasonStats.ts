import mongoose, { Schema, Document } from 'mongoose';
import { recentGameSubdoc, dailyEloSubdoc, IRecentGame, IDailyElo } from './gameBase';
import { coreStatFields } from './statFields';

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
  recentGames: IRecentGame[];
  dailyElo: IDailyElo[];
}

const SeasonStatsSchema: Schema = new Schema({
  discordId: { type: String, required: true },
  seasonNumber: { type: Number, required: true },
  chapterNumber: { type: Number, required: true },
  ign: { type: String },
  ...coreStatFields,
  recentGames: [recentGameSubdoc],
  dailyElo: [dailyEloSubdoc],
});


SeasonStatsSchema.index({ discordId: 1, seasonNumber: 1, chapterNumber: 1 }, { unique: true });

export default mongoose.model<ISeasonStats>('SeasonStats', SeasonStatsSchema);