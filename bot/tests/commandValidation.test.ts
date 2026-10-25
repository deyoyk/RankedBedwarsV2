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
import { escapeRegex } from '../src/utils/regexEscape';

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

function message(argsReply = true) {
  void argsReply;
  return {
    content: '',
    author: { id: '999000000000000001' },
    member: null,
    guild: { id: 'guild1', members: { cache: { get: () => undefined } } },
    reply: jest.fn().mockResolvedValue({})
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
    const interaction = message();

    await edit(interaction, ['<@123456789012345678>', 'elo', 'Infinity']);
    await edit(interaction, ['<@123456789012345678>', 'wins', '-3']);

    expect(UserModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(user.elo).toBe(1000);
    expect(interaction.reply).toHaveBeenCalledTimes(2);
  });

  it('accepts finite non-negative values with a single atomic update', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);
    UserModel.findOneAndUpdate.mockResolvedValue({ ...user, elo: 1500 });
    const interaction = message();

    await edit(interaction, ['<@123456789012345678>', 'elo', '1500']);

    expect(UserModel.findOneAndUpdate).toHaveBeenCalledWith(
      { discordId: '123456789012345678' },
      { $set: { elo: 1500 } },
      { new: true }
    );
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });
});

describe('forceregister and forcerename validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid discord ids', async () => {
    const interaction = message();
    await forceregister(interaction, ['notanid', 'Steve']);
    expect(UserModel.findOne).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });

  it('rejects invalid IGNs', async () => {
    const interaction = message();
    await forceregister(interaction, ['<@123456789012345678>', 'x!']);
    expect(UserModel.findOne).not.toHaveBeenCalled();
  });

  it('escapes regex metacharacters in the IGN lookup', async () => {
    expect(escapeRegex('a.c')).toBe('a\\.c');
    UserModel.findOne.mockImplementation(async (query: any) => {
      if (query.ign) {
        expect(query.ign.$options).toBe('i');
        return null;
      }
      return mockUser();
    });
    const interaction = message();
    await forceregister(interaction, ['<@123456789012345678>', 'abc']);
    expect(UserModel.findOne).toHaveBeenCalled();
  });

  it('forcerename rejects invalid ids and IGNs', async () => {
    const badId = message();
    await forcerename(badId, ['junk', 'Steve']);
    expect(UserModel.findOne).not.toHaveBeenCalled();

    const badIgn = message();
    await forcerename(badIgn, ['<@123456789012345678>', 'no good!']);
    expect(UserModel.findOne).not.toHaveBeenCalled();
  });
});

describe('score and void prefix validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects non numeric game ids and out of range teams', async () => {
    const badId = message();
    await score(badId, ['abc', '1', 'Steve']);
    expect(GameModel.findOne).not.toHaveBeenCalled();

    const badTeam = message();
    await score(badTeam, ['42', '3', 'Steve']);
    expect(GameModel.findOne).not.toHaveBeenCalled();
  });

  it('rejects non numeric void targets', async () => {
    const interaction = message();
    await voidGame(interaction, ['NaN']);
    expect(GameModel.findOne).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });
});

describe('addqueue prefix validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    QueueModel.findOne = jest.fn().mockResolvedValue(null);
  });

  it('reads bypass roles from the seventh argument', async () => {
    const interaction = message();
    await addqueue(interaction,
      ['1352587524475713619', '8', '0', '3000', 'true', 'false', '111111111111111111,222222222222222222']);

    expect(QueueModel).toHaveBeenCalledWith(expect.objectContaining({
      maxPlayers: 8,
      bypassRoles: ['111111111111111111', '222222222222222222']
    }));
  });

  it('rejects inverted elo ranges and tiny lobbies', async () => {
    const badRange = message();
    await addqueue(badRange, ['1352587524475713619', '8', '3000', '0', 'true', 'false']);
    expect(QueueModel).not.toHaveBeenCalled();

    const tiny = message();
    await addqueue(tiny, ['1352587524475713619', '1', '0', '3000', 'true', 'false']);
    expect(QueueModel).not.toHaveBeenCalled();
  });
});

describe('lose prefix validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects non mentions without touching the database', async () => {
    const interaction = message();
    await lose(interaction, ['somestring']);
    expect(UserModel.findOne).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });
});

describe('moderation error replies hide internals', () => {
  it('does not leak manager errors to users', async () => {
    const interaction = message();
    await executeModerationAction(interaction, ['<@123456789012345678>', '1h', 'spam'], {
      commandName: 'ban',
      actionVerb: 'Banned',
      hasDuration: true,
      managerCall: async () => { throw new Error('db secret xyz'); }
    });
    const replied = JSON.stringify(interaction.reply.mock.calls);
    expect(replied).not.toContain('db secret xyz');
    expect(replied).toContain('Failed to ban user.');
  });
});

describe('CommandHandler slash failure replies', () => {
  afterEach(() => {
    delete (global as any)._wsManager;
  });

  it('edits the deferred reply when a command throws', async () => {
    (global as any)._wsManager = { getPermission: () => ['everyone'] };
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

    expect(interaction.editReply).toHaveBeenCalledWith('Something went wrong running that command.');
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

