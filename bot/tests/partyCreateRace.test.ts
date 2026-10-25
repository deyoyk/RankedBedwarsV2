import { PartyService } from '../src/services/PartyService';

jest.mock('../src/models/Party', () => {
  const instances: Array<{ save: jest.Mock }> = [];
  const Ctor: any = jest.fn().mockImplementation(function (this: any, doc: any) {
    Object.assign(this, doc);
    const save = jest.fn().mockResolvedValue(this);
    instances.push({ save } as never);
    this.save = save;
  });
  Ctor.findOne = jest.fn();
  Ctor.updateOne = jest.fn();
  Ctor.deleteOne = jest.fn();
  Ctor.__instances = instances;
  return { __esModule: true, default: Ctor };
});
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() }
}));

const PartyModel = require('../src/models/Party').default;
const UserModel = require('../src/models/User').default;

describe('PartyService concurrent create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PartyModel.__instances.length = 0;
  });

  it('claims the user atomically after saving the party', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'u1', partyId: null });
    UserModel.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const result = await PartyService.createParty('u1');

    expect(result.success).toBe(true);
    expect(result.party?.leader).toBe('u1');
    expect(PartyModel.deleteOne).not.toHaveBeenCalled();
    expect(UserModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ discordId: 'u1' }),
      { $set: { partyId: expect.any(String) } }
    );
  });

  it('deletes the orphan party when the atomic claim loses a duplicate race', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'u1', partyId: null });
    UserModel.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    PartyModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const result = await PartyService.createParty('u1');

    expect(result).toEqual({ success: false, error: 'Already in a party' });
    expect(PartyModel.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('rejects without writing when the user is already in a party', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'u1', partyId: 'P' });

    const result = await PartyService.createParty('u1');

    expect(result).toEqual({ success: false, error: 'Already in a party' });
    expect(PartyModel).not.toHaveBeenCalled();
    expect(UserModel.updateOne).not.toHaveBeenCalled();
  });
});
