jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() }
}));
jest.mock('../src/services/AuditService', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

import config from '../src/config/config';
import { ScreenshareService } from '../src/services/ScreenshareService';

const SessionModel = require('../src/models/ScreenshareSession').default;

const NOW = 1_700_000_000_000;
const HOUR_45 = 105 * 60 * 1000;

function setup(isScreensharer = true) {
  const thread = { isTextBased: () => true, send: jest.fn().mockResolvedValue({ id: 'm' }), messages: { edit: jest.fn().mockResolvedValue(undefined) } };
  const requests = { isTextBased: () => true, messages: { edit: jest.fn().mockResolvedValue(undefined) } };
  const channels: Record<string, unknown> = { th1: thread, req1: requests };
  const member = { roles: { cache: { has: (id: string) => isScreensharer && id === 'ssrole' } } };
  const guild = {
    id: 'g1',
    channels: { cache: { get: (id: string) => channels[id] }, fetch: jest.fn(async (id: string) => channels[id] ?? null) },
    members: { cache: { get: () => member }, fetch: jest.fn() }
  } as any;
  return { guild, thread, requests };
}

const frozen = {
  sessionId: 'S1', status: 'frozen', targetId: 't1', targetIgn: 'Parady', requesterId: 'r1', reason: 'reach',
  threadId: 'th1', requestMessageId: 'reqmsg', sessionMessageId: 'sessmsg', expireTime: new Date(NOW + 60000), actions: []
};

describe('claiming a frozen screenshare', () => {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    config.roles.screensharer = 'ssrole';
    config.channels.screensharerequestsChannel = 'req1';
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => nowSpy.mockRestore());

  it('gives the target 10 minutes after the freeze and the freeze message says so', () => {
    expect(ScreenshareService.FREEZE_TIMEOUT).toBe(10 * 60 * 1000);
    const text = ScreenshareService.createFreezeEmbed('t1').toJSON().description!;
    expect(text).toContain('You have 10 minutes to download AnyDesk');
    expect(text).toContain('closes in 10 minutes unless a screensharer claims it');
  });

  it('offers Claim once the player is frozen', () => {
    const row = ScreenshareService.ticketButtons(frozen as any)[0].toJSON() as any;
    expect(row.components.map((b: any) => [b.custom_id, b.label])).toEqual([['ss_claim_S1', 'Claim']]);
  });

  it('restarts the ticket at 1 hour 45 minutes and turns it into an active session', async () => {
    const { guild, thread, requests } = setup();
    SessionModel.findOneAndUpdate.mockImplementation(async (_f: any, update: any) => ({ ...frozen, ...update.$set }));

    const result = await ScreenshareService.claimSession(guild, 'S1', 'mod1');

    expect(result).toEqual({ success: true, expireTime: new Date(NOW + HOUR_45) });
    const [filter, update] = SessionModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ sessionId: 'S1', status: 'frozen', takenBy: { $exists: false } });
    expect(update.$set).toEqual({ takenBy: 'mod1', takenTime: new Date(NOW), expireTime: new Date(NOW + HOUR_45) });
    expect(thread.send.mock.calls[0][0].content).toContain('<@mod1> claimed this screenshare');

    const [messageId, edit] = thread.messages.edit.mock.calls[0];
    expect(messageId).toBe('sessmsg');
    const embed = edit.embeds[0].toJSON();
    expect(embed.description).toContain('Screenshare Active Session');
    expect(embed.fields).toContainEqual({ name: 'Status', value: '`ACTIVE`' });
    expect(embed.fields).toContainEqual({ name: 'Claimed By', value: '<@mod1>' });
    expect(edit.components).toEqual([]);
    expect(requests.messages.edit.mock.calls[0][1].embeds[0].toJSON().fields).toContainEqual({ name: 'Status', value: '`ACTIVE`' });
  });

  it('only lets screensharers claim it', async () => {
    const result = await ScreenshareService.claimSession(setup(false).guild, 'S1', 'player1');
    expect(result.success).toBe(false);
    expect(SessionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('can only be claimed once', async () => {
    SessionModel.findOneAndUpdate.mockResolvedValue(null);
    SessionModel.findOne.mockResolvedValue({ status: 'frozen', takenBy: 'mod1' });
    expect(await ScreenshareService.claimSession(setup().guild, 'S1', 'mod2'))
      .toEqual({ success: false, error: '<@mod1> already claimed this screenshare' });
  });

  it('needs the player frozen first', async () => {
    SessionModel.findOneAndUpdate.mockResolvedValue(null);
    SessionModel.findOne.mockResolvedValue({ status: 'pending' });
    expect(await ScreenshareService.claimSession(setup().guild, 'S1', 'mod1'))
      .toEqual({ success: false, error: 'Freeze the player before claiming' });
  });

  it('shows the final status and outcome when the ticket ends', () => {
    const closed = { ...frozen, status: 'closed', takenBy: 'mod1', actions: [{ action: 'close', userId: 'mod1', timestamp: new Date(), context: 'Clean' }] };
    const request = ScreenshareService.createRequestEmbed(closed as any).toJSON();
    expect(request.fields).toContainEqual({ name: 'Status', value: '`CLOSED`' });
    expect(request.fields).toContainEqual({ name: 'Outcome', value: 'Clean\nClosed by <@mod1>' });
    expect(request.fields).toContainEqual({ name: 'Channel', value: '<#th1>' });
    expect(ScreenshareService.ticketButtons(closed as any)).toEqual([]);
    const expired = ScreenshareService.createRequestEmbed({ ...frozen, status: 'expired' } as any).toJSON();
    expect(expired.fields).toContainEqual({ name: 'Outcome', value: 'Session expired automatically' });
  });
});

describe('closing a ticket', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    config.channels.screensharerequestsChannel = 'req1';
  });

  it('updates both messages, then closes and locks the thread', async () => {
    const { guild, thread, requests } = setup();
    Object.assign(thread, { setLocked: jest.fn().mockResolvedValue(undefined), setArchived: jest.fn().mockResolvedValue(undefined) });
    const closed = { ...frozen, status: 'closed', actions: [{ action: 'close', userId: 'mod1', timestamp: new Date(), context: 'Clean' }] };
    SessionModel.findOneAndUpdate.mockResolvedValue(closed);
    SessionModel.findOne.mockResolvedValue(closed);
    (SessionModel as any).countDocuments = jest.fn().mockResolvedValue(0);

    expect(await ScreenshareService.closeSession(guild, 'S1', 'mod1', 'Clean')).toEqual({ success: true });

    expect(requests.messages.edit.mock.calls[0][1].embeds[0].toJSON().fields).toContainEqual({ name: 'Status', value: '`CLOSED`' });
    expect(thread.messages.edit.mock.calls[0][1].components).toEqual([]);
    expect((thread as any).setLocked).toHaveBeenCalledWith(true, expect.any(String));
    expect((thread as any).setArchived).toHaveBeenCalledWith(true, expect.any(String));
  });
});

describe('finding a screenshare from where /ssclose is used', () => {
  beforeEach(() => jest.clearAllMocks());

  it('matches the ticket thread', async () => {
    SessionModel.findOne.mockResolvedValueOnce({ sessionId: 'S1' });
    await expect(ScreenshareService.getSessionByChannelId('thread1', 'ss-wuwster')).resolves.toEqual({ sessionId: 'S1' });
    expect(SessionModel.findOne).toHaveBeenCalledWith({ $or: [{ channelId: 'thread1' }, { threadId: 'thread1' }] });
  });

  it('falls back to the session id in older thread names', async () => {
    SessionModel.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ sessionId: 'SSMWY61XOA13J' });
    expect(await ScreenshareService.getSessionByChannelId('old', 'SS: wuwster | SSMWY61XOA13J')).toEqual({ sessionId: 'SSMWY61XOA13J' });
  });

  it('finds nothing in an unrelated channel', async () => {
    SessionModel.findOne.mockResolvedValueOnce(null);
    await expect(ScreenshareService.getSessionByChannelId('general', 'general')).resolves.toBeNull();
  });
});
