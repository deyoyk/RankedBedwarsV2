const mockStartPrivateGame = jest.fn();
const mockStartDuel = jest.fn();
const mockValidatePartyAccess = jest.fn();
const mockSetAutoWarp = jest.fn();

const USERS: Record<string, { discordId: string; ign: string; partyId: string }> = {
  alpha: { discordId: 'a', ign: 'Alpha', partyId: 'P1' },
  bravo: { discordId: 'b', ign: 'Bravo', partyId: 'P1' },
  charlie: { discordId: 'c', ign: 'Charlie', partyId: 'P2' },
  delta: { discordId: 'd', ign: 'Delta', partyId: 'P2' },
};
const PARTIES: Record<string, { partyId: string; leader: string; members: string[]; privateGames: boolean; autoWarp?: boolean }> = {
  P1: { partyId: 'P1', leader: 'a', members: ['a', 'b'], privateGames: true },
  P2: { partyId: 'P2', leader: 'c', members: ['c', 'd'], privateGames: true },
};

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: ({ ign }: { ign: string }) => ({
      collation: () => ({ select: () => ({ lean: async () => USERS[ign.toLowerCase()] ?? null }) }),
    }),
    find: ({ discordId }: { discordId: { $in: string[] } }) => ({
      select: () => ({ lean: async () => Object.values(USERS).filter(u => discordId.$in.includes(u.discordId)) }),
    }),
  },
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: async ({ partyId }: { partyId: string }) => PARTIES[partyId] ?? null },
}));
jest.mock('../src/services/PartyService', () => ({
  __esModule: true,
  PartyService: {
    validatePartyAccess: (...args: unknown[]) => mockValidatePartyAccess(...args),
    setAutoWarp: (...args: unknown[]) => mockSetAutoWarp(...args),
  },
}));
jest.mock('../src/services/PrivateGameService', () => ({
  __esModule: true,
  PrivateGameService: {
    startPrivateGame: (...args: unknown[]) => mockStartPrivateGame(...args),
    startDuel: (...args: unknown[]) => mockStartDuel(...args),
  },
}));

import { PartyBridge } from '../src/services/PartyBridge';

function setup() {
  const ws = {
    send: jest.fn(),
    setGlobalHandler: jest.fn(),
    checkPlayerOnline: jest.fn().mockResolvedValue({ online: true }),
    handleQueueFromInGame: jest.fn(),
  };
  const client = { guilds: { cache: { first: () => ({ id: 'guild' }) } } };
  const bridge = new PartyBridge(client as any, ws as any) as any;
  const sent = () => ws.send.mock.calls.map(c => c[0]);
  return { ws, bridge, sent };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockValidatePartyAccess.mockImplementation(async (id: string) => {
    const party = Object.values(PARTIES).find(p => p.members.includes(id));
    return party ? { isValid: true, party } : { isValid: false };
  });
});

describe('in-game private games', () => {
  it('/party queue with private games on asks the server to host it, with no game number', async () => {
    const { bridge, sent } = setup();
    mockStartPrivateGame.mockResolvedValue({ success: true, map: 'Quad', players: ['Alpha', 'Bravo'], missing: [] });

    await bridge.handle({ type: 'party_command', request_id: 'r1', ign: 'Alpha', action: 'queue', map: 'Quad' });

    expect(mockStartPrivateGame).toHaveBeenCalledWith('a', expect.anything(), { map: 'Quad' });
    const result = sent().find(m => m.type === 'party_result');
    expect(result).toMatchObject({ request_id: 'r1', ok: true, message: 'Private game on Quad is starting!', map: 'Quad' });
    expect(result.game_id).toBeUndefined();
  });

  it('/party queue with private games off asks for them instead of joining a ranked queue', async () => {
    const { bridge, ws, sent } = setup();
    PARTIES.P1.privateGames = false;
    try {
      await bridge.handle({ type: 'party_command', request_id: 'r5', ign: 'Alpha', action: 'queue', map: 'Quad' });
    } finally {
      PARTIES.P1.privateGames = true;
    }
    expect(mockStartPrivateGame).not.toHaveBeenCalled();
    expect(ws.handleQueueFromInGame).not.toHaveBeenCalled();
    expect(sent().find(m => m.type === 'party_result')).toMatchObject({ ok: false, message: 'Turn on private games first (/party private).' });
  });

  it('/party queue without a party says a party is needed instead of joining a ranked queue', async () => {
    const { bridge, ws, sent } = setup();
    mockValidatePartyAccess.mockResolvedValue({ isValid: false });
    await bridge.handle({ type: 'party_command', request_id: 'r6', ign: 'Alpha', action: 'queue' });
    expect(ws.handleQueueFromInGame).not.toHaveBeenCalled();
    expect(mockStartPrivateGame).not.toHaveBeenCalled();
    expect(sent().find(m => m.type === 'party_result')).toMatchObject({ ok: false, message: expect.stringMatching(/need a party/) });
  });

  it('/party autowarp flips autowarp and tells the party', async () => {
    const { bridge, sent } = setup();
    mockSetAutoWarp.mockResolvedValue({ success: true, party: { ...PARTIES.P1, autoWarp: true } });
    await bridge.handle({ type: 'party_command', request_id: 'r7', ign: 'Alpha', action: 'autowarp' });
    expect(mockSetAutoWarp).toHaveBeenCalledWith('a', true);
    expect(sent().find(m => m.type === 'party_result')).toMatchObject({ ok: true, message: expect.stringMatching(/^Autowarp ON/) });
    expect(sent()).toContainEqual(expect.objectContaining({ type: 'party_notify', message: 'Alpha turned autowarp on.' }));
  });

  it("passes on the server's reason when the game can't start", async () => {
    const { bridge, sent } = setup();
    mockStartPrivateGame.mockResolvedValue({ success: false, message: 'Only 1 player is on the server' });

    await bridge.handle({ type: 'party_command', request_id: 'r2', ign: 'Alpha', action: 'queue' });

    expect(sent().find(m => m.type === 'party_result')).toMatchObject({ ok: false, message: 'Only 1 player is on the server' });
  });

  it('accepting a duel hosts it with the challenger as the first team', async () => {
    const { bridge, sent } = setup();
    mockStartDuel.mockResolvedValue({ success: true, map: 'Duo', players: [], missing: [] });

    await bridge.handle({ type: 'party_command', request_id: 'r3', ign: 'Alpha', action: 'duel', target: 'Charlie' });
    expect(sent()).toContainEqual(expect.objectContaining({ type: 'party_duel', ign: 'Charlie', from: 'Alpha' }));
    expect(mockStartDuel).not.toHaveBeenCalled();

    await bridge.handle({ type: 'party_command', request_id: 'r4', ign: 'Charlie', action: 'duel', target: 'Alpha' });

    expect(mockStartDuel).toHaveBeenCalledWith('P1', 'P2', expect.anything(), {});
    const accepted = sent().find(m => m.type === 'party_result' && m.request_id === 'r4');
    expect(accepted).toMatchObject({ ok: true, message: 'Duel accepted! The game on Duo is starting.' });
    expect(accepted.game_id).toBeUndefined();
  });
});
