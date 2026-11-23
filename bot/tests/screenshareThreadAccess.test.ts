import { PermissionFlagsBits } from 'discord.js';
import { isTargetThreadAccess, screenshareThreadPing, TARGET_THREAD_ACCESS } from '../src/services/screenshareAccess';

describe('screenshare thread access', () => {
  test('the thread ping mentions the SS team role and the target so Discord adds both', () => {
    const ping = screenshareThreadPing('role-1', 'user-9');
    expect(ping.content).toBe('<@&role-1> <@user-9>');
    expect(ping.allowedMentions).toEqual({ roles: ['role-1'], users: ['user-9'] });
  });

  test('without an SS team role only the target is pinged', () => {
    expect(screenshareThreadPing(undefined, 'user-9')).toEqual({ content: '<@user-9>', allowedMentions: { roles: [], users: ['user-9'] } });
  });

  test('the target may read the request channel and reply in threads, but not post in the channel', () => {
    expect(TARGET_THREAD_ACCESS.ViewChannel).toBe(true);
    expect(TARGET_THREAD_ACCESS.SendMessagesInThreads).toBe(true);
    expect(TARGET_THREAD_ACCESS.SendMessages).toBe(false);
  });

  test('only the access the bot gave is recognised for removal', () => {
    const allow = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessagesInThreads | PermissionFlagsBits.ReadMessageHistory;
    expect(isTargetThreadAccess(allow, PermissionFlagsBits.SendMessages)).toBe(true);
    expect(isTargetThreadAccess(allow | PermissionFlagsBits.AttachFiles, PermissionFlagsBits.SendMessages)).toBe(false);
    expect(isTargetThreadAccess(PermissionFlagsBits.ViewChannel, 0n)).toBe(false);
  });
});
