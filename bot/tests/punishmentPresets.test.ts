jest.mock('../src/models/PunishmentPreset', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock('../src/managers/BanManager', () => ({ BanManager: { ban: jest.fn(), unban: jest.fn() } }));
jest.mock('../src/managers/MuteManager', () => ({ MuteManager: { mute: jest.fn(), unmute: jest.fn() } }));

import type { IPunishmentPreset } from '../src/models/PunishmentPreset';
import { parseSteps, resolvePreset, toWire, PunishmentPresets } from '../src/services/PunishmentPresets';
import { choosePunishment } from '../src/utils/modCommands';
import { handleIngamePunish, typedDuration } from '../src/websocket/ingamePunish';

const PresetModel = require('../src/models/PunishmentPreset').default;
const UserModel = require('../src/models/User').default;
const { BanManager } = require('../src/managers/BanManager');
const { MuteManager } = require('../src/managers/MuteManager');

const lean = (value: unknown) => ({ sort: () => ({ lean: () => Promise.resolve(value) }), select: () => ({ lean: () => Promise.resolve(value) }) });

const cheating: IPunishmentPreset = {
  name: 'cheating', type: 'ban', reason: 'Cheating',
  steps: [{ duration: '1d' }, { duration: '7d', reason: 'Cheating again' }, { duration: 'perm' }],
  createdBy: '1', updatedAt: new Date(0)
};
const spam: IPunishmentPreset = { name: 'spam', type: 'mute', reason: 'Spam', steps: [{ duration: '1h' }], createdBy: '1', updatedAt: new Date(0) };

beforeEach(async () => {
  PresetModel.find.mockReturnValue(lean([cheating, spam]));
  PresetModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
  await PunishmentPresets.remove('nothing');
});

describe('preset steps', () => {
  test('parse durations, with an optional reason per step', () => {
    expect(parseSteps('1d, 7d:Second time ,perm')).toEqual([{ duration: '1d' }, { duration: '7d', reason: 'Second time' }, { duration: 'perm' }]);
  });

  test('refuse bad or too short durations when the preset is saved', () => {
    expect(() => parseSteps('')).toThrow();
    expect(() => parseSteps('1d, soon')).toThrow();
    expect(() => parseSteps('30s')).toThrow('shorter than a minute');
  });

  test('repeat offences climb the steps and stay on the last one', () => {
    const past = (n: number) => Array.from({ length: n }, () => ({ preset: 'cheating' }));
    expect(resolvePreset(cheating, [])).toMatchObject({ offence: 1, duration: '1d', reason: 'Cheating' });
    expect(resolvePreset(cheating, [...past(1), { preset: 'other' }, {}])).toMatchObject({ offence: 2, duration: '7d', reason: 'Cheating again' });
    expect(resolvePreset(cheating, past(5))).toMatchObject({ offence: 6, duration: 'perm' });
  });

  test('go to the server in minutes, permanent as null', () => {
    expect(toWire(cheating).steps).toEqual([{ minutes: 1440, reason: null }, { minutes: 10080, reason: 'Cheating again' }, { minutes: null, reason: null }]);
  });

  test('listeners hear about every change', async () => {
    const heard = jest.fn();
    PunishmentPresets.onChange(heard);
    await PunishmentPresets.remove('spam');
    expect(heard).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'cheating' })]));
  });
});

describe('choosing a punishment', () => {
  test('without a preset needs a duration', async () => {
    expect(await choosePunishment('ban', '5', null, '', 'x')).toHaveProperty('error');
    expect(await choosePunishment('ban', '5', null, '2d', '')).toMatchObject({ duration: '2d', reason: 'No reason provided', options: {} });
  });

  test('a preset uses the target history, and typed values win', async () => {
    UserModel.findOne.mockReturnValue(lean({ bans: [{ preset: 'cheating' }] }));
    expect(await choosePunishment('ban', '5', 'Cheating', '', '')).toMatchObject({
      duration: '7d', reason: 'Cheating again', options: { preset: 'cheating' }
    });
    expect(await choosePunishment('ban', '5', 'cheating', '3d', 'Blatant')).toMatchObject({ duration: '3d', reason: 'Blatant' });
  });

  test('a preset of the other type or that does not exist is refused', async () => {
    expect(await choosePunishment('mute', '5', 'cheating', '', '')).toHaveProperty('error');
    expect(await choosePunishment('ban', '5', 'nope', '', '')).toHaveProperty('error');
  });
});

describe('the preset command', () => {
  test('is refused to anyone without the Administrator permission', async () => {
    const { preset } = require('../src/commands/moderation/preset');
    const reply = jest.fn();
    const i = { memberPermissions: { has: () => false }, options: { getSubcommand: jest.fn() }, replied: false, deferred: false, reply, isRepliable: () => true } as any;
    await preset(i);
    expect(i.options.getSubcommand).not.toHaveBeenCalled();
  });
});

describe('in-game punishments', () => {
  const notifier = { send: jest.fn() };
  const deps = (users: Record<string, string>) => ({
    findUser: async (ign: string) => (users[ign.toLowerCase()] ? { discordId: users[ign.toLowerCase()] } : null),
    guild: () => ({}) as any,
    botId: () => 'bot',
    notifier
  });

  test('turn typed minutes into a duration', () => {
    expect(typedDuration({ type: 'ingame_punish', minutes: 90 })).toBe('90m');
    expect(typedDuration({ type: 'ingame_punish', permanent: true })).toBe('perm');
    expect(typedDuration({ type: 'ingame_punish' })).toBe('');
  });

  test('an unregistered player is left to the server', async () => {
    const result = await handleIngamePunish({ type: 'ingame_punish', request_id: 'r', action: 'ban', ign: 'Nobody', preset: 'cheating' }, deps({}));
    expect(result).toMatchObject({ type: 'ingame_punish_result', request_id: 'r', ok: false, error: 'not_registered' });
    expect(BanManager.ban).not.toHaveBeenCalled();
  });

  test('a preset ban is applied on Discord by the staff member, preset and all', async () => {
    UserModel.findOne.mockReturnValue(lean({ bans: [] }));
    const result = await handleIngamePunish({ type: 'ingame_punish', request_id: 'r', action: 'ban', ign: 'Steve', staff: 'Mod1', preset: 'cheating' },
      deps({ steve: '10', mod1: '20' }));
    expect(result).toMatchObject({ ok: true, duration: '1d', reason: 'Cheating', preset: 'cheating' });
    expect(BanManager.ban).toHaveBeenCalledWith(expect.anything(), '10', '20', '1d', 'Cheating', notifier, { preset: 'cheating', staff: 'Mod1' });
  });

  test('staff who are not registered act as the bot', async () => {
    await handleIngamePunish({ type: 'ingame_punish', action: 'mute', ign: 'Steve', staff: 'Helper', minutes: 30, reason: 'Toxic' }, deps({ steve: '10' }));
    expect(MuteManager.mute).toHaveBeenCalledWith(expect.anything(), '10', 'bot', '30m', 'Toxic', notifier, { staff: 'Helper' });
  });

  test('an unban says when there was nothing to undo on Discord', async () => {
    BanManager.unban.mockResolvedValue(false);
    const result = await handleIngamePunish({ type: 'ingame_punish', action: 'unban', ign: 'Steve' }, deps({ steve: '10' }));
    expect(result).toMatchObject({ ok: false, error: 'not_punished' });
  });

  test('a failure is reported instead of thrown', async () => {
    BanManager.ban.mockRejectedValue(new Error('db down'));
    UserModel.findOne.mockReturnValue(lean({ bans: [] }));
    const result = await handleIngamePunish({ type: 'ingame_punish', action: 'ban', ign: 'Steve', minutes: 60 }, deps({ steve: '10' }));
    expect(result).toMatchObject({ ok: false, error: 'failed', message: 'db down' });
  });
});
