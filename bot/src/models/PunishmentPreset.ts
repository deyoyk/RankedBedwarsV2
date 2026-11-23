import mongoose, { Schema } from 'mongoose';

export type PresetType = 'ban' | 'mute';

export interface IPresetStep {
  duration: string;
  reason?: string;
}

export interface IPunishmentPreset {
  name: string;
  type: PresetType;
  reason: string;
  steps: IPresetStep[];
  createdBy: string;
  updatedAt: Date;
}

const PunishmentPresetSchema = new Schema<IPunishmentPreset>({
  name: { type: String, required: true, unique: true, lowercase: true, trim: true },
  type: { type: String, required: true, enum: ['ban', 'mute'] },
  reason: { type: String, required: true },
  steps: [{
    _id: false,
    duration: { type: String, required: true },
    reason: { type: String }
  }],
  createdBy: { type: String, required: true },
  updatedAt: { type: Date, default: () => new Date() }
});

export default mongoose.model<IPunishmentPreset>('PunishmentPreset', PunishmentPresetSchema);
