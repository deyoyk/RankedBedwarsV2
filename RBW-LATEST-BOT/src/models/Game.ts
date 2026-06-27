import mongoose, { Schema, Document } from 'mongoose';
import { gameBaseFields, applyGetTeamOfPlayer } from './gameBase';
import { IGameBase } from './gameTypes';

export interface IGame extends IGameBase, Document {
  seasonNumber?: number;
  chapterNumber?: number;
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
