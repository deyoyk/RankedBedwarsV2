jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn() },
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

import User from '../src/models/User';
import EloRank from '../src/models/EloRank';
import { WebSocketManager } from '../src/websocket/WebSocketManager';

const UserModel = User as unknown as { findOne: jest.Mock };
const RankModel = EloRank as unknown as { find: jest.Mock };
const managers: any[] = [];

function makeWs() {
  const roles = new Map([['gold', { name: 'Gold', color: 0xffaa00, hexColor: '#ffaa00', iconURL: () => null }]]);
  const guild = { roles: { cache: roles } };
  const ws: any = new WebSocketManager(0, { guilds: { cache: { first: () => guild } } } as any);
  ws.send = jest.fn();
  managers.push(ws);
  return ws;
}

describe('stats_request', () => {
  afterAll(() => {
    for (const m of managers) {
      try { m.shutdown?.(); } catch { }
      try { m.server?.close?.(); } catch { }
    }
  });

  it('sends the player rank with their stats', async () => {
    UserModel.findOne.mockReturnValue({ collation: () => ({ lean: async () => ({ _id: 'x', ign: 'Steve', elo: 250, wins: 4 }) }) });
    RankModel.find.mockReturnValue({ lean: async () => [{ roleId: 'gold', startElo: 200, endElo: 399, winElo: 25 }] });
    const ws = makeWs();
    await ws.handleStatsRequest({ type: 'stats_request', ign: 'Steve', request_id: 'r1' });
    const reply = ws.send.mock.calls[0][0];
    expect(reply.data._id).toBeUndefined();
    expect(reply.data.wins).toBe(4);
    expect(reply.data.rank).toMatchObject({ name: 'Gold', color: '#ffaa00', start: 200, next: null });
  });

  it('still sends the stats when the ranks cannot be read', async () => {
    UserModel.findOne.mockReturnValue({ collation: () => ({ lean: async () => ({ ign: 'Steve', elo: 10 }) }) });
    RankModel.find.mockImplementation(() => { throw new Error('db down'); });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const ws = makeWs();
    await ws.handleStatsRequest({ type: 'stats_request', ign: 'Steve', request_id: 'r2' });
    expect(ws.send.mock.calls[0][0].data).toMatchObject({ ign: 'Steve', elo: 10 });
  });
});
