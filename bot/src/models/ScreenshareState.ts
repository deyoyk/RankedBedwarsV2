import mongoose, { Schema } from 'mongoose';

export interface IScreenshareState {
  guildId: string;
  enabled: boolean;
  by: string;
  at: Date;
}

const ScreenshareStateSchema = new Schema<IScreenshareState>({
  guildId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, required: true },
  by: { type: String, required: true },
  at: { type: Date, required: true }
});

export default mongoose.model<IScreenshareState>('ScreenshareState', ScreenshareStateSchema);
