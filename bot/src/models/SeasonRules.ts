import mongoose, { Schema } from 'mongoose';

export interface ISeasonRules {
  key: string;
  season: string[];
  ppp: string[];
  updatedAt: Date;
}

const SeasonRulesSchema = new Schema<ISeasonRules>({
  key: { type: String, required: true, unique: true },
  season: { type: [String], default: [] },
  ppp: { type: [String], default: [] },
  updatedAt: { type: Date, required: true }
});

export default mongoose.model<ISeasonRules>('SeasonRules', SeasonRulesSchema);
