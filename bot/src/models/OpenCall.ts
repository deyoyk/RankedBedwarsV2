import mongoose, { Schema } from 'mongoose';

export interface IOpenedRole {
  id: string;
  allow: string | null;
  deny: string | null;
}

export interface IOpenCall {
  channelId: string;
  tier: string;
  roles: IOpenedRole[];
  openedBy: string;
  at: Date;
}

const OpenCallSchema = new Schema<IOpenCall>({
  channelId: { type: String, required: true, unique: true },
  tier: { type: String, required: true },
  roles: [{
    _id: false,
    id: { type: String, required: true },
    allow: { type: String, default: null },
    deny: { type: String, default: null }
  }],
  openedBy: { type: String, required: true },
  at: { type: Date, default: () => new Date() }
});

export default mongoose.model<IOpenCall>('OpenCall', OpenCallSchema);
