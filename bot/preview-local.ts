import * as fs from 'fs';
import { generateThemeImage } from './src/assets/stats-theme/base';
import type { EnrichedPlayerData } from './src/assets/stats-theme/base';
import { generateScoreImageBuffer, generateGameStartImageBuffer } from './src/utils/scoreImage';

async function renderDefault(): Promise<void> {
  const player: EnrichedPlayerData = {
    discordid: '1',
    ign: 'xFlame',
    wins: 5,
    losses: 0,
    mvps: 0,
    elo: 50,
    gamesplayed: 5,
    rankName: 'Coal',
    rankColor: '#A0A0A0',
    wlr: '5.00',
    beds: 0,
    streak: 5,
  };
  const stats = await generateThemeImage(player, [], { calculatePosition: () => 106, calculateRating: (pd) => pd.elo });
  fs.writeFileSync('preview-default.png', stats);
  console.log('Wrote preview-default.png');
}

async function renderScore(): Promise<void> {
  const score = await generateScoreImageBuffer(42,
    [
      { discordId: '1', username: 'Alice', team: 'winning', elo_before: 1200, elo_after: 1230, oldElo: 1200, newElo: 1230, mvp: true, kills: 6, deaths: 2, diamonds: 4, emeralds: 1 },
      { discordId: '2', username: 'Bob', team: 'winning', elo_before: 1100, elo_after: 1130, oldElo: 1100, newElo: 1130, mvp: false, bedbreaker: true, kills: 3, deaths: 4, diamonds: 2, emeralds: 0 },
    ],
    [
      { discordId: '3', username: 'Cara', team: 'losing', elo_before: 1300, elo_after: 1280, oldElo: 1300, newElo: 1280, mvp: false, bedbreaker: true, kills: 2, deaths: 5, diamonds: 1, emeralds: 0 },
      { discordId: '4', username: 'Dan', team: 'losing', elo_before: 1250, elo_after: 1225, oldElo: 1250, newElo: 1225, mvp: false, kills: 1, deaths: 3, diamonds: 0, emeralds: 2 },
    ], {
      map: 'Boletum',
      date: '22 Nov 2026',
      scoredAt: '16:02 UTC',
      duration: '5m 11s',
      mode: 'RANKED',
      isRanked: true,
    });
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

