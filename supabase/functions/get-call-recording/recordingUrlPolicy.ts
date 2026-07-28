const ALLOWED_RECORDING_HOST_SUFFIXES = ['vapi.ai', 'r2.cloudflarestorage.com'];

export function isAllowedRecordingUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const allowedHost = ALLOWED_RECORDING_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );

    return url.protocol === 'https:' &&
      allowedHost &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

export async function fetchAllowedRecording(
  initialUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowedRecordingUrl(currentUrl)) throw new Error('Recording URL is not allowed');

    const response = await fetcher(currentUrl, { redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) throw new Error('Recording redirect has no location');
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error('Too many recording redirects');
}
