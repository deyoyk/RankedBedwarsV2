describe('server address setting', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  function load(): { serverip: string } {
    let cfg: { serverip: string } = { serverip: '' };
    jest.isolateModules(() => {
      cfg = require('../src/config/config').default;
    });
    return cfg;
  }

  test('MINECRAFT_SERVER_IP wins over the SERVER_IP that Pterodactyl sets to the machine address', () => {
    process.env.SERVER_IP = '139.180.187.162';
    process.env.MINECRAFT_SERVER_IP = 'vrbw.club';
    expect(load().serverip).toBe('vrbw.club');
  });

  test('SERVER_IP still works when MINECRAFT_SERVER_IP is not set', () => {
    process.env.SERVER_IP = 'rbw.example.net';
    delete process.env.MINECRAFT_SERVER_IP;
    expect(load().serverip).toBe('rbw.example.net');
  });
});
