import User from '../src/models/User';
import { clearPlayerDirectoryCache, getPlayerIgns } from '../src/utils/playerDirectory';
import { findInGamePlayerIds } from '../src/Matchmaking/utils';
import { WebSocketManager } from '../src/websocket/WebSocketManager';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

const UserModel = User as unknown as { find: jest.Mock };

function queryResult(rows: Array<{ discordId: string; ign?: string }>) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) }) };
}

describe('10k-player consolidation paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPlayerDirectoryCache();
    UserModel.find.mockReset();
    UserModel.find.mockResolvedValue(queryResult([]));
  });

  it('resolves 10k IGNs in bounded chunks and reuses the cache', async () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `user-${i}`);
    UserModel.find.mockImplementation((filter: any) => queryResult(
      (filter.discordId.$in as string[]).map(id => ({ discordId: id, ign: `ign-${id}` }))
    ));

    const first = await getPlayerIgns(ids);
    expect(first.size).toBe(10_000);
    expect(first.get('user-0')).toBe('ign-user-0');
    expect(first.get('user-9999')).toBe('ign-user-9999');
    expect(UserModel.find).toHaveBeenCalledTimes(20);

    const second = await getPlayerIgns(ids);
    expect(second.size).toBe(10_000);
    expect(UserModel.find).toHaveBeenCalledTimes(20);
  });

  it('caches missing users briefly instead of re-querying them', async () => {
    UserModel.find.mockImplementation(() => queryResult([]));

    expect((await getPlayerIgns(['missing'])).size).toBe(0);
    expect((await getPlayerIgns(['missing'])).size).toBe(0);
    expect(UserModel.find).toHaveBeenCalledTimes(1);
  });

  it('maps BedWars statuses for 10k players in one shared check', async () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `id-${i}`);
    const ignById = new Map(ids.map((id, i) => [id, `ign-${i}`]));
    const checkPlayers = jest.fn(async (igns: string[]) => new Map(
      igns.map(ign => [ign.toLowerCase(), { online: true, inGame: ign.endsWith('00') }])
    ));

    const inGame = await findInGamePlayerIds({ checkPlayers }, ids, ignById);

    expect(checkPlayers).toHaveBeenCalledTimes(1);
    expect(inGame.size).toBe(99);
    expect(inGame.has('id-100')).toBe(true);
    expect(inGame.has('id-0')).toBe(false);
    expect(inGame.has('id-9999')).toBe(false);
  });

  it('batches 1k bulk player checks into four websocket requests', async () => {
    const manager: any = Object.create(WebSocketManager.prototype);
    const sent: any[] = [];
    manager.isConnected = () => true;
    manager.bedwarsCheckCallbacks = new Map();
    manager.send = (payload: any) => {
      sent.push(payload);
      setImmediate(() => manager.handleBedwarsPlayersStatus({
        type: 'bedwars_players_status',
        request_id: payload.request_id,
        players: Object.fromEntries(payload.igns.map((ign: string) => [ign, ign.endsWith('0')])),
        online: Object.fromEntries(payload.igns.map((ign: string) => [ign, true])),
      }));
    };

    const igns = Array.from({ length: 1000 }, (_, i) => `Player${i}`);
    const statuses = await manager.checkPlayers(igns);

    expect(sent).toHaveLength(4);
    expect(sent.every(payload => payload.igns.length <= 250)).toBe(true);
    expect(statuses.size).toBe(1000);
    expect(statuses.get('player0')).toEqual({ online: true, inGame: true });
    expect(statuses.get('player1')).toEqual({ online: true, inGame: false });
  });

  it('serves leaderboard requests over the existing websocket', async () => {
    const manager: any = Object.create(WebSocketManager.prototype);
    manager.send = jest.fn();
    UserModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([{ ign: 'Steve', elo: 890 }])
            })
          })
        })
      })
    });

    await manager.handleLeaderboardRequest({
      type: 'leaderboard_request',
      request_id: 'lb-1',
      mode: 'elo',
      page: 1
    });

    expect(manager.send).toHaveBeenCalledWith({
      type: 'leaderboard_data',
      request_id: 'lb-1',
      entries: { '1': { ign: 'Steve', value: 890 } }
    });
  });

  it('returns no bulk statuses when the Minecraft link is down', async () => {
    const manager: any = Object.create(WebSocketManager.prototype);
    manager.isConnected = () => false;
    manager.send = jest.fn();

    expect(await manager.checkPlayers(['Steve'])).toEqual(new Map());
    expect(manager.send).not.toHaveBeenCalled();
  });
});
