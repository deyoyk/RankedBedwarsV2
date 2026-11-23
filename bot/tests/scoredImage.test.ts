const mockGenerate = jest.fn();
jest.mock('../src/utils/scoreImage', () => {
  const actual = jest.requireActual('../src/utils/scoreImage');
  return { ...actual, generateScoreImageBuffer: (...args: unknown[]) => mockGenerate(...args) };
});
const mockUsers = jest.fn();
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: () => ({ select: () => ({ lean: () => mockUsers() }) }) },
}));
const mockQueue = jest.fn();
jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { findOne: () => ({ select: () => ({ lean: () => mockQueue() }) }) },
}));
jest.mock('node-fetch', () => jest.fn().mockRejectedValue(new Error('offline')));

import { renderScoredGame } from '../src/utils/scoredGameImage';
import { buildGameResultImage } from '../src/utils/gameResultImage';
import { scoreTemplate, ScoreTemplatePlayer } from '../src/assets/games/score';

const pngSize = (buf: Buffer) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
const player = (id: string, before: number, after: number, extra: Record<string, unknown> = {}) => ({
  discordId: id, ign: id, eloBefore: before, eloAfter: after, kills: 6, deaths: 3, diamonds: 4, emeralds: 1, mvp: false, bedBreaker: false, ...extra,
});

function texts(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (!node || typeof node !== 'object') return [];
  const kids = (node as { props?: { children?: unknown } }).props?.children;
  return (Array.isArray(kids) ? kids : [kids]).flatMap(texts);
}

function templatePlayer(username: string, before: number, after: number, extra: Partial<ScoreTemplatePlayer> = {}): ScoreTemplatePlayer {
  return {
    username,
    avatar: 'data:image/png;base64,',
    kills: 4,
    deaths: 2,
    kdr: '2.00',
    diamonds: 1,
    emeralds: 0,
    eloBefore: before,
    eloAfter: after,
    mvp: false,
    bedbreaker: false,
    ...extra,
  };
}

describe('scored-game image', () => {
  beforeEach(() => {
    mockGenerate.mockReset().mockResolvedValue(Buffer.from('png'));
    mockQueue.mockReset().mockResolvedValue(null);
  });

  it('renders the HTML card as a 1920x980 PNG without network access', async () => {
    const { generateScoreImageBuffer } = jest.requireActual('../src/utils/scoreImage');
    const buf = await generateScoreImageBuffer(58,
      [{ username: 'wuwster', team: 'winning', elo_before: 1000, elo_after: 1025, mvp: true, kills: 5, deaths: 2, diamonds: 4 }],
      [{ username: 'ssharpp', team: 'losing', elo_before: 1010, elo_after: 995, kills: 2, deaths: 5, diamonds: 1 }],
      { isRanked: true, minElo: 1000, maxElo: 1999, map: 'Boletum', date: '22 Nov 2026', scoredAt: '16:02 UTC', duration: '5m 11s' });
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(pngSize(buf)).toEqual({ width: 1920, height: 980 });
  }, 20000);

  it('builds the scoreboard with sections, stats, badges and metadata', () => {
    const tpl = scoreTemplate({
      gameId: 42,
      winners: [
        templatePlayer('Alice', 1200, 1230, { mvp: true }),
        templatePlayer('Bob', 1100, 1130, { bedbreaker: true }),
      ],
      losers: [templatePlayer('Cara', 1300, 1280)],
      map: 'Boletum',
      date: '22 Nov 2026',
      scoredAt: '16:02 UTC',
      duration: '5m 11s',
      mode: 'RANKED',
      serverName: 'Test Server',
      inviteLink: 'play.test.lol',
    });

    expect(tpl.width).toBe(1920);
    expect(tpl.height).toBe(980);
    const all = texts(tpl.root);
    for (const expected of [
      'WINNERS', 'LOSERS', 'KILLS', 'DEATHS', 'K/D', 'DIA', 'EMS', 'ELO CHANGE',
      'Alice', 'Bob', 'Cara', 'MVP', 'BED', '1200 -> 1230', '30', 'Boletum', 'GAME ID',
      'DATE', 'SCORED AT', 'DURATION', 'MODE', 'RANKED', 'Test Server', 'play.test.lol',
    ]) {
      expect(all).toContain(expected);
    }
  });

  it('passes player stats and metadata to the renderer', async () => {
    await renderScoredGame({
      gameId: 9,
      map: 'Boletum',
      startTime: new Date('2026-11-22T15:56:49.000Z'),
      endTime: new Date('2026-11-22T16:02:00.000Z'),
      isRanked: true,
      minElo: 1000,
      maxElo: 1999,
      winners: [player('a', 1000, 1025, { mvp: true }), player('b', 900, 921)],
      losers: [player('c', 1010, 995)],
    });

    const [gameId, winners, losers, options] = mockGenerate.mock.calls[0];
    expect(gameId).toBe(9);
    expect(winners[0]).toMatchObject({
      username: 'a', elo_before: 1000, elo_after: 1025, oldElo: 1000, newElo: 1025,
      mvp: true, kills: 6, deaths: 3, diamonds: 4, emeralds: 1,
    });
    expect(winners[1]).toMatchObject({ username: 'b', elo_before: 900, elo_after: 921 });
    expect(losers[0]).toMatchObject({ username: 'c', elo_before: 1010, elo_after: 995 });
    expect(options).toEqual({
      map: 'Boletum',
      date: '22 Nov 2026',
      scoredAt: '16:02 UTC',
      duration: '5m 11s',
      mode: 'RANKED',
      isRanked: true,
      minElo: 1000,
      maxElo: 1999,
    });
  });
});

describe('/gameinfo result image', () => {
  beforeEach(() => {
    mockGenerate.mockReset().mockResolvedValue(Buffer.from('png'));
    mockQueue.mockReset().mockResolvedValue(null);
  });

  it('has no image for a game that was never scored', async () => {
    await expect(buildGameResultImage({ gameId: 1, state: 'voided', winners: [] })).resolves.toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('rebuilds the scoreboard from each player\'s saved game entry', async () => {
    mockUsers.mockResolvedValue([
      { discordId: 'a', ign: 'Alpha', elo: 1100, recentGames: [{ eloGain: 25, elo_before: 1000, elo_after: 1025, kills: 7, deaths: 1, diamonds: 9, emeralds: 3 }] },
      { discordId: 'c', ign: 'Charlie', elo: 990, recentGames: [{ eloGain: -15 }] },
    ]);
    mockQueue.mockResolvedValue({ isRanked: true, minElo: 1000, maxElo: 1999 });
    const buf = await buildGameResultImage({
      gameId: 3, state: 'scored', queueId: 'q1', map: 'Boletum',
      startTime: new Date('2026-11-22T15:56:49.000Z'), endTime: new Date('2026-11-22T16:02:00.000Z'),
      winners: ['a'], losers: ['c'], mvps: ['a'], bedbreaks: ['c'],
    });

    expect(buf).toEqual(Buffer.from('png'));
    const [gameId, winners, losers, options] = mockGenerate.mock.calls[0];
    expect(gameId).toBe(3);
    expect(winners[0]).toMatchObject({
      username: 'Alpha', elo_before: 1000, elo_after: 1025, mvp: true, bedbreaker: false,
      kills: 7, deaths: 1, diamonds: 9, emeralds: 3, 
    });
    expect(losers[0]).toMatchObject({ username: 'Charlie', elo_before: 1005, elo_after: 990, mvp: false, bedbreaker: true });
    expect(options).toMatchObject({ map: 'Boletum', mode: 'RANKED', isRanked: true, minElo: 1000, maxElo: 1999 });
  });
});


