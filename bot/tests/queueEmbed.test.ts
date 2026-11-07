import { queueSystemEmbed } from '../src/utils/queueEmbed';
import { EMBED_THEME } from '../src/utils/betterembed';

describe('queueSystemEmbed', () => {
  it('uses the shared success theme and the queue system title', () => {
    const embed = queueSystemEmbed('Successfully opened `Ranked` queues', 'success').toJSON();

    expect(embed.title).toBe('Success: Queue System');
    expect(embed.color).toBe(EMBED_THEME.successColor);
    expect(embed.description).toBe('> Successfully opened `Ranked` queues');
    expect(embed.footer?.text).toBe(EMBED_THEME.footer);
    expect(embed.timestamp).toBeDefined();
  });

  it('uses the shared error theme and a single summary quote', () => {
    const embed = queueSystemEmbed(['Something failed', 'Try again'], 'error').toJSON();

    expect(embed.title).toBe('Error: Queue System');
    expect(embed.color).toBe(EMBED_THEME.errorColor);
    expect(embed.description).toBe('> Something failed\n\nTry again');
  });

  it('uses the shared info theme', () => {
    const embed = queueSystemEmbed(['First line', '', 'Final line']).toJSON();

    expect(embed.title).toBe('Info: Queue System');
    expect(embed.color).toBe(EMBED_THEME.defaultColor);
    expect(embed.description).toBe('> First line\n\nFinal line');
  });

  it('splits embedded newlines and keeps one quoted summary', () => {
    const embed = queueSystemEmbed('one\ntwo', 'success').toJSON();

    expect(embed.description).toBe('> one\n\ntwo');
  });
});
