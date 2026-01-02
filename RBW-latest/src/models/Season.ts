import mongoose, { Schema, Document } from 'mongoose';

export interface ISeason extends Document {
  seasonNumber: number;
  chapterNumber: number;
  name: string;
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  description?: string;
}

const SeasonSchema: Schema = new Schema({
  seasonNumber: { type: Number, required: true },
  chapterNumber: { type: Number, required: true },
  name: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  isActive: { type: Boolean, default: true },
  description: { type: String }
});


SeasonSchema.index({ seasonNumber: 1, chapterNumber: 1 }, { unique: true });

export default mongoose.model<ISeason>('Season', SeasonSchema);