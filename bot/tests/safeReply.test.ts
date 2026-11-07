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

  it('recovers with followUp when reply returns 40060', async () => {
    const target = interaction();
    target.reply.mockRejectedValue(Object.assign(new Error('Already acknowledged'), { code: 40060 }));

    await expect(safeReply(target, 'hello')).resolves.toBeDefined();

    expect(target.followUp).toHaveBeenCalledWith('hello');
  });

  it('drops the response when the interaction expired (10062)', async () => {
    const target = interaction();
    target.reply.mockRejectedValue(Object.assign(new Error('Unknown interaction'), { code: 10062 }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(safeReply(target, 'hello')).resolves.toBeNull();

    expect(target.followUp).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
