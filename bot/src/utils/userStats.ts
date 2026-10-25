export interface UserStatsLike {
  elo?: number;
  wins?: number;
  losses?: number;
  games?: number;
  mvps?: number;
  kills?: number;
  deaths?: number;
  bedBroken?: number;
  finalKills?: number;
  diamonds?: number;
  irons?: number;
  gold?: number;
  emeralds?: number;
  blocksPlaced?: number;
  winStreak?: number;
  loseStreak?: number;
  kdr?: number;
  wlr?: number;
  finalDeaths?: number;
  playtimeSeconds?: number;
  peakElo?: number;
  experience?: number;
  level?: number;
  dailyElo?: Array<{ elo: number; date: Date | string }>;
  recentGames?: unknown[];
}

export function ensureUserStats(user: UserStatsLike) {
  user.elo = typeof user.elo === 'number' && !isNaN(user.elo) ? user.elo : 0;
  user.wins = typeof user.wins === 'number' && !isNaN(user.wins) ? user.wins : 0;
  user.games = typeof user.games === 'number' && !isNaN(user.games) ? user.games : 0;
  user.winStreak = typeof user.winStreak === 'number' && !isNaN(user.winStreak) ? user.winStreak : 0;
  user.loseStreak = typeof user.loseStreak === 'number' && !isNaN(user.loseStreak) ? user.loseStreak : 0;
  user.losses = typeof user.losses === 'number' && !isNaN(user.losses) ? user.losses : 0;
  user.finalDeaths = typeof user.finalDeaths === 'number' && !isNaN(user.finalDeaths) ? user.finalDeaths : 0;
  user.playtimeSeconds = typeof user.playtimeSeconds === 'number' && !isNaN(user.playtimeSeconds) ? user.playtimeSeconds : 0;
  user.peakElo = typeof user.peakElo === 'number' && !isNaN(user.peakElo) ? user.peakElo : 0;
  if (!Array.isArray(user.dailyElo)) user.dailyElo = [];
}

export function resetUserStats(user: UserStatsLike) {
  user.elo = 0;
  user.wins = 0;
  user.losses = 0;
  user.games = 0;
  user.mvps = 0;
  user.kills = 0;
  user.deaths = 0;
  user.bedBroken = 0;
  user.finalKills = 0;
  user.finalDeaths = 0;
  user.diamonds = 0;
  user.irons = 0;
  user.gold = 0;
  user.emeralds = 0;
  user.blocksPlaced = 0;
  user.winStreak = 0;
  user.loseStreak = 0;
  user.kdr = 0;
  user.wlr = 0;
  user.playtimeSeconds = 0;
  user.peakElo = 0;
  user.recentGames = [];
  user.dailyElo = [];
}

export function updateDailyElo(user: UserStatsLike, newElo: number) {
  if (!Array.isArray(user.dailyElo)) user.dailyElo = [];
  const dayKey = (d: Date | string) => {
    const t = new Date(d);
    return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
  };
  const todayKey = dayKey(new Date());
  const last = user.dailyElo[user.dailyElo.length - 1];
  if (last && dayKey(last.date) === todayKey) {
    last.elo = newElo;
    return;
  }
  user.dailyElo.push({ elo: newElo, date: new Date() });
  if (user.dailyElo.length > 30) {
    user.dailyElo.splice(0, user.dailyElo.length - 30);
  }
}

export function computeWlr(wins: number, losses: number): number {
  return losses > 0 ? parseFloat((wins / losses).toFixed(2)) : wins;
}
