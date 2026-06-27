import mongoose, { Schema, Document } from 'mongoose';
import { gameBaseFields, applyGetTeamOfPlayer } from './gameBase';

export interface IGame extends Document {
  gameId: number;
  map: string;
  team1: string[];
  seasonNumber?: number;
  chapterNumber?: number;
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

const GameSchema: Schema = new Schema({
  ...gameBaseFields,
  gameId: { type: Number, required: true, unique: true },
  seasonNumber: { type: Number },
  chapterNumber: { type: Number },
});

applyGetTeamOfPlayer(GameSchema);

export default mongoose.model<IGame>('Game', GameSchema);
