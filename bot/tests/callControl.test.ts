jest.mock('../src/models/Game', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/models/OpenCall', () => ({ __esModule: true, default: { findOne: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn() } }));
jest.mock('../src/models/CallRoles', () => ({ __esModule: true, default: { findOne: jest.fn(), updateOne: jest.fn() } }));

import { PermissionsBitField } from 'discord.js';
import { CallRoleService, rolesForTier } from '../src/services/CallRoleService';
import { addToCall, closeCall, findCall, openCall, removeFromCall, restoreOptions, staysOnClose, unmuteInCall } from '../src/services/CallControl';
import { actionOf } from '../src/services/CallBridge';

const Game = require('../src/models/Game').default;
const OpenCall = require('../src/models/OpenCall').default;
const CallRoles = require('../src/models/CallRoles').default;

const GAME = { gameId: 7, team1: ['a1', 'a2'], team2: ['b1'], channels: { team1Voice: 'vc1', team2Voice: 'vc2', picking: 'pick' } };

function voiceChannel(id: string, overwrites: Record<string, { allow: bigint; deny: bigint }> = {}) {
  const cache = new Map(Object.entries(overwrites).map(([k, v]) => [k, { allow: new PermissionsBitField(v.allow), deny: new PermissionsBitField(v.deny) }]));
  const members = new Map<string, any>();
  return {
    id,
    members,
    isVoiceBased: () => true,
    permissionOverwrites: {
      cache,
      create: jest.fn(async (target: string, options: any) => { cache.set(target, toBits(options)); }),
      edit: jest.fn(async (target: string, options: any) => { cache.set(target, toBits(options)); }),
      delete: jest.fn(async (target: string) => { cache.delete(target); }),
    },
  };
}

function toBits(options: Record<string, boolean>) {
  const allow = new PermissionsBitField(Object.keys(options).filter(k => options[k]) as any);
  const deny = new PermissionsBitField(Object.keys(options).filter(k => options[k] === false) as any);
  return { allow, deny };
}

const inVoice = (id: string) => ({ id, voice: { disconnect: jest.fn().mockResolvedValue(undefined), setChannel: jest.fn().mockResolvedValue(undefined) } });

function context(voice: any, requesterId = 'a1', picking?: any) {
  return { guild: { roles: { everyone: { id: 'everyone' } }, channels: { cache: new Map(picking ? [['pick', picking]] : []) } } as any, voice, game: GAME, requesterId };
}

beforeEach(async () => {
  CallRoles.findOne.mockReturnValue({ lean: () => Promise.resolve({ pups: 'r-pups', pugstrial: 'r-trial', pugs: 'r-pugs', premium: 'r-prem' }) });
  await CallRoleService.load('g');
  OpenCall.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
});

describe('/call open tiers', () => {
  test('pups includes Pugs Trial, Pugs and Premium; pugs includes Premium', () => {
    const roles = CallRoleService.current();
    expect(rolesForTier('pups', roles, 'everyone')).toEqual(['r-pups', 'r-trial', 'r-pugs', 'r-prem']);
    expect(rolesForTier('pugs', roles, 'everyone')).toEqual(['r-pugs', 'r-prem']);
    expect(rolesForTier('premium', roles, 'everyone')).toEqual(['r-prem']);
    expect(rolesForTier('everyone', {}, 'everyone')).toEqual(['everyone']);
    expect(rolesForTier('pups', { premium: 'r-prem' }, 'everyone')).toEqual(['r-prem']);
  });
});

describe('who can use /call', () => {
  const guildWith = (voiceId: string | null) => ({ members: { cache: new Map([['a1', { voice: { channel: voiceId ? { id: voiceId } : null } }], ['x', { voice: { channel: { id: 'vc1' } } }]]), fetch: jest.fn() } }) as any;

  test('open, close and unmute need a team member in their team voice channel', async () => {
    Game.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(GAME) }) });
    expect(await findCall(guildWith('vc1'), 'a1', true)).toHaveProperty('game');
    expect(await findCall(guildWith('vc1'), 'x', true)).toHaveProperty('error');
    expect(await findCall(guildWith('vc1'), 'x', false)).toHaveProperty('game');
    expect(await findCall(guildWith(null), 'a1', false)).toHaveProperty('error');
  });
});

describe('opening and closing a team voice channel', () => {
  test('open remembers how each role was set, then lets it join and talk', async () => {
    const vc = voiceChannel('vc1', { 'r-pugs': { allow: 0n, deny: PermissionsBitField.Flags.Connect } });
    const result = await openCall(context(vc), 'pugs');
    expect(result.ok).toBe(true);
    const saved = OpenCall.updateOne.mock.calls.at(-1)[1].$set.roles;
    expect(saved).toEqual([
      { id: 'r-pugs', allow: '0', deny: PermissionsBitField.Flags.Connect.toString() },
      { id: 'r-prem', allow: null, deny: null },
    ]);
    expect(vc.permissionOverwrites.edit).toHaveBeenCalledWith('r-prem', { ViewChannel: true, Connect: true, Speak: true }, expect.anything());
  });

  test('open says which roles still need picking', async () => {
    CallRoles.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    await CallRoleService.load('g');
    const result = await openCall(context(voiceChannel('vc1')), 'premium');
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('Call Roles');
  });

  test('close puts the roles back and moves out everyone not on the team or added', async () => {
    const vc = voiceChannel('vc1', { 'r-prem': { allow: PermissionsBitField.Flags.Connect, deny: 0n }, guest: { allow: PermissionsBitField.Flags.Connect, deny: 0n } });
    OpenCall.findOne.mockReturnValue({ lean: () => Promise.resolve({ roles: [{ id: 'r-prem', allow: null, deny: null }, { id: 'r-pugs', allow: '0', deny: PermissionsBitField.Flags.Connect.toString() }] }) });
    const teammate = inVoice('a2');
    const guest = inVoice('guest');
    const random = inVoice('random');
    vc.members.set('a2', teammate).set('guest', guest).set('random', random);
    const result = await closeCall(context(vc));
    expect(result.ok).toBe(true);
    expect(vc.permissionOverwrites.cache.has('r-prem')).toBe(false);
    expect(vc.permissionOverwrites.create).toHaveBeenCalledWith('r-pugs', { Connect: false }, expect.anything());
    expect(random.voice.disconnect).toHaveBeenCalled();
    expect(teammate.voice.disconnect).not.toHaveBeenCalled();
    expect(guest.voice.disconnect).not.toHaveBeenCalled();
    expect(OpenCall.deleteOne).toHaveBeenCalledWith({ channelId: 'vc1' });
  });

  test('close of a channel that is not open says so', async () => {
    expect(await closeCall(context(voiceChannel('vc1')))).toMatchObject({ ok: false });
  });

  test('restore turns saved permission bits back into overwrite settings', () => {
    expect(restoreOptions(PermissionsBitField.Flags.ViewChannel.toString(), PermissionsBitField.Flags.Speak.toString()))
      .toEqual({ ViewChannel: true, Speak: false });
    expect(staysOnClose('a1', ['a1'], false)).toBe(true);
    expect(staysOnClose('z', ['a1'], true)).toBe(true);
    expect(staysOnClose('z', ['a1'], false)).toBe(false);
  });
});

describe('adding, muting and removing one person', () => {
  test('--mute lets them in without talking, and unmute bounces them through the waiting room', async () => {
    const vc = voiceChannel('vc1');
    await addToCall(context(vc), 'guest', true);
    expect(vc.permissionOverwrites.create).toHaveBeenCalledWith('guest', expect.objectContaining({ Connect: true, Speak: false }));
    const guest = inVoice('guest');
    vc.members.set('guest', guest);
    const waiting = { id: 'pick', isVoiceBased: () => true };
    await unmuteInCall(context(vc, 'a1', waiting), 'guest');
    expect(vc.permissionOverwrites.edit).toHaveBeenCalledWith('guest', expect.objectContaining({ Speak: true }));
    expect(guest.voice.setChannel.mock.calls.map((c: any[]) => c[0].id)).toEqual(['pick', 'vc1']);
  });

  test('remove locks them out and moves them out, but never a teammate', async () => {
    const vc = voiceChannel('vc1');
    const guest = inVoice('guest');
    vc.members.set('guest', guest);
    await removeFromCall(context(vc), 'guest');
    expect(vc.permissionOverwrites.create).toHaveBeenCalledWith('guest', { ViewChannel: true, Connect: false });
    expect(guest.voice.disconnect).toHaveBeenCalled();
    expect(await removeFromCall(context(vc), 'a2')).toMatchObject({ ok: false });
  });
});

describe('in-game /call', () => {
  test('reads which action it is, old messages included', () => {
    expect(actionOf({ type: 'callcmd' })).toBe('add');
    expect(actionOf({ type: 'callremove' })).toBe('remove');
    expect(actionOf({ type: 'callcmd', action: 'OPEN' })).toBe('open');
    expect(actionOf({ type: 'callcmd', action: 'explode' })).toBeNull();
  });
});
