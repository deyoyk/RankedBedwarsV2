import { generateThemeImage } from '../src/assets/stats-theme/base';
import { defaultTemplate } from '../src/assets/stats-theme/default';
import { themes, resolveTheme } from '../src/assets/stats-theme';

global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf[0]).toBe(0x89);
  expect(buf.toString('ascii', 1, 4)).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function texts(node: any): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (!node || typeof node !== 'object') return [];
  const kids = node.props?.children;
  return (Array.isArray(kids) ? kids : [kids]).flatMap(texts);
}

function player() {
  return {
    discordid: '123',
    ign: 'LoveDeyo',
    wins: 4,
    losses: 2,
    mvps: 1,
    elo: 1234,
    gamesplayed: 6,
    rankName: 'Coal',
    rankColor: '#A0A0A0',
    wlr: '2.00',
    beds: 3,
    streak: 2,
  };
}

describe('single default theme', () => {
  it('exposes only the default theme', () => {
    expect(themes).toEqual(['default']);
    expect(resolveTheme('elite')).toBe(resolveTheme('anything-else'));
  });
});

describe('html image rendering', () => {
  it('renders the default card at 1200x685', async () => {
    const t0 = Date.now();
    const buf = await generateThemeImage(player(), [], {
      calculatePosition: () => 106,
      calculateRating: (pd: any) => pd.elo,
    });
    const ms = Date.now() - t0;
    expect(pngSize(buf)).toEqual({ width: 1200, height: 685 });
    expect(buf.length).toBeGreaterThan(20000);
    expect(ms).toBeLessThan(15000);
  }, 20000);

  it('default template keeps raw values as text nodes', () => {
    const tpl = defaultTemplate({
      ign: 'LoveDeyo',
      skin: null,
      elo: 1234,
      rankName: 'Coal',
      rankColor: '#A0A0A0',
      wins: '4',
      losses: '2',
      wlr: '2.00',
      mvps: '1',
      beds: '3',
      streak: '+2',
      matches: ['win', 'loss', 'voided', 'active', 'unknown'],
      inviteLink: 'discord.gg/deyobw',
      positions: {
        elo: '#106',
        wins: '#278',
        losses: '#1167',
        wlr: '#26',
        mvps: '#456',
        beds: '#488',
        streak: '#34',
      },
    });
    const all = texts(tpl.root);
    for (const expected of [
      'LoveDeyo', 'ELO', '1234', '[  COAL  ]', 'WINS', 'LOSSES', 'W/L', 'MVPS', 'BEDS',
      'STREAK', 'LAST 10 MATCHES', '.gg/deyobw', '#106', '#278', '#1167', '#26', '#456', '#488', '#34',
    ]) {
      expect(all).toContain(expected);
    }
  });
});
