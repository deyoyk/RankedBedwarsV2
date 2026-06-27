import { Schema } from 'mongoose';

export const recentGameSubdoc = {
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
};

export const dailyEloSubdoc = {
  elo: { type: Number, required: true },
  date: { type: Date, required: true },
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
};

export function getTeamOfPlayer(this: any, playerId: string): string[] | null {
  if (this.team1.includes(playerId)) return this.team1;
  if (this.team2.includes(playerId)) return this.team2;
  return null;
}

export function applyGetTeamOfPlayer(schema: Schema): void {
  schema.methods.getTeamOfPlayer = getTeamOfPlayer;
}
