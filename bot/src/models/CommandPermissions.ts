import mongoose, { Document, Schema } from 'mongoose';

export interface ICommandPermissions extends Document {
  guildId: string;
  admin: string[];
  staff: string[];
  player: string[];
  playerEveryone: boolean;
}

const CommandPermissionsSchema: Schema = new Schema({
  guildId: { type: String, required: true, unique: true },
  admin: { type: [String], default: [] },
  staff: { type: [String], default: [] },
  player: { type: [String], default: [] },
  playerEveryone: { type: Boolean, default: true },
});

export default mongoose.model<ICommandPermissions>('CommandPermissions', CommandPermissionsSchema);
