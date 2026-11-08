jest.mock('../src/assets/renderer', () => {
  const actual = jest.requireActual('../src/assets/renderer');
  return {
    ...actual,
    renderPng: jest.fn().mockResolvedValue(Buffer.from('image')),
  };
});

jest.mock('../src/assets/assets', () => ({
  loadBustDataUrl: jest.fn().mockResolvedValue(null),
}));

import { generateThemeImage } from '../src/assets/stats-theme/base';
import { renderPng } from '../src/assets/renderer';

const mockedRenderPng = renderPng as jest.MockedFunction<typeof renderPng>;

function playerData(discordid: string, ign: string) {
  return {
    discordid,
    ign,
    wins: 5,
    losses: 2,
    mvps: 1,
    elo: 1200,
  };
}

const helpers = {
  calculatePosition: () => 10,
};

describe('stats image cache', () => {
  it('dedupes concurrent requests and serves the cached buffer', async () => {
    const data = playerData('cache-test-1', 'CacheOne');
    const [first, second] = await Promise.all([
      generateThemeImage(data, [], helpers),
      generateThemeImage(data, [], helpers),
    ]);

    expect(mockedRenderPng).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    const third = await generateThemeImage(data, [], helpers);
    expect(mockedRenderPng).toHaveBeenCalledTimes(1);
    expect(third).toBe(first);
  });

  it('renders a new image for different player data', async () => {
    const data = playerData('cache-test-2', 'CacheTwo');
    await generateThemeImage(data, [], helpers);
    expect(mockedRenderPng).toHaveBeenCalledTimes(1);
  });
});
