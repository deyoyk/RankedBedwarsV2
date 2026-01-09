import mongoose, { Schema, Document } from 'mongoose';

 


export interface IQueue extends Document {
  channelId: string;
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isRanked: boolean;
  ispicking: boolean;
  bypassRoles: string[];
  isActive?: boolean;
}

const QueueSchema: Schema = new Schema({
  channelId: { type: String, required: true, unique: true, index: true },
  maxPlayers: { type: Number, required: true },
  minElo: { type: Number, required: true, index: true },
  maxElo: { type: Number, required: true, index: true },
  isRanked: { type: Boolean, required: true },
  ispicking: { type: Boolean, default: false },
  bypassRoles: [{ type: String, default: [] }],
  isActive: { type: Boolean, default: true, index: true }
});

QueueSchema.index({ isActive: 1, minElo: 1, maxElo: 1 });
QueueSchema.index({ channelId: 1, isActive: 1 });

export default mongoose.model<IQueue>('Queue', QueueSchema);