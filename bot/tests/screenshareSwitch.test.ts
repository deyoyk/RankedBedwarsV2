jest.mock('../src/models/ScreenshareState', () => ({ __esModule: true, default: { findOne: jest.fn(), updateOne: jest.fn() } }));
jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: { create: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn() },
}));
jest.mock('../src/models/User', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/services/AuditService', () => ({ recordAudit: jest.fn() }));
jest.mock('../src/utils/safeReply', () => ({ safeReply: jest.fn() }));
jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    channels: { screensharerequestsChannel: 'req1' },
    categories: { screenshareCategory: 'cat1' },
    roles: { screensharer: 'ssrole', frozen: 'frozenrole', everyone: 'everyone' },
  },
}));

import { ScreenshareService } from '../src/services/ScreenshareService';
import { SCREENSHARE_OFF_MESSAGE, ScreenshareSwitch } from '../src/services/ScreenshareSwitch';
import { describeScreenshareSwitch, sstoggle } from '../src/commands/moderation/sstoggle';

const State = require('../src/models/ScreenshareState').default;
const Session = require('../src/models/ScreenshareSession').default;
const { safeReply } = require('../src/utils/safeReply');
const { recordAudit } = require('../src/services/AuditService');

const run = (mode: string | null) => sstoggle({ user: { id: '7' }, options: { getString: () => mode } } as any);
const said = () => safeReply.mock.calls.at(-1)[1].builder.toJSON().description as string;

beforeEach(async () => {
  jest.clearAllMocks();
  State.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
  State.updateOne.mockResolvedValue({});
  await ScreenshareSwitch.load('guild');
  await ScreenshareSwitch.set(true, 'setup');
  jest.clearAllMocks();
});

describe('the screenshare switch', () => {
  test('is on until someone turns it off, and remembers the saved state after a restart', async () => {
    expect(ScreenshareSwitch.current().enabled).toBe(true);
    State.findOne.mockReturnValue({ lean: () => Promise.resolve({ enabled: false, by: '7', at: new Date(0) }) });
    await ScreenshareSwitch.load('guild');
    expect(ScreenshareSwitch.current().enabled).toBe(false);
  });

  test('while off, every new screenshare is refused, from Discord or from the game', async () => {
    await ScreenshareSwitch.set(false, '7');
    for (const fromGame of [false, true]) {
      const result = await ScreenshareService.createSession({} as any, 'target', 'asker', 'Cheating in game', 'https://x/y.png', { fromGame });
      expect(result).toEqual({ success: false, error: SCREENSHARE_OFF_MESSAGE });
    }
    expect(Session.create).not.toHaveBeenCalled();
    expect(Session.findOne).not.toHaveBeenCalled();
  });

  test('turning it off is saved and audited', async () => {
    await run('off');
    expect(State.updateOne).toHaveBeenCalledWith({ guildId: 'guild' }, { $set: expect.objectContaining({ enabled: false, by: '7' }) }, { upsert: true });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'config.screenshare_switch', after: { enabled: false } }));
    expect(said()).toContain('Screensharing is **off**');
    expect(said()).toContain('already open carry on');
  });

  test('says when it is already in that state, and shows it with no mode', async () => {
    await run('on');
    expect(State.updateOne).not.toHaveBeenCalled();
    expect(said()).toContain('already **on**');
    await run(null);
    expect(said()).toContain('Screensharing is **on**');
  });

  test('says who turned it off and when', () => {
    expect(describeScreenshareSwitch({ enabled: false, by: '7', at: new Date(1000_000) })).toContain('<@7> <t:1000:R>');
  });
});
