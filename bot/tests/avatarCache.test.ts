import { loadAvatarDataUrl, loadSkinDataUrl, staticImageDataUrl } from '../src/assets/assets';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function okResponse(): unknown {
  return {
    ok: true,
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    headers: { get: () => 'image/png' },
  };
}

describe('avatar download cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue(okResponse());
  });

  it('fetches once and serves repeats from cache', async () => {
    const first = await loadAvatarDataUrl('CacheHitSteve');
    const second = await loadAvatarDataUrl('cachehitsteve');
    expect(first).toContain('data:image/png;base64,');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent requests for the same username', async () => {
    const [a, b, c] = await Promise.all([
      loadAvatarDataUrl('DedupeDave'),
      loadAvatarDataUrl('dedupedave'),
      loadAvatarDataUrl('DEDUPEDAVE'),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the bundled steve avatar when the CDN fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const first = await loadAvatarDataUrl('OfflineOlivia');
    expect(first).toBe(staticImageDataUrl('fallbacks', 'steve.png'));
    expect(fetchMock).toHaveBeenCalled();
  });

  it('fetches different usernames independently', async () => {
    await loadAvatarDataUrl('AlphaAmy');
    await loadAvatarDataUrl('BetaBob');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches skin renders and dedupes concurrent callers', async () => {
    const [a, b] = await Promise.all([
      loadSkinDataUrl('SkinSam'),
      loadSkinDataUrl('skinsam'),
    ]);
    expect(a).toContain('data:image/png;base64,');
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tries the fallback skin CDN when the primary fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => 'image/png' } });
    const img = await loadSkinDataUrl('FallbackFinn');
    expect(img).toContain('data:image/png;base64,');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps skin loads queued instead of dropping them when many run at once', async () => {
    jest.useFakeTimers();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fetchMock.mockImplementation(() => gate.then(() => ({
        ok: false,
        headers: { get: () => null },
      })));

      const loads = Array.from({ length: 13 }, (_, index) => loadSkinDataUrl(`QueueLoad${index}`));
      jest.advanceTimersByTime(15000);
      release();

      const results = await Promise.all(loads);
      expect(results.every(Boolean)).toBe(true);
      expect(new Set(results).size).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects oversized image responses and uses the fallback avatar', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === 'content-type' ? 'image/png' : null),
      },
      body: (async function* () {
        yield Buffer.alloc(1024 * 1024);
        yield Buffer.alloc(1024 * 1024);
        yield Buffer.alloc(1024 * 1024);
      })(),
    });
    const img = await loadAvatarDataUrl('HugeAvatar');
    expect(img).toBe(staticImageDataUrl('fallbacks', 'steve.png'));
  });
});
