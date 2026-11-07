import { clearReleaseVersionCache, fallbackReleaseVersion, getReleaseVersion } from '../src/utils/releaseVersion';

describe('release version', () => {
  beforeEach(() => {
    clearReleaseVersionCache();
    jest.restoreAllMocks();
  });

  it('returns the latest GitHub release tag and caches it', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: 'v41' }),
    } as any);

    await expect(getReleaseVersion()).resolves.toBe('v41');
    await expect(getReleaseVersion()).resolves.toBe('v41');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the package version when GitHub is unavailable', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(getReleaseVersion()).resolves.toBe(fallbackReleaseVersion());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back when GitHub returns a non-ok response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as any);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(getReleaseVersion()).resolves.toBe(fallbackReleaseVersion());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
