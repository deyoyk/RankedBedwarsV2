jest.mock('../src/models/User', () => ({ __esModule: true, default: { findOneAndUpdate: jest.fn(), updateOne: jest.fn() } }));
jest.mock('../src/managers/BanManager', () => ({ BanManager: { ban: jest.fn() } }));
jest.mock('../src/managers/punishmentHelpers', () => ({
  createPendingOperation: () => ({ id: 'op' }),
  sendPunishmentNotification: jest.fn(),
}));
jest.mock('../src/services/AuditService', () => ({ recordAudit: jest.fn() }));
jest.mock('../src/services/StrikeRuleService', () => ({ StrikeRuleService: { actionFor: jest.fn() } }));

import { StrikeManager } from '../src/managers/StrikeManager';

const User = require('../src/models/User').default;
const { BanManager } = require('../src/managers/BanManager');
const { StrikeRuleService } = require('../src/services/StrikeRuleService');

const holding = (count: number) => ({ ign: 'Steve', strikes: Array.from({ length: count }, (_, i) => ({ id: String(i) })) });

beforeEach(() => {
  jest.clearAllMocks();
  StrikeRuleService.actionFor.mockImplementation((n: number) => (n >= 5 ? '1d' : 'warn'));
  BanManager.ban.mockResolvedValue(undefined);
});

describe('several strikes at once', () => {
  test('adds every strike in one update and bans for the new total', async () => {
    User.findOneAndUpdate.mockResolvedValue(holding(5));
    const result = await StrikeManager.strike({ id: 'g' } as any, '10', 'mod', 'Throwing', 4);
    const pushed = User.findOneAndUpdate.mock.calls[0][1].$push.strikes.$each;
    expect(pushed).toHaveLength(4);
    expect(new Set(pushed.map((s: { id: string }) => s.id)).size).toBe(4);
    expect(pushed.every((s: { reason: string }) => s.reason === 'Throwing')).toBe(true);
    expect(StrikeRuleService.actionFor).toHaveBeenCalledWith(5);
    expect(BanManager.ban).toHaveBeenCalledWith({ id: 'g' }, '10', 'mod', '1d', 'Strike 5: Throwing');
    expect(result).toEqual({ strikeCount: 5, actionTaken: 'Banned for 1d (Strike 5)' });
  });

  test('one strike is still the default', async () => {
    User.findOneAndUpdate.mockResolvedValue(holding(1));
    await StrikeManager.strike({ id: 'g' } as any, '10', 'mod', 'AFK');
    expect(User.findOneAndUpdate.mock.calls[0][1].$push.strikes.$each).toHaveLength(1);
    expect(BanManager.ban).not.toHaveBeenCalled();
  });
});
