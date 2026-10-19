import { PlayerData, RecentGame, Helpers, generateThemeImage } from './base';

export default {
  generate: (playerData: PlayerData, recentGames: RecentGame[], helpers: Helpers) =>
    generateThemeImage('y2k', playerData, recentGames, helpers),
};
