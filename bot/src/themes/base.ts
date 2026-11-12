export type RankInfo = {
  name: string;
  color: string;
  startElo: number;
  endElo: number;
  nextRankName?: string;
  nextRankColor?: string;
  nextRankStartElo?: number;
  isMaxRank?: boolean;
  roleId?: string;
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  customEmoji?: string | null;
  nextRankIconUrl?: string | null;
};

export type PlayerData = {
  discordid: string;
  ign: string;
  wins: number;
  losses: number;
  mvps: number;
  elo: number;
  gamesplayed?: number;
  winstreak?: number;
  losestreak?: number;
  level?: number;
  experience?: number;
  kills?: number;
  deaths?: number;
  bedBroken?: number;
  finalKills?: number;
  diamonds?: number;
  irons?: number;
  gold?: number;
  emeralds?: number;
  blocksPlaced?: number;
  rankInfo?: RankInfo;
  primeRank?: 'prime' | 'prime+' | 'prime++' | string | null;
};

export type RecentGame = {
  gameid?: number | string;
  result?: 'win' | 'lose' | 'loss' | 'voided' | 'pending' | 'submitted' | string;
} | null;

export type Helpers = {
  calculateRating?: (playerData: PlayerData) => number;
  calculatePosition: (discordId: string) => number | string | Promise<number | string>;
};
