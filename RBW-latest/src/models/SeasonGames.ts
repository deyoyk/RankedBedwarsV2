import mongoose, { Schema, Document } from 'mongoose';

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
  gameId: { type: Number, required: true },
  seasonNumber: { type: Number, required: true },
  chapterNumber: { type: Number, required: true },
  map: { type: String, required: true },
  team1: [{ type: String, required: true }],
  team2: [{ type: String, required: true }],
  winners: [{ type: String }],
  losers: [{ type: String }],
  mvps: [{ type: String }],
  bedbreaks: [{ type: String }],
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  state: { 
    type: String, 
    enum: ['voided', 'scored', 'pending', 'active'],
    default: 'pending'
  },
  channels: {
    text: { type: String, required: true },
    team1Voice: { type: String, required: true },
    team2Voice: { type: String, required: true },
    picking: { type: String }
  },
  queueId: { type: String, required: true },
  isRanked: { type: Boolean, default: false },
  partiesInThisGame: { type: String, default: '' },
  reason: { type: String, default: '' }
});


SeasonGamesSchema.index({ gameId: 1, seasonNumber: 1, chapterNumber: 1 }, { unique: true });

SeasonGamesSchema.methods.getTeamOfPlayer = function (playerId: string): string[] | null {
  if (this.team1.includes(playerId)) return this.team1;
  if (this.team2.includes(playerId)) return this.team2;
  return null;
};

export default mongoose.model<ISeasonGames>('SeasonGames', SeasonGamesSchema);