import mongoose, { Document, Schema } from 'mongoose';

export interface IPickingSessionState extends Document {
  gameId: number;
  queueData: Record<string, unknown>;
  selectedMap: string;
  players: string[];
  captains: string[];
  team1: string[];
  team2: string[];
  remainingPlayers: string[];
  currentPicker: string;
  pickCount: number;
  pickOrder: string[];
  partyInfo: Record<string, string[]>;
  partyPlayers: string[];
  channels: {
    game: string;
    picking: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const PickingSessionStateSchema: Schema = new Schema({
  gameId: { type: Number, required: true, unique: true },
  queueData: { type: Schema.Types.Mixed, required: true },
  selectedMap: { type: String, required: true },
  players: [{ type: String, required: true }],
  captains: [{ type: String, required: true }],
  team1: [{ type: String, default: [] }],
  team2: [{ type: String, default: [] }],
  remainingPlayers: [{ type: String, default: [] }],
  currentPicker: { type: String, required: true },
  pickCount: { type: Number, default: 0 },
  pickOrder: [{ type: String, default: [] }],
  partyInfo: { type: Schema.Types.Mixed, default: {} },
  partyPlayers: [{ type: String, default: [] }],
  channels: {
    game: { type: String, required: true },
    picking: { type: String, required: true },
  },
}, { timestamps: true });

PickingSessionStateSchema.index({ updatedAt: 1 });

export default mongoose.model<IPickingSessionState>('PickingSessionState', PickingSessionStateSchema);
