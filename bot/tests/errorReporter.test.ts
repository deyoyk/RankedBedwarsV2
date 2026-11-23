import { formatCommandError, getErrorMessage, installErrorReporting, reportError } from '../src/utils/errorReporter';

describe('errorReporter', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.ERROR_WEBHOOK_URL = 'https://example.test/webhook';
    process.env.ERROR_WEBHOOK_INTERVAL_MS = '0';
  });

  afterEach(() => {
    delete process.env.ERROR_WEBHOOK_URL;
    delete process.env.ERROR_WEBHOOK_INTERVAL_MS;
    global.fetch = originalFetch;
  });

  it('extracts readable messages from different error shapes', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('plain text')).toBe('plain text');
    expect(getErrorMessage({ code: 500 })).toBe('{"code":500}');
    expect(getErrorMessage(null)).toBe('Unknown error');
  });

  it('includes the action, reason and error id in command errors', () => {
    const description = formatCommandError('void game #3', new Error('already settled'), 'abc12345');
    expect(description).toContain('Could not void game #3.');
    expect(description).toContain('already settled');
    expect(description).toContain('Error ID: `abc12345`');
  });

  it('posts reported errors to the configured webhook', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const id = reportError('[test]', new Error('kaboom'));
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.embeds[0].description).toContain('kaboom');
    expect(body.embeds[0].footer.text).toContain(id);
  });

  it('does not send Node deprecation warnings', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    reportError('[test]', '(node:103) [DEP0040] DeprecationWarning: The punycode module is deprecated.');
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes console.error through the webhook after installation', async () => {
    installErrorReporting();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = fetchMock as unknown as typeof fetch;

    console.error('[wrapped]', new Error('from console'));
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(fetchMock).toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.embeds[0].description).toContain('from console');
  });

  it('ignores console deprecation warnings after installation', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    console.error('(node:103) [DEP0040] DeprecationWarning: The punycode module is deprecated.');
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
