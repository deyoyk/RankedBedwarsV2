import { RandomQueueManager } from '../src/Matchmaking/RandomQueueManager';
import { GameManager } from '../src/Matchmaking/GameManager';

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({})
  }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({})
  }
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: jest.fn() }
}));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: {} }));
jest.mock('../src/models/Counter', () => ({
  getNextSequence: jest.fn().mockResolvedValue(100),
  Counter: {}
}));
jest.mock('../src/Matchmaking/utils', () => ({
  calculateTeamAverageElo: jest.fn().mockResolvedValue(0),
  selectRandomMap: jest.fn().mockResolvedValue('LoadArena'),
  getPlayerIGNs: jest.fn().mockResolvedValue(new Map())
}));
jest.mock('../src/utils/scoreImage', () => ({
  generateScoreImageBuffer: jest.fn().mockResolvedValue(null)
}));
jest.mock('../src/utils/fix', () => ({
  fix: jest.fn().mockResolvedValue(undefined),
  safeFix: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../src/utils/userStats', () => ({
  updateDailyElo: jest.fn(),
  ensureUserStats: jest.fn(),
  resetUserStats: jest.fn(),
  computeWlr: (w: number, l: number) => (l > 0 ? w / l : w)
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

const GameModel = require('../src/models/Game').default;
const UserModel = require('../src/models/User').default;
const EloRankModel = require('../src/models/EloRank').default;

const PLAYER_COUNT = 1000;
const GAME_SIZE = 8;
const GAME_COUNT = PLAYER_COUNT / GAME_SIZE;
const BASE_GAME_ID = 50000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPool() {
  const rand = mulberry32(1337);
  const pool: any[] = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    const id = `load-${String(i).padStart(4, '0')}`;
    pool.push({
      discordId: id,
      ign: id.toUpperCase(),
      partyId: null,
      elo: 200 + Math.floor(rand() * 2800),
      wins: 0, losses: 0, games: 0, mvps: 0,
      kills: 0, deaths: 0, finalKills: 0, finalDeaths: 0, bedBroken: 0,
      diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0,
      playtimeSeconds: 0, peakElo: 0, kdr: 0, wlr: 0,
      winstreak: 0, losestreak: 0, experience: 0, level: 1,
      recentGames: [], dailyElo: [],
      save: jest.fn().mockResolvedValue(undefined)
    });
  }
  for (let g = 0; g < GAME_COUNT; g++) {
    const members = pool.slice(g * GAME_SIZE, g * GAME_SIZE + GAME_SIZE);
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [members[i], members[j]] = [members[j], members[i]];
    }
    members[0].partyId = `load-party-${g}-a`;
    members[1].partyId = `load-party-${g}-a`;
    members[2].partyId = `load-party-${g}-b`;
    members[3].partyId = `load-party-${g}-b`;
  }
  return pool;
}

const pool = buildPool();
const docs = new Map<number, any>();
const claimed = new Set<number>();

UserModel.find.mockImplementation((query: any) => {
  const ids = query?.discordId?.$in;
  const rows = ids ? pool.filter(p => ids.includes(p.discordId)) : [...pool];
  const chain: any = {};
  chain.select = () => chain;
  chain.sort = () => chain;
  chain.skip = () => chain;
  chain.limit = () => chain;
  chain.lean = async () => rows;
  chain.then = (resolve: any) => Promise.resolve(rows).then(resolve);
  return chain;
});
UserModel.findOne.mockImplementation(async (query: any) =>
  pool.find(p => p.discordId === query?.discordId) || null);
GameModel.findOne.mockImplementation(async (query: any) => docs.get(query?.gameId) || null);
GameModel.findOneAndUpdate.mockImplementation(async (filter: any) => {
  const id = filter?.gameId;
  if (claimed.has(id)) return null;
  const doc = docs.get(id);
  if (!doc || doc.state !== 'pending') return null;
  claimed.add(id);
  return doc;
});
EloRankModel.find.mockReturnValue({
  sort: jest.fn().mockResolvedValue([{
    roleId: 'rank-1', startElo: 0, endElo: 99999,
    winElo: 30, loseElo: 20, mvpElo: 10, bedElo: 5
  }])
});

const wsManagerMock = { send: jest.fn(), setGlobalHandler: jest.fn() };
const clientMock = {
  guilds: { cache: { first: jest.fn().mockReturnValue(undefined) } },
  channels: { cache: { get: jest.fn().mockReturnValue(undefined) } }
};

function makeGameDoc(gameId: number, team1: string[], team2: string[]) {
  return {
    gameId,
    map: 'LoadArena',
    queueId: 'load-queue',
    isRanked: true,
    state: 'pending',
    team1: [...team1],
    team2: [...team2],
    winners: [], losers: [], mvps: [], bedbreaks: [], reason: '',
    startTime: new Date(Date.now() - 600000),
    endTime: undefined,
    channels: { text: `t-${gameId}`, team1Voice: `v1-${gameId}`, team2Voice: `v2-${gameId}` },
    save: jest.fn().mockResolvedValue(undefined)
  };
}

let summary: string[] = [];
beforeAll(() => {
  summary = [];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  (console.log as jest.Mock).mockRestore();
  (console.warn as jest.Mock).mockRestore();
  (console.error as jest.Mock).mockRestore();
  process.stdout.write(`\n[loadPipeline] ${summary.join(' | ')}\n`);
});

describe('1000-player pipeline load test', () => {
  const games: Array<{ gameId: number; team1: string[]; team2: string[] }> = [];

  it('drafts all 1000 queued players into balanced 4v4 games', async () => {
    const queueManager = new RandomQueueManager({} as any, {} as any, {} as any) as any;
    const started = Date.now();
    const queue = pool.map(p => p.discordId);
    const seen = new Set<string>();
    const pairOf = new Map(pool.map(p => [p.discordId, p.partyId]));

    for (let offset = 0; offset < queue.length; offset += GAME_SIZE) {
      const group = queue.slice(offset, offset + GAME_SIZE);
      const result = await queueManager.selectBalancedTeams(group, { maxPlayers: GAME_SIZE });
      expect(result.team1).toHaveLength(4);
      expect(result.team2).toHaveLength(4);
      const combined = [...result.team1, ...result.team2];
      expect(new Set(combined).size).toBe(8);
      expect(combined.sort()).toEqual([...group].sort());
      for (const id of combined) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      for (const team of [result.team1, result.team2]) {
        for (const id of team) {
          const party = pairOf.get(id);
          if (party) {
            for (const mate of pool.filter(p => p.partyId === party).map(p => p.discordId)) {
              expect(team).toContain(mate);
            }
          }
        }
      }
      games.push({ gameId: BASE_GAME_ID + games.length, team1: result.team1, team2: result.team2 });
    }

    expect(games).toHaveLength(GAME_COUNT);
    expect(seen.size).toBe(PLAYER_COUNT);
    summary.push(`drafted ${seen.size} players into ${games.length} games in ${Date.now() - started}ms`);
  }, 120000);

  it('settles all 125 games concurrently with zero double-settles', async () => {
    expect(games).toHaveLength(GAME_COUNT);
    const manager = new GameManager(clientMock as any, wsManagerMock as any);
    for (const g of games) docs.set(g.gameId, makeGameDoc(g.gameId, g.team1, g.team2));

    const started = Date.now();
    for (const p of pool) p._startElo = p.elo;
    const outcomes = await Promise.allSettled(games.map((g, i) =>
      i % 3 === 2
        ? manager.voidGame(g.gameId, 'load void')
        : manager.scoreGame({ gameId: g.gameId, winningTeam: 1, mvps: [g.team1[0].toUpperCase()], bedbreaks: [] })
    ));
    const ms = Date.now() - started;

    const rejected = outcomes.filter(o => o.status === 'rejected');
    expect(rejected).toEqual([]);

    let scored = 0;
    let voided = 0;
    for (const g of games) {
      const doc = docs.get(g.gameId);
      if (doc.state === 'scored') scored++;
      else if (doc.state === 'voided') voided++;
    }
    expect(scored + voided).toBe(GAME_COUNT);
    expect(voided).toBe(41);
    expect(scored).toBe(84);

    for (const p of pool) {
      expect(Number.isFinite(p.elo)).toBe(true);
      expect(p.elo).toBeGreaterThanOrEqual(0);
      expect(p.games).toBe(0);
    }

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const mvpId = g.team1[0];
      for (const id of g.team1) {
        const p = pool.find(x => x.discordId === id);
        if (i % 3 === 2) {
          expect(p.wins).toBe(0);
        } else if (id === mvpId) {
          expect(p.elo).toBe(p._startElo + 40);
          expect(p.wins).toBe(1);
          expect(p.mvps).toBe(1);
        } else {
          expect(p.elo).toBe(p._startElo + 30);
          expect(p.wins).toBe(1);
        }
      }
      for (const id of g.team2) {
        const p = pool.find(x => x.discordId === id);
        if (i % 3 === 2) {
          expect(p.losses).toBe(0);
          expect(p.elo).toBe(p._startElo);
        } else {
          expect(p.elo).toBe(p._startElo - 20);
          expect(p.losses).toBe(1);
        }
      }
    }

    const winners = games.flatMap(g => g.team1);
    expect(new Set(winners).size).toBe(winners.length);
    summary.push(`settled ${scored} scored + ${voided} voided concurrently in ${ms}ms, 0 rejections`);

    await expect(manager.scoreGame({ gameId: games[0].gameId, winningTeam: 1, mvps: [] }))
      .rejects.toThrow(/already settled/);
    await expect(manager.voidGame(games[1].gameId, 'late void'))
      .rejects.toThrow(/already settled/);
  }, 180000);
});
