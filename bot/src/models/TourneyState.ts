import mongoose, { Schema } from 'mongoose';

export interface ITourneyState {
  guildId: string;
  enabled: boolean;
  by: string;
  source: 'discord' | 'minecraft';
  at: Date;
}

const TourneyStateSchema = new Schema<ITourneyState>({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, required: true },
  by: { type: String, required: true },
  source: { type: String, required: true, enum: ['discord', 'minecraft'] },
  at: { type: Date, required: true }
});

export default mongoose.model<ITourneyState>('TourneyState', TourneyStateSchema);
