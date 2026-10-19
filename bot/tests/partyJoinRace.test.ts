import { PartyService } from '../src/services/PartyService';

jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));

const PartyModel = require('../src/models/Party').default;
const UserModel = require('../src/models/User').default;

const mockSave = jest.fn().mockResolvedValue(undefined);

function makeUser() {
  return { discordId: 'u9', partyId: null, save: mockSave };
}

function makeParty(members: string[] = ['a']) {
  return { partyId: 'P', members: [...members], maxMembers: 2, save: mockSave };
}

describe('PartyService atomic join', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(PartyService as any, 'updatePartyRoles').mockResolvedValue(undefined);
    jest.spyOn(PartyService as any, 'updatePartyActivity').mockResolvedValue(undefined);
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
    expect(user.save).not.toHaveBeenCalled();
  });

  it('reports already joined when the atomic update loses a duplicate race', async () => {
    const user = makeUser();
    UserModel.findOne.mockResolvedValue(user);
    PartyModel.findOneAndUpdate.mockResolvedValue(null);
    PartyModel.findOne.mockResolvedValue({ partyId: 'P', members: ['a', 'u9'] });

    const result = await (PartyService as any).addMemberToParty(makeParty(['a']), 'u9', {});

    expect(result).toEqual({ success: false, message: 'Already in this party' });
    expect(user.save).not.toHaveBeenCalled();
  });

  it('joins through the atomic update and refreshes membership', async () => {
    const user = makeUser();
    UserModel.findOne.mockResolvedValue(user);
    PartyModel.findOneAndUpdate.mockResolvedValue({ partyId: 'P', members: ['a', 'u9'] });

    const party = makeParty(['a']);
    const result = await (PartyService as any).addMemberToParty(party, 'u9', {});

    expect(result).toEqual({ success: true });
    expect(party.members).toEqual(['a', 'u9']);
    expect(user.partyId).toBe('P');
    expect(user.save).toHaveBeenCalled();
    expect(PartyModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        partyId: 'P',
        members: { $ne: 'u9' },
        $expr: { $lt: [{ $size: '$members' }, '$maxMembers'] }
      },
      { $push: { members: 'u9' } },
      { new: true }
    );
  });
});
