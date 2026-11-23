import mongoose, { Document, Schema } from 'mongoose';
import { dailyEloSubdoc, IDailyElo, IRecentGame, recentGameSubdoc } from './gameBase';
import { coreStatFields, IUserStats } from './statFields';

export interface IUser extends Document, Omit<IUserStats, 'kdr' | 'wlr'> {
  discordId: string;
  ign: string;
  kdr?: number;
  wlr?: number;
  createdAt?: Date;
  updatedAt?: Date;
  ownedThemes?: string[];
  currentTheme?: string;
  seasonNumber?: number;
  chapterNumber?: number;
  isMuted?: boolean;
  isFrozen?: boolean;
  isBanned?: boolean;
  settings: {
    toggleprefix: boolean;
    togglescoreping: boolean;
    togglepartyinvites: boolean;
    togglestaticnick: boolean;
    nick: string;
  };
  recentGames: IRecentGame[];
  partyId?: string;
  lastPlayedAt?: Date;
  /** The queue VC this player last got into, for /q in game. */
  lastQueueChannelId?: string;
  lastQueueAt?: Date;
  dailyElo: IDailyElo[];
  strikes: Array<{
    id: string;
    reason: string;
    date: Date;
    moderator: string;
  }>;
  mutes: Array<{
    id: string;
    reason: string;
    date: Date;
    duration: number;
    moderator: string;
    preset?: string;
  }>;
  bans: Array<{
    id: string;
    reason: string;
    date: Date;
    duration: number;
    moderator: string;
    preset?: string;
  }>;
  statResets: Array<{
    date: Date;
    seasonNumber?: number;
    chapterNumber?: number;
  }>;
  eloClaims: Array<{
    date: Date;
    seasonNumber?: number;
    chapterNumber?: number;
    roleId?: string;
    amount?: number;
  }>;
}

const UserSchema: Schema = new Schema({
  discordId: { type: String, required: true, unique: true, index: true },
  ign: { type: String },
  ...coreStatFields,
  elo: { ...coreStatFields.elo, index: true },
  ownedThemes: { type: [String], default: [] },
  currentTheme: { type: String, default: 'elite' },
  seasonNumber: { type: Number },
  chapterNumber: { type: Number },
  wins: { ...coreStatFields.wins, index: true },
  isBanned: { type: Boolean, default: false, index: true },
  isMuted: { type: Boolean, default: false },
  isFrozen: { type: Boolean, default: false, index: true },
  settings:{
    toggleprefix:{ type: Boolean, default: false },
    togglescoreping: { type: Boolean, default: false },
    togglepartyinvites: { type: Boolean, default: false },
    togglestaticnick: { type: Boolean, default: false },
    nick: { type: String, default: '' },
  },
  recentGames: [recentGameSubdoc],
  partyId: { type: String },
  lastPlayedAt: { type: Date, index: true },
  lastQueueChannelId: { type: String },
  lastQueueAt: { type: Date },
  dailyElo: [dailyEloSubdoc],
  strikes: [{
    id: { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    reason: { type: String, required: true },
    date: { type: Date, required: true },
    moderator: { type: String, required: true },
  }],
  mutes: [{
    id: { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    reason: { type: String, required: true },
    date: { type: Date, required: true },
    duration: { type: Number, required: true },
    moderator: { type: String, required: true },
    preset: { type: String },
  }],
  bans: [{
    id: { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    reason: { type: String, required: true },
    date: { type: Date, required: true },
    duration: { type: Number, required: true },
    moderator: { type: String, required: true },
    preset: { type: String },
  }],
  statResets: [{
    date: { type: Date, required: true },
    seasonNumber: { type: Number },
    chapterNumber: { type: Number },
  }],
  eloClaims: [{
    date: { type: Date, required: true },
    seasonNumber: { type: Number },
    chapterNumber: { type: Number },
    roleId: { type: String },
    amount: { type: Number },
  }],
}, { timestamps: true });

UserSchema.index({ ign: 1 }, { collation: { locale: 'en', strength: 2 } });
UserSchema.index({ elo: -1 });
UserSchema.index({ elo: 1, lastPlayedAt: 1 });
UserSchema.index({ wins: -1 });
UserSchema.index({ kills: -1 });
UserSchema.index({ isBanned: 1, isFrozen: 1 });
UserSchema.index({ isMuted: 1 });
UserSchema.index({ partyId: 1 }, { sparse: true });
UserSchema.index({ 'bans.id': 1 }, { sparse: true });
UserSchema.index({ 'mutes.id': 1 }, { sparse: true });
UserSchema.index({ 'strikes.id': 1 }, { sparse: true });

export default mongoose.model<IUser>('User', UserSchema);
