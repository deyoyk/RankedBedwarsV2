import { ChatInputCommandInteraction } from 'discord.js';
import { CommandHandler } from '../src/handlers/CommandHandler';

function interactionDouble(overrides: Record<string, unknown> = {}) {
  const value: any = Object.create(ChatInputCommandInteraction.prototype);
  Object.defineProperties(value, {
    replied: { value: false, writable: true, configurable: true },
    deferred: { value: false, writable: true, configurable: true },
  });
  value.commandName = 'test';
  value.deferReply = jest.fn().mockResolvedValue(undefined);
  value.reply = jest.fn().mockResolvedValue({});
  value.editReply = jest.fn().mockResolvedValue({});
  value.followUp = jest.fn().mockResolvedValue({});
  value.options = { getInteger: jest.fn(), getString: jest.fn() };
  Object.assign(value, overrides);
  return value;
}

describe('CommandHandler expired interaction guard', () => {
  beforeEach(() => {
    (global as any)._wsManager = { getPermission: () => ['everyone'] };
  });

  afterEach(() => {
    delete (global as any)._wsManager;
  });

  it('skips the command when the interaction expired before defer', async () => {
    const handler = new CommandHandler({} as any, {} as any);
    const run = jest.fn().mockResolvedValue(undefined);
    handler.registerCommand('test', run);
    const target = interactionDouble();
    target.deferReply.mockRejectedValue(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await handler.handleInteraction(target);

    expect(run).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still runs the command when another path already acknowledged it', async () => {
    const handler = new CommandHandler({} as any, {} as any);
    const run = jest.fn().mockResolvedValue(undefined);
    handler.registerCommand('test', run);
    const target = interactionDouble();
    target.deferReply.mockRejectedValue(Object.assign(new Error('Already acknowledged'), { code: 40060 }));

    await handler.handleInteraction(target);

    expect(run).toHaveBeenCalledWith(target, expect.anything());
  });

  it('ignores duplicate dispatch of the same interaction', async () => {
    const handler = new CommandHandler({} as any, {} as any);
    const run = jest.fn().mockResolvedValue(undefined);
    handler.registerCommand('test', run);
    const target = interactionDouble({ id: 'interaction-1' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await handler.handleInteraction(target);
    await handler.handleInteraction(target);

    expect(run).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
