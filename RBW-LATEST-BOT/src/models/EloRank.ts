import mongoose, { Schema, Document } from 'mongoose';

 


export interface IEloRank extends Document {
  roleId: string;
  startElo: number;
  endElo: number;
  mvpElo: number; 
  winElo: number; 
  loseElo: number; 
  bedElo: number;
}

const EloRankSchema: Schema = new Schema({
  roleId: { type: String, required: true, unique: true },
  startElo: { type: Number, required: true },
  endElo: { type: Number, required: true },
  mvpElo: { type: Number, required: true },
  winElo: { type: Number, required: true }, 
  loseElo: { type: Number, required: true },
  bedElo: { type: Number, required: true  } 
});

export default mongoose.model<IEloRank>('EloRank', EloRankSchema);