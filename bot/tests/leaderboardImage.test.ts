jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockRejectedValue(new Error('offline')) } }));
const mockUsers = jest.fn();
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ select: () => ({ lean: () => mockUsers() }) }) }) }) }),
    countDocuments: jest.fn().mockResolvedValue(23),
    findOne: jest.fn(),
  },
}));
const mockDraw = jest.fn();
jest.mock('../src/utils/leaderboardImage', () => {
  const actual = jest.requireActual('../src/utils/leaderboardImage');
  return { ...actual, generateLeaderboardImage: (...args: unknown[]) => mockDraw(...args) };
});

import { leaderboard } from '../src/commands/stats/leaderboard';

const pngSize = (buf: Buffer) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

function slash(mode: string | null = null) {
  return {
    user: { id: 'me' },
    channel: null,
    options: { getString: () => mode, getInteger: () => null },
    reply: jest.fn().mockResolvedValue({ createMessageComponentCollector: () => ({ on: jest.fn() }) }),
    deferred: false,
    replied: false,
  } as any;
}

beforeEach(() => {
  mockDraw.mockReset().mockResolvedValue(Buffer.from('png'));
  mockUsers.mockReset();
});

describe('leaderboard image', () => {
  it('draws the first page from the real template without network access', async () => {
    const { generateLeaderboardImage } = jest.requireActual('../src/utils/leaderboardImage');
    const entries = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, ign: `p${i}`, value: 1000 - i, elo: 1000 - i }));
    const buf = await generateLeaderboardImage('Elo Leaderboard', 'ELO', entries, 0, 3);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(pngSize(buf)).toEqual({ width: 366, height: 512 });
  }, 20000);

  it('sends the page as an image with paging buttons', async () => {
    mockUsers.mockResolvedValue([
      { ign: 'Alpha', discordId: 'a', elo: 1500, kdr: 2.5 },
      { ign: 'Bravo', discordId: 'b', elo: 1400, kdr: 1 },
    ]);
    const interaction = slash('kdr');
    await leaderboard(interaction);

    const [title, label, entries, page, totalPages] = mockDraw.mock.calls[0];
    expect(title).toBe('KDR Leaderboard');
    expect(label).toBe('KDR');
    expect(entries).toEqual([
      { rank: 1, ign: 'Alpha', value: '2.50', elo: 1500 },
      { rank: 2, ign: 'Bravo', value: 1, elo: 1400 },
    ]);
    expect([page, totalPages]).toEqual([0, 3]);

    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    const buttons = payload.components[0].toJSON().components;
    expect(buttons.map((b: any) => b.custom_id)).toEqual(['prev_page', 'next_page', 'search_ign', 'search_pos', 'reload']);
    expect(buttons[0].disabled).toBe(true);
  });

  it('uses short labels for long stat names', async () => {
    mockUsers.mockResolvedValue([{ ign: 'Alpha', discordId: 'a', elo: 1500, bedBroken: 12 }]);
    await leaderboard(slash('bedBroken'));
    expect(mockDraw.mock.calls[0][1]).toBe('BEDS');
  });

  it('says so instead of drawing when nobody is on the leaderboard', async () => {
    mockUsers.mockResolvedValue([]);
    const interaction = slash();
    await leaderboard(interaction);
    expect(mockDraw).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.reply.mock.calls)).toContain('No users found');
  });
});
