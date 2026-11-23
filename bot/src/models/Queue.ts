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
  /** Players per team on the maps this queue may use (4 = 4v4 maps). Unset: maps whose size matches maxPlayers. */
  mapTeamSize?: number;
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
  ruleset: { type: String, enum: ['normal', 'ppp'], default: 'normal' },
  mapTeamSize: { type: Number, min: 1, max: 4 }
});

QueueSchema.index({ isActive: 1, minElo: 1, maxElo: 1 });
QueueSchema.index({ channelId: 1, isActive: 1 });

export default mongoose.model<IQueue>('Queue', QueueSchema);