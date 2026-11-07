import { queueSystemEmbed } from '../src/utils/queueEmbed';

describe('queueSystemEmbed', () => {
  it('uses the queue system title and purple accent', () => {
    const embed = queueSystemEmbed('Successfully opened `Ranked` queues', 'success').toJSON();

    expect(embed.title).toBe('Queue System');
    expect(embed.color).toBe(0x71368A);
    expect(embed.description).toBe('> Successfully opened `Ranked` queues ✓');
    expect(embed.timestamp).toBeDefined();
  });

  it('adds the error marker to the last line', () => {
    const embed = queueSystemEmbed(['Something failed', 'Try again'], 'error').toJSON();

    expect(embed.description).toBe('> Something failed\n> Try again ✗');
  });

  it('blockquotes every line and leaves info without a symbol', () => {
    const embed = queueSystemEmbed(['First line', '', 'Final line']).toJSON();

    expect(embed.description).toBe('> First line\n> \n> Final line');
  });

  it('splits embedded newlines into separate quote lines', () => {
    const embed = queueSystemEmbed('one\ntwo', 'success').toJSON();

    expect(embed.description).toBe('> one\n> two ✓');
  });
});
