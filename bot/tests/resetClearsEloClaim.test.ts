const mockFindOneAndUpdate = jest.fn();
const mockSafeFix = jest.fn().mockResolvedValue(undefined);
const mockRecordAudit = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args) },
}));

jest.mock('../src/utils/fix', () => ({
  __esModule: true,
  safeFix: (...args: unknown[]) => mockSafeFix(...args),
}));

jest.mock('../src/services/AuditService', () => ({
  __esModule: true,
  auditInteractionContext: () => ({}),
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

import { wipe } from '../src/commands/account/wipe';
import { resetUserStats } from '../src/utils/userStats';
import { getEloClaimEligibility } from '../src/utils/eloClaim';

const UID = '123456789012345678';
const SEASON = { seasonNumber: 3, chapterNumber: 1 };

describe('a stats reset lets the player claim ELO again', () => {
  beforeEach(() => jest.clearAllMocks());

  it('clears this season\'s claim along with the games', () => {
    const user: Record<string, unknown> = {
      games: 12,
      elo: 900,
      eloClaims: [{ date: new Date(), seasonNumber: 3, chapterNumber: 1, amount: 500 }],
    };
    expect(getEloClaimEligibility(user.games as number, user.eloClaims as never, SEASON)).toBe('played');
    resetUserStats(user);
    expect(user.eloClaims).toEqual([]);
    expect(getEloClaimEligibility(user.games as number, user.eloClaims as never, SEASON)).toBe('eligible');
  });

  it('/wipe clears the claim in the database', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ discordId: UID });
    const interaction = {
      options: { getUser: jest.fn().mockReturnValue({ id: UID }) },
      user: { id: '999999999999999999' },
      guild: { id: 'guild-1' },
      reply: jest.fn().mockResolvedValue({}),
      deferred: false,
      replied: false,
    } as any;
    await wipe(interaction);
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set.eloClaims).toEqual([]);
    expect(update.$set.games).toBe(0);
    expect(update.$set.elo).toBe(0);
  });
});
