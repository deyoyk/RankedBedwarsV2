jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn() }
}));
jest.mock('../src/services/AuditService', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

import config from '../src/config/config';
import { ScreenshareService } from '../src/services/ScreenshareService';

const SessionModel = require('../src/models/ScreenshareSession').default;

const NOW = 1_700_000_000_000;

function guild(isScreensharer = true) {
  const member = { roles: { cache: { has: (id: string) => isScreensharer && id === 'ssrole' } } };
  return { id: 'g1', members: { cache: { get: () => member }, fetch: jest.fn() } } as any;
}

describe('taking a frozen screenshare', () => {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    config.roles.screensharer = 'ssrole';
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => nowSpy.mockRestore());

  it('gives the target 10 minutes after the freeze and the freeze message says so', () => {
    expect(ScreenshareService.FREEZE_TIMEOUT).toBe(10 * 60 * 1000);
    const text = ScreenshareService.createFreezeEmbed('t1').toJSON().description!;
    expect(text).toContain('You have 10 minutes to download AnyDesk');
    expect(text).toContain('closes in 10 minutes unless a screensharer takes it');
  });

  it('puts a take button on the freeze message', () => {
    const row = ScreenshareService.createTakeButton('S1').toJSON() as any;
    expect(row.components[0].custom_id).toBe('ss_take_S1');
    expect(row.components[0].label).toBe('Take screenshare');
  });

  it('restarts the ticket at 1 hour 45 minutes from when it is taken', async () => {
    SessionModel.findOneAndUpdate.mockResolvedValue({ targetId: 't1', targetIgn: 'Parady' });

    const result = await ScreenshareService.takeSession(guild(), 'S1', 'mod1');

    expect(result).toEqual({ success: true, expireTime: new Date(NOW + 105 * 60 * 1000) });
    const [filter, update] = SessionModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ sessionId: 'S1', status: 'frozen', takenBy: { $exists: false } });
    expect(update.$set).toEqual({ takenBy: 'mod1', takenTime: new Date(NOW), expireTime: new Date(NOW + 105 * 60 * 1000) });
    expect(update.$push.actions.action).toBe('take');
  });

  it('only lets screensharers take it', async () => {
    const result = await ScreenshareService.takeSession(guild(false), 'S1', 'player1');
    expect(result.success).toBe(false);
    expect(SessionModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('can only be taken once', async () => {
    SessionModel.findOneAndUpdate.mockResolvedValue(null);
    SessionModel.findOne.mockResolvedValue({ status: 'frozen', takenBy: 'mod1' });

    const result = await ScreenshareService.takeSession(guild(), 'S1', 'mod2');

    expect(result).toEqual({ success: false, error: '<@mod1> already took this screenshare' });
  });

  it('refuses a session that already ended', async () => {
    SessionModel.findOneAndUpdate.mockResolvedValue(null);
    SessionModel.findOne.mockResolvedValue({ status: 'expired' });

    const result = await ScreenshareService.takeSession(guild(), 'S1', 'mod1');

    expect(result).toEqual({ success: false, error: 'This screenshare session is expired' });
  });

  it('shows who took it and when the ticket closes', () => {
    const closes = new Date(NOW + 105 * 60 * 1000);
    const text = ScreenshareService.createTakenEmbed({ targetId: 't1' } as any, 'mod1', closes).toJSON().description!;
    expect(text).toContain('<@mod1> is screensharing <@t1>');
    expect(text).toContain(`<t:${Math.floor(closes.getTime() / 1000)}:R>`);
  });
});
