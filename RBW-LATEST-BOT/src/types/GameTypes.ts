export enum GameState {
  PENDING = 'pending',
  SCORED = 'scored',
  VOIDED = 'voided'
}

export enum QueueType {
  RANDOM = 'random',
  PICKING = 'picking'
}

export interface TeamData {
  team1: string[];
  team2: string[];
}

export interface GameChannel {
  text: string;
  team1Voice: string;
  team2Voice: string;
  picking?: string;
}

export interface GameResources {
  gameId: number;
  gameChannel: any;
  team1Voice: any;
  team2Voice: any;
  pickingChannel?: any;
  game: any;
}

export interface WarpRequestData {
  gameId: string;
  timeout: NodeJS.Timeout;
  attempts: number;
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
}

export interface GameResult {
  gameId: number;
  winningTeam: number;
  winningTeamIGNs?: string[]; 
  mvps: string[];
  bedbreaks?: string[];
  playerData?: Record<string, PlayerData>;
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
}

export interface PartyInfo {
  partyId: string;
  members: string[];
  leader: string;
}

export interface GameSettings {
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isRanked: boolean;
  allowParties: boolean;
  queueType: QueueType;
  pickingEnabled: boolean;
}