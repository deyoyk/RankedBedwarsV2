import { getDivisionTag, pickDivisionTag } from '../src/utils/divisionTags';

const mockedFetch = jest.fn();
const originalFetch = global.fetch;
global.fetch = mockedFetch as unknown as typeof fetch;
const ENV_KEYS = ['PPP_API_URL', 'PPP_API_KEY', 'PPP_API_TIMEOUT_MS', 'PPP_API_CACHE_MS'] as const;
const savedEnv: Record<string, string | undefined> = {};

function response(status: number, body: unknown): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterAll(() => {
  global.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

beforeEach(() => {
  mockedFetch.mockReset();
  process.env.PPP_API_URL = 'http://ppp.test/api/v1/private/';
  process.env.PPP_API_KEY = 'secret-key';
  process.env.PPP_API_TIMEOUT_MS = '1000';
  process.env.PPP_API_CACHE_MS = '60000';
});

describe('pickDivisionTag', () => {
  it('keeps the highest division in premium > pugs > pups > pit order', () => {
    expect(pickDivisionTag([{ division: 'pit' }, { division: 'pups' }, { division: 'premium' }])).toBe('premium');
    expect(pickDivisionTag([{ division: 'pit' }, { division: 'pups' }])).toBe('pups');
    expect(pickDivisionTag([{ division: 'pit' }])).toBe('pit');
  });

  it('ignores divisions without a requested tag', () => {
    expect(pickDivisionTag([{ division: 'pugstrial' }])).toBeNull();
    expect(pickDivisionTag([])).toBeNull();
    expect(pickDivisionTag(null)).toBeNull();
  });
});

describe('getDivisionTag', () => {
  it('reads the private member endpoint with the api key', async () => {
    mockedFetch.mockResolvedValue(response(200, {
      divisions: [{ division: 'pit' }, { division: 'pugs' }],
    }));

    await expect(getDivisionTag('123')).resolves.toBe('pugs');
    expect(mockedFetch).toHaveBeenCalledWith(
      'http://ppp.test/api/v1/private/members/123',
      expect.objectContaining({ headers: { 'x-api-key': 'secret-key' } }),
    );
  });

  it('caches a member lookup', async () => {
    mockedFetch.mockResolvedValue(response(200, { divisions: [{ division: 'pups' }] }));

    await expect(getDivisionTag('200')).resolves.toBe('pups');
    await expect(getDivisionTag('200')).resolves.toBe('pups');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('caches a missing member as no tag', async () => {
    mockedFetch.mockResolvedValue(response(404, { error: 'not found' }));

    await expect(getDivisionTag('404')).resolves.toBeNull();
    await expect(getDivisionTag('404')).resolves.toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache server failures so a later lookup can recover', async () => {
    mockedFetch.mockResolvedValue(response(500, { error: 'down' }));

    await expect(getDivisionTag('500')).resolves.toBeNull();
    await expect(getDivisionTag('500')).resolves.toBeNull();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it('returns no tag when the api cannot be reached', async () => {
    mockedFetch.mockRejectedValue(new Error('offline'));

    await expect(getDivisionTag('offline')).resolves.toBeNull();
  });

  it('returns no tag when the api is not configured', async () => {
    delete process.env.PPP_API_URL;

    await expect(getDivisionTag('123')).resolves.toBeNull();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
