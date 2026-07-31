import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { hasRecentlyReloaded, isChunkLoadError, reloadForFreshBuild } from '@/lib/chunkReload';

type Importer<T> = () => Promise<{ default: T }>;

const RETRY_DELAYS_MS = [250, 900];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Loads a lazy chunk, tolerating the two ways it realistically fails.
 *
 * 1. A flaky network drops the request — retried with a short backoff.
 * 2. The page is running a stale `index.html` whose chunk hashes the host no
 *    longer serves — no amount of retrying helps, so we reload once to pick up
 *    the current build. Guarded so a genuinely broken deploy cannot spin.
 */
export async function loadChunkWithRetry<T>(importer: Importer<T>): Promise<{ default: T }> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await importer();
    } catch (error) {
      lastError = error;
      if (!isChunkLoadError(error)) throw error;
      if (attempt < RETRY_DELAYS_MS.length) await wait(RETRY_DELAYS_MS[attempt]);
    }
  }

  if (!hasRecentlyReloaded()) {
    console.warn('[chunk] Stale build detected — reloading to fetch the current assets.');
    reloadForFreshBuild();
    // Park the promise: the navigation is already underway, and resolving or
    // rejecting here would flash an error boundary on the way out.
    return new Promise<{ default: T }>(() => undefined);
  }

  console.error('[chunk] Chunk still unavailable after a recovery reload.', lastError);
  throw lastError;
}

/**
 * Drop-in replacement for `React.lazy` that survives a redeploy.
 *
 * `React.lazy` caches the rejected promise, so once a chunk import fails the
 * component can never recover — even after the network comes back. Retrying
 * inside the importer keeps recovery inside the same promise.
 */
export function lazyWithRetry<T extends ComponentType<never>>(
  importer: Importer<T>,
): LazyExoticComponent<T> {
  return lazy(() => loadChunkWithRetry(importer));
}
