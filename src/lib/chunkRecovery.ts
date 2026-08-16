/**
 * Global recovery for chunk loads that fail outside a `lazyWithRetry` boundary.
 *
 * `lazyWithRetry` only sees the route-level import it wraps. A chunk can also
 * fail from Vite's own `modulepreload` polyfill, from a nested `lazy()` inside a
 * page, or from any bare `import()` — those reject into `unhandledrejection`,
 * where nothing was listening, so the reader saw a raw
 * "Failed to fetch dynamically imported module" and the app stayed broken until
 * they hard-reloaded by hand.
 *
 * The handler does the same two things the route loader does, in the same order:
 * re-request the URL outside the module loader (which clears an edge/WAF
 * interstitial and its cookie), then reload once past the HTTP cache so a stale
 * `index.html` cannot be served again. One-shot, so a genuinely broken deploy
 * cannot spin.
 */
import {
  extractChunkUrl,
  hasRecentlyReloaded,
  isChunkLoadError,
  reloadForFreshBuild,
  warmChunkUrl,
} from '@/lib/chunkReload';

let installed = false;
let recovering = false;

async function recover(error: unknown): Promise<void> {
  if (recovering || hasRecentlyReloaded()) return;
  recovering = true;
  const url = extractChunkUrl(error);
  await warmChunkUrl(url);
  console.warn('[chunk] Asset load failed — reloading onto the current build.', url ?? error);
  reloadForFreshBuild();
}

export function installChunkFailureRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Vite's preload helper emits this for a failed dynamic import; preventing
  // the default stops it re-throwing over the top of our recovery.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    void recover((event as unknown as { payload?: unknown }).payload);
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (!isChunkLoadError(event.reason)) return;
    event.preventDefault();
    void recover(event.reason);
  });

  window.addEventListener('error', (event) => {
    if (!isChunkLoadError(event.error ?? event.message)) return;
    void recover(event.error ?? event.message);
  });
}
