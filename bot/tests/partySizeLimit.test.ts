import { PartyService } from '../src/services/PartyService';
import config from '../src/config/config';

jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() }
}));
jest.mock('../src/models/PartySize', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() }
}));

import { PartySizeService } from '../src/services/PartySizeService';
const PartySizeModel = require('../src/models/PartySize').default;

function useSize(size: number | null) {
  (PartySizeService as any).size = size;
}

const PartyModel = require('../src/models/Party').default;
const UserModel = require('../src/models/User').default;

describe('party size limits', () => {
  const saved = { party: config.partyMaxMembers, priv: config.privatePartyMaxMembers };

  beforeEach(() => {
    jest.clearAllMocks();
    config.partyMaxMembers = 2;
    config.privatePartyMaxMembers = 16;
    useSize(null);
    jest.spyOn(PartyService as any, 'updatePartyActivity').mockResolvedValue(undefined);
  });

  afterEach(() => {
    config.partyMaxMembers = saved.party;
    config.privatePartyMaxMembers = saved.priv;
    useSize(null);
    jest.restoreAllMocks();
  });

  it('caps a party at 2, even one made when the cap was 8', () => {
    expect(PartyService.memberLimit({ maxMembers: 8 })).toBe(2);
    expect(PartyService.memberLimit({})).toBe(2);
  });

  it('follows the /rbwconfig choice over the .env default', () => {
    useSize(4);
    expect(PartyService.memberLimit({ maxMembers: 8 })).toBe(4);
    useSize(0);
    expect(PartyService.memberLimit({ maxMembers: 8 })).toBe(0);
  });

  it('uses 2 when the .env default is not 0, 2 or 4', () => {
    config.partyMaxMembers = 3;
    expect(PartySizeService.current()).toBe(2);
  });

  it('only saves 0, 2 or 4', async () => {
    (PartySizeService as any).guildId = 'g1';
    await expect(PartySizeService.set(3)).rejects.toThrow('0, 2, 4');
    PartySizeModel.updateOne.mockResolvedValue({});
    await expect(PartySizeService.set(4)).resolves.toBe(4);
    expect(PartySizeModel.updateOne).toHaveBeenCalledWith({ guildId: 'g1' }, { $set: { size: 4 } }, { upsert: true });
    expect(PartySizeService.current()).toBe(4);
  });

  it('in a solo season nobody can join a party without private games', async () => {
    useSize(0);
    UserModel.findOne.mockResolvedValue({ discordId: 'u2', partyId: null });

    const result = await (PartyService as any).addMemberToParty({ partyId: 'P', members: ['a'], maxMembers: 8 }, 'u2', {});

    expect(result).toEqual({ success: false, message: 'Party is full' });
  });

  it('in a solo season a party with private games still takes 16', () => {
    useSize(0);
    expect(PartyService.memberLimit({ maxMembers: 0, privateGames: true })).toBe(16);
  });

  it('lets a party with private games on have 16', () => {
    expect(PartyService.memberLimit({ maxMembers: 8, privateGames: true })).toBe(16);
  });

  it('refuses a third player in a party of 2', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'u3', partyId: null });

    const result = await (PartyService as any).addMemberToParty({ partyId: 'P', members: ['a', 'b'], maxMembers: 8 }, 'u3', {});

    expect(result).toEqual({ success: false, message: 'Party is full' });
    expect(PartyModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('checks the same limit in the atomic join', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'u3', partyId: null });
    PartyModel.findOneAndUpdate.mockResolvedValue(null);
    PartyModel.findOne.mockResolvedValue({ partyId: 'P', members: ['a', 'b', 'c'] });

    await (PartyService as any).addMemberToParty({ partyId: 'P', members: ['a', 'b'], maxMembers: 8, privateGames: true }, 'u3', {});

    const [filter] = PartyModel.findOneAndUpdate.mock.calls[0];
    expect(filter.$expr).toEqual({ $lt: [{ $size: '$members' }, 16] });
  });

  it("won't turn private games off while the party is bigger than 2", async () => {
    const party = { partyId: 'P', leader: 'a', members: ['a', 'b', 'c'], privateGames: true };
    jest.spyOn(PartyService, 'validatePartyAccess').mockResolvedValue({ isValid: true, party } as any);

    const result = await PartyService.setPrivateGames('a', false);

    expect(result.success).toBe(false);
    expect(result.message).toContain('2 players');
    expect(PartyModel.updateOne).not.toHaveBeenCalled();
  });

  it('turns private games off for a party of 2', async () => {
    const party = { partyId: 'P', leader: 'a', members: ['a', 'b'], privateGames: true };
    jest.spyOn(PartyService, 'validatePartyAccess').mockResolvedValue({ isValid: true, party } as any);
    PartyModel.updateOne.mockResolvedValue({});

    const result = await PartyService.setPrivateGames('a', false);

    expect(result.success).toBe(true);
    expect(PartyModel.updateOne).toHaveBeenCalled();
  });
});

describe('/rbwconfig party size section', () => {
  it('shows the three choices with the current one picked', () => {
    (PartySizeService as any).size = 2;
    const { partySizeView } = require('../src/commands/general/rbwconfig');
    const view = partySizeView();
    const menu = view.components[0].toJSON().components[0];
    expect(menu.options.map((o: any) => o.value)).toEqual(['0', '2', '4']);
    expect(menu.options.find((o: any) => o.default).value).toBe('2');
    expect(view.embeds[0].toJSON().description).toContain('Parties of 2');
    (PartySizeService as any).size = null;
  });
});
