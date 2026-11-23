import * as fs from 'fs';
import { generateScoreImageBuffer } from './src/utils/scoreImage';

async function main(): Promise<void> {
  const image = await generateScoreImageBuffer(
    53,
    [
      { discordId: '1', username: 'Qyyroxt', team: 'winning', elo_before: 165, elo_after: 195, mvp: false, kills: 4, deaths: 2, diamonds: 0, emeralds: 1, partyId: 'p1' },
      { discordId: '2', username: 'DukeShadow_YT', team: 'winning', elo_before: 540, elo_after: 570, mvp: true, kills: 5, deaths: 5, diamonds: 0, emeralds: 0, partyId: 'p1' },
      { discordId: '3', username: 'TheGoatDewier', team: 'winning', elo_before: 410, elo_after: 440, mvp: false, bedbreaker: true, kills: 1, deaths: 2, diamonds: 0, emeralds: 0, partyId: '' },
      { discordId: '4', username: 'Entitilo_dplsx', team: 'winning', elo_before: 350, elo_after: 375, mvp: false, kills: 3, deaths: 1, diamonds: 7, emeralds: 2, partyId: '' },
    ],
    [
      { discordId: '5', username: 'LoneSpeed', team: 'losing', elo_before: 465, elo_after: 445, mvp: false, kills: 0, deaths: 3, diamonds: 0, emeralds: 6, partyId: 'p3' },
      { discordId: '6', username: 'AMBOSUK444', team: 'losing', elo_before: 410, elo_after: 390, mvp: false, kills: 3, deaths: 5, diamonds: 0, emeralds: 0, partyId: 'p3' },
      { discordId: '7', username: 'Skydots', team: 'losing', elo_before: 280, elo_after: 265, mvp: false, kills: 1, deaths: 3, diamonds: 0, emeralds: 0, partyId: 'p4' },
      { discordId: '8', username: 'fbbr_', team: 'losing', elo_before: 340, elo_after: 325, mvp: false, kills: 3, deaths: 3, diamonds: 1, emeralds: 0, partyId: 'p4' },
    ],
    {
      map: 'Boletum',
      date: '22 Nov 2026',
      scoredAt: '16:02 UTC',
      duration: '5m 11s',
      mode: 'RANKED',
      isRanked: true,
      serverName: 'DEYO RANKED BEDWARS',
      inviteLink: 'play.deyo.lol',
    },
  );

  fs.writeFileSync('preview-score.png', image);
  console.log('Wrote preview-score.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
