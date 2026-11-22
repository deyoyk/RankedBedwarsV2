import { PermissionFlagsBits } from 'discord.js';
import { teamVoiceOverwrites } from '../src/Matchmaking/teamVoice';

describe('team voice channel permissions', () => {
  const overwrites = teamVoiceOverwrites('everyone', ['p1', 'p2']);

  test('everyone can see the channel but cannot join it', () => {
    const everyone = overwrites.find(o => o.id === 'everyone')!;
    expect(everyone.allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(everyone.deny).toContain(PermissionFlagsBits.Connect);
    expect(everyone.deny).not.toContain(PermissionFlagsBits.ViewChannel);
  });

  test('the game players can join and talk', () => {
    for (const id of ['p1', 'p2']) {
      const o = overwrites.find(x => x.id === id)!;
      expect(o.allow).toEqual(expect.arrayContaining([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]));
    }
  });
});
