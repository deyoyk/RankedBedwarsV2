import { ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../src/utils/safeReply';

function interaction(overrides: Record<string, unknown> = {}) {
  const value: any = Object.create(ChatInputCommandInteraction.prototype);
  Object.defineProperties(value, {
    replied: { value: false, writable: true, configurable: true },
    deferred: { value: false, writable: true, configurable: true },
  });
  value.reply = jest.fn().mockResolvedValue({});
  value.editReply = jest.fn().mockResolvedValue({});
  value.followUp = jest.fn().mockResolvedValue({});
  value.webhook = { send: jest.fn().mockResolvedValue({}) };
  Object.assign(value, overrides);
  return value;
}

describe('safeReply interaction recovery', () => {
  it('replies normally when the interaction has not been acknowledged', async () => {
    const target = interaction();

    await safeReply(target, 'hello');

    expect(target.reply).toHaveBeenCalledWith('hello');
  });

  it('edits the deferred reply', async () => {
    const target = interaction({ deferred: true });

    await safeReply(target, 'hello');

    expect(target.editReply).toHaveBeenCalledWith('hello');
  });

  it('falls back to followUp when the interaction was already acknowledged', async () => {
    const target = interaction({ replied: true });

    await safeReply(target, 'hello');

    expect(target.followUp).toHaveBeenCalledWith('hello');
  });

  it('recovers through the interaction webhook when reply returns 40060', async () => {
    const target = interaction();
    target.reply.mockRejectedValue(Object.assign(new Error('Already acknowledged'), { code: 40060 }));

    await expect(safeReply(target, 'hello')).resolves.toBeDefined();

    expect(target.followUp).not.toHaveBeenCalled();
    expect(target.webhook.send).toHaveBeenCalledWith('hello');
  });

  it('drops the response when the interaction expired (10062)', async () => {
    const target = interaction();
    target.reply.mockRejectedValue(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(safeReply(target, 'hello')).resolves.toBeNull();

    expect(target.followUp).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops the response when the deferred message no longer exists (10008)', async () => {
    const target = interaction({ deferred: true });
    target.editReply.mockRejectedValue(Object.assign(new Error('Unknown Message'), { code: 10008 }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(safeReply(target, 'hello')).resolves.toBeNull();

    expect(target.followUp).not.toHaveBeenCalled();
    expect(target.webhook.send).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('silently drops a follow-up that Discord can no longer deliver', async () => {
    const target = interaction({ replied: true });
    target.followUp.mockRejectedValue(Object.assign(new Error('Unknown Message'), { code: 10008 }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(safeReply(target, 'hello')).resolves.toBeNull();

    expect(target.webhook.send).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it('drops a recovery follow-up that is no longer deliverable', async () => {
    const target = interaction({ replied: true });
    target.followUp.mockRejectedValue(new Error('network down'));
    target.webhook.send.mockRejectedValue(Object.assign(new Error('Unknown Message'), { code: 10008 }));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(safeReply(target, 'hello')).resolves.toBeNull();

    expect(target.webhook.send).toHaveBeenCalledWith('hello');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
