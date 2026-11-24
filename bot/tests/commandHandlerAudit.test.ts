jest.mock('../src/services/AuditService', () => {
  const actual = jest.requireActual('../src/services/AuditService');
  return { ...actual, recordAudit: jest.fn().mockResolvedValue(undefined) };
});

import { ChatInputCommandInteraction } from 'discord.js';
import { CommandHandler } from '../src/handlers/CommandHandler';
import { PermissionService } from '../src/services/PermissionService';
import { recordAudit } from '../src/services/AuditService';

const mockedAudit = recordAudit as unknown as jest.Mock;

function interactionDouble(overrides: Record<string, unknown> = {}) {
  const value: any = Object.create(ChatInputCommandInteraction.prototype);
  Object.defineProperties(value, {
    replied: { value: false, writable: true, configurable: true },
    deferred: { value: false, writable: true, configurable: true },
  });
  value.commandName = 'test';
  value.user = { id: 'actor-1', username: 'Staff', tag: 'Staff#0001' };
  value.guildId = 'guild-1';
  value.channelId = 'channel-1';
  value.memberPermissions = { has: () => false };
  value.options = { data: [{ name: 'user', type: 6, user: { id: 'target-1', username: 'Target' } }] };
  value.deferReply = jest.fn().mockResolvedValue(undefined);
  value.reply = jest.fn().mockResolvedValue({});
  value.editReply = jest.fn().mockResolvedValue({});
  value.followUp = jest.fn().mockResolvedValue({});
  Object.assign(value, overrides);
  return value;
}

describe('CommandHandler audit trail', () => {
  beforeEach(() => {
    mockedAudit.mockClear();
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue(['everyone']);
  });

  it('records a successful command with actor, target, options and duration', async () => {
    const handler = new CommandHandler({} as any, {} as any);
    handler.registerCommand('test', jest.fn().mockResolvedValue(undefined));

    await handler.handleInteraction(interactionDouble());

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'command.execute',
      category: 'command',
      commandName: 'test',
      success: true,
      actorId: 'actor-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      targetType: 'user',
      targetId: 'target-1',
      metadata: expect.objectContaining({
        durationMs: expect.any(Number),
        options: { user: { id: 'target-1', username: 'Target' } },
      }),
    }));
  });

  it('records a permission denial', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue(['staff-role']);
    const handler = new CommandHandler({} as any, {} as any);
    const run = jest.fn();
    handler.registerCommand('test', run);

    await handler.handleInteraction(interactionDouble());

    expect(run).not.toHaveBeenCalled();
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'command.denied',
      success: false,
      commandName: 'test',
      error: 'Permission denied',
    }));
  });

  it('records a thrown command failure and still reports it', async () => {
    const handler = new CommandHandler({} as any, {} as any);
    handler.registerCommand('test', jest.fn().mockRejectedValue(new Error('boom')));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await handler.handleInteraction(interactionDouble());

    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'command.failed',
      success: false,
      commandName: 'test',
      error: 'boom',
    }));
    error.mockRestore();
  });
});
