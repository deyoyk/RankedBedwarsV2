import mongoose, { Schema, Document } from 'mongoose';
import { gameBaseFields, applyGetTeamOfPlayer } from './gameBase';

export interface ISeasonGames extends Document {
  gameId: number;
  seasonNumber: number;
  chapterNumber: number;
  map: string;
  team1: string[];
  team2: string[];
  winners: string[];
  losers: string[];
  mvps: string[];
  bedbreaks: string[];
  startTime: Date;
  endTime?: Date;
  state: 'voided' | 'scored' | 'pending' | 'active';
  channels: {
    text: string;
    team1Voice: string;
    team2Voice: string;
    picking?: string;
  };
  queueId: string;
  isRanked: boolean;
  partiesInThisGame: string;
  reason: string;
  getTeamOfPlayer(playerId: string): string[] | null;
}

const SeasonGamesSchema: Schema = new Schema({
  ...gameBaseFields,
  seasonNumber: { type: Number, required: true },
  chapterNumber: { type: Number, required: true },
});

SeasonGamesSchema.index({ gameId: 1, seasonNumber: 1, chapterNumber: 1 }, { unique: true });

applyGetTeamOfPlayer(SeasonGamesSchema);

export default mongoose.model<ISeasonGames>('SeasonGames', SeasonGamesSchema);
