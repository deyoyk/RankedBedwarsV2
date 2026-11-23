import * as fs from 'fs';
import { generateThemeImage } from './src/assets/stats-theme/base';
import type { EnrichedPlayerData } from './src/assets/stats-theme/base';
import type { MatchResult } from './src/assets/stats-theme/default';

const MATCHES: MatchResult[] = ['win', 'loss', 'voided', 'active', 'unknown', 'win', 'loss', 'voided', 'active', 'win'];

async function main(): Promise<void> {
  const player: EnrichedPlayerData = {
    discordid: 'lovedeyo-preview',
    ign: 'LoveDeyo',
    wins: 0,
    losses: 0,
    mvps: 0,
    elo: 0,
    gamesplayed: 0,
    rankName: 'Coal',
    rankColor: '#A0A0A0',
    wlr: 'N/A',
    beds: 0,
    streak: 0,
    positions: {
      elo: '#106',
      wins: '#278',
      losses: '#1167',
      wlr: '#26',
      mvps: '#456',
      beds: '#488',
      streak: '#34',
    },
  };
  const image = await generateThemeImage(player, MATCHES.map((result, index) => ({ gameid: index + 1, result })), {
    calculatePosition: () => 106,
    calculateRating: (pd) => pd.elo,
  });

  fs.writeFileSync('preview-lovedeyo.png', image);
  console.log('Wrote preview-lovedeyo.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
