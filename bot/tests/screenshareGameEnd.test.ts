jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }
}));
jest.mock('../src/services/AuditService', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

import config from '../src/config/config';
import { ScreenshareService } from '../src/services/ScreenshareService';

const SessionModel = require('../src/models/ScreenshareSession').default;

const NOW = 1_700_000_000_000;

function setup() {
  const thread = { isTextBased: () => true, send: jest.fn().mockResolvedValue({ id: 'm' }), messages: { edit: jest.fn().mockResolvedValue(undefined) } };
  const requests = { isTextBased: () => true, messages: { edit: jest.fn().mockResolvedValue(undefined) } };
  const member = { roles: { cache: { has: () => false }, add: jest.fn().mockResolvedValue(undefined) } };
  const channels: Record<string, unknown> = { th1: thread, req1: requests };
  const guild = {
    id: 'g1',
    channels: { cache: { get: (id: string) => channels[id] }, fetch: jest.fn(async (id: string) => channels[id] ?? null) },
    members: { cache: { get: () => member }, fetch: jest.fn() }
  } as any;
  return { guild, thread, requests, member };
}

function waiting(sessions: any[]) {
  SessionModel.find.mockReturnValue({ collation: jest.fn().mockResolvedValue(sessions) });
}

const pending = {
  sessionId: 'S1', status: 'pending', targetId: 't1', targetIgn: 'Parady', requesterId: 'r1', reason: 'reach',
  threadId: 'th1', requestMessageId: 'reqmsg', sessionMessageId: 'sessmsg', waitingForGame: true,
  expireTime: new Date(NOW + 60 * 60 * 1000), actions: []
};

describe('screenshare tickets made during a game', () => {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    config.channels.screensharerequestsChannel = 'req1';
    config.roles.frozen = 'frozenrole';
    config.roles.screensharer = 'ssrole';
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    global._wsManager = { registerScreenshareThread: jest.fn() } as any;
  });
  afterEach(() => {
    nowSpy.mockRestore();
    delete (global as any)._wsManager;
  });

  it('freeze the player when the game ends and give them 10 minutes', async () => {
    const { guild, thread, member } = setup();
    waiting([pending]);
    SessionModel.findOneAndUpdate.mockImplementation(async (_f: any, update: any) => ({ ...pending, ...update.$set, waitingForGame: undefined }));

    const started = await ScreenshareService.startAfterGame(guild, ['parady']);

    expect(started).toBe(1);
    expect(SessionModel.find.mock.calls[0][0]).toMatchObject({ status: 'pending', waitingForGame: true, targetIgn: { $in: ['parady'] } });
    const [filter, update] = SessionModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ sessionId: 'S1', status: 'pending' });
    expect(update.$set).toMatchObject({ status: 'frozen', expireTime: new Date(NOW + 10 * 60 * 1000) });
    expect(update.$unset).toEqual({ waitingForGame: '' });
    expect(member.roles.add).toHaveBeenCalledWith('frozenrole', expect.any(String));
    const freeze = thread.send.mock.calls[0][0];
    expect(freeze.content).toBe('<@&ssrole> <@t1>');
    expect(freeze.allowedMentions).toEqual({ users: ['t1'], roles: ['ssrole'] });
    expect(freeze.embeds[0].toJSON().description).toContain('You have 10 minutes to download AnyDesk');
    const ticket = thread.messages.edit.mock.calls[0];
    expect(ticket[0]).toBe('sessmsg');
    expect(ticket[1].components[0].toJSON().components[0].custom_id).toBe('ss_claim_S1');
    expect(global._wsManager!.registerScreenshareThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'th1', expiresAt: NOW + 10 * 60 * 1000 })
    );
  });

  it('skip a ticket that is no longer pending', async () => {
    const { guild } = setup();
    waiting([pending]);
    SessionModel.findOneAndUpdate.mockResolvedValue(null);

    expect(await ScreenshareService.startAfterGame(guild, ['Parady'])).toBe(0);
  });

  it('do nothing without any players', async () => {
    expect(await ScreenshareService.startAfterGame(setup().guild, [])).toBe(0);
    expect(SessionModel.find).not.toHaveBeenCalled();
  });

  it('only offer Cancel while the game is still going', () => {
    const row = ScreenshareService.ticketButtons(pending as any)[0].toJSON() as any;
    expect(row.components.map((b: any) => b.custom_id)).toEqual(['ss_cancel_S1']);
    const embed = ScreenshareService.createSessionEmbed(pending as any).toJSON();
    expect(embed.fields).toContainEqual({ name: 'Expires', value: 'When the game ends, the player is frozen' });
  });
});
