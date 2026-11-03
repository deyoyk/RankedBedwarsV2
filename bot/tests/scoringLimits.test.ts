import config from '../src/config/config';
import {
  bedBreakerLimitMessage,
  getMaxBedBreakersPerGame,
  getMaxMvpsPerGame,
  limitBedBreakers,
  limitMvps,
  mvpLimitMessage,
  uniquePlayers,
} from '../src/utils/scoringLimits';

describe('scoring limits', () => {
  const originalMvpLimit = config.maxMvpsPerGame;
  const originalBedLimit = config.maxBedBreakersPerGame;

  afterEach(() => {
    config.maxMvpsPerGame = originalMvpLimit;
    config.maxBedBreakersPerGame = originalBedLimit;
  });

  it('trims and deduplicates names case-insensitively', () => {
    expect(uniquePlayers([' Alice ', 'bob', 'ALICE', '', 'Bob', 'Cara'])).toEqual([
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

  it('limits bed breakers to the configured maximum', () => {
    config.maxBedBreakersPerGame = 3;
    expect(getMaxBedBreakersPerGame()).toBe(3);
    expect(limitBedBreakers(['A', 'B', 'C', 'D', 'A'])).toEqual(['A', 'B', 'C']);
  });

  it('falls back to one when configuration is invalid', () => {
    config.maxMvpsPerGame = 0;
    config.maxBedBreakersPerGame = -5;
    expect(getMaxMvpsPerGame()).toBe(1);
    expect(getMaxBedBreakersPerGame()).toBe(1);
  });

  it('builds singular and plural limit messages', () => {
    expect(mvpLimitMessage(1)).toBe('A game can have at most 1 MVP.');
    expect(mvpLimitMessage(3)).toBe('A game can have at most 3 MVPs.');
    expect(bedBreakerLimitMessage(1)).toBe('A game can have at most 1 bed breaker.');
    expect(bedBreakerLimitMessage(3)).toBe('A game can have at most 3 bed breakers.');
  });

  it('reads limits from the environment', () => {
    const previousMvp = process.env.MAX_MVPS_PER_GAME;
    const previousBed = process.env.MAX_BED_BREAKERS_PER_GAME;
    process.env.MAX_MVPS_PER_GAME = '4';
    process.env.MAX_BED_BREAKERS_PER_GAME = '5';
    try {
      jest.isolateModules(() => {
        const freshConfig = require('../src/config/config').default;
        expect(freshConfig.maxMvpsPerGame).toBe(4);
        expect(freshConfig.maxBedBreakersPerGame).toBe(5);
      });
    } finally {
      if (previousMvp === undefined) delete process.env.MAX_MVPS_PER_GAME;
      else process.env.MAX_MVPS_PER_GAME = previousMvp;
      if (previousBed === undefined) delete process.env.MAX_BED_BREAKERS_PER_GAME;
      else process.env.MAX_BED_BREAKERS_PER_GAME = previousBed;
    }
  });
});
