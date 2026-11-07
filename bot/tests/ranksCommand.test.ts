const mockGetEloRanks = jest.fn();

jest.mock('../src/utils/fix', () => ({
  __esModule: true,
  getEloRanks: (...args: unknown[]) => mockGetEloRanks(...args),
}));

import { ranks } from '../src/commands/general/ranks';

function interaction() {
  return {
    author: { id: '123456789012345678' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild-1' },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function embedJson(target: any) {
  return target.reply.mock.calls[0][0].embeds[0].toJSON();
}

describe('ranks command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEloRanks.mockResolvedValue([
      { roleId: '111111111111111111', startElo: 0, endElo: 999, winElo: 10, loseElo: 5, mvpElo: 2, bedElo: 1 },
      { roleId: '222222222222222222', startElo: 1000, endElo: 1999, winElo: 15, loseElo: 8, mvpElo: 3, bedElo: 2 },
    ]);
  });

  it('shows only rank ranges and scoring values', async () => {
    const target = interaction();

    await ranks(target);

    const embed = embedJson(target);
    expect(embed.title).toBe('Info: Rank List');
    expect(embed.description).toContain('<@&111111111111111111>');
    expect(embed.description).toContain('Win: `10`');
    expect(embed.description).toContain('<@&222222222222222222>');
    expect(embed.description).not.toContain('Decay');
    expect(embed.description).not.toContain('Win Streak Bonuses');
    expect(embed.description).not.toContain('Bounties');
  });
});
