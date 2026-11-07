jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

import { recentgames } from '../src/commands/stats/recentgames';
import { resolveRecentGameResult } from '../src/utils/recentGameResult';

const UserModel = require('../src/models/User').default;

function recentGame(overrides: Record<string, unknown>) {
  return {
    gameId: 1,
    map: 'Lectus1v1',
    eloGain: 0,
    kills: 0,
    deaths: 0,
    bedBroken: 0,
    finalKills: 0,
    date: new Date('2026-01-01T00:00:00Z'),
    startTime: new Date('2026-01-01T00:00:00Z'),
    state: 'scored',
    won: false,
    ...overrides,
  };
}

function interaction() {
  return {
    user: { id: '1526597163885527121' },
    options: {
      getInteger: jest.fn(() => 1),
      getString: jest.fn(() => null),
    },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

describe('resolveRecentGameResult', () => {
  it('uses the won flag instead of treating every scored game as a win', () => {
    expect(resolveRecentGameResult({ state: 'scored', won: true })).toBe('win');
    expect(resolveRecentGameResult({ state: 'scored', won: false })).toBe('lose');
  });

  it('classifies voided, pending, legacy and unknown states', () => {
    expect(resolveRecentGameResult({ state: 'voided', won: false })).toBe('voided');
    expect(resolveRecentGameResult({ state: 'pending', won: false })).toBe('pending');
    expect(resolveRecentGameResult({ state: 'active', won: false })).toBe('pending');
    expect(resolveRecentGameResult({ state: 'win', won: true })).toBe('win');
    expect(resolveRecentGameResult({ state: 'lose', won: false })).toBe('lose');
    expect(resolveRecentGameResult({ state: 'loss', won: false })).toBe('lose');
    expect(resolveRecentGameResult({ state: 'something-else', won: false })).toBe('unknown');
  });
});

describe('recentgames command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows Lost for a scored game the player lost and Won for a scored game the player won', async () => {
    UserModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          discordId: '1526597163885527121',
          ign: 'LoveDeyo',
          recentGames: [
            recentGame({ gameId: 9, state: 'scored', won: false }),
            recentGame({ gameId: 8, state: 'scored', won: true }),
            recentGame({ gameId: 7, state: 'voided', won: false }),
            recentGame({ gameId: 6, state: 'pending', won: false }),
          ],
        }),
      }),
    });

    const msg = interaction();
    await recentgames(msg);

    const embed = msg.reply.mock.calls[0][0].embeds[0].toJSON();
    const games = embed.fields[0].value;

    expect(games).toContain('**Game #9:** Lost');
    expect(games).toContain('**Game #8:** Won');
    expect(games).toContain('**Game #7:** Voided');
    expect(games).toContain('**Game #6:** Ongoing');
    expect(games).not.toContain('**Game #9:** Won');
  });
});
