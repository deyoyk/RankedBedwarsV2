import { CentralizedMatchmaker } from '../src/Matchmaking/CentralizedMatchmaker';
import { PresenceService } from '../src/services/PresenceService';

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
}));
jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: { getInstance: () => ({}) },
}));

const UserModel = require('../src/models/User').default;

const wsManagerMock: any = {
  send: jest.fn(),
  setGlobalHandler: jest.fn(),
  checkPlayerOnline: jest.fn().mockResolvedValue({ online: true }),
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

beforeEach(() => {
  jest.clearAllMocks();
  PresenceService.clear();
  wsManagerMock.checkPlayerOnline.mockResolvedValue({ online: true });
});

describe('matchmaker presence fast path', () => {
  it('rejects a known-offline player without a live check', async () => {
    UserModel.findOne.mockImplementation(() => ({ lean: async () => ({ discordId: 'a', ign: 'Alice', elo: 1000, partyId: null, isbanned: false, isfrozen: false }) }));
    PresenceService.ingest('Alice', false);
    const mm = makeManager();

    const valid = await mm.validateSinglePlayer('a', queue, ['a'], new Set(), new Set());

    expect(valid).toBe(false);
    expect(wsManagerMock.checkPlayerOnline).not.toHaveBeenCalled();
  });

  it('accepts a known-online player without a live check', async () => {
    UserModel.findOne.mockImplementation(() => ({ lean: async () => ({ discordId: 'a', ign: 'Alice', elo: 1000, partyId: null, isbanned: false, isfrozen: false }) }));
    PresenceService.ingest('Alice', true);
    const mm = makeManager();

    const valid = await mm.validateSinglePlayer('a', queue, ['a'], new Set(), new Set());

    expect(valid).toBe(true);
    expect(wsManagerMock.checkPlayerOnline).not.toHaveBeenCalled();
  });

  it('falls back to a live check when presence is unknown', async () => {
    UserModel.findOne.mockImplementation(() => ({ lean: async () => ({ discordId: 'a', ign: 'Alice', elo: 1000, partyId: null, isbanned: false, isfrozen: false }) }));
    const mm = makeManager();

    const valid = await mm.validateSinglePlayer('a', queue, ['a'], new Set(), new Set());

    expect(valid).toBe(true);
    expect(wsManagerMock.checkPlayerOnline).toHaveBeenCalledWith('Alice');
  });
});

