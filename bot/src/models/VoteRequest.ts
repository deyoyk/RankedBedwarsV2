import mongoose, { Schema, Document } from 'mongoose';

export interface IVoteRequest extends Document {
  key: string;
  gameId: string;
  scope: string;
  requesterId: string;
  messageId?: string;
  createdAt: Date;
  expireAt: Date;
}

const VoteRequestSchema: Schema = new Schema({
  key: { type: String, required: true, unique: true },
  gameId: { type: String, required: true },
  scope: { type: String, required: true },
  requesterId: { type: String, required: true },
  messageId: { type: String },
  createdAt: { type: Date, default: Date.now },
  expireAt: { type: Date, required: true }
});

VoteRequestSchema.index({ gameId: 1 });
VoteRequestSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IVoteRequest>('VoteRequest', VoteRequestSchema);
