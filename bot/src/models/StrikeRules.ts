import mongoose, { Schema } from 'mongoose';

export interface IStrikeRule {
  strikes: number;
  action: string;
}

export interface IStrikeRules {
  guildId: string;
  rules: IStrikeRule[];
  otherwise: string;
}

const StrikeRulesSchema = new Schema<IStrikeRules>({
  guildId: { type: String, required: true, unique: true },
  rules: [{
    _id: false,
    strikes: { type: Number, required: true },
    action: { type: String, required: true }
  }],
  otherwise: { type: String, required: true }
});

export default mongoose.model<IStrikeRules>('StrikeRules', StrikeRulesSchema);
