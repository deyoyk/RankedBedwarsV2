import mongoose from 'mongoose';
import { BanManager } from '../src/managers/BanManager';
import { MuteManager } from '../src/managers/MuteManager';
import { StrikeManager } from '../src/managers/StrikeManager';

const mockSave = jest.fn().mockImplementation(() => Promise.resolve());

const mockUser = (): any => ({
  discordId: '123',
  ign: 'Steve',
  elo: 1000,
  isbanned: false,
  ismuted: false,
  bans: [] as any[],
  mutes: [] as any[],
  strikes: [] as any[],
  save: mockSave
});

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    find: jest.fn()
  }
}));

const UserModel = require('../src/models/User').default;

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    roles: {
      banned: 'bannedRoleId',
      muted: 'mutedRoleId'
    },
    strikes: {
      1: 'warn',
      2: '10h',
      default: 'warn'
    }
  }
}));

jest.mock('../src/utils/punishmentEmbed', () => ({
  sendPunishmentEmbed: jest.fn().mockResolvedValue(undefined)
}));

const guildMock = () => ({
  members: {
    cache: {
      get: jest.fn().mockReturnValue({
        roles: { add: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) }
      })
    },
    ban: jest.fn().mockResolvedValue(undefined),
    unban: jest.fn().mockResolvedValue(undefined)
  }
});

beforeEach(() => {
  mockSave.mockClear();
  jest.clearAllMocks();
});

describe('BanManager.ban', () => {
  it('persists a ban with a valid ObjectId', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    const expires = await BanManager.ban(guildMock() as any, '123', 'mod', '1h', 'Being toxic');

    expect(expires).toBeInstanceOf(Date);
    expect(user.bans).toHaveLength(1);
    expect(mongoose.isValidObjectId(user.bans[0].id)).toBe(true);
    expect(user.isbanned).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  it('creates a permanent ban when duration is omitted', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    const expires = await BanManager.ban(guildMock() as any, '123', 'mod', '', 'Cheating');
    expect(expires).toBeUndefined();
    expect(user.bans[0].duration).toBe(0);
  });

  it('rejects durations under 1 minute', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    await expect(BanManager.ban(guildMock() as any, '123', 'mod', '30s', 'test'))
      .rejects.toThrow('Ban duration must be at least 1 minute');
    expect(user.bans).toHaveLength(0);
  });

  it('throws on invalid duration instead of permanent banning', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    await expect(BanManager.ban(guildMock() as any, '123', 'mod', 'not-a-duration', 'test'))
      .rejects.toThrow();
    expect(user.bans).toHaveLength(0);
    expect(user.isbanned).toBe(false);
  });

  it('does not duplicate records when re-banning, updates existing instead', async () => {
    const user = mockUser();
    user.isbanned = true;
    user.bans.push({
      id: new mongoose.Types.ObjectId().toString(),
      reason: 'old reason',
      date: new Date('2024-01-01'),
      duration: 60,
      moderator: 'oldmod'
    });
    UserModel.findOne.mockResolvedValue(user);

    await BanManager.ban(guildMock() as any, '123', 'mod', '2h', 'new reason');

    expect(user.bans).toHaveLength(1);
    expect(user.bans[0].reason).toBe('new reason');
    expect(user.bans[0].moderator).toBe('mod');
    expect(user.bans[0].duration).toBe(120);
  });

  it('rejects when target user does not exist', async () => {
    UserModel.findOne.mockResolvedValue(null);
    await expect(BanManager.ban(guildMock() as any, 'nobody', 'mod', '1h', 'test'))
      .rejects.toThrow('User nobody not found in database');
  });
});

describe('BanManager.unban', () => {
  it('clears the ban status and saves', async () => {
    const user = mockUser();
    user.isbanned = true;
    UserModel.findOne.mockResolvedValue(user);

    await BanManager.unban(guildMock() as any, '123', 'mod', 'Expired');

    expect(user.isbanned).toBe(false);
    expect(mockSave).toHaveBeenCalled();
  });

  it('does nothing for users who are not banned', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    await BanManager.unban(guildMock() as any, '123', 'mod');
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('MuteManager.mute', () => {
  it('persists a mute with a valid ObjectId', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    const expires = await MuteManager.mute(guildMock() as any, '123', 'mod', '1h', 'Spamming');

    expect(expires).toBeInstanceOf(Date);
    expect(user.mutes).toHaveLength(1);
    expect(mongoose.isValidObjectId(user.mutes[0].id)).toBe(true);
    expect(user.ismuted).toBe(true);
  });

  it('rejects invalid durations', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    await expect(MuteManager.mute(guildMock() as any, '123', 'mod', 'banana', 'Spamming'))
      .rejects.toThrow();
    expect(user.mutes).toHaveLength(0);
  });

  it('does not duplicate records when re-muting', async () => {
    const user = mockUser();
    user.ismuted = true;
    user.mutes.push({
      id: new mongoose.Types.ObjectId().toString(),
      reason: 'old',
      date: new Date(),
      duration: 60,
      moderator: 'oldmod'
    });
    UserModel.findOne.mockResolvedValue(user);

    await MuteManager.mute(guildMock() as any, '123', 'mod', '3h', 'new reason');
    expect(user.mutes).toHaveLength(1);
    expect(user.mutes[0].reason).toBe('new reason');
    expect(user.mutes[0].duration).toBe(180);
  });
});

describe('StrikeManager.strike', () => {
  it('persists a strike with a valid ObjectId', async () => {
    const user = mockUser();
    UserModel.findOne.mockResolvedValue(user);

    const result = await StrikeManager.strike(guildMock() as any, '123', 'mod', 'Cheating');

    expect(user.strikes).toHaveLength(1);
    expect(mongoose.isValidObjectId(user.strikes[0].id)).toBe(true);
    expect(result.strikeCount).toBe(1);
  });

  it('removes the last strike on unstrike', async () => {
    const user = mockUser();
    user.strikes = [
      { id: new mongoose.Types.ObjectId().toString(), reason: 'a', date: new Date(), moderator: 'm1' },
      { id: new mongoose.Types.ObjectId().toString(), reason: 'b', date: new Date(), moderator: 'm2' }
    ];
    UserModel.findOne.mockResolvedValue(user);

    const result = await StrikeManager.unstrike(guildMock() as any, '123', 'mod');
    expect(user.strikes).toHaveLength(1);
    expect(result.strikeCount).toBe(1);
    expect(result.removedStrike.reason).toBe('b');
  });
});
