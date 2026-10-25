import { loadAvatarDataUrl, loadSkinDataUrl } from '../src/images/assets';

const fetchMock = jest.fn();

jest.mock('node-fetch', () => (...args: unknown[]) => fetchMock(...args));

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
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const first = await loadAvatarDataUrl('OfflineOlivia');
    expect(first).toContain('data:image/png;base64,');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tries the fallback skin CDN when the primary fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => 'image/png' } });
    const img = await loadSkinDataUrl('FallbackFinn');
    expect(img).toContain('data:image/png;base64,');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
