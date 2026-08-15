import mongoose, { Schema, Document } from 'mongoose';
import { gameBaseFields, applyGetTeamOfPlayer } from './gameBase';
import { IGameBase } from './gameTypes';

export interface ISeasonGames extends IGameBase, Document {
  seasonNumber: number;
  chapterNumber: number;
  getTeamOfPlayer(playerId: string): string[] | null;
}

const SeasonGamesSchema: Schema = new Schema({
  ...gameBaseFields,
  seasonNumber: { type: Number, required: true },
  chapterNumber: { type: Number, required: true },
});

SeasonGamesSchema.index({ gameId: 1, seasonNumber: 1, chapterNumber: 1 }, { unique: true });
SeasonGamesSchema.index({ seasonNumber: 1, chapterNumber: 1, gameId: -1 });

applyGetTeamOfPlayer(SeasonGamesSchema);

export default mongoose.model<ISeasonGames>('SeasonGames', SeasonGamesSchema);
