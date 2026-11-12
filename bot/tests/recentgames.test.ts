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

    expect(games).toContain('[#9] Lectus1v1 - [Loss]');
    expect(games).toContain('[#8] Lectus1v1 - [Win]');
    expect(games).toContain('[#7] Lectus1v1 - [Voided]');
    expect(games).toContain('[#6] Lectus1v1 - [Ongoing]');
    expect(games).not.toContain('[#9] Lectus1v1 - [Win]');
    expect(embed.description).toContain('-# ➡ Recent Games - LoveDeyo');
  });

  it('shows signed elo changes, relative time, result and bed stats', async () => {
    UserModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          discordId: '1526597163885527121',
          ign: 'LoveDeyo',
          recentGames: [
            recentGame({
              gameId: 101,
              state: 'scored',
              won: true,
              eloGain: 15,
              map: 'Archway',
              kills: 11,
              bedBroken: 1,
              finalKills: 16,
              date: new Date('2026-01-01T06:00:00Z'),
            }),
            recentGame({
              gameId: 102,
              state: 'scored',
              won: true,
              eloGain: 0,
              map: 'Urban',
              kills: 3,
              bedBroken: 0,
              finalKills: 9,
              date: new Date('2026-01-01T06:00:00Z'),
            }),
            recentGame({
              gameId: 103,
              state: 'scored',
              won: false,
              eloGain: -30,
              map: 'Antenna',
              kills: 4,
              bedBroken: 0,
              finalKills: 6,
              date: new Date('2026-01-01T06:00:00Z'),
            }),
          ],
        }),
      }),
    });

    const msg = interaction();
    await recentgames(msg);

    const games = msg.reply.mock.calls[0][0].embeds[0].toJSON().fields[0].value;
    expect(games).toContain('[+15] - <t:');
    expect(games).toContain('[#101] Archway - [Win] - 11/1/16 - 1 bed');
    expect(games).toContain('[—]');
    expect(games).toContain('[#102] Urban - [Win] - 3/0/9');
    expect(games).toContain('[-30]');
    expect(games).toContain('[#103] Antenna - [Loss] - 4/0/6');
  });
});
