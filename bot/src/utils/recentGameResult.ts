import { IRecentGame } from '../models/gameBase';

export type RecentGameResult = 'win' | 'lose' | 'voided' | 'pending' | 'unknown';

export function resolveRecentGameResult(game: Pick<IRecentGame, 'state' | 'won'>): RecentGameResult {
  switch (game.state) {
    case 'scored':
      return game.won === true ? 'win' : 'lose';
    case 'win':
      return 'win';
    case 'lose':
    case 'loss':
      return 'lose';
    case 'voided':
      return 'voided';
    case 'pending':
    case 'active':
      return 'pending';
    default:
      return 'unknown';
  }
}
