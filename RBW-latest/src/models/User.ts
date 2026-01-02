import mongoose, { Schema, Document } from 'mongoose';

 


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
  recentGames: Array<{
    gameId: number;
    queueid?: number;
    map: string;
    eloGain: number;
    kills: number;
    deaths: number;
    bedBroken: number;
    finalKills: number;
    won?: boolean;
    ismvp?: boolean;
    date: Date;
    state: String;
    startTime: Date;
    endTime?: Date;
    diamonds?: number;
    irons?: number;
    gold?: number;
    emeralds?: number;
    blocksPlaced?: number;
  }>;
  partyId?: string;
  dailyElo: Array<{
    elo: number;
    date: Date;
  }>;
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
  elo: { type: Number, default: 0, index: true },
  ownedThemes: { type: [String], default: [] },
  currentTheme: { type: String, default: 'elite' },
  seasonNumber: { type: Number },
  chapterNumber: { type: Number },
  level: { type: Number, default: 1 },
  experience: { type: Number, default: 0 },
  wins: { type: Number, default: 0, index: true },
  losses: { type: Number, default: 0 },
  games: { type: Number, default: 0 },
  mvps: { type: Number, default: 0 },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  bedBroken: { type: Number, default: 0 }, 
  finalKills: { type: Number, default: 0 }, 
  diamonds: { type: Number, default: 0 },
  irons: { type: Number, default: 0 },
  gold: { type: Number, default: 0 },
  emeralds: { type: Number, default: 0 },
  blocksPlaced: { type: Number, default: 0 },
  isbanned: { type: Boolean, default: false, index: true }, 
  ismuted: { type: Boolean, default: false }, 
  isfrozen: { type: Boolean, default: false, index: true }, 
  winstreak: { type: Number, default: 0 },
  losestreak: { type: Number, default: 0 },
  kdr: { type: Number, default: 0 },
  wlr: { type: Number, default: 0 },
  settings:{
    toggleprefix:{ type: Boolean, default: false },
    togglescoreping: { type: Boolean, default: false },
    togglepartyinvites: { type: Boolean, default: false },
    togglestaticnick: { type: Boolean, default: false },
    nick: { type: String, default: '' },
  },
  recentGames: [{
    gameId: { type: Number, required: true },
    queueid: { type: String, required: false },
    map: { type: String, required: true },
    eloGain: { type: Number, required: true },
    kills: { type: Number, required: true },
    deaths: { type: Number, required: true },
    bedBroken: { type: Number, required: true },
    finalKills: { type: Number, required: true },
    won: { type: Boolean, required: true },
    ismvp: { type: Boolean, default: false },
    date: { type: Date, required: true },
    state: { type: String, default: 'pending' },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    diamonds: { type: Number, default: 0 },
    irons: { type: Number, default: 0 },
    gold: { type: Number, default: 0 },
    emeralds: { type: Number, default: 0 },
    blocksPlaced: { type: Number, default: 0 },
  }],
  partyId: { type: String, index: true },
  dailyElo: [
    {
      elo: { type: Number, required: true },
      date: { type: Date, required: true },
    },
  ],
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