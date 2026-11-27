jest.mock('../src/models/SeasonRules', () => ({
  __esModule: true,
  default: {
    updateOne: jest.fn(),
    findOne: jest.fn(),
  },
}));

import SeasonRules from '../src/models/SeasonRules';
import { SeasonRulesService } from '../src/services/SeasonRulesService';

const model = SeasonRules as unknown as {
  updateOne: jest.Mock;
  findOne: jest.Mock;
};

describe('SeasonRulesService', () => {
  it('saves both rule sets under one document', async () => {
    model.updateOne.mockResolvedValue({});

    const saved = await SeasonRulesService.save(['&a&lAlways Allowed', 5], ['&c&lNever Allowed']);

    expect(saved).toEqual({ season: ['&a&lAlways Allowed'], ppp: ['&c&lNever Allowed'] });
    expect(model.updateOne).toHaveBeenCalledWith(
      { key: 'global' },
      { $set: { season: ['&a&lAlways Allowed'], ppp: ['&c&lNever Allowed'], updatedAt: expect.any(Date) } },
      { upsert: true }
    );
  });

  it('reads the stored rule sets', async () => {
    model.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ season: ['Ladders'], ppp: ['Pearls'] }),
    });

    await expect(SeasonRulesService.get()).resolves.toEqual({ season: ['Ladders'], ppp: ['Pearls'] });
  });

  it('returns null before the server has sent anything', async () => {
    model.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await expect(SeasonRulesService.get()).resolves.toBeNull();
  });
});
