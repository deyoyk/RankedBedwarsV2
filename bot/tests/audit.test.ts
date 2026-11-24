import mongoose from 'mongoose';
import AuditLog from '../src/models/AuditLog';
import {
  auditTargetFromOptions,
  describeCommandOptions,
  isAuditStorageReady,
  recordAudit,
} from '../src/services/AuditService';

const mockedCreate = AuditLog.create as unknown as jest.Mock;

function setReady(ready: boolean): void {
  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    get: () => (ready ? 1 : 0),
  });
}

function interactionWithData(data: unknown[]) {
  return {
    options: { data },
    user: { id: 'actor-1', username: 'Staff', tag: 'Staff#0001' },
    guildId: 'guild-1',
    channelId: 'channel-1',
  } as any;
}

describe('AuditService', () => {
  beforeEach(() => {
    mockedCreate.mockClear();
  });

  afterEach(() => {
    delete (mongoose.connection as unknown as { readyState?: unknown }).readyState;
  });

  it('writes normalized audit entries when MongoDB is connected', async () => {
    setReady(true);
    expect(isAuditStorageReady()).toBe(true);

    await recordAudit({
      action: 'stats.edit',
      category: 'stats',
      source: 'discord',
      actorId: 'actor-1',
      targetType: 'user',
      targetId: 'target-1',
      before: { elo: 100 },
      after: { elo: 200 },
      metadata: { stat: 'elo' },
    });

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'stats.edit',
      category: 'stats',
      source: 'discord',
      success: true,
      actorId: 'actor-1',
      targetId: 'target-1',
      before: { elo: 100 },
      after: { elo: 200 },
      metadata: { stat: 'elo' },
      createdAt: expect.any(Date),
    }));
  });

  it('defaults category/source/result and never throws when the write fails', async () => {
    setReady(true);
    mockedCreate.mockRejectedValueOnce(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(recordAudit({ action: 'system.test' })).resolves.toBeUndefined();
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({
      category: 'system',
      source: 'system',
      success: true,
    }));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not attempt a write while MongoDB is disconnected', async () => {
    setReady(false);
    await recordAudit({ action: 'system.test' });
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('command audit serialization', () => {
  it('turns nested options, users, roles, channels and attachments into plain data', () => {
    const interaction = interactionWithData([
      {
        name: 'edit',
        type: 1,
        options: [
          { name: 'user', type: 6, user: { id: 'target-1', username: 'Target' } },
          { name: 'stat', type: 3, value: 'elo' },
        ],
      },
      { name: 'role', type: 8, role: { id: 'role-1', name: 'Admin' } },
      { name: 'channel', type: 7, channel: { id: 'channel-2', name: 'general' } },
      { name: 'proof', type: 11, attachment: { id: 'file-1', name: 'proof.png', url: 'https://example.com/proof.png' } },
    ]);

    expect(describeCommandOptions(interaction)).toEqual({
      edit: {
        user: { id: 'target-1', username: 'Target' },
        stat: 'elo',
      },
      role: { id: 'role-1', name: 'Admin' },
      channel: { id: 'channel-2', name: 'general' },
      proof: { id: 'file-1', name: 'proof.png', url: 'https://example.com/proof.png' },
    });
  });

  it('extracts user targets from user, user_id and nested subcommands', () => {
    expect(auditTargetFromOptions(interactionWithData([
      { name: 'user', type: 6, user: { id: 'target-1', username: 'Target' } },
    ]))).toEqual({ targetType: 'user', targetId: 'target-1', targetName: 'Target' });

    expect(auditTargetFromOptions(interactionWithData([
      { name: 'user_id', type: 3, value: '123456789012345678' },
    ]))).toEqual({ targetType: 'user', targetId: '123456789012345678' });

    expect(auditTargetFromOptions(interactionWithData([
      { name: 'mute', type: 1, options: [{ name: 'user', type: 6, user: { id: 'target-2', username: 'Other' } }] },
    ]))).toEqual({ targetType: 'user', targetId: 'target-2', targetName: 'Other' });
  });

  it('handles interactions without option data', () => {
    expect(describeCommandOptions({ options: {} } as any)).toEqual({});
    expect(auditTargetFromOptions({ options: {} } as any)).toBeUndefined();
  });
});

describe('AuditLog schema', () => {
  it('has indexed audit fields and an immutable-looking timestamp', () => {
    const ActualAuditLog = jest.requireActual('../src/models/AuditLog').default as typeof AuditLog;
    for (const path of ['action', 'category', 'actorId', 'targetId', 'commandName', 'source', 'success', 'createdAt']) {
      expect(ActualAuditLog.schema.path(path)).toBeDefined();
    }
    const indexes = ActualAuditLog.schema.indexes().map(([fields]) => Object.keys(fields));
    const hasIndex = (a: string, b: string) => indexes.some(fields => fields.includes(a) && fields.includes(b));
    expect(hasIndex('createdAt', 'createdAt')).toBe(true);
    expect(hasIndex('action', 'createdAt')).toBe(true);
    expect(hasIndex('actorId', 'createdAt')).toBe(true);
    expect(hasIndex('targetId', 'createdAt')).toBe(true);
  });
});
