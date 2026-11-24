const mockRenderPng = jest.fn();
jest.mock('../src/assets/renderer', () => {
  const actual = jest.requireActual('../src/assets/renderer');
  return { ...actual, renderPng: (...args: unknown[]) => mockRenderPng(...args) };
});

jest.mock('../src/assets/assets', () => ({
  loadAvatarDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,'),
  loadSkinDataUrl: jest.fn().mockResolvedValue(null),
  staticImageDataUrl: jest.fn().mockReturnValue('data:image/png;base64,'),
}));

const mockGetDivisionTag = jest.fn();
jest.mock('../src/utils/divisionTags', () => ({
  getDivisionTag: (...args: unknown[]) => mockGetDivisionTag(...args),
}));

import { generateScoreImageBuffer, generateGameStartImageBuffer } from '../src/utils/scoreImage';
import { generateLeaderboardImage } from '../src/utils/leaderboardImage';
import { generateThemeImage } from '../src/assets/stats-theme/base';
import { defaultTemplate } from '../src/assets/stats-theme/default';
import type { DivisionTag } from '../src/assets/divisionTag';

function texts(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (!node || typeof node !== 'object') return [];
  const kids = (node as { props?: { children?: unknown } }).props?.children;
  return (Array.isArray(kids) ? kids : [kids]).flatMap(texts);
}

function statsInput(tag: DivisionTag | null, id: string) {
  return {
    discordid: id,
    ign: `Name${id}`,
    wins: 4,
    losses: 2,
    mvps: 1,
    elo: 1200,
    divisionTag: tag,
  };
}

const helpers = { calculatePosition: () => 1 };

async function renderedTexts(render: () => Promise<Buffer>): Promise<string[]> {
  mockRenderPng.mockClear();
  await render();
  return texts(mockRenderPng.mock.calls[0][0]);
}

beforeEach(() => {
  mockRenderPng.mockReset().mockResolvedValue(Buffer.from('png'));
  mockGetDivisionTag.mockReset().mockResolvedValue(null);
});

describe('division tags on rendered cards', () => {
  it('adds the premium tag to stats, scoring, start and leaderboard cards', async () => {
    mockGetDivisionTag.mockResolvedValue('premium');

    const stats = await renderedTexts(() => generateThemeImage(statsInput('premium', 'premium-stats'), [], helpers));
    expect(stats).toContain('PREMIUM');

    const scoring = await renderedTexts(() => generateScoreImageBuffer(1, [
      { discordId: 'premium-score', username: 'Scored', team: 'winning', elo_before: 1000, elo_after: 1025, mvp: false },
    ], [], {}));
    expect(scoring).toContain('PREMIUM');

    const start = await renderedTexts(() => generateGameStartImageBuffer(2, [
      { discordId: 'premium-start', username: 'Starting', elo: 1000, isCaptain: false },
    ], [], { mapName: 'Boletum', modeLabel: 'RANKED' }));
    expect(start).toContain('PREMIUM');

    const leaderboard = await renderedTexts(() => generateLeaderboardImage('Elo', 'ELO', [
      { rank: 1, ign: 'Boarded', value: 1000, elo: 1000, discordId: 'premium-board' },
    ], 0, 1));
    expect(leaderboard).toContain('PREMIUM');
  });

  it('renders each division label on the stats card', () => {
    const labels: Array<[DivisionTag, string]> = [
      ['premium', 'PREMIUM'],
      ['pugs', 'PUGS'],
      ['pups', 'PUPS'],
      ['pit', 'PIT'],
    ];

    for (const [tag, label] of labels) {
      const tpl = defaultTemplate({
        ign: 'Player',
        skin: null,
        elo: 1000,
        rankName: 'Gold',
        rankColor: '#C99A2E',
        wins: '1',
        losses: '0',
        wlr: '1.00',
        mvps: '0',
        beds: '0',
        streak: '0',
        matches: [],
        inviteLink: 'discord.gg/test',
        divisionTag: tag,
        positions: { elo: '#1', wins: '#1', losses: '#1', wlr: '#1', mvps: '#1', beds: '#1', streak: '#1' },
      });
      expect(texts(tpl.root)).toContain(label);
    }
  });

  it('leaves the tag off when the api returns nothing', async () => {
    mockGetDivisionTag.mockResolvedValue(null);

    const scoring = await renderedTexts(() => generateScoreImageBuffer(3, [
      { discordId: 'none-score', username: 'Scored', team: 'winning', elo_before: 1000, elo_after: 1025, mvp: false },
    ], [], {}));
    const start = await renderedTexts(() => generateGameStartImageBuffer(4, [
      { discordId: 'none-start', username: 'Starting', elo: 1000, isCaptain: false },
    ], [], { mapName: 'Boletum', modeLabel: 'RANKED' }));
    const leaderboard = await renderedTexts(() => generateLeaderboardImage('Elo', 'ELO', [
      { rank: 1, ign: 'Boarded', value: 1000, elo: 1000, discordId: 'none-board' },
    ], 0, 1));
    const stats = await renderedTexts(() => generateThemeImage(statsInput(null, 'none-stats'), [], helpers));

    for (const all of [scoring, start, leaderboard, stats]) {
      for (const label of ['PREMIUM', 'PUGS', 'PUPS', 'PIT']) expect(all).not.toContain(label);
    }
  });
});
