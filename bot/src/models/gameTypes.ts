export interface ITimelineEvent {
  type: string;
  player?: string;
  target?: string;
  amount?: number;
  team?: string;
  timestamp: number;
}

export interface IFight {
  opponent: string;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
}

export interface ICombatEntry {
  player: string;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  assists: number;
  maxStreak: number;
  firstBlood: boolean;
  fights: IFight[];
}

export interface IGameBase {
  gameId: number;
  map: string;
  team1: string[];
  team2: string[];
  winners: string[];
  losers: string[];
  mvps: string[];
  bedbreaks: string[];
  startTime: Date;
  endTime?: Date;
  state: 'voided' | 'scored' | 'pending' | 'active' | 'scoring';
  channels: {
    text: string;
    team1Voice: string;
    team2Voice: string;
    picking?: string;
  };
  queueId: string;
  isRanked: boolean;
  partiesInThisGame: string;
  reason: string;
  timeline?: ITimelineEvent[];
  combat?: ICombatEntry[];
}
