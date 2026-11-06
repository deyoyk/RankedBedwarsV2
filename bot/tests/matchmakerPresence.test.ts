import { CentralizedMatchmaker } from '../src/Matchmaking/CentralizedMatchmaker';
import { PresenceService } from '../src/services/PresenceService';
import { clearPlayerDirectoryCache } from '../src/utils/playerDirectory';

jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), updateOne: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/models/Counter', () => ({
  getNextSequence: jest.fn().mockResolvedValue(100),
  Counter: {},
}));
jest.mock('../src/models/Party', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/Matchmaking/utils', () => ({
  calculateTeamAverageElo: jest.fn().mockResolvedValue(1000),
  selectRandomMap: jest.fn().mockResolvedValue('Aquarius'),
  getPlayerIGNs: jest.fn().mockResolvedValue(new Map()),
  findInGamePlayerIds: jest.fn().mockResolvedValue(new Set()),
  isIgnInGame: jest.fn().mockResolvedValue(false),
}));
jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: { getInstance: () => ({}) },
}));

const UserModel = require('../src/models/User').default;
const utils = require('../src/Matchmaking/utils');

const wsManagerMock: any = {
  send: jest.fn(),
  setGlobalHandler: jest.fn(),
  checkPlayerOnline: jest.fn().mockResolvedValue({ online: true }),
  checkPlayers: jest.fn().mockResolvedValue(new Map()),
  checkBedwarsPlayers: jest.fn().mockResolvedValue(new Map()),
};

const gameManagerMock: any = {
  getActiveGameCount: jest.fn().mockReturnValue(0),
  cleanup: jest.fn(),
};

const clientMock: any = {
  guilds: { cache: { first: jest.fn().mockReturnValue(undefined) } },
};

const queue = { channelId: 'q1', maxPlayers: 8, minElo: 0, maxElo: 99999 };

function makeManager() {
  const mm = new CentralizedMatchmaker(clientMock, wsManagerMock, gameManagerMock) as any;
  clearInterval(mm.queueMonitorInterval);
  clearInterval(mm.cacheCleanupInterval);
  return mm;
}

function userDoc() {
  return { discordId: 'a', ign: 'Alice', elo: 1000, partyId: null, isBanned: false, isFrozen: false };
}

beforeEach(() => {
  jest.clearAllMocks();
  PresenceService.clear();
  clearPlayerDirectoryCache();
  wsManagerMock.checkPlayerOnline.mockResolvedValue({ online: true });
  wsManagerMock.checkPlayers.mockResolvedValue(new Map());
  wsManagerMock.checkBedwarsPlayers.mockResolvedValue(new Map());
  utils.findInGamePlayerIds.mockResolvedValue(new Set());
  UserModel.find.mockResolvedValue([userDoc()]);
});

describe('matchmaker presence fast path', () => {
  it('rejects a known-offline player without a live check', async () => {
    PresenceService.ingest('Alice', false);
    const mm = makeManager();

    const valid = await mm.validatePlayers(['a'], queue);

    expect(valid).toEqual([]);
    expect(wsManagerMock.checkPlayerOnline).not.toHaveBeenCalled();
  });

  it('accepts a known-online player without a live check', async () => {
    PresenceService.ingest('Alice', true);
    const mm = makeManager();

    const valid = await mm.validatePlayers(['a'], queue);

    expect(valid).toEqual(['a']);
    expect(wsManagerMock.checkPlayerOnline).not.toHaveBeenCalled();
  });

  it('falls back to a live check when presence is unknown', async () => {
    const mm = makeManager();

    const valid = await mm.validatePlayers(['a'], queue);

    expect(valid).toEqual(['a']);
    expect(wsManagerMock.checkPlayerOnline).toHaveBeenCalledWith('Alice');
  });

  it('rejects a player when the live check reports offline', async () => {
    wsManagerMock.checkPlayerOnline.mockResolvedValue({ online: false });
    const mm = makeManager();

    const valid = await mm.validatePlayers(['a'], queue);

    expect(valid).toEqual([]);
  });

  it('treats an inconclusive live check as offline', async () => {
    wsManagerMock.checkPlayerOnline.mockResolvedValue({ online: null });
    const mm = makeManager();

    const valid = await mm.validatePlayers(['a'], queue);

    expect(valid).toEqual([]);
    expect(PresenceService.evaluate('Alice')).toBe('offline');
  });
});
