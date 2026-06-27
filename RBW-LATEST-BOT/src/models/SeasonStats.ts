import mongoose, { Schema, Document } from 'mongoose';
import { recentGameSubdoc, dailyEloSubdoc, IRecentGame, IDailyElo } from './gameBase';
import { coreStatFields, IUserStats } from './statFields';

export interface ISeasonStats extends Document, IUserStats {
  discordId: string;
  seasonNumber: number;
  chapterNumber: number;
  ign: string;
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