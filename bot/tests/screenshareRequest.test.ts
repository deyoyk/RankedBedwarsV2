jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn()
  }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));

import config from '../src/config/config';
import { ScreenshareService } from '../src/services/ScreenshareService';
import { WebSocketManager } from '../src/websocket/WebSocketManager';

const SessionModel = require('../src/models/ScreenshareSession').default;
const UserModel = require('../src/models/User').default;

const TEN_MINUTES = 10 * 60 * 1000;
const managers: any[] = [];

const users: Record<string, { discordId: string; ign: string }> = {
  steve: { discordId: 'target1', ign: 'Steve' },
  mod: { discordId: 'mod1', ign: 'Mod' }
};

function mockUsers(registered: Record<string, { discordId: string; ign: string }> = users) {
  UserModel.findOne.mockImplementation((query: { ign?: string; discordId?: string }) => {
    if (query.ign !== undefined) {
      const user = registered[query.ign.toLowerCase()] ?? null;
      return { collation: () => ({ select: () => ({ lean: async () => user }) }) };
    }
    return Promise.resolve(Object.values(registered).find(u => u.discordId === query.discordId) ?? null);
  });
}

function makeGuild({ requestsChannelPresent = true, hasScreensharerRole = true } = {}) {
  const thread = { id: 'thread1', setLocked: jest.fn().mockResolvedValue(undefined), send: jest.fn().mockResolvedValue(undefined) };
  const message = { startThread: jest.fn().mockResolvedValue(thread) };
  const requestsChannel = { id: 'req1', isTextBased: () => true, send: jest.fn().mockResolvedValue(message) };
  const member = { roles: { cache: { has: (id: string) => hasScreensharerRole && id === 'ssrole' } }, user: { tag: 'member#1' } };
  const guild = {
    channels: {
      cache: { get: jest.fn((id: string) => (requestsChannelPresent && id === 'req1' ? requestsChannel : undefined)) },
      fetch: jest.fn().mockResolvedValue(null)
    },
    members: { cache: { get: jest.fn().mockReturnValue(undefined) }, fetch: jest.fn().mockResolvedValue(member) }
  };
  return { guild, requestsChannel, message, thread };
}

function makeWs(guild: unknown) {
  const discordClient: any = { guilds: { cache: { first: () => guild } } };
  const ws: any = new WebSocketManager(0, discordClient);
  ws.send = jest.fn();
  ws.requestDontLog = jest.fn().mockResolvedValue({ online: true, dontlog: false });
  jest.spyOn(ws, 'registerScreenshareThread');
  managers.push(ws);
  return ws;
}

function sent(ws: any) {
  return (ws.send as jest.Mock).mock.calls.map(call => call[0]);
}

describe('in-game screenshare requests (autoss)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.channels.screensharerequestsChannel = 'req1';
    config.roles.screensharer = 'ssrole';
    config.roles.frozen = '';
    mockUsers();
    SessionModel.findOne.mockResolvedValue(null);
    SessionModel.countDocuments.mockResolvedValue(0);
    SessionModel.create.mockImplementation(async (doc: any) => doc);
    SessionModel.findOneAndUpdate.mockImplementation(async (_filter: any, update: any) => ({ sessionId: 'closed', targetId: 'target1', ...update.$set }));
  });

  afterAll(() => {
    for (const manager of managers) {
      try { manager.shutdown?.(); } catch { }
      try { manager.server?.close(); } catch { }
    }
  });

  it('posts a request with the in-game reason to the requests channel, like /screenshare', async () => {
    const { guild, requestsChannel, message, thread } = makeGuild();
    const ws = makeWs(guild);

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-1', reason: '  Suspicious reach on Quad  ' });

    expect(SessionModel.create).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'target1',
      requesterId: 'mod1',
      reason: 'Suspicious reach on Quad',
      imageUrl: ''
    }));
    expect(requestsChannel.send).toHaveBeenCalledTimes(1);
    const post = requestsChannel.send.mock.calls[0][0];
    expect(post.content).toBe('<@&ssrole>');
    expect(post.components).toHaveLength(1);
    const embed = post.embeds[0].toJSON();
    expect(embed.description).toContain('**Reason:** Suspicious reach on Quad');
    expect(embed.image).toBeUndefined();
    expect(embed.fields?.map((f: any) => f.name)).not.toContain('Logged off');
    expect(message.startThread).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining('SS: Steve |') }));
    expect(thread.send).toHaveBeenCalledWith(expect.objectContaining({ content: '<@target1>' }));

    const created = SessionModel.create.mock.calls[0][0];
    expect(ws.registerScreenshareThread).toHaveBeenCalledWith({
      ign: 'Steve',
      sessionId: created.sessionId,
      threadId: 'thread1',
      expiresAt: created.expireTime.getTime()
    });
    expect(sent(ws)).toEqual([{ type: 'autoss_success', uuid: 'u-1' }]);
  });

  it('falls back to a default reason and shows that the target logged off', async () => {
    const { guild, requestsChannel } = makeGuild();
    const ws = makeWs(guild);

    await ws.handleAutoSS({ type: 'autoss', targetign: 'steve', requestign: 'mod', uuid: 'u-2', reason: '   ', loggedoff: true });

    expect(SessionModel.create).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Requested in-game' }));
    const embed = requestsChannel.send.mock.calls[0][0].embeds[0].toJSON();
    expect(embed.fields).toContainEqual({ name: 'Logged off', value: 'Yes — left the game after being requested', inline: true });
    expect(sent(ws)).toEqual([{ type: 'autoss_success', uuid: 'u-2' }]);
  });

  it('accepts a short reason from an ordinary player without the screensharer role', async () => {
    const { guild, requestsChannel } = makeGuild({ hasScreensharerRole: false });
    const ws = makeWs(guild);

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-8', reason: 'cheating' });

    expect(SessionModel.create).toHaveBeenCalledWith(expect.objectContaining({ reason: 'cheating', requesterId: 'mod1' }));
    expect(requestsChannel.send).toHaveBeenCalledTimes(1);
    expect(sent(ws)).toEqual([{ type: 'autoss_success', uuid: 'u-8' }]);
  });

  it('lets a requester with an active session request another enemy', async () => {
    const { guild, requestsChannel } = makeGuild({ hasScreensharerRole: false });
    const ws = makeWs(guild);
    SessionModel.countDocuments.mockResolvedValue(1);

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-9', reason: 'cheating' });

    expect(requestsChannel.send).toHaveBeenCalledTimes(1);
    expect(sent(ws)).toEqual([{ type: 'autoss_success', uuid: 'u-9' }]);
  });

  it('still rejects an in-game reason longer than the maximum', async () => {
    const ws = makeWs(makeGuild().guild);

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-10', reason: 'x'.repeat(501) });

    expect(sent(ws)).toEqual([{ type: 'autoss_fail', uuid: 'u-10', error: 'Reason cannot exceed 500 characters' }]);
    expect(SessionModel.create).not.toHaveBeenCalled();
  });

  it('fails with a reason when the target is not registered', async () => {
    const { guild, requestsChannel } = makeGuild();
    const ws = makeWs(guild);
    mockUsers({ mod: users.mod });

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-3', reason: 'Suspicious reach' });

    expect(sent(ws)).toEqual([{ type: 'autoss_fail', uuid: 'u-3', error: 'Steve is not registered' }]);
    expect(SessionModel.create).not.toHaveBeenCalled();
    expect(requestsChannel.send).not.toHaveBeenCalled();
  });

  it('fails with a reason when the requester is not registered', async () => {
    const ws = makeWs(makeGuild().guild);
    mockUsers({ steve: users.steve });

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-4', reason: 'Suspicious reach' });

    expect(sent(ws)).toEqual([{ type: 'autoss_fail', uuid: 'u-4', error: 'You are not registered' }]);
  });

  it('fails with the session error when the target already has an active session', async () => {
    const { guild, requestsChannel } = makeGuild();
    const ws = makeWs(guild);
    SessionModel.findOne.mockResolvedValue({ sessionId: 'S0', status: 'pending' });

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-5', reason: 'Suspicious reach' });

    expect(sent(ws)).toEqual([{ type: 'autoss_fail', uuid: 'u-5', error: 'Target user already has an active screenshare session' }]);
    expect(requestsChannel.send).not.toHaveBeenCalled();
  });

  it('fails with a reason when the requests channel is not configured', async () => {
    const ws = makeWs(makeGuild().guild);
    config.channels.screensharerequestsChannel = '';

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-6', reason: 'Suspicious reach' });

    expect(sent(ws)).toEqual([{ type: 'autoss_fail', uuid: 'u-6', error: 'Screenshare requests channel not configured' }]);
    expect(SessionModel.create).not.toHaveBeenCalled();
  });

  it('closes the session and reports why when the request cannot be posted', async () => {
    const ws = makeWs(makeGuild({ requestsChannelPresent: false }).guild);

    await ws.handleAutoSS({ type: 'autoss', targetign: 'Steve', requestign: 'Mod', uuid: 'u-7', reason: 'Suspicious reach' });

    expect(sent(ws)).toEqual([{ type: 'autoss_fail', uuid: 'u-7', error: 'Screenshare requests channel not found or not a text channel.' }]);
    const created = SessionModel.create.mock.calls[0][0];
    expect(SessionModel.findOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: created.sessionId, status: { $nin: ['closed', 'expired'] } },
      expect.objectContaining({ $set: { status: 'closed' } }),
      { new: true }
    );
    expect(ws.registerScreenshareThread).not.toHaveBeenCalled();
  });
});

describe('Discord /screenshare keeps its own checks', () => {
  const proof = 'https://cdn.example.com/proof.png';

  beforeEach(() => {
    jest.clearAllMocks();
    config.channels.screensharerequestsChannel = 'req1';
    config.roles.screensharer = 'ssrole';
    mockUsers();
    SessionModel.findOne.mockResolvedValue(null);
    SessionModel.countDocuments.mockResolvedValue(0);
    SessionModel.create.mockImplementation(async (doc: any) => doc);
    global._wsManager = undefined;
  });

  it('rejects a reason shorter than 10 characters', async () => {
    const result = await ScreenshareService.createSession(makeGuild().guild as any, 'target1', 'mod1', 'cheating', proof);

    expect(result).toEqual({ success: false, error: 'Reason must be at least 10 characters long' });
    expect(SessionModel.create).not.toHaveBeenCalled();
  });

  it('rejects a requester without the screensharer role', async () => {
    const result = await ScreenshareService.createSession(
      makeGuild({ hasScreensharerRole: false }).guild as any, 'target1', 'mod1', 'Need to verify this player', proof
    );

    expect(result).toEqual({ success: false, error: 'You do not have the screensharer role' });
    expect(SessionModel.create).not.toHaveBeenCalled();
  });

  it('rejects a requester who already has an active session', async () => {
    SessionModel.countDocuments.mockResolvedValue(1);

    const result = await ScreenshareService.createSession(makeGuild().guild as any, 'target1', 'mod1', 'Need to verify this player', proof);

    expect(result).toEqual({ success: false, error: 'You have reached the maximum number of active screenshare sessions' });
    expect(SessionModel.create).not.toHaveBeenCalled();
  });
});

describe('screenshare session expiry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.channels.screensharerequestsChannel = 'req1';
    config.roles.screensharer = 'ssrole';
    mockUsers();
    SessionModel.findOne.mockResolvedValue(null);
    SessionModel.countDocuments.mockResolvedValue(0);
    SessionModel.create.mockImplementation(async (doc: any) => doc);
    global._wsManager = undefined;
  });

  it('expires every session 10 minutes after it is created', async () => {
    const now = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const result = await ScreenshareService.createSession(
        makeGuild().guild as any, 'target1', 'mod1', 'Need to verify this player', 'https://cdn.example.com/proof.png'
      );
      expect(result.success).toBe(true);
      expect(result.session!.expireTime.getTime()).toBe(now + TEN_MINUTES);
    } finally {
      nowSpy.mockRestore();
    }
    expect(ScreenshareService.SESSION_TIMEOUT).toBe(TEN_MINUTES);
  });

  it('tells screensharers the request expires in 10 minutes and only shows an image when there is one', () => {
    const session: any = { sessionId: 'S1', targetId: 'target1', requesterId: 'mod1', reason: 'Need to verify' };

    const withImage = ScreenshareService.createSessionEmbed(session, 'https://cdn.example.com/proof.png').toJSON();
    const withoutImage = ScreenshareService.createSessionEmbed(session, '').toJSON();

    expect(withImage.description).toContain('**Expires:** 10 minutes');
    expect(withImage.image).toEqual({ url: 'https://cdn.example.com/proof.png' });
    expect(withoutImage.description).toContain('**Expires:** 10 minutes');
    expect(withoutImage.image).toBeUndefined();
  });

  it('registers the request thread until the session expires', async () => {
    const { guild } = makeGuild();
    const register = jest.fn();
    global._wsManager = { registerScreenshareThread: register } as any;
    const expireTime = new Date(Date.now() + TEN_MINUTES);
    const session: any = { sessionId: 'S1', targetId: 'target1', targetIgn: 'Steve', requesterId: 'mod1', reason: 'Need to verify', expireTime };

    const posted = await ScreenshareService.postRequest(guild as any, session, { targetName: 'Steve', imageUrl: 'https://cdn.example.com/proof.png' });

    expect(posted).toEqual({ success: true, threadId: 'thread1' });
    expect(register).toHaveBeenCalledWith({ ign: 'Steve', sessionId: 'S1', threadId: 'thread1', expiresAt: expireTime.getTime() });
    global._wsManager = undefined;
  });
});
