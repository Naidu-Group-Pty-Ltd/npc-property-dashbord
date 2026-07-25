import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeSecureFunction } from './secureInvoke';

describe('invokeSecureFunction CORS credentials', () => {
  beforeEach(() => {
    sessionStorage.setItem('supabase_access_token', 'access-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
      headers: new Headers(),
    }));
  });

  it('omits credentials for wildcard CORS token-auth functions', async () => {
    await invokeSecureFunction('template-import-pdf', { operation: 'status' });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/template-import-pdf'),
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('includes credentials for cookie-auth functions', async () => {
    await invokeSecureFunction('custom-auth-profile');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/functions/v1/custom-auth-profile'),
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
