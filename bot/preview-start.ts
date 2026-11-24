import * as fs from 'fs';
import { generateGameStartImageBuffer } from './src/utils/scoreImage';

async function main(): Promise<void> {
  const image = await generateGameStartImageBuffer(
    53,
    [
      { discordId: '1', username: 'Qyyroxt', elo: 165, isCaptain: true },
      { discordId: '2', username: 'DukeShadow_YT', elo: 540, isCaptain: false },
      { discordId: '3', username: 'TheGoatDewier', elo: 410, isCaptain: false },
      { discordId: '4', username: 'Entitilo_dplsx', elo: 350, isCaptain: false },
    ],
    [
      { discordId: '5', username: 'LoneSpeed', elo: 465, isCaptain: true },
      { discordId: '6', username: 'AMBOSUK444', elo: 410, isCaptain: false },
      { discordId: '7', username: 'Skydots', elo: 280, isCaptain: false },
      { discordId: '8', username: 'fbbr_', elo: 340, isCaptain: false },
    ],
    {
      mapName: 'Boletum',
      modeLabel: 'RANKED',
      isRanked: true,
      minElo: 0,
      maxElo: 1000,
      serverName: 'DEYO RANKED BEDWARS',
      inviteLink: 'discord.gg/vrbw',
    },
  );

  fs.writeFileSync('preview-start.png', image);
  console.log('Wrote preview-start.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
