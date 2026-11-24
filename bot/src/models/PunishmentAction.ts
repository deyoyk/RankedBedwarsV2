import mongoose, { Schema } from 'mongoose';

export type PunishmentSource = 'discord' | 'minecraft';

export interface IPunishmentAction {
  type: string;
  targetId: string;
  moderatorId: string;
  staff?: string;
  source: PunishmentSource;
  caseId?: string;
  date: Date;
}

const PunishmentActionSchema = new Schema<IPunishmentAction>({
  type: { type: String, required: true },
  targetId: { type: String, required: true, index: true },
  moderatorId: { type: String, required: true },
  staff: { type: String },
  source: { type: String, required: true, enum: ['discord', 'minecraft'] },
  caseId: { type: String },
  date: { type: Date, default: () => new Date() }
});

export default mongoose.model<IPunishmentAction>('PunishmentAction', PunishmentActionSchema);
