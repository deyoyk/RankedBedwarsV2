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

GameSchema.index({ state: 1 });
GameSchema.index({ startTime: 1, state: 1 });
GameSchema.index({ queueId: 1, state: 1 });
GameSchema.index({ team1: 1 });
GameSchema.index({ team2: 1 });
GameSchema.index({ winners: 1 });
GameSchema.index({ losers: 1 });
GameSchema.index({ 'channels.text': 1 });
GameSchema.index({ 'channels.team1Voice': 1 });
GameSchema.index({ 'channels.team2Voice': 1 });
GameSchema.index({ 'channels.picking': 1 });
GameSchema.index({ seasonNumber: 1, chapterNumber: 1 });

applyGetTeamOfPlayer(GameSchema);

export default mongoose.model<IGame>('Game', GameSchema);
