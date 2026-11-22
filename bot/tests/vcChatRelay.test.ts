import { relayText } from '../src/services/VcChatRelay';

describe('VC chat relay', () => {
  test('only a message starting with - goes to the game, without the dash', () => {
    expect(relayText('-yeah', true)).toBe('yeah');
    expect(relayText('  - gg wp ', true)).toBe('gg wp');
    expect(relayText('yeah', true)).toBeNull();
  });

  test('nothing goes through from someone not in the voice channel', () => {
    expect(relayText('-yeah', false)).toBeNull();
  });

  test('an empty dash or a too long message is handled', () => {
    expect(relayText('-', true)).toBeNull();
    expect(relayText('-' + 'a'.repeat(300), true)).toHaveLength(200);
  });
});
