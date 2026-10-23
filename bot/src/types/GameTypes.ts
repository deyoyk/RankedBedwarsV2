export enum GameState {
  PENDING = 'pending',
  SCORING = 'scoring',
  SCORED = 'scored',
  VOIDED = 'voided'
}

export enum QueueType {
  RANDOM = 'random',
  PICKING = 'picking'
}

import type { IGame } from '../models/Game';

export interface GameResources {
  gameId: number;
  gameChannel: { id: string };
  team1Voice: { id: string };
  team2Voice: { id: string };
  pickingChannel?: { id: string };
  game: IGame | null;
}

export interface WarpRequestData {
  gameId: string;
  timeout: NodeJS.Timeout;
  attempts: number;
  retrying?: boolean;
  team1IGNs: string[];
  team2IGNs: string[];
  map: string;
  isRanked: boolean;
  timestamp: number;
}

export interface PlayerData {
  kills?: number;
  deaths?: number;
  bedBroken?: number;
  finalKills?: number;
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
  fights?: Record<string, { kills?: number; damage_dealt?: number; damageDealt?: number }>;
}

export interface GameResult {
  gameId: number;
  winningTeam?: number;
  winningTeamIGNs?: string[]; 
  mvps: string[];
  bedbreaks?: string[];
  playerData?: Record<string, PlayerData>;
  timeline?: Array<{
    type: string;
    player?: string;
    target?: string;
    amount?: number;
    team?: string;
    timestamp: number;
  }>;
  reason?: string;
}

export interface VoidResult {
  gameId: number;
  reason: string;
  revertedPlayers: Array<{ discordId: string; elo: number }>;
}

export interface MatchmakingResult {
  success: boolean;
  gamesCreated: number;
  errors?: string[];
}

export interface QueueProcessingResult {
  gamesCreated: number;
  usedPlayers: string[];
}

export interface TeamBalanceResult {
  team1: string[];
  team2: string[];
  usedPlayers: Set<string>;
  averageEloDiff: number;
}

export interface PickingSession {
  gameId: number;
  captains: string[];
  remainingPlayers: string[];
  currentPicker: string;
  pickCount: number;
  team1: string[];
  team2: string[];
  timeout: NodeJS.Timeout;
  active: boolean;
  partyInfo?: Map<string, string[]>;
  partyPlayers?: Set<string>;
  pickOrder?: string[];
  pickingResources?: Partial<GameResources>;
}

