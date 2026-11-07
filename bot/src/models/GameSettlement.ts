import mongoose, { Document, Schema } from 'mongoose';

export type SettlementType = 'score' | 'void';
export type SettlementStatus = 'started' | 'stats_applied' | 'completed';

export interface IGameSettlement extends Document {
  gameId: number;
  type: SettlementType;
  status: SettlementStatus;
  payload: Record<string, unknown>;
  startedAt: Date;
  updatedAt: Date;
}

const GameSettlementSchema: Schema = new Schema({
  gameId: { type: Number, required: true, unique: true },
  type: { type: String, enum: ['score', 'void'], required: true },
  status: { type: String, enum: ['started', 'stats_applied', 'completed'], default: 'started', index: true },
  payload: { type: Schema.Types.Mixed, default: {} },
  startedAt: { type: Date, default: Date.now },
}, { timestamps: true });

GameSettlementSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.model<IGameSettlement>('GameSettlement', GameSettlementSchema);
