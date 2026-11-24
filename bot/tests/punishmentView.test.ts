jest.mock('../src/models/User', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/models/StrikeRules', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/utils/safeReply', () => ({ safeReply: jest.fn() }));

import { buildPunishmentView, formatMinutes, loadCurrent, nextStrikeText, punishment } from '../src/commands/moderation/punishment';

const User = require('../src/models/User').default;
const { safeReply } = require('../src/utils/safeReply');

const RULES = { rules: [{ strikes: 3, action: '1d' }, { strikes: 4, action: '3d' }, { strikes: 5, action: 'perm' }], otherwise: 'warn' };
const day = new Date('2026-11-20T12:00:00Z');

const findReturns = (doc: unknown) => User.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(doc) }) });
const json = (current: Parameters<typeof buildPunishmentView>[0]) => buildPunishmentView(current, RULES).toJSON();
const everything = (data: ReturnType<typeof json>) => JSON.stringify(data);

beforeEach(() => {
  safeReply.mockReset();
});

describe('/punishment view', () => {
  test('writes durations the way people say them', () => {
    expect(formatMinutes(0)).toBe('Permanent');
    expect(formatMinutes(60 * 12)).toBe('12 hours');
    expect(formatMinutes(60 * 24 * 7)).toBe('1 week');
    expect(formatMinutes(60 * 30)).toBe('1 day 6 hours');
    expect(formatMinutes(45)).toBe('45 minutes');
  });

  test('says when there is nothing, in the brand colour', () => {
    const data = json({ ban: null, mute: null, strikes: [] });
    expect(data.description).toContain('You have no active punishments');
    expect(data.fields ?? []).toHaveLength(0);
    expect(data.color).toBe(0x00aaaa);
  });

  test('a ban shows its reason, duration and end, but never who gave it', () => {
    const data = json({ ban: { reason: 'Cheating', date: day, duration: 60 * 24 * 7 }, mute: null, strikes: [] });
    expect(data.fields?.[0].name).toBe('🔨 Ranked ban');
    expect(data.fields?.[0].value).toContain('**Reason:** Cheating');
    expect(data.fields?.[0].value).toContain('`1 week`');
    expect(data.fields?.[0].value).toContain(`<t:${day.getTime() / 1000 + 7 * 86400}:R>`);
    expect(data.color).toBe(0xed4245);
  });

  test('a permanent mute never ends', () => {
    const data = json({ ban: null, mute: { reason: 'Toxic', date: day, duration: 0 }, strikes: [] });
    expect(data.fields?.[0].name).toBe('🔇 Mute');
    expect(data.fields?.[0].value).toContain('`Permanent`');
    expect(data.fields?.[0].value).toContain('**Ends:** Never');
  });

  test('strikes alone are amber, listed with dates and what the next one does', () => {
    const data = json({ ban: null, mute: null, strikes: [{ reason: 'Left early', date: day }, { reason: 'No score', date: day }] });
    expect(data.color).toBe(0xf0b232);
    expect(data.fields?.[0].name).toBe('⚠️ Strikes (2)');
    expect(data.fields?.[0].value).toContain('**1.** Left early');
    expect(data.fields?.[0].value).toContain('**2.** No score');
    expect(data.fields?.[0].value).toContain('next strike means a **1 day ban**');
  });

  test('the next-strike line follows the strike rules', () => {
    expect(nextStrikeText(1, RULES)).toBeNull();
    expect(nextStrikeText(2, RULES)).toContain('1 day ban');
    expect(nextStrikeText(3, RULES)).toContain('3 day ban');
    expect(nextStrikeText(4, RULES)).toContain('permanent ban');
  });

  test('everything together: ban, then mute, then strikes', () => {
    const data = json({
      ban: { reason: 'Cheating', date: day, duration: 0 },
      mute: { reason: 'Toxic', date: day, duration: 720 },
      strikes: [{ reason: 'Left early', date: day }],
    });
    expect(data.fields?.map(f => f.name)).toEqual(['🔨 Ranked ban', '🔇 Mute', '⚠️ Strikes (1)']);
    expect(data.color).toBe(0xed4245);
  });

  test('a long strike list keeps to the newest ten and still counts them all', () => {
    const strikes = Array.from({ length: 14 }, (_, i) => ({ reason: `s${i + 1}`, date: day }));
    const field = json({ ban: null, mute: null, strikes }).fields?.[0];
    expect(field?.name).toBe('⚠️ Strikes (14)');
    expect(field?.value).toContain('4 older');
    expect(field?.value).toContain('**14.** s14');
    expect(field?.value).not.toContain('**4.** s4');
  });

  test('only the active ban and mute count, and staff names are left out', async () => {
    findReturns({
      isBanned: false, isMuted: true,
      bans: [{ reason: 'old', date: day, duration: 60, moderator: '999' }],
      mutes: [{ reason: 'first', date: day, duration: 60, moderator: '999' }, { reason: 'now', date: day, duration: 60, moderator: '999' }],
      strikes: [],
    });
    const current = await loadCurrent('5');
    expect(current?.ban).toBeNull();
    expect(current?.mute?.reason).toBe('now');
    expect(everything(buildPunishmentView(current!, RULES).toJSON())).not.toContain('999');
  });

  test('shows the caller their own punishments, privately', async () => {
    findReturns({ isBanned: false, isMuted: false, strikes: [] });
    await punishment({ user: { id: '42' } } as any);
    expect(User.findOne).toHaveBeenCalledWith({ discordId: '42' });
    expect(safeReply.mock.calls[0][1].flags).toBe(64);
  });

  test('an unregistered caller is told so', async () => {
    findReturns(null);
    await punishment({ user: { id: '42' } } as any);
    expect(safeReply.mock.calls[0][1].embeds[0].toJSON().description).toContain("aren't registered");
  });
});
