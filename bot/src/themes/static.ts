import { PlayerData, RecentGame, Helpers } from './base';
import { generateVeltrixImage } from './veltrix';

export default {
  generate: (playerData: PlayerData, recentGames: RecentGame[], helpers: Helpers) =>
    generateVeltrixImage(playerData, recentGames, helpers, 'static'),
};
