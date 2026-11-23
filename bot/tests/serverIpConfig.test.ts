import { resolveServerIp } from '../src/config/config';

describe('server address setting', () => {
  test('MINECRAFT_SERVER_IP wins over the SERVER_IP that Pterodactyl sets to the machine address', () => {
    expect(resolveServerIp(
      { SERVER_IP: '203.0.113.10', MINECRAFT_SERVER_IP: 'vrbw.club' },
      {}
    )).toBe('vrbw.club');
  });

  test('.env SERVER_IP wins over the machine SERVER_IP Pterodactyl injects', () => {
    expect(resolveServerIp(
      { SERVER_IP: '203.0.113.10' },
      { SERVER_IP: 'vrbw.club' }
    )).toBe('vrbw.club');
  });

  test('falls back to the process SERVER_IP when there is no .env value', () => {
    expect(resolveServerIp({ SERVER_IP: 'rbw.example.net' }, {})).toBe('rbw.example.net');
  });

  test('uses the default when nothing is configured', () => {
    expect(resolveServerIp({}, {})).toBe('play.deyo.lol');
  });
});
