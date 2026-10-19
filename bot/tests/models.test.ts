import mongoose from 'mongoose';
import UserModel from '../src/models/User';
import QueueModel from '../src/models/Queue';

describe('User schema', () => {
  it('rejects a non-ObjectId punishment id', () => {
    const idPath = (UserModel.schema.path('bans') as any).caster.schema.path('id');
    expect(() => idPath.cast('not-an-objectid')).toThrow();
    expect(() => idPath.cast('aB3xY9zQ1')).toThrow();
  });

  it('accepts a valid 24-hex ObjectId punishment id', () => {
    const idPath = (UserModel.schema.path('bans') as any).caster.schema.path('id');
    const validId = new mongoose.Types.ObjectId().toString();
    expect(idPath.cast(validId).toString()).toBe(validId);
  });

  it('auto-generates ObjectIds for punishment records when omitted', () => {
    const user = new UserModel({
      discordId: 'x3',
      ign: 'Steve',
      strikes: [{ reason: 'r', date: new Date(), moderator: 'm' }]
    });
    expect(mongoose.isValidObjectId(user.strikes[0].id)).toBe(true);
  });

  it('stores the nickname under settings.nick', async () => {
    const user = new UserModel({ discordId: 'x4', ign: 'Steve' });
    user.settings.nick = 'Sweaty';
    const doc = user.toObject();
    expect((doc.settings as any).nick).toBe('Sweaty');
    expect((doc as any).nick).toBeUndefined();
  });
});

describe('Queue schema', () => {
  it('accepts queue config and defaults isActive to true', () => {
    const queue = new QueueModel({
      channelId: 'chan-1',
      maxPlayers: 4,
      minElo: 0,
      maxElo: 2000,
      isRanked: true,
      ispicking: false,
      bypassRoles: []
    });
    expect(queue.isActive).toBe(true);
  });
});
