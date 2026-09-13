/**
 * The daily ceiling on paid Google Maps requests, in one place.
 *
 * This is **not a second metering system**. It is the existing one —
 * `enforceGlobalDailyQuota` from `publicAbuseControls.ts`, backed by the
 * `security_consume_rate_limit` RPC — named once so that a call site which has
 * never had a ceiling can acquire one without inventing a vocabulary.
 * `resolve-listing-coordinates`, `google-places-autocomplete`, `street-view`
 * and `builderStock/images.ts` keep the inline form they already had; nothing
 * about their behaviour changes.
 *
 * ## The unit, measured rather than assumed
 *
 * The mandate's warning was precise: do not accidentally count a different
 * unit than Google bills. So the primitive's semantics were read off the
 * deployed function rather than inferred.
 *
 *  * `security_consume_rate_limit` increments by **exactly one per call**
 *    (`count = limits.count + 1`), and every existing site calls it once
 *    immediately before one outbound Google request. **One unit is one
 *    request.**
 *  * The allow test is `count <= p_max`, so a ceiling of 250 admits the 250th
 *    request and refuses the 251st.
 *  * The window is **fixed, not calendar**: `window_start` is stamped on the
 *    first call and reset only once it is more than the window old. The "day"
 *    therefore begins at the first request after a 24-hour idle gap. An
 *    operator reading "250/day" gets 250 per rolling 24h from first use, which
 *    is at least as conservative as a calendar day.
 *  * The key is `public:global:<scope>:daily` and is regex-checked
 *    `^[a-z0-9:_./-]{1,200}$`, so a scope is lowercase and punctuation-light.
 *
 * That unit matches Google's billing for Geocoding, Places Nearby Search and
 * Static Maps, which are all billed per request. Two mismatches exist in the
 * wider product and are recorded here rather than silently "fixed":
 *
 *  * **Distance Matrix is billed per ELEMENT** (origins × destinations), not
 *    per request. It matches here only because the one call site in
 *    `location-intelligence-service` sends a single origin and a single
 *    destination — 1 request = 1 element. A call site that ever sends more
 *    must consume that many units, or the counter under-counts the bill.
 *  * **Street View metadata is free and its images are not**, and
 *    `street-view` consumes one unit for each. That counter therefore
 *    over-counts relative to the bill, which is the safe direction, so it is
 *    left alone.
 *
 * ## A ceiling may never invent a value
 *
 * Refusal is not a fallback. Every caller routes a refusal into the path it
 * already uses for a provider that did not answer, so the measured field
 * becomes unavailable and the report omits the claim. `rentalEvidence`'s rule
 * — absent is never zero — applied to spend: **cost safety must never create
 * false data.**
 */
import { enforceGlobalDailyQuota, killSwitchActive } from './publicAbuseControls.ts';

/**
 * One scope per Google billable API.
 *
 * `google_places` is deliberately the SAME string `google-places-autocomplete`
 * already uses, so autocomplete and the report enrichment share one bucket and
 * one `GOOGLE_PLACES_DAILY_LIMIT` means what it says across the product.
 *
 * Geocoding is the one place that does not share, and it is worth stating:
 * `resolve-listing-coordinates` counts under `google_listing_geocoding`, which
 * is also its circuit-breaker scope. Merging the two would merge the breakers
 * as well, which is a larger change than closing this gap. So both sites read
 * the same `GOOGLE_GEOCODING_DAILY_LIMIT` and hold separate buckets — the
 * product-wide ceiling on geocoding is therefore up to **twice** the configured
 * number, and an operator who wants a true N should configure N/2.
 */
export const GOOGLE_CAP_SCOPES = {
  geocoding: 'google_geocoding',
  places: 'google_places',
  distanceMatrix: 'google_distance_matrix',
} as const;

export type GoogleCapKind = keyof typeof GOOGLE_CAP_SCOPES;

/**
 * Defaults chosen for **zero paid usage**, not for throughput.
 *
 * The binding constraint is Places: one report enrichment is 1 geocode +
 * 6 Places Nearby + 1 Distance Matrix (the ledger's exact 6:1 Places:Distance
 * ratio confirms it), so 150 Places admits ~25 enrichments a day against a
 * corpus that created 32 reports in the last thirty. The headroom is ~25x.
 *
 * The existing sites default to 5000 and keep doing so. These are the
 * ceilings for the call sites that had none, which is where a surprise bill
 * would actually have come from.
 */
const CAP_DEFAULTS: Record<GoogleCapKind, number> = {
  geocoding: 250,
  places: 150,
  distanceMatrix: 250,
};

/** The existing environment names. No new ones are introduced. */
const CAP_ENV: Record<GoogleCapKind, string> = {
  geocoding: 'GOOGLE_GEOCODING_DAILY_LIMIT',
  places: 'GOOGLE_PLACES_DAILY_LIMIT',
  distanceMatrix: 'GOOGLE_DISTANCE_MATRIX_DAILY_LIMIT',
};

/** Per-API kill switches, in the shape `killSwitchActive` already reads. */
const CAP_KILL_SWITCH: Record<GoogleCapKind, string> = {
  geocoding: 'GOOGLE_GEOCODING_KILL_SWITCH',
  places: 'GOOGLE_PLACES_KILL_SWITCH',
  distanceMatrix: 'GOOGLE_DISTANCE_MATRIX_KILL_SWITCH',
};

/**
 * The configured ceiling, or the default.
 *
 * A value that is not a positive integer is the default rather than an error:
 * a typo in an environment variable must not uncap a paid provider, and it
 * must not disable a working feature either.
 */
export function dailyCapFor(kind: GoogleCapKind, env: (k: string) => string | undefined): number {
  const raw = Number(env(CAP_ENV[kind]));
  return Number.isInteger(raw) && raw > 0 ? raw : CAP_DEFAULTS[kind];
}

export interface CapVerdict {
  /** True when this request may be made. */
  ok: boolean;
  /** Why it may not be, for a log line. Never surfaced to a client. */
  reason?: 'kill_switch' | 'daily_cap';
}

const ALLOWED: CapVerdict = { ok: true };

/**
 * Consume one unit of the daily allowance for one outbound Google request.
 *
 * Call it immediately before the request, once per request, exactly as the
 * existing sites do — a unit consumed and then not spent is a ceiling that
 * drifts below the bill, and a request made before consuming is a ceiling that
 * can be exceeded under concurrency.
 *
 * A degraded limiter (the RPC unavailable, falling back to a per-isolate
 * counter) still answers; `publicAbuseControls` decided that trade-off and the
 * reasoning is in its header.
 */
export async function consumeGoogleDailyCap(
  supabase: unknown,
  kind: GoogleCapKind,
  env: (k: string) => string | undefined = (k) => Deno.env.get(k),
): Promise<CapVerdict> {
  if (killSwitchActive(CAP_KILL_SWITCH[kind])) {
    return { ok: false, reason: 'kill_switch' };
  }
  const verdict = await enforceGlobalDailyQuota(
    supabase,
    GOOGLE_CAP_SCOPES[kind],
    dailyCapFor(kind, env),
  );
  return verdict.ok ? ALLOWED : { ok: false, reason: 'daily_cap' };
}
