import { startTemplate } from '../src/assets/games/start';

jest.mock('node-fetch', () => jest.fn().mockRejectedValue(new Error('offline')));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn() },
}));

const UserModel = require('../src/models/User').default;

function chainable(value: any) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function texts(node: any): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (!node || typeof node !== 'object') return [];
  const kids = node.props?.children;
  return (Array.isArray(kids) ? kids : [kids]).flatMap(texts);
}

function player(username: string, elo: number, isCaptain = false) {
  return { discordId: username, username, elo, isCaptain, avatar: 'data:image/png;base64,' };
}

describe('startTemplate', () => {
  it('renders header, map, teams and captain badges', () => {
    const tpl = startTemplate({
      gameId: 42,
      mapName: 'Dreamgrove',
      modeLabel: 'RANKED',
      team1: [player('Alice', 1200, true), player('Bob', 1100)],
      team2: [player('Cara', 1150), player('Dan', 1050)],
      team1Avg: 1150,
      team2Avg: 1100,
      serverName: 'Test Server',
      inviteLink: 'discord.gg/test',
    });
    expect(tpl.width).toBe(1920);
    expect(tpl.height).toBe(1080);
    const all = texts(tpl.root);
    expect(all).toContain('MATCH START');
    expect(all).toContain('Dreamgrove · RANKED');
    expect(all).toContain('TEAM GREEN');
    expect(all).toContain('TEAM RED');
    expect(all).toContain('Alice');
    expect(all).toContain('Dan');
    expect(all).toContain('CPT');
    expect(all).toContain('AVG 1150');
    expect(all).toContain('AVG 1100');
    expect(all).toContain('GAME #42');
  });

  it('handles empty teams without crashing', () => {
    const tpl = startTemplate({
      gameId: 7,
      mapName: 'M',
      modeLabel: 'CASUAL',
      team1: [],
      team2: [],
      team1Avg: 0,
      team2Avg: 0,
      serverName: '',
      inviteLink: '',
    });
    const all = texts(tpl.root);
    expect(all).toContain('MATCH START');
  });
});

describe('fetchGameStartRoster', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps docs by discord id and fills defaults for missing players', async () => {
    const { fetchGameStartRoster } = await import('../src/utils/scoreImage');
    UserModel.find.mockImplementation(() => chainable([
      { discordId: 'a', ign: 'Alice', elo: 1200 },
      { discordId: 'b', ign: '', elo: 5 },
    ]));
    const roster = await fetchGameStartRoster(['a', 'b', 'missing']);
    expect(roster.get('a')).toEqual({ discordId: 'a', username: 'Alice', elo: 1200, isCaptain: false });
    expect(roster.get('b')).toEqual({ discordId: 'b', username: 'b', elo: 5, isCaptain: false });
    expect(roster.get('missing')).toEqual({ discordId: 'missing', username: 'missing', elo: 0, isCaptain: false });
  });

  it('returns an empty roster when the database fails', async () => {
    const { fetchGameStartRoster } = await import('../src/utils/scoreImage');
    UserModel.find.mockImplementation(() => { throw new Error('db down'); });
    const roster = await fetchGameStartRoster(['a']);
    expect(roster.size).toBe(0);
  });

  it('returns an empty roster for empty input without querying', async () => {
    const { fetchGameStartRoster } = await import('../src/utils/scoreImage');
    const roster = await fetchGameStartRoster([]);
    expect(roster.size).toBe(0);
    expect(UserModel.find).not.toHaveBeenCalled();
  });
});

describe('generateGameStartImageBuffer', () => {
  it('produces a valid 1920x1080 PNG', async () => {
    const { generateGameStartImageBuffer } = await import('../src/utils/scoreImage');
    const buf = await generateGameStartImageBuffer(
      9,
      [player('Alice', 1200, true), player('Bob', 1100)],
      [player('Cara', 1150), player('Dan', 1050)],
      { mapName: 'Dreamgrove', modeLabel: 'RANKED', serverName: '', inviteLink: '' }
    );
    expect(buf[0]).toBe(0x89);
    expect(buf.toString('ascii', 1, 4)).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(1920);
    expect(buf.readUInt32BE(20)).toBe(1080);
  }, 30000);
});
