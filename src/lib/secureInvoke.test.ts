import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeSecureFunction } from './secureInvoke';

const okResponse = () => ({
  ok: true,
  json: vi.fn().mockResolvedValue({ ok: true }),
  headers: new Headers(),
});

/** What a browser throws when it refuses a response's CORS answer. */
const corsRejection = () => new TypeError('Failed to fetch');

describe('invokeSecureFunction CORS credentials', () => {
  beforeEach(() => {
    sessionStorage.setItem('supabase_access_token', 'access-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
  });

  it('includes credentials for cookie-auth functions', async () => {
    await invokeSecureFunction('custom-auth-profile');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/custom-auth-profile'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  // The regression this pins: template-import-pdf was called with
  // `credentials: 'omit'`, which stripped the HttpOnly `__Host-session_token`
  // cookie — the only session carrier `extractSessionToken` reads. Its remaining
  // credential was an access-token JWT the ES256 migration made unobtainable, so
  // every PDF import 401'd "Authentication required" and the dialog reported the
  // user's session as expired when it was perfectly valid.
  it('sends the session cookie to the PDF import functions', async () => {
    await invokeSecureFunction('template-import-pdf', { operation: 'create_import' });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/template-import-pdf'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('falls back to an uncredentialed retry when the function still answers a wildcard origin', async () => {
    // First call: the browser refuses the credentialed request at the preflight,
    // so nothing reached the function and the retry cannot duplicate an effect.
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(corsRejection())
      .mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const first = await invokeSecureFunction('render-source', { url: 'https://example.com' });

    expect(first.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'omit' });

    // …and the answer is remembered, so only the first call pays for the
    // failed preflight.
    await invokeSecureFunction('render-source', { url: 'https://example.com/2' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ credentials: 'omit' });
  });

  it('does not retry a timeout as if it were a CORS refusal', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeSecureFunction('import-from-url', { url: 'https://example.com' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error?.code).toBe('provider_timeout');
  });

  it('does not retry uncredentialed for functions outside the migrating set', async () => {
    const fetchMock = vi.fn().mockRejectedValue(corsRejection());
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeSecureFunction('custom-auth-profile');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error?.network).toBe(true);
  });
});
