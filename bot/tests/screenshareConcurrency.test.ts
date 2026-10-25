import { ScreenshareService } from '../src/services/ScreenshareService';

jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    bulkWrite: jest.fn(),
    deleteOne: jest.fn(),
    countDocuments: jest.fn()
  }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    channels: { screensharerequestsChannel: 'req1' },
    categories: { screenshareCategory: 'cat1' },
    roles: { screensharer: 'ssrole', frozen: 'frozenrole', everyone: 'everyone' }
  }
}));

const SessionModel = require('../src/models/ScreenshareSession').default;
const UserModel = require('../src/models/User').default;

function memberStub() {
  return {
    roles: { cache: { has: () => true }, add: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
    user: { tag: 'mod#1' }
  };
}

function guildStub() {
  return {
    roles: { everyone: { id: 'everyone' } },
    channels: {
      cache: { find: jest.fn().mockReturnValue(undefined), get: jest.fn() },
      fetch: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (opts: any) => ({ id: 'chan1', name: opts.name }))
    },
    members: { fetch: jest.fn().mockResolvedValue(memberStub()) }
  };
}

function pendingSession(overrides: any = {}) {
  return {
    sessionId: 'S1',
    targetId: 'target1',
    targetIgn: 'Steve',
    status: 'pending',
    expireTime: new Date(Date.now() + 60000),
    channelId: undefined,
    actions: [],
    ...overrides
  };
}

describe('ScreenshareService concurrency guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a duplicate create with a friendly message instead of crashing', async () => {
    UserModel.findOne.mockResolvedValue({ discordId: 'target1', ign: 'Steve' });
    SessionModel.findOne.mockResolvedValue(null);
    SessionModel.countDocuments.mockResolvedValue(0);
    const dup = new Error('E11000 duplicate key');
    (dup as any).code = 11000;
    SessionModel.create.mockRejectedValue(dup);

    const result = await ScreenshareService.createSession(
      guildStub() as any, 'target1', 'mod1', 'Need to verify this player cheats', undefined as any
    );

    expect(result).toEqual({ success: false, error: 'Target user already has an active screenshare session' });
  });

  it('freezes through a conditional update', async () => {
    const session = pendingSession();
    SessionModel.findOneAndUpdate.mockResolvedValue({ ...session, status: 'frozen' });

    const result = await ScreenshareService.freezeSession(guildStub() as any, session as any, 'mod1');

    expect(result.success).toBe(true);
    expect(SessionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: 'S1', status: 'pending' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'frozen' }) }),
      { new: true }
    );
  });

  it('cleans up the fresh channel when freeze loses the race', async () => {
    const session = pendingSession();
    SessionModel.findOneAndUpdate.mockResolvedValue(null);
    const guild: any = guildStub();

    const result = await ScreenshareService.freezeSession(guild, session as any, 'mod1');

    expect(result).toEqual({ success: false, error: 'Session is no longer pending' });
    expect(guild.channels.create).toHaveBeenCalled();
    expect(guild.channels.fetch).toHaveBeenCalledWith('chan1');
  });

  it('refuses to close an already-settled session without touching Discord', async () => {
    SessionModel.findOneAndUpdate.mockResolvedValue(null);
    SessionModel.findOne.mockResolvedValue({ sessionId: 'S1', status: 'closed' });
    const guild: any = guildStub();

    const result = await ScreenshareService.closeSession(guild, 'S1', 'mod1');

    expect(result).toEqual({ success: false, error: 'Session already closed or expired' });
    expect(guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('closes through a guarded update and then cleans up', async () => {
    const closed = pendingSession({ status: 'closed', channelId: 'chan1' });
    SessionModel.findOneAndUpdate.mockResolvedValue(closed);
    const guild: any = guildStub();

    const result = await ScreenshareService.closeSession(guild, 'S1', 'mod1');

    expect(result).toEqual({ success: true });
    expect(SessionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: 'S1', status: { $nin: ['closed', 'expired'] } },
      expect.objectContaining({ $set: { status: 'closed' } }),
      { new: true }
    );
    expect(guild.channels.fetch).toHaveBeenCalledWith('chan1');
  });

  it('expires in one bulk write instead of N saves', async () => {
    const docs = [
      { sessionId: 'S1', targetId: 't1', targetIgn: 'A', channelId: 'chan1' },
      { sessionId: 'S2', targetId: 't2', targetIgn: 'B', channelId: undefined }
    ];
    SessionModel.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(docs) }) });
    SessionModel.bulkWrite.mockResolvedValue({ modifiedCount: 2 });
    const guild: any = guildStub();

    const count = await ScreenshareService.expireSessions(guild);

    expect(count).toBe(2);
    expect(SessionModel.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = SessionModel.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(ops[0].updateOne.filter).toEqual({ sessionId: 'S1', status: { $in: ['pending', 'frozen'] } });
  });
});
