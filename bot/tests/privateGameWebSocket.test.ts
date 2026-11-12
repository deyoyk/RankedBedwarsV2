const mockStartPrivateGame = jest.fn();

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn() },
}));
jest.mock('../src/services/PrivateGameService', () => ({
  __esModule: true,
  PrivateGameService: {
    startPrivateGame: (...args: unknown[]) => mockStartPrivateGame(...args),
  },
}));

import User from '../src/models/User';
import { WebSocketManager } from '../src/websocket/WebSocketManager';

const UserModel = User as unknown as { findOne: jest.Mock };
const servers: Array<{ close: (cb?: () => void) => void }> = [];
const managers: any[] = [];

function userChain(user: any) {
  return {
    collation: () => ({
      select: () => ({
        lean: async () => user,
      }),
    }),
  };
}

async function makeWs() {
  const guild = { id: 'guild-1' };
  const discordClient: any = { guilds: { cache: { first: () => guild } } };
  const ws = new WebSocketManager(0, discordClient);
  (ws as any).send = jest.fn();
  managers.push(ws);
  const server = (ws as any).server;
  if (server && typeof server.close === 'function') servers.push(server);
  return { ws: ws as any, guild };
}

function sent(ws: any) {
  return (ws.send as jest.Mock).mock.calls.map(call => call[0]);
}

describe('private game websocket bridge', () => {
  beforeEach(() => jest.clearAllMocks());

  afterAll(() => {
    for (const manager of managers) {
      try { manager.shutdown?.(); } catch {  }
    }
    for (const server of servers) {
      try { server.close(); } catch {  }
    }
  });

  it('starts a private game and acknowledges the request', async () => {
    const { ws } = await makeWs();
    UserModel.findOne.mockReturnValue(userChain({ discordId: 'u1', ign: 'Steve' }));
    mockStartPrivateGame.mockResolvedValue({ success: true, map: 'Quad' });

    await (ws as any).handlePrivateFromInGame({ ign: 'Steve', uuid: 'req-1', map: 'Quad' });

    expect(mockStartPrivateGame).toHaveBeenCalledWith('u1', ws, { map: 'Quad' });
    expect(sent(ws)).toContainEqual({
      type: 'privatefromingame_success',
      uuid: 'req-1',
      map: 'Quad',
    });
  });

  it('forwards a clear failure reason to Minecraft', async () => {
    const { ws } = await makeWs();
    UserModel.findOne.mockReturnValue(userChain({ discordId: 'u1', ign: 'Steve' }));
    mockStartPrivateGame.mockResolvedValue({ success: false, message: 'Not party leader' });

    await (ws as any).handlePrivateFromInGame({ ign: 'Steve', uuid: 'req-2' });

    expect(sent(ws)).toContainEqual({
      type: 'privatefromingame_fail',
      reason: 'Not party leader',
      uuid: 'req-2',
    });
  });

  it('rejects unknown players before creating anything', async () => {
    const { ws } = await makeWs();
    UserModel.findOne.mockReturnValue(userChain(null));

    await (ws as any).handlePrivateFromInGame({ ign: 'Nobody', uuid: 'req-3' });

    expect(mockStartPrivateGame).not.toHaveBeenCalled();
    expect(sent(ws)).toContainEqual({
      type: 'privatefromingame_fail',
      reason: 'User not found in database',
      uuid: 'req-3',
    });
  });
});

describe('host_private_game', () => {
  afterAll(() => {
    for (const manager of managers) {
      try { manager.shutdown?.(); } catch {  }
    }
  });

  async function linked() {
    const { ws } = await makeWs();
    ws.isConnected = () => true;
    return ws;
  }

  it('says the server is offline without sending anything', async () => {
    const { ws } = await makeWs();
    await expect(ws.hostPrivateGame({ players: ['A', 'B'] })).resolves.toMatchObject({ ok: false, message: 'The Minecraft server is offline.' });
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('sends the party and returns the server answer', async () => {
    const ws = await linked();
    const pending = ws.hostPrivateGame({ players: ['A', 'B', 'C'] });
    const request = sent(ws)[0];
    expect(request).toMatchObject({ type: 'host_private_game', map: 'random', players: ['A', 'B', 'C'] });
    expect(request.teams).toBeUndefined();

    await ws.handleMessage(JSON.stringify({
      type: 'host_private_game_result', request_id: request.request_id, ok: true,
      message: 'Hosting on Quad', map: 'Quad', players: ['A', 'B'], missing: ['C'],
    }));
    await expect(pending).resolves.toEqual({ ok: true, message: 'Hosting on Quad', map: 'Quad', players: ['A', 'B'], missing: ['C'] });
  });

  it('sends duel teams instead of players', async () => {
    const ws = await linked();
    void ws.hostPrivateGame({ map: 'Duo', teams: [['A'], ['B']] });
    const request = sent(ws)[0];
    expect(request).toMatchObject({ map: 'Duo', teams: [['A'], ['B']] });
    expect(request.players).toBeUndefined();
  });

  it('gives up when the server never answers', async () => {
    const ws = await linked();
    await expect(ws.hostPrivateGame({ players: ['A', 'B'] }, 10)).resolves.toMatchObject({ ok: false, message: expect.stringContaining("didn't answer") });
  });

  it('fails waiting requests when the server disconnects', async () => {
    const ws = await linked();
    const pending = ws.hostPrivateGame({ players: ['A', 'B'] });
    ws.failHostPrivateRequests();
    await expect(pending).resolves.toMatchObject({ ok: false, message: 'The Minecraft server disconnected.' });
  });
});
