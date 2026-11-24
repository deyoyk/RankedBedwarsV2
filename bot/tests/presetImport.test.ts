jest.mock('../src/config/config', () => ({ __esModule: true, default: { strikes: {} } }));
jest.mock('../src/models/StrikeRules', () => ({ __esModule: true, default: { findOne: jest.fn(), updateOne: jest.fn() } }));

import { parsePresetFile } from '../src/services/PresetImport';

const file = (data: unknown) => JSON.stringify(data);

describe('preset files', () => {
  test('read bans, mutes and strike presets with their steps and strike counts', () => {
    const parsed = parsePresetFile(file({
      presets: [
        { name: 'Cheating', type: 'ban', reason: 'Cheating', durations: '1d, 7d, perm' },
        { name: 'spam', type: 'mute', reason: 'Spam', durations: '1h' },
        { name: 'afk', type: 'strike', reason: 'AFK' },
        { name: 'throwing', type: 'strike', reason: 'Throwing', strikes: 3 },
      ],
    }));
    expect(parsed.presets.map(p => p.name)).toEqual(['cheating', 'spam', 'afk', 'throwing']);
    expect(parsed.presets[0].steps).toEqual([{ duration: '1d' }, { duration: '7d' }, { duration: 'perm' }]);
    expect(parsed.presets[2]).toMatchObject({ steps: [], strikes: 1 });
    expect(parsed.presets[3].strikes).toBe(3);
    expect(parsed.strikeRules).toBeNull();
  });

  test('read optional strike rules, sorted, with +duration allowed', () => {
    const parsed = parsePresetFile(file({
      presets: [{ name: 'afk', type: 'strike', reason: 'AFK' }],
      strikeRules: { rules: [{ strikes: 4, action: '1d' }, { strikes: 2, action: '1H' }], otherwise: '+2d' },
    }));
    expect(parsed.strikeRules).toEqual({ rules: [{ strikes: 2, action: '1h' }, { strikes: 4, action: '1d' }], otherwise: '+2d' });
  });

  test.each([
    ['not json', '{', "isn't valid JSON"],
    ['no presets list', file({}), 'needs a `presets` list'],
    ['an empty list', file({ presets: [] }), '1 to 200 presets'],
    ['a bad name', file({ presets: [{ name: 'no spaces', type: 'ban', reason: 'x', durations: '1d' }] }), 'preset name'],
    ['an unknown type', file({ presets: [{ name: 'a', type: 'kick', reason: 'x' }] }), 'ban, mute or strike'],
    ['no reason', file({ presets: [{ name: 'a', type: 'ban', durations: '1d' }] }), '`reason`'],
    ['a ban without durations', file({ presets: [{ name: 'a', type: 'ban', reason: 'x' }] }), 'needs `durations`'],
    ['bad durations', file({ presets: [{ name: 'a', type: 'ban', reason: 'x', durations: 'soon' }] }), '`a`:'],
    ['too many strikes', file({ presets: [{ name: 'a', type: 'strike', reason: 'x', strikes: 11 }] }), '1 to 10 strikes'],
    ['a name twice', file({ presets: [{ name: 'a', type: 'strike', reason: 'x' }, { name: 'A', type: 'strike', reason: 'y' }] }), 'twice'],
    ['broken strike rules', file({ presets: [{ name: 'a', type: 'strike', reason: 'x' }], strikeRules: { rules: {} } }), '`strikeRules`'],
    ['a strike rule twice', file({ presets: [{ name: 'a', type: 'strike', reason: 'x' }],
      strikeRules: { rules: [{ strikes: 2, action: '1h' }, { strikes: 2, action: '2h' }], otherwise: 'warn' } }), 'two strike rules'],
    ['a bad strike action', file({ presets: [{ name: 'a', type: 'strike', reason: 'x' }],
      strikeRules: { rules: [{ strikes: 2, action: 'soon' }], otherwise: 'warn' } }), 'Invalid duration'],
  ])('refuse %s, before anything is saved', (_label, text, message) => {
    expect(() => parsePresetFile(text)).toThrow(message);
  });
});
