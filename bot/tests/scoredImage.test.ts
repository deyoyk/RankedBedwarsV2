const mockGenerate = jest.fn();
jest.mock('../src/utils/scoredImage', () => {
  const actual = jest.requireActual('../src/utils/scoredImage');
  return { ...actual, generateScoredImage: (...args: unknown[]) => mockGenerate(...args) };
});
const mockUsers = jest.fn();
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: () => ({ select: () => ({ lean: () => mockUsers() }) }) },
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: () => ({ select: () => ({ lean: async () => [{ roleId: 'gold', startElo: 1000, endElo: 1999 }] }) }) },
}));

import { renderScoredGame } from '../src/utils/scoredGameImage';
import { buildGameResultImage } from '../src/utils/gameResultImage';

const pngSize = (buf: Buffer) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
const player = (id: string, before: number, after: number, extra: Record<string, unknown> = {}) => ({
  discordId: id, ign: id, eloBefore: before, eloAfter: after, kills: 6, deaths: 3, diamonds: 4, mvp: false, bedBreaker: false, ...extra,
});

describe('scored-game image', () => {
  beforeEach(() => mockGenerate.mockReset().mockResolvedValue(Buffer.from('png')));

  it('draws the real template as a PNG without network access', async () => {
    const { generateScoredImage } = jest.requireActual('../src/utils/scoredImage');
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as any;
    try {
      const buf = await generateScoredImage(58,
        [{ username: 'wuwster', team: 'winning', oldElo: 1000, newElo: 1025, mvp: true, kills: 5, deaths: 2, diamonds: 4 }],
        [{ username: 'ssharpp', team: 'losing', oldElo: 1010, newElo: 995, kills: 2, deaths: 5, diamonds: 1 }],
        { map: 'Invasion', duration: '12:34', date: '12/11/2026', winnerTeamElo: '+25', loserTeamElo: '-15' });
      expect(buf.subarray(1, 4).toString()).toBe('PNG');
      expect(pngSize(buf)).toEqual({ width: 1024, height: 585 });
    } finally {
      global.fetch = realFetch;
    }
  }, 20000);

  it('passes each player\'s rank role, KDR and the team totals to the card', async () => {
    const guild: any = { roles: { cache: new Map([['gold', { name: 'Gold', color: 0xffd700, hexColor: '#ffd700', iconURL: () => 'https://cdn/gold.png' }]]) } };
    await renderScoredGame({
      gameId: 9, map: 'lighthouse4v4', startTime: new Date(0), endTime: new Date(754000),
      winners: [player('a', 1000, 1025, { mvp: true }), player('b', 900, 921)],
      losers: [player('c', 1010, 995, { deaths: 0 })],
    }, [{ roleId: 'gold', startElo: 1000, endElo: 1999 }], guild);

    const [gameId, winners, losers, meta] = mockGenerate.mock.calls[0];
    expect(gameId).toBe(9);
    expect(winners[0]).toMatchObject({ username: 'a', rankName: 'Gold', rankColor: '#ffd700', rankIconUrl: 'https://cdn/gold.png', kdr: '2.00', mvp: true });
    expect(winners[1].rankName).toBeUndefined();
    expect(losers[0].kdr).toBe('6');
    expect(meta).toMatchObject({ map: 'Lighthouse', duration: '12:34', winnerTeamElo: '+46', loserTeamElo: '-15' });
  });
});

describe('/gameinfo result image', () => {
  beforeEach(() => mockGenerate.mockReset().mockResolvedValue(Buffer.from('png')));

  it('has no image for a game that was never scored', async () => {
    await expect(buildGameResultImage({ gameId: 1, state: 'voided', winners: [] })).resolves.toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rebuilds the card from each player\'s saved game entry', async () => {
    mockUsers.mockResolvedValue([
      { discordId: 'a', ign: 'Alpha', elo: 1100, recentGames: [{ eloGain: 25, elo_before: 1000, elo_after: 1025, kills: 7, deaths: 1, diamonds: 9 }] },
      { discordId: 'c', ign: 'Charlie', elo: 990, recentGames: [{ eloGain: -15 }] },
    ]);
    const buf = await buildGameResultImage({ gameId: 3, state: 'scored', winners: ['a'], losers: ['c'], mvps: ['a'] });

    expect(buf).toEqual(Buffer.from('png'));
    const [, winners, losers] = mockGenerate.mock.calls[0];
    expect(winners[0]).toMatchObject({ username: 'Alpha', oldElo: 1000, newElo: 1025, kills: 7, diamonds: 9, mvp: true });
    // No saved before/after: work back from the current ELO
    expect(losers[0]).toMatchObject({ username: 'Charlie', oldElo: 1005, newElo: 990 });
  });
});
