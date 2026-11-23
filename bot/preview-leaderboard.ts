import * as fs from 'fs';
import { generateLeaderboardImage, LeaderboardEntry } from './src/utils/leaderboardImage';

const players = [
  ['bananayskl', 1000, 'Obsidian', '#A855F7'],
  ['sharpetherapist', 0, 'Coal', '#A0A0A0'],
  ['whisperinurheart', 0, 'Coal', '#A0A0A0'],
  ['TopBehaviour', 0, 'Coal', '#A0A0A0'],
  ['lily_sienna', 0, 'Coal', '#A0A0A0'],
  ['villagr', 0, 'Coal', '#A0A0A0'],
  ['futurelifepoet', 0, 'Coal', '#A0A0A0'],
  ['Roadyowo', 0, 'Coal', '#A0A0A0'],
  ['BoriSiu', 0, 'Coal', '#A0A0A0'],
  ['yfou', 0, 'Coal', '#A0A0A0'],
] as const;

async function main(): Promise<void> {
  const entries: LeaderboardEntry[] = players.map(([ign, elo, rankName, rankColor], index) => ({
    rank: index + 1,
    ign,
    value: elo,
    elo,
    rankName,
    rankColor,
  }));

  const image = await generateLeaderboardImage('Elo Leaderboard', 'ELO', entries, 0, 1);
  fs.writeFileSync('preview-leaderboard.png', image);
  console.log('Wrote preview-leaderboard.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
