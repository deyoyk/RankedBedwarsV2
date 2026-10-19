import { generateScoreImageBuffer } from '../src/utils/scoreImage';
import { generateThemeImage } from '../src/themes/base';
import { scoreTemplate } from '../src/images/templates/score';
import { defaultTemplate } from '../src/images/templates/default';
import { staticImageDataUrl } from '../src/images/assets';
import { themes, resolveTheme } from '../src/themes';

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

function enrichedPlayer() {
  return {
    discordid: '123',
    ign: 'TestPlayer',
    wins: 5,
    losses: 0,
    mvps: 0,
    elo: 50,
    gamesplayed: 5,
    games: 5,
    joined: 'Joined Jun 15, 2026',
    level: 3,
    xpToNext: 70,
    xpProgress: 0.3,
    winRate: 1,
    winCaption: '100.0% win rate · 5 games',
    tiles: [
      { value: '5', label: 'Wins', accent: '#00e676', rank: '#278' },
      { value: '0', label: 'Losses', accent: '#ff5252', rank: '#1167' },
      { value: '5.00', label: 'W/L ratio', accent: '#8b5cf6', rank: '#26' },
      { value: '42', label: 'Total Kills', accent: '#8b5cf6', rank: '#328' },
      { value: '0.95', label: 'K/D ratio', accent: '#00e5ff', rank: '#416' },
      { value: '0', label: 'MVPs', accent: '#ffd600', rank: '#456' },
      { value: '+5', label: 'Streak', accent: '#ff9100', rank: '#34' },
      { value: '49m', label: 'Playtime', accent: '#ffd600', rank: '#406' },
    ],
    combat: [
      { value: '3', label: 'Final Kills', accent: '#8b5cf6', rank: '#377' },
      { value: '0', label: 'Beds Broken', accent: '#8b5cf6', rank: '#488' },
      { value: '7', label: 'Final Deaths', accent: '#8b5cf6', rank: '#290' },
    ],
    seasonLine1: 'YEAR 26 SEASON 1',
    seasonLine2: 'July 22, 2026',
  };
}

describe('single default theme', () => {
  it('exposes only the default theme', () => {
    expect(themes).toEqual(['default']);
    expect(resolveTheme('elite')).toBe(resolveTheme('anything-else'));
  });
});

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

  it('renders the default card at 1400x940 with all sections', async () => {
    const t0 = Date.now();
    const buf = await generateThemeImage(enrichedPlayer(), [], {
      calculatePosition: () => 106,
      calculateRating: (pd: any) => pd.elo,
    });
    const ms = Date.now() - t0;
    expect(pngSize(buf)).toEqual({ width: 1400, height: 940 });
    expect(buf.length).toBeGreaterThan(20000);
    expect(ms).toBeLessThan(15000);
  }, 20000);

  it('default template keeps raw values as text nodes', () => {
    const tpl = defaultTemplate({
      ign: '<Hacker>',
      joined: 'Joined Jun 15, 2026',
      level: 3,
      xpToNext: 70,
      xpProgress: 0.3,
      skin: null,
      elo: 50,
      globalRank: 106,
      wins: '5',
      losses: '0',
      winRate: 1,
      winCaption: '100.0% win rate · 5 games',
      tiles: enrichedPlayer().tiles,
      combat: enrichedPlayer().combat,
      seasonLine1: 'YEAR 26 SEASON 1',
      seasonLine2: 'July 22, 2026',
    });
    const all = texts(tpl.root);
    for (const expected of ['<Hacker>', 'RECORD', 'COMBAT', 'W/L ratio', 'RBW.GG', '#278', '50 RR', 'Final Deaths', 'LEVEL PROGRESS']) {
      expect(all).toContain(expected);
    }
  });
});
