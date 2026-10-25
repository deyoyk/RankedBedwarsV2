import { PartyService } from '../src/services/PartyService';

jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() }
}));

const PartyModel = require('../src/models/Party').default;
const UserModel = require('../src/models/User').default;

function makeUser() {
  return { discordId: 'u9', partyId: null };
}

function makeParty(members: string[] = ['a']) {
  return { partyId: 'P', members: [...members], maxMembers: 2 };
}

describe('PartyService atomic join', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(PartyService as any, 'updatePartyRoles').mockResolvedValue(undefined);
    jest.spyOn(PartyService as any, 'updatePartyActivity').mockResolvedValue(undefined);
    PartyModel.updateOne.mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports full when a concurrent join filled the last slot', async () => {
    const user = makeUser();
    UserModel.findOne.mockResolvedValue(user);
    PartyModel.findOneAndUpdate.mockResolvedValue(null);
    PartyModel.findOne.mockResolvedValue({ partyId: 'P', members: ['a', 'x'] });

    const result = await (PartyService as any).addMemberToParty(makeParty(['a']), 'u9', {});

    expect(result).toEqual({ success: false, message: 'Party is full' });
    expect(UserModel.updateOne).not.toHaveBeenCalled();
    expect(PartyModel.updateOne).not.toHaveBeenCalled();
  });

  it('reports already joined when the atomic update loses a duplicate race', async () => {
    const user = makeUser();
    UserModel.findOne.mockResolvedValue(user);
    PartyModel.findOneAndUpdate.mockResolvedValue(null);
    PartyModel.findOne.mockResolvedValue({ partyId: 'P', members: ['a', 'u9'] });

    const result = await (PartyService as any).addMemberToParty(makeParty(['a']), 'u9', {});

    expect(result).toEqual({ success: false, message: 'Already in this party' });
    expect(UserModel.updateOne).not.toHaveBeenCalled();
    expect(PartyModel.updateOne).not.toHaveBeenCalled();
  });

  it('joins through the atomic update and claims the user conditionally', async () => {
    const user = makeUser();
    UserModel.findOne.mockResolvedValue(user);
    PartyModel.findOneAndUpdate.mockResolvedValue({ partyId: 'P', members: ['a', 'u9'] });
    UserModel.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });

    const party = makeParty(['a']);
    const result = await (PartyService as any).addMemberToParty(party, 'u9', {});

    expect(result).toEqual({ success: true });
    expect(party.members).toEqual(['a', 'u9']);
    expect(PartyModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        partyId: 'P',
        members: { $ne: 'u9' },
        $expr: { $lt: [{ $size: '$members' }, '$maxMembers'] }
      },
      { $push: { members: 'u9' } },
      { new: true }
    );
    expect(UserModel.updateOne).toHaveBeenCalledWith(
      {
        discordId: 'u9',
        $or: [{ partyId: { $exists: false } }, { partyId: null }, { partyId: '' }]
      },
      { $set: { partyId: 'P' } }
    );
    expect(PartyModel.updateOne).not.toHaveBeenCalled();
  });

  it('rolls back the pushed slot when the user claim loses a race', async () => {
    UserModel.findOne
      .mockResolvedValueOnce(makeUser())
      .mockResolvedValueOnce({ discordId: 'u9', partyId: 'OTHER' });
    PartyModel.findOneAndUpdate.mockResolvedValue({ partyId: 'P', members: ['a', 'u9'] });
    UserModel.updateOne.mockResolvedValue({ modifiedCount: 0, matchedCount: 0 });

    const result = await (PartyService as any).addMemberToParty(makeParty(['a']), 'u9', {});

    expect(result).toEqual({ success: false, message: 'Already in a party' });
    expect(PartyModel.updateOne).toHaveBeenCalledWith(
      { partyId: 'P' },
      { $pull: { members: 'u9' } }
    );
  });
});
