jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    winStreakBonus: { enabled: true, tiers: '5:5,10:10,20:15,25:20' },
    bounty: { enabled: true, tiers: '10:5,20:10,30:15' },
  },
}));

import config from '../src/config/config';
import { bonus } from '../src/commands/general/bonus';

const configMock = config as unknown as {
  winStreakBonus: { enabled: boolean; tiers: string };
  bounty: { enabled: boolean; tiers: string };
};

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

describe('bonus command', () => {
  beforeEach(() => {
    configMock.winStreakBonus = { enabled: true, tiers: '5:5,10:10,20:15,25:20' };
    configMock.bounty = { enabled: true, tiers: '10:5,20:10,30:15' };
  });

  it('shows every configured bonus and its tiers', async () => {
    const target = interaction();

    await bonus(target);

    const embed = embedJson(target);
    expect(embed.title).toBe('Scoring System');
    expect(embed.description).toContain('Current bonus configuration used by scoring system.');
    expect(embed.description).toContain('[P] Winstreak Bonus');
    expect(embed.description).toContain('[T] Bounty Bonus | Winstreak');
    expect(embed.description).toContain('Enabled · ✓');
    expect(embed.description).toContain('5+ winstreak → +5 ELO');
    expect(embed.description).toContain('10+ winstreak → +10 ELO');
    expect(embed.description).toContain('25+ winstreak → +20 ELO');
    expect(embed.description).toContain('30+ winstreak → +15 ELO');
    expect(embed.description).not.toContain('Decay');
  });

  it('marks disabled bonuses without listing their tiers', async () => {
    configMock.winStreakBonus.enabled = false;
    configMock.bounty.enabled = false;
    const target = interaction();

    await bonus(target);

    const embed = embedJson(target);
    expect(embed.description.match(/Disabled/g)).toHaveLength(2);
    expect(embed.description).not.toContain('winstreak →');
  });

  it('keeps each bonus independent when only one is disabled', async () => {
    configMock.bounty.enabled = false;
    const target = interaction();

    await bonus(target);

    const embed = embedJson(target);
    expect(embed.description).toContain('5+ winstreak → +5 ELO');
    expect(embed.description.match(/Disabled/g)).toHaveLength(1);
    expect(embed.description).not.toContain('30+ winstreak → +15 ELO');
  });
});
