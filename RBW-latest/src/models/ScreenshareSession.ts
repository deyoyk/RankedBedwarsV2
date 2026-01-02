import mongoose, { Schema, Document } from 'mongoose';

export interface IScreenshareSession extends Document {
  sessionId: string;
  targetId: string;
  targetIgn: string;
  requesterId: string;
  reason: string;
  imageUrl?: string;
  status: 'pending' | 'frozen' | 'closed' | 'expired' | 'cancelled';
  freezeTime?: Date;
  expireTime: Date;
  actions: Array<{
    action: 'freeze' | 'admit' | 'deny' | 'close' | 'expire' | 'cancel';
    userId: string;
    timestamp: Date;
    context?: string;
  }>;
  channelId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ScreenshareSessionSchema: Schema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  targetId: { type: String, required: true },
  targetIgn: { type: String, required: true },
  requesterId: { type: String, required: true },
  reason: { type: String, required: true },
  imageUrl: { type: String },
  status: { type: String, enum: ['pending', 'frozen', 'closed', 'expired', 'cancelled'], default: 'pending' },
  freezeTime: { type: Date },
  expireTime: { type: Date, required: true },
  actions: [
    {
      action: { type: String, enum: ['freeze', 'admit', 'deny', 'close', 'expire', 'cancel'], required: true },
      userId: { type: String, required: true },
      timestamp: { type: Date, required: true },
      context: { type: String }
    }
  ],
  channelId: { type: String }
}, { timestamps: true });

export default mongoose.model<IScreenshareSession>('ScreenshareSession', ScreenshareSessionSchema);