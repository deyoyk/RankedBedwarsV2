import { Schema } from 'mongoose';

export interface IRecentGame {
  gameId: number;
  queueId?: string;
  map: string;
  eloGain: number;
  elo_before?: number;
  elo_after?: number;
  kills: number;
  deaths: number;
  bedBroken: number;
  finalKills: number;
  finalDeaths?: number;
  won?: boolean;
  isMvp?: boolean;
  date: Date;
  state: string;
  startTime: Date;
  endTime?: Date;
  diamonds?: number;
  irons?: number;
  gold?: number;
  emeralds?: number;
  blocksPlaced?: number;
  damageDealt?: number;
  damageTaken?: number;
  assists?: number;
  maxStreak?: number;
  firstBlood?: boolean;
  fights?: number;
}

export interface IDailyElo {
  elo: number;
  date: Date;
}

export const recentGameSubdoc = {
  gameId: { type: Number, required: true },
  queueId: { type: String, required: false },
  map: { type: String, required: true },
  eloGain: { type: Number, required: true },
  elo_before: { type: Number },
  elo_after: { type: Number },
  kills: { type: Number, required: true },
  deaths: { type: Number, required: true },
  bedBroken: { type: Number, required: true },
  finalKills: { type: Number, required: true },
  finalDeaths: { type: Number, default: 0 },
  won: { type: Boolean, required: true },
  isMvp: { type: Boolean, default: false },
  date: { type: Date, required: true },
  state: { type: String, default: 'pending' },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  diamonds: { type: Number, default: 0 },
  irons: { type: Number, default: 0 },
  gold: { type: Number, default: 0 },
  emeralds: { type: Number, default: 0 },
  blocksPlaced: { type: Number, default: 0 },
  damageDealt: { type: Number, default: 0 },
  damageTaken: { type: Number, default: 0 },
  assists: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 },
  firstBlood: { type: Boolean, default: false },
  fights: { type: Number, default: 0 },
};

export const dailyEloSubdoc = {
  elo: { type: Number, required: true },
  date: { type: Date, required: true },
};

export const timelineEventSubdoc = {
  type: { type: String, required: true },
  player: { type: String },
  target: { type: String },
  amount: { type: Number },
  team: { type: String },
  timestamp: { type: Number, required: true },
};

export const fightSubdoc = {
  opponent: { type: String, required: true },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  damageDealt: { type: Number, default: 0 },
  damageTaken: { type: Number, default: 0 },
};

export const combatEntrySubdoc = {
  player: { type: String, required: true },
  kills: { type: Number, default: 0 },
  deaths: { type: Number, default: 0 },
  damageDealt: { type: Number, default: 0 },
  damageTaken: { type: Number, default: 0 },
  assists: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 },
  firstBlood: { type: Boolean, default: false },
  fights: { type: [fightSubdoc], default: [] },
};

export const gameBaseFields = {
  gameId: { type: Number, required: true },
  map: { type: String, required: true },
  team1: [{ type: String, required: true }],
  team2: [{ type: String, required: true }],
  winners: [{ type: String }],
  losers: [{ type: String }],
  mvps: [{ type: String }],
  bedbreaks: [{ type: String }],
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  state: {
    type: String,
    enum: ['voided', 'scored', 'pending', 'active'],
    default: 'pending'
  },
  channels: {
    text: { type: String, required: true },
    team1Voice: { type: String, required: true },
    team2Voice: { type: String, required: true },
    picking: { type: String }
  },
  queueId: { type: String, required: true },
  isRanked: { type: Boolean, default: false },
  partiesInThisGame: { type: String, default: '' },
  reason: { type: String, default: '' },
  timeline: { type: [timelineEventSubdoc], default: [] },
  combat: { type: [combatEntrySubdoc], default: [] },
};

function getTeamOfPlayer(this: { team1: string[]; team2: string[] }, playerId: string): string[] | null {
  if (this.team1.includes(playerId)) return this.team1;
  if (this.team2.includes(playerId)) return this.team2;
  return null;
}

export function applyGetTeamOfPlayer(schema: Schema): void {
  schema.methods.getTeamOfPlayer = getTeamOfPlayer;
}
