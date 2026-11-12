import { PermissionService } from '../src/services/PermissionService';
import { ChatInputCommandInteraction } from 'discord.js';
import { edit } from '../src/commands/scoring/edit';
import { forceregister } from '../src/commands/account/forceregister';
import { forcerename } from '../src/commands/account/forcerename';
import { addqueue } from '../src/commands/queue/addqueue';
import { executeListSeasons } from '../src/commands/season/listseasons';
import { score } from '../src/commands/scoring/score';
import { voidGame } from '../src/commands/scoring/void';
import { lose } from '../src/commands/scoring/lose';
import { executeModerationAction } from '../src/utils/modCommands';
import { CommandHandler } from '../src/handlers/CommandHandler';
import { parseDiscordId, isValidIgn } from '../src/utils/inputValidation';
import config from '../src/config/config';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn(), findOneAndUpdate: jest.fn() }
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((doc: any) => ({
    ...doc,
    save: jest.fn().mockResolvedValue(undefined)
  }))
}));
jest.mock('../src/models/Season', () => ({
  __esModule: true,
  default: { find: jest.fn() }
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));

const UserModel = require('../src/models/User').default;
const GameModel = require('../src/models/Game').default;
const QueueModel = require('../src/models/Queue').default;
const SeasonModel = require('../src/models/Season').default;

function interaction(options: Record<string, any> = {}, overrides: Record<string, any> = {}) {
  return {
    id: `interaction-${Math.random().toString(36).slice(2)}`,
    user: { id: '999000000000000001' },
    member: { roles: { cache: new Map() } },
    guild: { id: 'guild1', members: { cache: { get: () => undefined } } },
    options: {
      getUser: (name: string) => options[name] ?? null,
      getString: (name: string) => options[name] ?? null,
      getInteger: (name: string) => options[name] ?? null,
      getBoolean: (name: string) => options[name] ?? null,
      getAttachment: (name: string) => options[name] ?? null,
      getSubcommand: () => options.__subcommand ?? 'enable',
    },
    reply: jest.fn().mockResolvedValue({}),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
    ...overrides,
  } as any;
}

function mockUser(overrides: any = {}) {
  return {
    discordId: '123456789012345678',
    ign: 'Steve',
    elo: 1000,
    wins: 5,
    losses: 2,
    kills: 10,
    deaths: 5,
    kdr: 2,
    wlr: 2.5,
    ...overrides
  };
}

describe('inputValidation helpers', () => {
  it('parses mentions and snowflakes, rejects garbage', () => {
    expect(parseDiscordId('<@123456789012345678>')).toBe('123456789012345678');
    expect(parseDiscordId('<@!123456789012345678>')).toBe('123456789012345678');
    expect(parseDiscordId('123456789012345678')).toBe('123456789012345678');
    expect(parseDiscordId('notanid')).toBeNull();
    expect(parseDiscordId('123')).toBeNull();
    expect(parseDiscordId(undefined)).toBeNull();
  });
  it('validates IGN shape', () => {
    expect(isValidIgn('Steve_123')).toBe(true);
    expect(isValidIgn('ab')).toBe(false);
    expect(isValidIgn('a'.repeat(17))).toBe(false);
    expect(isValidIgn('evil ign!')).toBe(false);
  });
});

describe('edit command validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects Infinity and negative values without writing', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);
    const first = interaction({ user: { id: '123456789012345678' }, stat: 'elo', value: 'Infinity' });
    const second = interaction({ user: { id: '123456789012345678' }, stat: 'wins', value: '-3' });

    await edit(first);
    await edit(second);

    expect(UserModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(user.elo).toBe(1000);
    expect(first.reply).toHaveBeenCalledTimes(1);
    expect(second.reply).toHaveBeenCalledTimes(1);
  });

  it('accepts finite non-negative values with a single atomic update', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);
    UserModel.findOneAndUpdate.mockResolvedValue({ ...user, elo: 1500 });
    const target = interaction({ user: { id: '123456789012345678' }, stat: 'elo', value: '1500' });

    await edit(target);

    expect(UserModel.findOneAndUpdate).toHaveBeenCalledWith(
      { discordId: '123456789012345678' },
      { $set: { elo: 1500 } },
      { new: true }
    );
    expect(target.reply).toHaveBeenCalledTimes(1);
  });
});

describe('forceregister and forcerename validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid discord ids', async () => {
    const target = interaction({ user: null, ign: 'Steve' });
    await forceregister(target);
    expect(UserModel.findOne).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalled();
  });

  it('rejects invalid IGNs', async () => {
    const target = interaction({ user: { id: '123456789012345678' }, ign: 'x!' });
    await forceregister(target);
    expect(UserModel.findOne).not.toHaveBeenCalled();
  });

  it('uses a collated exact match for the IGN lookup', async () => {
    const seen: Array<{ query: any; chain: any }> = [];
    UserModel.findOne.mockImplementation((query: any) => {
      const chain = {
        collation: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(query.ign ? null : mockUser())
      };
      seen.push({ query, chain });
      return chain as any;
    });
    UserModel.findOneAndUpdate.mockResolvedValue(mockUser());
    const target = interaction({ user: { id: '123456789012345678' }, ign: 'abc' });
    await forceregister(target);
    expect(UserModel.findOne).toHaveBeenCalledWith({ ign: 'abc', discordId: { $ne: '123456789012345678' } });
    const ignCall = seen.find(s => s.query.ign);
    expect(ignCall?.chain.collation).toHaveBeenCalledWith({ locale: 'en', strength: 2 });
  });

  it('forcerename rejects invalid ids and IGNs', async () => {
    const badId = interaction({ user: null, new_ign: 'Steve' });
    await forcerename(badId);
    expect(UserModel.findOne).not.toHaveBeenCalled();

    const badIgn = interaction({ user: { id: '123456789012345678' }, new_ign: 'no good!' });
    await forcerename(badIgn);
    expect(UserModel.findOne).not.toHaveBeenCalled();
  });
});

describe('moderation error replies hide internals', () => {
  it('does not leak manager errors to users', async () => {
    const target = interaction({ user: { id: '123456789012345678' }, duration: '1h', reason: 'spam' });
    await executeModerationAction(target, {
      commandName: 'ban',
      actionVerb: 'Banned',
      hasDuration: true,
      managerCall: async () => { throw new Error('db secret xyz'); }
    });
    const replied = JSON.stringify(target.reply.mock.calls);
    expect(replied).not.toContain('db secret xyz');
    expect(replied).toContain('Failed to ban user.');
  });
});

describe('CommandHandler slash failure replies', () => {
  afterEach(() => {
    delete (global as any)._wsManager;
  });

  it('edits the deferred reply when a command throws', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue(['everyone']);
    const handler = new CommandHandler({} as any, {} as any);
    handler.registerCommand('boom', async () => { throw new Error('kaboom'); });
    const interaction: any = Object.create(ChatInputCommandInteraction.prototype);
    Object.assign(interaction, {
      commandName: 'boom',
      deferred: true,
      replied: false,
      user: { id: '1' },
      member: { roles: { cache: { has: () => true } } },
      deferReply: jest.fn(),
      editReply: jest.fn().mockResolvedValue(undefined)
    });

    await handler.handleInteraction(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array)
    }));
    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.embeds[0].toJSON().description).toBe('Something went wrong running that command.');
  });
});

describe('listseasons field chunking', () => {
  it('splits more than 25 seasons across embeds', async () => {
    const seasons = Array.from({ length: 30 }, (_, i) => ({
      seasonNumber: i + 1,
      chapterNumber: 1,
      name: `S${i + 1}`,
      isActive: i === 29,
      startDate: new Date('2024-01-01'),
      endDate: null,
      description: 'd'
    }));
    SeasonModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(seasons) });
    const interaction = { reply: jest.fn().mockResolvedValue({}) } as any;

    await executeListSeasons(interaction);

    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.embeds).toHaveLength(2);
    const fields = payload.embeds.flatMap((e: any) => e.data?.fields ?? e.fields ?? []);
    expect(fields).toHaveLength(30);
  });
});

