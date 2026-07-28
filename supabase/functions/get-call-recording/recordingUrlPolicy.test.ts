import { describe, expect, it, vi } from 'vitest';
import { fetchAllowedRecording, isAllowedRecordingUrl } from './recordingUrlPolicy';

describe('recording URL policy', () => {
  it.each([
    'https://api.vapi.ai/recording.wav',
    'https://tenant.r2.cloudflarestorage.com/call.wav?signature=value',
  ])('allows an expected recording URL: %s', (url) => {
    expect(isAllowedRecordingUrl(url)).toBe(true);
  });

  it.each([
    'http://api.vapi.ai/recording.wav',
    'https://127.0.0.1/internal',
    'https://169.254.169.254/latest/meta-data',
    'https://vapi.ai.attacker.example/recording.wav',
    'https://user:password@api.vapi.ai/recording.wav',
  ])('rejects an unsafe recording URL: %s', (url) => {
    expect(isAllowedRecordingUrl(url)).toBe(false);
  });

  it('does not follow an allowed URL redirect to an internal service', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/internal' },
    }));

    await expect(fetchAllowedRecording('https://api.vapi.ai/recording.wav', fetcher))
      .rejects.toThrow('not allowed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
