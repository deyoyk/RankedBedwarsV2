import mongoose, { Schema } from 'mongoose';

export interface IPartySize {
  guildId: string;
  size: number;
}

const PartySizeSchema = new Schema<IPartySize>({
  guildId: { type: String, required: true, unique: true },
  size: { type: Number, required: true }
});

export default mongoose.model<IPartySize>('PartySize', PartySizeSchema);
