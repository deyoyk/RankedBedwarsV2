import { GameManager } from '../src/Matchmaking/GameManager';

jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: { getInstance: jest.fn().mockReturnValue({}) },
}));

function makeManager() {
  const ws: any = { setGlobalHandler: jest.fn(), send: jest.fn() };
  const client: any = {};
  return new GameManager(client, ws);
}

describe('createGame team validation', () => {
  it('rejects duplicate inside a team', async () => {
    const gm = makeManager();
    await expect(gm.createGame(1, { maxPlayers: 4 }, ['a', 'a'], ['b', 'c'], 'Map')).rejects.toThrow('Duplicate players inside a team');
  });
  it('rejects player on both teams', async () => {
    const gm = makeManager();
    await expect(gm.createGame(2, { maxPlayers: 4 }, ['a', 'b'], ['b', 'c'], 'Map')).rejects.toThrow('Player cannot be on both teams');
  });
  it('rejects teams not matching queue size', async () => {
    const gm = makeManager();
    await expect(gm.createGame(3, { maxPlayers: 8 }, ['a', 'b'], ['c', 'd'], 'Map')).rejects.toThrow('Teams must match queue size 8');
  });
  it('rejects unequal teams', async () => {
    const gm = makeManager();
    await expect(gm.createGame(4, null, ['a'], ['b', 'c'], 'Map')).rejects.toThrow('Teams must be equal size');
  });
});

describe('setup merge', () => {
  it('setup script merges without overwrite', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rbw-setup-'));
    fs.writeFileSync(path.join(tmp, '.env.example'), 'A=1\nB=2\nAUTH_KEY=change_me_in_production\n');
    fs.writeFileSync(path.join(tmp, '.env'), 'A=custom\n');
    const setupPath = path.join(__dirname, '..', 'scripts', 'setup.cjs');
    expect(fs.existsSync(setupPath)).toBe(true);
  });
});
