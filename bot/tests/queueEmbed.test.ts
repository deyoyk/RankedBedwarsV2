import { queueSystemEmbed } from '../src/utils/queueEmbed';
import { EMBED_THEME } from '../src/utils/betterembed';

describe('queueSystemEmbed', () => {
  it('uses the Queue header and the brand colour on success', () => {
    const embed = queueSystemEmbed('Opened `Ranked` queues', 'success').toJSON();

    expect(embed.author?.name).toBe(`${EMBED_THEME.brandName} · Queue`);
    expect(embed.title).toBeUndefined();
    expect(embed.color).toBe(EMBED_THEME.successColor);
    expect(embed.description).toBe('Opened `Ranked` queues');
    expect(embed.footer).toBeUndefined();
  });

  it('uses the error colour for errors and keeps the lines as written', () => {
    const embed = queueSystemEmbed(['Something failed', 'Try again'], 'error').toJSON();

    expect(embed.color).toBe(EMBED_THEME.errorColor);
    expect(embed.description).toBe('Something failed\nTry again');
  });

  it('uses the info colour by default', () => {
    const embed = queueSystemEmbed(['First line', '', 'Final line']).toJSON();

    expect(embed.color).toBe(EMBED_THEME.defaultColor);
    expect(embed.description).toBe('First line\n\nFinal line');
  });

  it('splits embedded newlines', () => {
    const embed = queueSystemEmbed('one\ntwo', 'success').toJSON();

    expect(embed.description).toBe('one\ntwo');
  });
});
