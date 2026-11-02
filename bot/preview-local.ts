import * as fs from 'fs';
import { generateThemeImage } from './src/assets/stats-theme/base';
import { generateScoreImageBuffer, generateGameStartImageBuffer } from './src/utils/scoreImage';

async function renderDefault(): Promise<void> {
  const stats = await generateThemeImage({
    discordid: '1',
    ign: 'xFlame',
    wins: 5,
    losses: 0,
    mvps: 0,
    elo: 50,
    gamesplayed: 5,
    games: 5,
    joined: 'Joined Jun 15, 2026',
    level: 3,
    xpToNext: 70,
    xpProgress: 0.3,
    winRate: 1,
    winCaption: '100.0% win rate · 5 games',
    tiles: [
      { value: '5', label: 'Wins', accent: '#00e676', rank: '#278' },
      { value: '0', label: 'Losses', accent: '#ff5252', rank: '#1167' },
      { value: '5.00', label: 'W/L ratio', accent: '#8b5cf6', rank: '#26' },
      { value: '42', label: 'Total Kills', accent: '#8b5cf6', rank: '#328' },
      { value: '0.95', label: 'K/D ratio', accent: '#00e5ff', rank: '#416' },
      { value: '0', label: 'MVPs', accent: '#ffd600', rank: '#456' },
      { value: '+5', label: 'Streak', accent: '#ff9100', rank: '#34' },
      { value: '49m', label: 'Playtime', accent: '#ffd600', rank: '#406' },
    ],
    combat: [
      { value: '3', label: 'Final Kills', accent: '#8b5cf6', rank: '#377' },
      { value: '0', label: 'Beds Broken', accent: '#8b5cf6', rank: '#488' },
      { value: '12', label: 'Final Deaths', accent: '#8b5cf6', rank: '#290' },
    ],
    seasonLine1: 'YEAR 26 SEASON 1',
    seasonLine2: 'July 22, 2026',
  } as any, [], { calculatePosition: () => 106, calculateRating: (pd: any) => pd.elo });
  fs.writeFileSync('preview-default.png', stats);
  console.log('Wrote preview-default.png');
}

async function renderScore(): Promise<void> {
  const score = await generateScoreImageBuffer(42,
    [
      { discordId: '1', username: 'Alice', team: 'winning', elo_before: 1200, elo_after: 1230, oldElo: 1200, newElo: 1230, mvp: true },
      { discordId: '2', username: 'Bob', team: 'winning', elo_before: 1100, elo_after: 1130, oldElo: 1100, newElo: 1130, mvp: false, bedbreaker: true },
    ],
    [
      { discordId: '3', username: 'Cara', team: 'losing', elo_before: 1300, elo_after: 1280, oldElo: 1300, newElo: 1280, mvp: false, bedbreaker: true },
      { discordId: '4', username: 'Dan', team: 'losing', elo_before: 1250, elo_after: 1225, oldElo: 1250, newElo: 1225, mvp: false },
    ]);
  fs.writeFileSync('preview-score.png', score);
  console.log('Wrote preview-score.png');
}

async function renderStart(): Promise<void> {
  const start = await generateGameStartImageBuffer(
    43,
    [
      { discordId: '1', username: 'Alice', elo: 1200, isCaptain: true },
      { discordId: '2', username: 'Bob', elo: 1100, isCaptain: false },
    ],
    [
      { discordId: '3', username: 'Cara', elo: 1300, isCaptain: true },
      { discordId: '4', username: 'Dan', elo: 1250, isCaptain: false },
    ],
    { mapName: 'Dreamgrove', modeLabel: 'RANKED' }
  );
  fs.writeFileSync('preview-start.png', start);
  console.log('Wrote preview-start.png');
}

async function main(): Promise<void> {
  const target = (process.argv[2] || 'all').toLowerCase();
  if (target === 'all' || target === 'default') await renderDefault();
  if (target === 'all' || target === 'score') await renderScore();
  if (target === 'all' || target === 'start') await renderStart();
  if (target !== 'all' && target !== 'default' && target !== 'score' && target !== 'start') {
    console.log('Usage: npm run preview [-- default|score|start|all]');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
