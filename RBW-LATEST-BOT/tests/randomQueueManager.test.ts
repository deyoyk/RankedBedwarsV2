import { RandomQueueManager } from '../src/Matchmaking/RandomQueueManager';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: jest.fn()
  }
}));

jest.mock('../src/Matchmaking/utils', () => ({
  calculateTeamAverageElo: jest.fn().mockResolvedValue(0),
  selectRandomMap: jest.fn().mockResolvedValue('Aquarius'),
  getPlayerIGNs: jest.fn().mockResolvedValue(new Map())
}));

const UserModel = require('../src/models/User').default;

function mockUserFind(users: any[]) {
  UserModel.find.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(users) })
  });
}

function makeManager(): any {
  return new RandomQueueManager({} as any, {} as any, {} as any);
}

describe('RandomQueueManager.selectBalancedTeams', () => {
  it('keeps parties together on the same team', async () => {
    mockUserFind([
      { discordId: 'p1', partyId: 'P1', elo: 1000 },
      { discordId: 'p2', partyId: 'P1', elo: 1100 },
      { discordId: 's1', partyId: null, elo: 1500 },
      { discordId: 's2', partyId: null, elo: 1400 }
    ]);

    const manager = makeManager();
    const result = await manager.selectBalancedTeams(
      ['p1', 'p2', 's1', 's2'],
      { maxPlayers: 4 }
    ) as { team1: string[]; team2: string[]; usedPlayers: Set<string> };

    const team1 = result.team1;
    const team2 = result.team2;
    const combined = [...team1, ...team2];

    expect(combined).toHaveLength(4);
    expect(result.usedPlayers.size).toBe(4);

    const partyMembersOnTeam1 = team1.filter(id => ['p1', 'p2'].includes(id));
    const partyMembersOnTeam2 = team2.filter(id => ['p1', 'p2'].includes(id));
    expect(partyMembersOnTeam1.length === 2 || partyMembersOnTeam2.length === 2).toBe(true);
  });

  it('does NOT mark an unplaced oversized party as used', async () => {
    mockUserFind([
      { discordId: 'a', partyId: 'BIG', elo: 1000 },
      { discordId: 'b', partyId: 'BIG', elo: 1000 },
      { discordId: 'c', partyId: 'BIG', elo: 1000 },
      { discordId: 's1', partyId: null, elo: 1500 }
    ]);

    const manager = makeManager();
    const result = await manager.selectBalancedTeams(
      ['a', 'b', 'c', 's1'],
      { maxPlayers: 4 }
    );

    expect(result.usedPlayers.has('a')).toBe(false);
    expect(result.usedPlayers.has('b')).toBe(false);
    expect(result.usedPlayers.has('c')).toBe(false);
  });

  it('fills teams with solos sorted by ELO', async () => {
    mockUserFind([
      { discordId: 's1', partyId: null, elo: 1200 },
      { discordId: 's2', partyId: null, elo: 1600 },
      { discordId: 's3', partyId: null, elo: 1400 },
      { discordId: 's4', partyId: null, elo: 1300 }
    ]);

    const manager = makeManager();
    const result = await manager.selectBalancedTeams(
      ['s1', 's2', 's3', 's4'],
      { maxPlayers: 4 }
    );

    expect(result.team1).toHaveLength(2);
    expect(result.team2).toHaveLength(2);
    expect(result.usedPlayers.size).toBe(4);
  });

  it('throws when there are not enough players', async () => {
    mockUserFind([
      { discordId: 's1', partyId: null, elo: 1200 }
    ]);

    const manager = makeManager();
    await expect(manager.selectBalancedTeams(['s1'], { maxPlayers: 4 }))
      .rejects.toThrow('Not enough players');
  });
});
