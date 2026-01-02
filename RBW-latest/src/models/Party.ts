import mongoose, { Schema, Document } from 'mongoose';

 


export interface IParty extends Document {
  partyId: string;
  leader: string;
  members: string[];
  createdAt: Date;
  lastActiveTime: Date;
  maxMembers: number;
  isPrivate: boolean;
  description: string;
}

const PartySchema: Schema = new Schema({
  partyId: { type: String, required: true, unique: true },
  leader: { type: String, required: true },
  members: [{ type: String, required: true }],
  createdAt: { type: Date, default: Date.now },
  lastActiveTime: { type: Date, default: Date.now },
  maxMembers: { type: Number, default: 8 },
  isPrivate: { type: Boolean, default: false },
  description: { type: String, default: '' }
});

export default mongoose.model<IParty>('Party', PartySchema);