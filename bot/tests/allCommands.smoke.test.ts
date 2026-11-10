/**
 * A-to-Z smoke test for every Discord bot command.
 * No live bot needed: mocked slash interactions + mocked DB/managers.
 * For each command: verifies export shape, then runs the slash-happy path
 * without throwing,
 * asserting a reply was sent.
 */
import { ChatInputCommandInteraction, Message, EmbedBuilder } from 'discord.js';

// ---------- heavy module mocks ----------
jest.mock('chartjs-node-canvas', () => ({
  ChartJSNodeCanvas: jest.fn().mockImplementation(() => ({
    renderToBuffer: jest.fn().mockResolvedValue(Buffer.from('chart')),
  })),
}));

function chainable(value: any) {
  const q: any = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
    collation: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
  q.select.mockReturnValue({ ...q, lean: jest.fn().mockResolvedValue(value), collation: jest.fn().mockReturnThis() });
  return q;
}

const mockUserDoc = {
  discordId: '123456789012345678',
  ign: 'Steve',
  elo: 1000,
  wins: 5,
  losses: 2,
  kills: 10,
  deaths: 5,
  mvps: 1,
  experience: 100,
  settings: {},
  save: jest.fn().mockResolvedValue(undefined),
};
const mockGameDoc = {
  gameId: 1,
  state: 'pending',
  map: 'Map1',
  team1: [],
  team2: [],
  channels: { text: 'chan1' },
  select: jest.fn(),
};

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockImplementation(() => chainable({ ...mockUserDoc })),
    find: jest.fn().mockImplementation(() => chainable([])),
    findOneAndUpdate: jest.fn().mockResolvedValue({ ...mockUserDoc }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(5),
    create: jest.fn().mockResolvedValue({ ...mockUserDoc }),
    deleteMany: jest.fn().mockResolvedValue({}),
    aggregate: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockImplementation(() => chainable({ ...mockGameDoc })),
    find: jest.fn().mockImplementation(() => chainable([{ ...mockGameDoc }])),
    findOneAndUpdate: jest.fn().mockResolvedValue({ ...mockGameDoc }),
    updateOne: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(3),
    deleteMany: jest.fn().mockResolvedValue({}),
    aggregate: jest.fn().mockResolvedValue([]),
  },
}));
function queueCtor(this: any, doc: any) {
  Object.assign(this, doc);
  this.save = jest.fn().mockResolvedValue(undefined);
}
const queueStatics: any = {
  findOne: jest.fn().mockImplementation(() => chainable({ channelId: '1352587524475713619', maxPlayers: 8, minElo: 0, maxElo: 3000, isRanked: true, isPicking: false })),
  find: jest.fn().mockImplementation(() => chainable([])),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  updateOne: jest.fn().mockResolvedValue({}),
  countDocuments: jest.fn().mockResolvedValue(1),
};
Object.assign(queueCtor, queueStatics);
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: queueCtor }));
jest.mock('../src/models/Season', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockImplementation(() => chainable({ isActive: true, seasonNumber: 1, chapterNumber: 1, name: 'S1', startDate: new Date(), description: 'd' })),
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue([]) }),
    countDocuments: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockImplementation(() => chainable({ roleId: '1', winElo: 10, loseElo: 5, mvpElo: 2, bedElo: 1 })),
    find: jest.fn().mockImplementation(() => chainable([])),
    create: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockImplementation(() => chainable(null)) },
}));
jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockImplementation(() => chainable(null)), create: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../src/models/VoteRequest', () => ({
  __esModule: true,
  default: { create: jest.fn().mockResolvedValue({}), deleteOne: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/models/SeasonStats', () => ({ __esModule: true, default: { insertMany: jest.fn().mockResolvedValue([]) } }));
jest.mock('../src/models/SeasonGames', () => ({ __esModule: true, default: { insertMany: jest.fn().mockResolvedValue([]) } }));
jest.mock('../src/models/Counter', () => ({ __esModule: true, default: { getNextSequence: jest.fn().mockResolvedValue(2) } }));

jest.mock('../src/managers/SeasonManager', () => ({
  SeasonManager: {
    startSeason: jest.fn().mockResolvedValue({ success: true, message: 'started', embed: null }),
    endSeason: jest.fn().mockResolvedValue({ success: true, message: 'ended', usersMigrated: 1, gamesMigrated: 1, statsCreated: 1, seasonInfo: { name: 'S1', seasonNumber: 1, chapterNumber: 1 } }),
    getCurrentSeason: jest.fn().mockResolvedValue({ seasonNumber: 1, chapterNumber: 1 }),
  },
}));
jest.mock('../src/Matchmaking/GameManager', () => ({
  GameManager: jest.fn().mockImplementation(() => ({
    scoreGame: jest.fn().mockResolvedValue({}),
    voidGame: jest.fn().mockResolvedValue({}),
  })),
}));
jest.mock('../src/managers/BanManager', () => ({ BanManager: { ban: jest.fn().mockResolvedValue(undefined), unban: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/managers/MuteManager', () => ({ MuteManager: { mute: jest.fn().mockResolvedValue(undefined), unmute: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/managers/StrikeManager', () => ({ StrikeManager: { strike: jest.fn().mockResolvedValue(undefined), unstrike: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/services/ScreenshareService', () => ({
  ScreenshareService: {
    createSession: jest.fn().mockResolvedValue({ success: true, session: { sessionId: 'ss1', targetIgn: 'Steve', expireTime: new Date() } }),
    closeSession: jest.fn().mockResolvedValue({ success: true }),
    getSessionByChannelId: jest.fn().mockResolvedValue({ sessionId: 'ss1', targetId: '123456789012345678' }),
    getSessionById: jest.fn().mockResolvedValue(null),
    createSessionEmbed: jest.fn().mockReturnValue(new EmbedBuilder().setTitle('ss')),
    createFreezeButton: jest.fn().mockReturnValue({}),
  },
}));
jest.mock('../src/services/PartyService', () => ({
  PartyService: {
    createParty: jest.fn().mockResolvedValue({ success: true, message: 'created' }),
    inviteToParty: jest.fn().mockResolvedValue({ success: true, message: 'invited' }),
    acceptInvite: jest.fn().mockResolvedValue({ success: true, message: 'accepted' }),
    leaveParty: jest.fn().mockResolvedValue({ success: true, message: 'left' }),
    getPartyInfo: jest.fn().mockResolvedValue({ success: true, message: 'info' }),
    disbandParty: jest.fn().mockResolvedValue({ success: true, message: 'disbanded' }),
    kickFromParty: jest.fn().mockResolvedValue({ success: true, message: 'kicked' }),
    promoteToLeader: jest.fn().mockResolvedValue({ success: true, message: 'promoted' }),
    updatePartySettings: jest.fn().mockResolvedValue({ success: true, message: 'updated' }),
    listPublicParties: jest.fn().mockResolvedValue({ success: true, message: 'listed', parties: [] }),
    joinParty: jest.fn().mockResolvedValue({ success: true, message: 'joined' }),
  },
}));
jest.mock('../src/managers/MapManager', () => ({
  MapService: { getSharedInstance: jest.fn().mockReturnValue({ getAllMaps: jest.fn().mockResolvedValue([{ name: 'Map1' }]) }) },
}));
jest.mock('../src/utils/releaseVersion', () => ({
  getReleaseVersion: jest.fn().mockResolvedValue('v41'),
}));

jest.mock('../src/utils/fix', () => ({
  fix: jest.fn().mockResolvedValue(true),
  getEloRanks: jest.fn().mockResolvedValue([]),
  safeFix: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/utils/confirmAction', () => ({
  executeWithConfirmation: jest.fn().mockImplementation(async (_i: any, cfg: any) => { await cfg.onConfirm(); }),
}));
jest.mock('../src/utils/voteRequest', () => ({
  createVoteButtons: jest.fn().mockReturnValue({}),
  createDiscussionThread: jest.fn().mockResolvedValue(undefined),
  setupVoteCollector: jest.fn().mockReturnValue({ stop: jest.fn() }),
  buildResultEmbed: jest.fn().mockReturnValue(new EmbedBuilder().setTitle('vote')),
  claimVoteRequest: jest.fn().mockResolvedValue(true),
  releaseVoteRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/assets/stats-theme', () => ({
  resolveTheme: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(Buffer.from('img'))),
  themes: ['default'],
}));

const ID19 = '123456789012345678';
const CHAN19 = '1352587524475713619';
function sentMessageDouble() {
  const m: any = {
    edit: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn(), stop: jest.fn() }),
    awaitMessageComponent: jest.fn().mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'Timeout' })),
  };
  return m;
}
function channelDouble() {
  return {
    id: 'chan1',
    type: 0,
    isTextBased: () => true,
    send: jest.fn().mockResolvedValue(sentMessageDouble()),
    createMessageComponentCollector: jest.fn().mockReturnValue({ on: jest.fn(), stop: jest.fn() }),
  };
}
function mockMessage(over: any = {}) {
  return {
    content: '=cmd',
    author: { id: ID19 },
    member: { voice: { channel: { id: CHAN19, name: 'queue-1' } }, roles: { cache: new Map() } },
    guild: {
      id: 'guild1',
      members: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) },
      roles: { cache: new Map() },
      channels: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) },
    },
    channel: channelDouble(),
    channelId: 'chan1',
    client: { users: { cache: { get: () => undefined } } },
    reply: jest.fn().mockResolvedValue(sentMessageDouble()),
    ...over,
  } as any;
}
function mockSlash(optionMap: Record<string, any> = {}, over: any = {}) {
  const sent = sentMessageDouble();
  const get = (name: string) => optionMap[name];
  const interaction: any = Object.create(ChatInputCommandInteraction.prototype);
  const props = {
    commandName: 'test',
    options: {
      getString: jest.fn((n: string, _r?: boolean) => get(n) ?? null),
      getInteger: jest.fn((n: string, _r?: boolean) => get(n) ?? null),
      getBoolean: jest.fn((n: string, _r?: boolean) => get(n) ?? null),
      getUser: jest.fn((n: string, _r?: boolean) => get(n) ?? null),
      getAttachment: jest.fn((n: string, _r?: boolean) => get(n) ?? null),
      getSubcommand: jest.fn(() => get('__subcommand') ?? 'enable'),
    },
    user: { id: ID19, username: 'Tester', displayAvatarURL: () => 'http://avatar' },
    member: { voice: { channel: { id: CHAN19, name: 'queue-1' } }, roles: { cache: { has: () => false } } },
    guild: {
      id: 'guild1',
      members: { cache: new Map(), fetch: jest.fn().mockResolvedValue({ id: ID19, user: { id: ID19 } }) },
      roles: { cache: new Map() },
      channels: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) },
    },
    channel: channelDouble() as any,
    channelId: 'chan1',
    client: { users: { cache: { get: () => undefined } } },
    deferred: false,
    replied: false,
    deferReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(sent),
    editReply: jest.fn().mockResolvedValue(sent),
    followUp: jest.fn().mockResolvedValue(sent),
    ...over,
  };
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(interaction, k, { value: v, writable: true, configurable: true, enumerable: true });
  }
  return interaction;
}
function replied(interaction: any) {
  return interaction.reply.mock.calls.length > 0
    || interaction.editReply?.mock.calls.length > 0
    || interaction.followUp?.mock.calls.length > 0;
}
const wsManager: any = {
  send: jest.fn(),
  checkPlayerOnline: jest.fn().mockResolvedValue({ online: true, original_ign_case: 'Steve' }),
  getPermission: jest.fn().mockReturnValue(['everyone']),
  registerScreenshareThread: jest.fn(),
};
(global as any)._wsManager = wsManager;

import { help } from '../src/commands/help';
import { register } from '../src/commands/account/register';
import { forceregister } from '../src/commands/account/forceregister';
import { forcerename } from '../src/commands/account/forcerename';
import { unregister } from '../src/commands/account/unregister';
import { nick } from '../src/commands/account/nick';
import { settings } from '../src/commands/account/settings';
import { refresh } from '../src/commands/account/refresh';
import { fixall } from '../src/commands/account/fixall';
import { addelo } from '../src/commands/account/addelo';
import { removeelo } from '../src/commands/account/removeelo';
import { wipe } from '../src/commands/account/wipe';
import { wipeeveryone } from '../src/commands/account/wipeeveryone';
import { statreset } from '../src/commands/account/statreset';
import { claimelo } from '../src/commands/account/claimelo';
import { queues } from '../src/commands/general/queues';
import { games } from '../src/commands/general/games';
import { gameinfo } from '../src/commands/general/gameinfo';
import { maps } from '../src/commands/general/maps';
import { ranks } from '../src/commands/general/ranks';
import { bonus } from '../src/commands/general/bonus';
import { ban } from '../src/commands/moderation/ban';
import { unban } from '../src/commands/moderation/unban';
import { mute } from '../src/commands/moderation/mute';
import { unmute } from '../src/commands/moderation/unmute';
import { strike } from '../src/commands/moderation/strike';
import { unstrike } from '../src/commands/moderation/unstrike';
import { history } from '../src/commands/moderation/history';
import { screenshare } from '../src/commands/moderation/screenshare';
import { ssclose } from '../src/commands/moderation/ssclose';
import { queue } from '../src/commands/queue/queue';
import { party } from '../src/commands/queue/party';
import { call } from '../src/commands/queue/call';
import { retry } from '../src/commands/queue/retry';
import { addqueue } from '../src/commands/queue/addqueue';
import { removequeue } from '../src/commands/queue/removequeue';
import { queuecontrol } from '../src/commands/queue/queuecontrol';
import { score } from '../src/commands/scoring/score';
import { win } from '../src/commands/scoring/win';
import { lose } from '../src/commands/scoring/lose';
import { voidGame } from '../src/commands/scoring/void';
import { forcevoid } from '../src/commands/scoring/forcevoid';
import { edit } from '../src/commands/scoring/edit';
import { gamescount } from '../src/commands/scoring/gamescount';
import { strikerequest } from '../src/commands/scoring/strikerequest';
import { voidrequest } from '../src/commands/scoring/voidrequest';
import { stats } from '../src/commands/stats/stats';
import { leaderboard } from '../src/commands/stats/leaderboard';
import { recentgames } from '../src/commands/stats/recentgames';
import { level } from '../src/commands/stats/level';
import { startseason } from '../src/commands/season/startseason';
import { endseason } from '../src/commands/season/endseason';
import { listseasons } from '../src/commands/season/listseasons';
import { seasoninfo } from '../src/commands/season/seasoninfo';

const MENTION = `<@${ID19}>`;
const discordUser = { id: ID19, username: 'Steve', displayAvatarURL: () => 'http://avatar' };

type Row = { name: string; fn: any; slash: Record<string, any> };
const ROWS: Row[] = [
  { name: 'help', fn: help, slash: {} },
  { name: 'register', fn: register, slash: { ign: 'Steve' } },
  { name: 'forceregister', fn: forceregister, slash: { user: discordUser, ign: 'Steve' } },
  { name: 'forcerename', fn: forcerename, slash: { user: discordUser, new_ign: 'Alex' } },
  { name: 'unregister', fn: unregister, slash: { user: discordUser } },
  { name: 'nick', fn: nick, slash: { action: 'remove' } },
  { name: 'settings', fn: settings, slash: {} },
  { name: 'refresh', fn: refresh, slash: {} },
  { name: 'fixall', fn: fixall, slash: {} },
  { name: 'addelo', fn: addelo, slash: { role_id: CHAN19, start_elo: 0, end_elo: 100, win_elo: 10, lose_elo: 5, mvp_elo: 2 } },
  { name: 'removeelo', fn: removeelo, slash: { role_id: CHAN19 } },
  { name: 'wipe', fn: wipe, slash: { user: discordUser } },
  { name: 'wipeeveryone', fn: wipeeveryone, slash: {} },
  { name: 'statreset', fn: statreset, slash: {} },
  { name: 'claimelo', fn: claimelo, slash: {} },
  { name: 'queues', fn: queues, slash: {} },
  { name: 'games', fn: games, slash: {} },
  { name: 'gameinfo', fn: gameinfo, slash: { game_id: 1 } },
  { name: 'maps', fn: maps, slash: {} },
  { name: 'ranks', fn: ranks, slash: {} },
  { name: 'bonus', fn: bonus, slash: {} },
  { name: 'ban', fn: ban, slash: { user: discordUser, duration: '1h', reason: 'test' } },
  { name: 'unban', fn: unban, slash: { user: discordUser, user_id: ID19 } },
  { name: 'mute', fn: mute, slash: { user: discordUser, duration: '1h', reason: 'test' } },
  { name: 'unmute', fn: unmute, slash: { user: discordUser, user_id: ID19 } },
  { name: 'strike', fn: strike, slash: { user: discordUser, reason: 'test' } },
  { name: 'unstrike', fn: unstrike, slash: { user: discordUser, reason: 'test' } },
  { name: 'history', fn: history, slash: { user_id: ID19, type: 'ban' } },
  { name: 'screenshare', fn: screenshare, slash: { user: discordUser, reason: 'check', image: { url: 'http://img.png' } } },
  { name: 'ssclose', fn: ssclose, slash: { reason: 'done' } },
  { name: 'queue', fn: queue, slash: {} },
  { name: 'party', fn: party, slash: { action: 'info' } },
  { name: 'call', fn: call, slash: { user: discordUser } },
  { name: 'retry', fn: retry, slash: {} },
  { name: 'addqueue', fn: addqueue, slash: { channel_id: CHAN19, max_players: 8, min_elo: 0, max_elo: 3000, is_ranked: true, is_picking: false } },
  { name: 'removequeue', fn: removequeue, slash: { channel_id: CHAN19 } },
  { name: 'queuecontrol', fn: queuecontrol, slash: { __subcommand: 'enable', type: 'ranked' } },
  { name: 'score', fn: score, slash: { game_id: 1, winning_team: 1 } },
  { name: 'win', fn: win, slash: { user: discordUser } },
  { name: 'lose', fn: lose, slash: { user: discordUser } },
  { name: 'void', fn: voidGame, slash: { game_id: 1, reason: 'test' } },
  { name: 'forcevoid', fn: forcevoid, slash: {} },
  { name: 'edit', fn: edit, slash: { user: discordUser, stat: 'elo', value: '1500' } },
  { name: 'gamescount', fn: gamescount, slash: {} },
  { name: 'strikerequest', fn: strikerequest, slash: { game_id: '1', target: discordUser, reason: 'test' } },
  { name: 'voidrequest', fn: voidrequest, slash: { game_id: '1', reason: 'test' } },
  { name: 'stats', fn: stats, slash: { user: discordUser } },
  { name: 'leaderboard', fn: leaderboard, slash: { mode: 'elo', page: 1 } },
  { name: 'recentgames', fn: recentgames, slash: { page: 1 } },
  { name: 'level', fn: level, slash: { user: discordUser } },
  { name: 'startseason', fn: startseason, slash: { season: 2, chapter: 1, name: 'S2' } },
  { name: 'endseason', fn: endseason, slash: {} },
  { name: 'listseasons', fn: listseasons, slash: {} },
  { name: 'seasoninfo', fn: seasoninfo, slash: {} },
];

describe('command contract: exports + canonical signature', () => {
  it.each(ROWS.map(r => [r.name, r.fn]))('%s exports an async function with (interaction, args?, wsManager?)', (_name, fn) => {
    expect(typeof fn).toBe('function');
    expect(fn.length).toBeGreaterThanOrEqual(1);
    expect(fn.length).toBeLessThanOrEqual(3);
  });
  it('backward-compat aliases still exist', async () => {
    const qc = await import('../src/commands/queue/queuecontrol');
    expect(typeof (qc as any).executeQueueControl).toBe('function');
    const lvl = await import('../src/commands/stats/level');
    expect(typeof (lvl as any).execute).toBe('function');
    const ss = await import('../src/commands/season/startseason');
    expect(typeof (ss as any).executeStartSeason).toBe('function');
    const es = await import('../src/commands/season/endseason');
    expect(typeof (es as any).executeEndSeason).toBe('function');
    const ls = await import('../src/commands/season/listseasons');
    expect(typeof (ls as any).executeListSeasons).toBe('function');
  });
});

describe('CommandManager registers every command once with valid slash payload', () => {
  it('names match files, no duplicates, options well-formed', async () => {
    const { CommandManager } = await import('../src/managers/CommandManager');
    const client: any = { on: jest.fn(), application: { commands: { set: jest.fn().mockResolvedValue(undefined) } } };
    const mgr = new CommandManager(client, wsManager);
    const cmds: any[] = Array.from((mgr as any).commands.values());
    const names = cmds.map(c => c.name);
    for (const row of ROWS) {
      if (row.name === 'void') {
        expect(names).toContain('void');
      } else {
        expect(names).toContain(row.name);
      }
    }
    expect(new Set(names).size).toBe(names.length);
    for (const cmd of cmds) {
      expect(cmd.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(cmd.description.length).toBeLessThanOrEqual(100);
      const opts = cmd.options ?? cmd.apiData?.options ?? [];
      expect(opts.length).toBeLessThanOrEqual(25);
      for (const o of opts) {
        expect(o.type).toBeDefined();
        expect(o.name).toBeDefined();
        expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
        expect(String(o.description ?? '').length).toBeLessThanOrEqual(100);
        expect([1, 2, 3, 4, 5, 6, 7, 8, 10, 11]).toContain(o.type);
        if ('choices' in o && Array.isArray(o.choices)) {
          expect(o.choices.length).toBeGreaterThan(0);
          expect(o.choices.length).toBeLessThanOrEqual(25);
        }
      }
    }
    await (mgr as any).registerSlashCommands();
    expect(client.application.commands.set).toHaveBeenCalled();
  });
});

describe.each(ROWS.map(r => [r.name, r.fn, r.slash]))(
  'smoke: %s',
  (_name, fn: any, slashOpts: any) => {
    it('slash happy-path resolves and replies', async () => {
      const interaction = mockSlash(slashOpts);
      await expect(fn(interaction, wsManager)).resolves.toBeUndefined();
      expect(replied(interaction)).toBe(true);
    });
  }
);

describe('CommandHandler routing, permissions, errors', () => {
  it('denies without permission and defers slash', async () => {
    const { CommandHandler } = await import('../src/handlers/CommandHandler');
    (global as any)._wsManager = { getPermission: () => ['999'] };
    const handler = new CommandHandler({} as any, wsManager);
    handler.registerCommand('ban', jest.fn().mockResolvedValue(undefined));
    const denied = mockSlash({});
    denied.commandName = 'ban';
    denied.member = { roles: { cache: { has: () => false } } };
    await handler.handleInteraction(denied);
    expect(denied.deferReply).toHaveBeenCalled();
    (global as any)._wsManager = wsManager;
  });
});
