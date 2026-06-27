import User from '../models/User';

export function ensureUserStats(user: any) {
  user.elo = typeof user.elo === 'number' && !isNaN(user.elo) ? user.elo : 0;
  user.wins = typeof user.wins === 'number' && !isNaN(user.wins) ? user.wins : 0;
  user.games = typeof user.games === 'number' && !isNaN(user.games) ? user.games : 0;
  user.winstreak = typeof user.winstreak === 'number' && !isNaN(user.winstreak) ? user.winstreak : 0;
  user.losestreak = typeof user.losestreak === 'number' && !isNaN(user.losestreak) ? user.losestreak : 0;
  user.losses = typeof user.losses === 'number' && !isNaN(user.losses) ? user.losses : 0;
  if (!Array.isArray(user.dailyElo)) user.dailyElo = [];
}

export function resetUserStats(user: any) {
  user.elo = 0;
  user.wins = 0;
  user.losses = 0;
  user.games = 0;
  user.mvps = 0;
  user.kills = 0;
  user.deaths = 0;
  user.bedBroken = 0;
  user.finalKills = 0;
  user.diamonds = 0;
  user.irons = 0;
  user.gold = 0;
  user.emeralds = 0;
  user.blocksPlaced = 0;
  user.winstreak = 0;
  user.losestreak = 0;
  user.kdr = 0;
  user.wlr = 0;
  user.recentGames = [];
  user.dailyElo = [];
}

export function updateDailyElo(user: any, newElo: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const existingEntry = user.dailyElo.find((entry: any) => {
    const entryDate = new Date(entry.date);
    entryDate.setHours(0, 0, 0, 0);
    return entryDate.getTime() === today.getTime();
  });
  if (existingEntry) {
    existingEntry.elo = newElo;
  } else {
    user.dailyElo.push({ elo: newElo, date: new Date() });
  }
}

export function computeWlr(wins: number, losses: number): number {
  return losses > 0 ? parseFloat((wins / losses).toFixed(2)) : wins;
}
