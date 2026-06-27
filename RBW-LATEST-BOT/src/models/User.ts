import mongoose, { Schema, Document } from 'mongoose';
import { recentGameSubdoc, dailyEloSubdoc, IRecentGame, IDailyElo } from './gameBase';
import { coreStatFields } from './statFields';

export interface IUser extends Document {
  discordId: string;
  ign: string;
  elo: number;
  ownedThemes?: string[];
  currentTheme?: string;
  seasonNumber?: number;
  chapterNumber?: number;
  level: number;
  experience: number;
  wins: number;
  losses: number;
  games: number;
  mvps: number;
  kills: number;
  deaths: number;
  bedBroken: number;
  finalKills: number;
  diamonds?: number;
  irons?: number;
  gold?: number;
  emeralds?: number;
  blocksPlaced?: number;
  winstreak?: number;
  losestreak?: number;
  kdr?: number;
  wlr?: number;
  ismuted?: boolean;
  isfrozen?: boolean;
  isbanned?: boolean;
  nick?: string;
  settings: {
    toggleprefix: boolean;
    togglescoreping: boolean;
    togglepartyinvites: boolean;
    togglestaticnick: boolean;
  };
  recentGames: IRecentGame[];
  partyId?: string;
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
  }>;
  bans: Array<{
    id: string;
    reason: string;
    date: Date;
    duration: number;
    moderator: string;
  }>;
}

const UserSchema: Schema = new Schema({
  discordId: { type: String, required: true, unique: true, index: true },
  ign: { type: String, index: true },
  ...coreStatFields,
  elo: { ...coreStatFields.elo, index: true },
  ownedThemes: { type: [String], default: [] },
  currentTheme: { type: String, default: 'elite' },
  seasonNumber: { type: Number },
  chapterNumber: { type: Number },
  wins: { ...coreStatFields.wins, index: true },
  isbanned: { type: Boolean, default: false, index: true },
  ismuted: { type: Boolean, default: false },
  isfrozen: { type: Boolean, default: false, index: true },
  settings:{
    toggleprefix:{ type: Boolean, default: false },
    togglescoreping: { type: Boolean, default: false },
    togglepartyinvites: { type: Boolean, default: false },
    togglestaticnick: { type: Boolean, default: false },
    nick: { type: String, default: '' },
  },
  recentGames: [recentGameSubdoc],
  partyId: { type: String, index: true },
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
  }],
  bans: [{
    id: { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    reason: { type: String, required: true },
    date: { type: Date, required: true },
    duration: { type: Number, required: true },
    moderator: { type: String, required: true },
  }],
});

UserSchema.index({ ign: 1 }, { collation: { locale: 'en', strength: 2 } });
UserSchema.index({ elo: -1 });
UserSchema.index({ wins: -1 });
UserSchema.index({ isbanned: 1, isfrozen: 1 });
UserSchema.index({ partyId: 1 }, { sparse: true });

export default mongoose.model<IUser>('User', UserSchema);
