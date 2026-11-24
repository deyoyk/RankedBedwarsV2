import mongoose, { Schema } from 'mongoose';

export interface ICallRoles {
  guildId: string;
  pups?: string;
  pugstrial?: string;
  pugs?: string;
  premium?: string;
}

const CallRolesSchema = new Schema<ICallRoles>({
  guildId: { type: String, required: true, unique: true },
  pups: { type: String },
  pugstrial: { type: String },
  pugs: { type: String },
  premium: { type: String }
});

export default mongoose.model<ICallRoles>('CallRoles', CallRolesSchema);
