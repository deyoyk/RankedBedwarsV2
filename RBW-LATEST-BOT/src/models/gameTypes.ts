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
  state: 'voided' | 'scored' | 'pending' | 'active';
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
}
