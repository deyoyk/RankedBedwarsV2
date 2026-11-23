import { BanManager } from '../src/managers/BanManager';
import { lookupDiscordNames } from '../src/utils/discordLookup';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn()
  }
}));

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: { roles: { banned: 'bannedRoleId', muted: 'mutedRoleId' }, strikes: { default: 'warn' } }
}));

jest.mock('../src/utils/punishmentEmbed', () => ({
  sendPunishmentEmbed: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/utils/modCommands', () => ({
  executeModerationAction: jest.fn((_interaction: unknown, cfg: any) => cfg.managerCall('guild', 'target', 'issuer', '1d', 'cheating')),
  executeUnmoderationAction: jest.fn((_interaction: unknown, cfg: any) => cfg.managerCall('guild', 'target', 'issuer'))
}));

const UserModel = require('../src/models/User').default;

const guildMock = () => ({
  members: {
    cache: { get: jest.fn().mockReturnValue({ roles: { add: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) } }) },
    ban: jest.fn().mockResolvedValue(undefined),
    unban: jest.fn().mockResolvedValue(undefined)
  }
});

const user = (): any => ({ discordId: '123', ign: 'Steve', isBanned: false, bans: [] as any[] });

function chainable<T>(result: T): any {
  const chain: any = { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }) };
  chain.then = (resolve: (value: T) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

beforeEach(() => jest.clearAllMocks());

describe('Discord ban sync', () => {
  test('manual /ban sends botban with ign, reason, minutes and case id', async () => {
    const u = user();
    UserModel.findOneAndUpdate.mockImplementation(async (_f: any, update: any) => {
      u.bans.push(update.$push.bans);
      u.isBanned = true;
      return { ...u };
    });
    const ws = { send: jest.fn() };
    await BanManager.ban(guildMock() as any, '123', 'mod', '1h', 'cheating', ws);
    expect(ws.send).toHaveBeenCalledWith({ type: 'botban', ign: 'Steve', reason: 'cheating', duration: 60, id: u.bans[0].id });
  });

  test('re-ban of an already banned user still sends botban with the updated reason', async () => {
    const u = user();
    u.isBanned = true;
    u.bans.push({ id: 'case1', reason: 'old', date: new Date(), duration: 60, moderator: 'm' });
    UserModel.findOneAndUpdate.mockResolvedValue(null);
    UserModel.findOne.mockResolvedValue(u);
    UserModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    const ws = { send: jest.fn() };
    await BanManager.ban(guildMock() as any, '123', 'mod', '2h', 'new reason', ws);
    expect(ws.send).toHaveBeenCalledWith({ type: 'botban', ign: 'Steve', reason: 'new reason', duration: 120, id: 'case1' });
  });

  test('ban without a websocket (strike path) sends nothing and does not throw', async () => {
    const u = user();
    UserModel.findOneAndUpdate.mockImplementation(async (_f: any, update: any) => {
      u.bans.push(update.$push.bans);
      return { ...u, isBanned: true };
    });
    await expect(BanManager.ban(guildMock() as any, '123', 'mod', '1h', 'Strike 3: x')).resolves.toBeInstanceOf(Date);
  });

  test('/unban sends botunban', async () => {
    UserModel.findOneAndUpdate.mockReturnValue(chainable({ discordId: '123', ign: 'Steve' }));
    const ws = { send: jest.fn() };
    await BanManager.unban(guildMock() as any, '123', 'mod', 'appeal', ws);
    expect(ws.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'botunban', ign: 'Steve', reason: 'appeal' }));
  });

  test('the /ban and /unban commands pass the server connection to BanManager', async () => {
    const banSpy = jest.spyOn(BanManager, 'ban').mockResolvedValue(undefined);
    const unbanSpy = jest.spyOn(BanManager, 'unban').mockResolvedValue(true);
    const ws = { send: jest.fn() } as any;
    const { ban } = require('../src/commands/moderation/ban');
    const { unban } = require('../src/commands/moderation/unban');
    await ban({} as any, ws);
    await unban({} as any, ws);
    expect(banSpy).toHaveBeenCalledWith('guild', 'target', 'issuer', '1d', 'cheating', ws);
    expect(unbanSpy).toHaveBeenCalledWith('guild', 'target', 'issuer', undefined, ws);
  });
});

describe('lookupDiscordNames', () => {
  test('replies with usernames and null for unknown or unlinked igns', async () => {
    const result = await lookupDiscordNames(['Steve', 'Ghost', 'Alex'], {
      discordIdOf: async (ign) => ({ steve: '1', alex: '2' } as Record<string, string>)[ign.toLowerCase()] ?? null,
      usernameOf: async (id) => (id === '1' ? 'steve_dc' : null)
    });
    expect(result).toEqual({ Steve: 'steve_dc', Ghost: null, Alex: null });
  });

  test('caps the lookup at 50 names', async () => {
    const igns = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const result = await lookupDiscordNames(igns, { discordIdOf: async () => null, usernameOf: async () => null });
    expect(Object.keys(result)).toHaveLength(50);
  });
});
