import config from '../src/config/config';
import { getMaxMvpsPerGame, limitMvps, mvpLimitMessage, uniqueMvps } from '../src/utils/mvp';

describe('MVP configuration', () => {
  const originalLimit = config.maxMvpsPerGame;

  afterEach(() => {
    config.maxMvpsPerGame = originalLimit;
  });

  it('trims and deduplicates MVP names case-insensitively', () => {
    expect(uniqueMvps([' Alice ', 'bob', 'ALICE', '', 'Bob', 'Cara'])).toEqual([
      'Alice',
      'bob',
      'Cara',
    ]);
  });

  it('limits MVPs to the configured maximum', () => {
    config.maxMvpsPerGame = 2;
    expect(getMaxMvpsPerGame()).toBe(2);
    expect(limitMvps(['A', 'B', 'C', 'D'])).toEqual(['A', 'B']);
  });

  it('falls back to one MVP for invalid configuration', () => {
    config.maxMvpsPerGame = 0;
    expect(getMaxMvpsPerGame()).toBe(1);
    config.maxMvpsPerGame = -5;
    expect(getMaxMvpsPerGame()).toBe(1);
  });

  it('builds singular and plural limit messages', () => {
    expect(mvpLimitMessage(1)).toBe('A game can have at most 1 MVP.');
    expect(mvpLimitMessage(3)).toBe('A game can have at most 3 MVPs.');
  });

  it('reads MAX_MVPS_PER_GAME from the environment', () => {
    const previous = process.env.MAX_MVPS_PER_GAME;
    process.env.MAX_MVPS_PER_GAME = '4';
    try {
      jest.isolateModules(() => {
        const freshConfig = require('../src/config/config').default;
        expect(freshConfig.maxMvpsPerGame).toBe(4);
      });
    } finally {
      if (previous === undefined) delete process.env.MAX_MVPS_PER_GAME;
      else process.env.MAX_MVPS_PER_GAME = previous;
    }
  });
});
