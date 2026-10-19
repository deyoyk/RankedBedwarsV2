import { generateScoreImageBuffer } from '../src/utils/scoreImage';
import { generateThemeImage } from '../src/themes/base';
import { scoreTemplate } from '../src/images/templates/score';
import { themeTemplate } from '../src/images/templates/theme';
import { staticImageDataUrl } from '../src/images/assets';
import { themes } from '../src/themes';

jest.mock('node-fetch', () => jest.fn().mockRejectedValue(new Error('offline')));

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

function countText(node: any, text: string): number {
  if (!node || typeof node !== 'object') return 0;
  let n = 0;
  const kids = node.props?.children;
  for (const k of (Array.isArray(kids) ? kids : [kids])) {
    if (k === text) n += 1;
    else n += countText(k, text);
  }
  return n;
}

const avatar = staticImageDataUrl('fallbacks', 'steve.png');

function player(username: string, mvp = false) {
  return { discordId: username, username, team: 'winning' as const, oldElo: 1000, newElo: 1030, mvp };
}

describe('score template', () => {
  it('keeps user input as text and marks only the mvp', () => {
    const tpl = scoreTemplate({
      gameId: 7,
      winners: [{ ...player('<Bob>', true), avatar }],
      losers: [{ ...player('Eve'), avatar }],
      serverName: 'Test',
      inviteLink: 'discord.gg/test',
    });
    const all = texts(tpl.root);
    expect(all).toContain('GAME #7');
    expect(all).toContain('<Bob>');
    expect(countText(tpl.root, 'MVP')).toBe(1);
  });
});

describe('html image rendering', () => {
  it('renders the score image at 1920x1080', async () => {
    const t0 = Date.now();
    const buf = await generateScoreImageBuffer(7, [player('Alice', true), player('Bob')], [player('Cara'), player('Dan')]);
    const ms = Date.now() - t0;
    expect(pngSize(buf)).toEqual({ width: 1920, height: 1080 });
    expect(buf.length).toBeGreaterThan(20000);
    expect(ms).toBeLessThan(15000);
  }, 20000);

  it.each(themes)('renders the %s theme at 1240x698', async (theme) => {
    const t0 = Date.now();
    const buf = await generateThemeImage(theme, {
      discordid: '123',
      ign: 'TestPlayer',
      wins: 12,
      losses: 4,
      mvps: 3,
      elo: 1450,
      gamesplayed: 16,
    }, [
      { gameid: 1, result: 'win' },
      { gameid: 2, result: 'lose' },
      { gameid: 3, result: 'voided' },
    ], {
      calculatePosition: () => 5,
      calculateRating: (pd) => pd.elo,
    });
    const ms = Date.now() - t0;
    expect(pngSize(buf)).toEqual({ width: 1240, height: 698 });
    expect(buf.length).toBeGreaterThan(20000);
    expect(ms).toBeLessThan(15000);
  }, 20000);

  it('theme template keeps the ign as text', () => {
    const tpl = themeTemplate({
      theme: 'elite',
      serverName: 'S',
      inviteLink: 'I',
      ign: '<Hacker>',
      skin: null,
      wins: '1',
      rank: '#1',
      mvps: '0',
      rating: '1000',
      wlr: '1.0 W/L',
      mvpRate: '0% RATE',
      recent: [],
    });
    expect(texts(tpl.root)).toContain('<Hacker>');
  });
});
