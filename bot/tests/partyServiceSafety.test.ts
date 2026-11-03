jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn(),
  },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() },
}));

import { PartyService } from '../src/services/PartyService';

const PartyModel = require('../src/models/Party').default;
const UserModel = require('../src/models/User').default;

function party(overrides: Record<string, unknown> = {}) {
  return {
    partyId: 'P',
    leader: 'leader',
    members: ['leader', 'a', 'b'],
    maxMembers: 8,
    isPrivate: false,
    description: '',
    ...overrides,
  };
}

describe('PartyService safety checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(PartyService as any, 'updatePartyActivity').mockResolvedValue(undefined);
    jest.spyOn(PartyService as any, 'removePartyRoles').mockResolvedValue(undefined);
    jest.spyOn(PartyService as any, 'updatePartyRoles').mockResolvedValue(undefined);
    UserModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    UserModel.updateMany.mockResolvedValue({ matchedCount: 3, modifiedCount: 3 });
    PartyModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  afterEach(() => jest.restoreAllMocks());

  it('clears a stale partyId when the user is no longer in the party roster', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'u', partyId: 'P' });
    PartyModel.findOne.mockResolvedValue(party({ members: ['leader', 'a'] }));

    const result = await PartyService.validatePartyAccess('u');

    expect(result).toEqual({ isValid: false, error: 'Not in a party' });
    expect(UserModel.updateOne).toHaveBeenCalledWith(
      { discordId: 'u' },
      { $unset: { partyId: '' } },
    );
  });

  it('rejects invalid private settings instead of silently treating them as false', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'leader', partyId: 'P' });
    PartyModel.findOne.mockResolvedValue(party());

    const result = await PartyService.updatePartySettings('leader', 'private', 'maybe');

    expect(result).toEqual({ success: false, message: 'Private must be true or false' });
    expect(PartyModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects maxMembers below the current member count', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'leader', partyId: 'P' });
    PartyModel.findOne.mockResolvedValue(party());

    const result = await PartyService.updatePartySettings('leader', 'maxmembers', '2');

    expect(result).toEqual({ success: false, message: 'Max members must be between 3 and 8' });
    expect(PartyModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects malformed maxMembers values', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'leader', partyId: 'P' });
    PartyModel.findOne.mockResolvedValue(party());

    await expect(PartyService.updatePartySettings('leader', 'maxmembers', '2abc'))
      .resolves.toEqual({ success: false, message: 'Max members must be a whole number' });
  });

  it('accepts valid settings and trims descriptions', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'leader', partyId: 'P' });
    const doc = party();
    PartyModel.findOne.mockResolvedValue(doc);

    const result = await PartyService.updatePartySettings('leader', 'description', '  friendly  ');

    expect(result.success).toBe(true);
    expect(PartyModel.updateOne).toHaveBeenCalledWith(
      { partyId: 'P', leader: 'leader' },
      { $set: { description: 'friendly' } },
    );
    expect(doc.description).toBe('friendly');
  });

  it('accepts strict private true/false values', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'leader', partyId: 'P' });
    PartyModel.findOne.mockResolvedValue(party());

    const result = await PartyService.updatePartySettings('leader', 'private', 'true');

    expect(result.success).toBe(true);
    expect(PartyModel.updateOne).toHaveBeenCalledWith(
      { partyId: 'P', leader: 'leader' },
      { $set: { isPrivate: true } },
    );
  });

  it('blocks direct joins to private parties', async () => {
    PartyModel.findOne.mockResolvedValue(party({ isPrivate: true }));

    const result = await PartyService.joinParty('u', 'P', {} as any);

    expect(result).toEqual({ success: false, message: 'Party is private' });
  });

  it('refuses to disband when the party changed before deletion', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'leader', partyId: 'P' });
    PartyModel.findOne.mockResolvedValue(party());
    PartyModel.deleteOne.mockResolvedValue({ deletedCount: 0 });

    const result = await PartyService.disbandParty('leader', {} as any);

    expect(result).toEqual({ success: false, message: 'Party changed, try again' });
    expect(UserModel.updateMany).not.toHaveBeenCalled();
  });

  it('only lists public parties that still have open slots', async () => {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    };
    PartyModel.find.mockReturnValue(chain);

    const result = await PartyService.listPublicParties();

    expect(result.success).toBe(true);
    expect(PartyModel.find).toHaveBeenCalledWith({
      isPrivate: false,
      $expr: { $lt: [{ $size: { $ifNull: ['$members', []] } }, '$maxMembers'] },
    });
  });
});
