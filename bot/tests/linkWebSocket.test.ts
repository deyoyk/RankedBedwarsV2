jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn() },
}));

import User from '../src/models/User';
import { WebSocketManager } from '../src/websocket/WebSocketManager';
import { linkCodes } from '../src/services/LinkCodes';

const UserModel = User as unknown as { findOne: jest.Mock };
const managers: any[] = [];

function owner(value: unknown) {
  return { collation: () => ({ select: () => ({ lean: async () => value }) }) };
}

function makeWs() {
  const ws: any = new WebSocketManager(0, { guilds: { cache: { first: () => ({ id: 'g1' }) } } } as any);
  ws.send = jest.fn();
  managers.push(ws);
  return ws;
}

describe('/link in game', () => {
  beforeEach(() => jest.clearAllMocks());

  afterAll(() => {
    for (const manager of managers) {
      try { manager.shutdown?.(); } catch { }
      try { manager.server?.close?.(); } catch { }
    }
  });

  it('answers with a code that /link on Discord accepts for that name', async () => {
    const ws = makeWs();
    UserModel.findOne.mockReturnValue(owner(null));

    await ws.handleLinkRequest({ type: 'link_request', uuid: 'r1', ign: 'Steve' });

    const [reply] = ws.send.mock.calls[0];
    expect(reply).toMatchObject({ type: 'link_code', uuid: 'r1', ign: 'Steve', expires_in: 300 });
    expect(linkCodes.claim(reply.code, 'u1')).toEqual({ ign: 'Steve' });
  });

  it('turns down a name that is already linked', async () => {
    const ws = makeWs();
    UserModel.findOne.mockReturnValue(owner({ _id: 'x' }));

    await ws.handleLinkRequest({ type: 'link_request', uuid: 'r1', ign: 'Steve' });

    expect(ws.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'link_code_fail', uuid: 'r1' }));
  });

  it('turns down a name that is not a Minecraft name', async () => {
    const ws = makeWs();

    await ws.handleLinkRequest({ type: 'link_request', uuid: 'r1', ign: 'no spaces allowed' });

    expect(UserModel.findOne).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'link_code_fail', uuid: 'r1' }));
  });
});
