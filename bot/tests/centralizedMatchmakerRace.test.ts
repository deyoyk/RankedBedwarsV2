import { CentralizedMatchmaker } from '../src/Matchmaking/CentralizedMatchmaker';
import { queuePlayers } from '../src/types/queuePlayersMemory';

jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() }
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), updateOne: jest.fn().mockResolvedValue({}) }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({})
  }
}));
jest.mock('../src/models/Counter', () => ({
  getNextSequence: jest.fn().mockResolvedValue(100),
  Counter: {}
}));
jest.mock('../src/models/Party', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/Matchmaking/utils', () => ({
  calculateTeamAverageElo: jest.fn().mockResolvedValue(1000),
  selectRandomMap: jest.fn().mockResolvedValue('Aquarius'),
  getPlayerIGNs: jest.fn().mockResolvedValue(new Map())
}));
jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: {
    getInstance: () => ({
      createChannel: jest.fn().mockResolvedValue({ id: 'ch' }),
      deleteChannel: jest.fn().mockResolvedValue(undefined),
      moveMembers: jest.fn().mockResolvedValue([]),
      setMemberNickname: jest.fn().mockResolvedValue(undefined),
      updateMemberRoles: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn().mockResolvedValue(undefined)
    })
  }
}));

const QueueModel = require('../src/models/Queue').default;
const UserModel = require('../src/models/User').default;

const wsManagerMock: any = {
  send: jest.fn(),
  setGlobalHandler: jest.fn(),
  checkPlayerOnline: jest.fn().mockResolvedValue({ online: true })
};

const gameManagerMock: any = {
  activeGames: new Map(),
  getActiveGameCount: jest.fn().mockReturnValue(0),
  getNextGameId: jest.fn(),
  createGame: jest.fn(),
  initiateGameWarp: jest.fn().mockResolvedValue(undefined),
  updateGameMap: jest.fn().mockResolvedValue(undefined),
  cleanup: jest.fn()
};

const clientMock: any = {
  guilds: { cache: { first: jest.fn().mockReturnValue(undefined) } },
  channels: { cache: { get: jest.fn().mockReturnValue(undefined) } }
};

function makeQueue(channelId: string, maxPlayers = 4) {
  return {
    channelId,
    maxPlayers,
    minElo: 0,
    maxElo: 99999,
    isRanked: true,
    ispicking: false,
    bypassRoles: [],
    isActive: true
  };
}

function makeUser(id: string) {
  return {
    discordId: id,
    ign: id,
    elo: 1000 + parseInt(id.slice(1), 10) % 100,
    partyId: null,
    isbanned: false,
    isfrozen: false
  };
}

let gameIdCounter = 1000;
const createdGames: Array<{ id: number; t1: string[]; t2: string[] }> = [];
let userLookupDelay = 0;

function mockQueueQuery(docs: any[]): any {
  const query: any = { lean: async () => docs };
  query.then = (resolve: any, reject?: any) => Promise.resolve(docs).then(resolve, reject);
  return query;
}

function mockQueueOneQuery(queue: any): any {
  const query: any = { lean: async () => queue };
  query.then = (resolve: any, reject?: any) => Promise.resolve(queue).then(resolve, reject);
  return query;
}

function mockUserQuery(resolveDocs: () => any[]): any {
  const chain: any = {};
  chain.select = () => chain;
  chain.lean = async () => resolveDocs();
  chain.then = (resolve: any, reject?: any) => Promise.resolve(resolveDocs()).then(resolve, reject);
  return chain;
}

function mockUserOneQuery(resolveDoc: () => any): any {
  const chain: any = {};
  chain.select = () => chain;
  chain.lean = async () => resolveDoc();
  chain.then = (resolve: any, reject?: any) => Promise.resolve(resolveDoc()).then(resolve, reject);
  return chain;
}

function resetState(players: string[], queue: any) {
  queuePlayers.clear();
  queuePlayers.set(queue.channelId, [...players]);
  createdGames.length = 0;
  gameIdCounter = 1000;
  userLookupDelay = 0;

  QueueModel.findOne.mockImplementation(() => mockQueueOneQuery(queue));
  QueueModel.find.mockImplementation(() => mockQueueQuery([queue]));

  const userMap = new Map(players.map(p => [p, makeUser(p)]));
  const resolveIds = (filter: any): string[] => {
    const discordId = filter?.discordId;
    if (Array.isArray(discordId)) return discordId;
    if (discordId && Array.isArray(discordId.$in)) return discordId.$in;
    return discordId ? [discordId] : [];
  };
  UserModel.find.mockImplementation((filter: any) =>
    mockUserQuery(() => resolveIds(filter).map((id: string) => userMap.get(id)!).filter(Boolean))
  );
  UserModel.findOne.mockImplementation(({ discordId }: any) =>
    mockUserOneQuery(async () => {
      if (userLookupDelay > 0) {
        await new Promise(r => setTimeout(r, userLookupDelay));
      }
      return userMap.get(discordId) || null;
    })
  );

  gameManagerMock.getNextGameId.mockImplementation(async () => ++gameIdCounter);
  gameManagerMock.createGame.mockImplementation(async (gameId: number, _q: any, team1: string[], team2: string[], _map: string) => {
    createdGames.push({ id: gameId, t1: [...team1], t2: [...team2] });
    await new Promise(r => setTimeout(r, 5));
    return { gameId };
  });
}

describe('CentralizedMatchmaker race conditions', () => {
  const matchmakers: CentralizedMatchmaker[] = [];

  function makeMatchmaker(): CentralizedMatchmaker {
    const mm = new CentralizedMatchmaker(clientMock, wsManagerMock, gameManagerMock);
    matchmakers.push(mm);
    return mm;
  }

  afterEach(() => {
    for (const mm of matchmakers) {
      mm.cleanup();
    }
    matchmakers.length = 0;
    queuePlayers.clear();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    queuePlayers.clear();
  });

  it('concurrent processQueue calls for the same queue only process once', async () => {
    const queue = makeQueue('queue-A');
    const players = ['p1', 'p2', 'p3', 'p4'];
    resetState(players, queue);
    const matchmaker = makeMatchmaker();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => matchmaker.processQueue('queue-A'))
    );

    const successes = results.filter(r => r.status === 'fulfilled');
    const earlyExits = results.filter(r => r.status === 'fulfilled' &&
      (r.value as any).errors?.[0] === 'Queue already being processed');

    expect(successes.length).toBe(10);
    expect(earlyExits.length).toBe(9);
    expect(gameManagerMock.createGame).toHaveBeenCalledTimes(1);
    expect(createdGames).toHaveLength(1);
    expect(createdGames[0].t1).toHaveLength(2);
    expect(createdGames[0].t2).toHaveLength(2);
  });

  it('players are never assigned to two games across a full queue flush', async () => {
    const queue = makeQueue('queue-B', 4);
    const players = Array.from({ length: 16 }, (_, i) => `p${i}`);
    resetState(players, queue);
    const matchmaker = makeMatchmaker();

    const result = await matchmaker.processQueue('queue-B');

    expect(result.success).toBe(true);
    expect(result.gamesCreated).toBe(4);
    expect(createdGames).toHaveLength(4);

    const allAssigned = createdGames.flatMap(g => [...g.t1, ...g.t2]);
    expect(allAssigned).toHaveLength(16);
    expect(new Set(allAssigned).size).toBe(16);

    const remaining = queuePlayers.get('queue-B') || [];
    expect(remaining).toHaveLength(0);
  }, 30000);

  it('many concurrent game creations never double-assign players', async () => {
    const queue = makeQueue('queue-C', 4);
    const players = Array.from({ length: 40 }, (_, i) => `q${i}`);
    resetState(players, queue);
    const matchmaker = makeMatchmaker();

    const result = await matchmaker.processQueue('queue-C');

    expect(result.gamesCreated).toBe(10);
    const allAssigned = createdGames.flatMap(g => [...g.t1, ...g.t2]);
    expect(allAssigned).toHaveLength(40);
    expect(new Set(allAssigned).size).toBe(40);

    const remaining = queuePlayers.get('queue-C') || [];
    expect(remaining).toHaveLength(0);
  }, 30000);

  it('players who join while validation is running are not lost', async () => {
    const queue = makeQueue('queue-D');
    const players = ['a1', 'a2', 'a3', 'a4'];
    resetState(players, queue);
    userLookupDelay = 40;
    const matchmaker = makeMatchmaker();

    const processing = matchmaker.processQueue('queue-D');
    await new Promise(r => setTimeout(r, 10));
    queuePlayers.set('queue-D', [...queuePlayers.get('queue-D')!, 'lateJoiner']);
    await processing;

    const after = queuePlayers.get('queue-D') || [];
    expect(after).toContain('lateJoiner');
    expect(gameManagerMock.createGame).toHaveBeenCalledTimes(1);
  });

  it('queues remain independent under concurrent load', async () => {
    const queueA = makeQueue('queue-E', 4);
    const queueB = makeQueue('queue-F', 4);
    const playersA = ['x1', 'x2', 'x3', 'x4'];
    const playersB = ['y1', 'y2', 'y3', 'y4'];

    queuePlayers.set(queueA.channelId, [...playersA]);
    queuePlayers.set(queueB.channelId, [...playersB]);
    createdGames.length = 0;
    gameIdCounter = 1000;

    QueueModel.findOne.mockImplementation((filter: any) =>
      mockQueueOneQuery(filter.channelId === queueA.channelId ? queueA : queueB)
    );

    const userMap = new Map([...playersA, ...playersB].map(p => [p, makeUser(p)]));
    const resolveIds = (filter: any): string[] => {
      const discordId = filter?.discordId;
      if (Array.isArray(discordId)) return discordId;
      if (discordId && Array.isArray(discordId.$in)) return discordId.$in;
      return discordId ? [discordId] : [];
    };
    UserModel.find.mockImplementation((filter: any) =>
      mockUserQuery(() => { const ids = resolveIds(filter); if (ids.length > 0 && !userMap.has(ids[0])) { console.log('DEBUG missing user', ids[0]); } return ids.map((id: string) => userMap.get(id)!).filter(Boolean); })
    );
    UserModel.findOne.mockImplementation(({ discordId }: any) =>
      mockUserOneQuery(() => userMap.get(discordId) || null)
    );
    gameManagerMock.getNextGameId.mockImplementation(async () => ++gameIdCounter);
    gameManagerMock.createGame.mockImplementation(async (gameId: number, _q: any, team1: string[], team2: string[]) => {
      createdGames.push({ id: gameId, t1: [...team1], t2: [...team2] });
      return { gameId };
    });

    const matchmaker = makeMatchmaker();

    const [resultA, resultB] = await Promise.all([
      matchmaker.processQueue('queue-E'),
      matchmaker.processQueue('queue-F')
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
    expect(createdGames).toHaveLength(2);

    const playersInA = createdGames[0];
    const playersInB = createdGames[1];
    const aSet = new Set([...playersInA.t1, ...playersInA.t2]);
    const bSet = new Set([...playersInB.t1, ...playersInB.t2]);
    for (const id of aSet) {
      expect(bSet.has(id)).toBe(false);
    }
  });
});

