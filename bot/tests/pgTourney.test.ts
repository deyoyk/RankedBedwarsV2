jest.mock('../src/models/TourneyState', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../src/utils/safeReply', () => ({ safeReply: jest.fn() }));

import { TourneyService, wire } from '../src/services/TourneyService';
import { describeTourney, pgtourney } from '../src/commands/general/pgtourney';

const TourneyState = require('../src/models/TourneyState').default;
const { safeReply } = require('../src/utils/safeReply');

const said = () => (safeReply.mock.calls.at(-1)[1].builder.toJSON().description as string);
const run = (mode: string | null) => pgtourney({ user: { id: '42' }, options: { getString: () => mode } } as any);

beforeEach(async () => {
  TourneyState.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
  TourneyState.updateOne.mockResolvedValue({});
  await TourneyService.load('guild');
  await TourneyService.set(false, 'reset', 'discord');
});

describe('private game tourney mode', () => {
  test('is off until turned on, and comes back after a restart', async () => {
    expect(describeTourney(TourneyService.current())).toContain('**off**');
    TourneyState.findOne.mockReturnValue({ lean: () => Promise.resolve({ enabled: true, by: 'Mgr', source: 'minecraft', at: new Date(5000) }) });
    await TourneyService.load('guild');
    expect(TourneyService.current()).toMatchObject({ enabled: true, by: 'Mgr', source: 'minecraft' });
    expect(describeTourney(TourneyService.current())).toContain('`Mgr` in game');
  });

  test('every change is saved and told to listeners, like the Minecraft server', async () => {
    const heard = jest.fn();
    TourneyService.onChange(heard);
    await TourneyService.set(true, 'Mgr', 'minecraft');
    expect(TourneyState.updateOne).toHaveBeenLastCalledWith({ guildId: 'guild' },
      { $set: expect.objectContaining({ enabled: true, by: 'Mgr', source: 'minecraft' }) }, { upsert: true });
    expect(wire(heard.mock.calls.at(-1)[0])).toEqual({ type: 'pg_tourney', enabled: true, by: 'Mgr', source: 'minecraft' });
  });

  test('/pgtourney turns it on, says when nothing changes, and shows it without a mode', async () => {
    await run('on');
    expect(TourneyService.current()).toMatchObject({ enabled: true, by: '42', source: 'discord' });
    expect(said()).toContain('<@42>');
    await run('on');
    expect(said()).toContain('already **on**');
    await run(null);
    expect(said()).toContain("can't be spectated");
    await run('off');
    expect(TourneyService.current().enabled).toBe(false);
  });
});
