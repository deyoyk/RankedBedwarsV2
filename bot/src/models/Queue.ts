import mongoose, { Document, Schema } from 'mongoose';

export interface IQueue extends Document {
  channelId: string;
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isRanked: boolean;
  isPicking: boolean;
  bypassRoles: string[];
  isActive?: boolean;
  /** The Minecraft server's ruleset for this queue's games: its season rules and shop rules. */
  ruleset?: 'normal' | 'ppp';
}

const QueueSchema: Schema = new Schema({
  channelId: { type: String, required: true, unique: true, index: true },
  maxPlayers: { type: Number, required: true },
  minElo: { type: Number, required: true, index: true },
  maxElo: { type: Number, required: true, index: true },
  isRanked: { type: Boolean, required: true },
  isPicking: { type: Boolean, default: false },
  bypassRoles: [{ type: String, default: [] }],
  isActive: { type: Boolean, default: true, index: true },
  ruleset: { type: String, enum: ['normal', 'ppp'], default: 'normal' }
});

QueueSchema.index({ isActive: 1, minElo: 1, maxElo: 1 });
QueueSchema.index({ channelId: 1, isActive: 1 });

export default mongoose.model<IQueue>('Queue', QueueSchema);