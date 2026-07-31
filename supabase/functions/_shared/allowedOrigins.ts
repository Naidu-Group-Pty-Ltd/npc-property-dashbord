/**
 * CORS-ORIGINS: the single source of truth for which browser origins this
 * project trusts.
 *
 * Four modules used to answer this question independently — `auth.ts`
 * (CORS response headers), `csrfGuard.ts` (cookie-mutation origin check),
 * `solicitorSessionToken.ts` and `builderSessionToken.ts` (portal request
 * validation) — each with its own hardcoded fallback list. They drifted, and
 * the drift was live: `https://7976d60b-…lovableproject.com` was accepted by
 * the CORS layer (it is in `PROJECT_PREVIEW_ORIGINS`) but rejected by the CSRF
 * layer (whose fallback did not list it), so every cookie-authenticated
 * mutation from the Lovable editor answered `403 csrf_denied` on a request the
 * browser had been told was allowed.
 *
 * One list, one resolver, four consumers.
 *
 * ── Operational note ───────────────────────────────────────────────────────
 * `ALLOWED_ORIGINS` is read at REQUEST time, so changing that secret takes
 * effect immediately for every deployed function — including functions whose
 * bundled copy of this file predates it. The hardcoded lists below are only a
 * safety net for a missing/incomplete secret; they are NOT the configuration.
 * An origin the app is actually served from belongs in `ALLOWED_ORIGINS`.
 *
 * A disallowed origin is answered with a deliberately mismatched
 * `Access-Control-Allow-Origin` that the browser refuses. That rejection is
 * opaque to JS (`TypeError: Failed to fetch`), so `describeOriginRejection`
 * exists to leave a breadcrumb in the function logs — otherwise a
 * misconfigured allowlist is indistinguishable from an outage.
 */

/** Production origins assumed when `ALLOWED_ORIGINS` is unset entirely. */
export const LEGACY_FALLBACK_ORIGINS = [
  'https://command-centre.npcservices.com.au',
  'https://npc-property-dashbord.lovable.app',
];

/**
 * Exact, project-owned preview origins. Safe to include regardless of
 * `ALLOWED_ORIGINS` so credentialed auth requests from the Lovable editor do
 * not fail CORS when the preview host differs from the published host.
 * Deliberately exact — no suffix match.
 */
export const PROJECT_PREVIEW_ORIGINS = [
  'https://id-preview--7976d60b-c277-4851-889b-c170285f4be2.lovable.app',
  'https://7976d60b-c277-4851-889b-c170285f4be2.lovableproject.com',
  'https://preview--npc-property-dashbord.lovable.app',
];

export const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:8080',
];

function env(name: string): string {
  // globalThis-guarded so this module is importable from the Node test suite.
  return ((globalThis as any).Deno?.env?.get?.(name) || '') as string;
}

/** Origins configured via the `ALLOWED_ORIGINS` secret, in order. */
export function configuredOrigins(): string[] {
  return env('ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * The full allowlist every consumer must agree on.
 *
 * `ALLOWED_ORIGINS` REPLACES the legacy production defaults when set, so an
 * operator can tighten production to an exact list. The project preview and
 * localhost origins are always appended: they are this project's own hosts,
 * and omitting them is never a deliberate security posture — it is the
 * misconfiguration that takes the editor and local dev offline.
 */
export function resolveAllowedOrigins(): string[] {
  const configured = configuredOrigins();
  const base = configured.length > 0 ? configured : LEGACY_FALLBACK_ORIGINS;
  return [...new Set([...base, ...PROJECT_PREVIEW_ORIGINS, ...LOCAL_DEV_ORIGINS])];
}

/**
 * Opt-in, non-production escape hatch for Lovable preview iframes. OFF unless
 * `CORS_ALLOW_LOVABLE_PREVIEW=true` is explicitly set. Production leaves this
 * unset, so suffix origins are NOT trusted for credentialed responses.
 */
export function lovablePreviewSuffixAllowed(origin: string): boolean {
  if (env('CORS_ALLOW_LOVABLE_PREVIEW').trim().toLowerCase() !== 'true') return false;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith('.lovable.app') || host.endsWith('.lovableproject.com');
  } catch {
    return false;
  }
}

/** Exact-origin allowlist check. Suffix matching only via the preview flag. */
export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return resolveAllowedOrigins().includes(origin) || lovablePreviewSuffixAllowed(origin);
}

/**
 * The origin used when the caller's origin is not allowed. Returning a real
 * (but different) origin is what makes the browser reject the response.
 */
export function fallbackOrigin(): string {
  return resolveAllowedOrigins()[0];
}

/**
 * One-line diagnostic for a rejected origin. The browser hides the rejection
 * from JS, so without this a bad allowlist looks exactly like a dead function.
 */
export function describeOriginRejection(origin: string | null | undefined): string {
  return `[cors] origin ${origin ?? '<none>'} is not allow-listed; answering a mismatched `
    + `Access-Control-Allow-Origin, which the browser will reject as "Failed to fetch". `
    + `Add it to the ALLOWED_ORIGINS secret (currently ${configuredOrigins().length} configured `
    + `origin(s)) — that takes effect immediately, with no redeploy.`;
}
