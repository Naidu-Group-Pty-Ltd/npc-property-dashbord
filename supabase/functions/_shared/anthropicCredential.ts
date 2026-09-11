/**
 * Obtaining the credential `anthropicRoute.pure.ts` decided on.
 *
 * This is the half that touches the world: it reads the environment, and
 * where the deployment federates it exchanges a Mission Control identity
 * token for a short-lived, workspace-scoped Anthropic access token and keeps
 * it until it is nearly spent.
 *
 * ## Why there is a federated path at all
 *
 * Anthropic will not create an API key through its API — the Console is the
 * only place a key comes from — so the per-clone credential the other four
 * model vendors get cannot exist here. Workload Identity Federation is the
 * way around that: Mission Control is registered as an OIDC issuer, it signs
 * a short-lived assertion naming ONE clone, and Anthropic exchanges that for
 * an access token bound to that clone's own service account and workspace.
 * No `sk-ant-api…` string is ever minted, distributed or stored on a clone.
 *
 * The exchange is the only thing Mission Control is on the path of. Inference
 * itself goes clone → Anthropic directly, because model calls are the highest
 * volume vendor traffic in this product, they stream, and they run against a
 * ~150s edge ceiling — putting a broker in front of every report generation
 * would buy a new failure domain and nothing else.
 *
 * ## Four rules
 *
 * **A key present is always used.** Enforced in the pure module, restated
 * here because it is the rule that protects a tenant who supplied their own
 * credential from being billed by us anyway.
 *
 * **One exchange, however many callers.** A report generation fans out; an
 * unguarded refresh would run the exchange once per concurrent section, and
 * an identity token carrying a `jti` is accepted exactly once — so the
 * second and every later exchange would fail with `jti_reused` and the
 * failure would look like an outage. `inFlight` is that guard.
 *
 * **A refresh that fails does not discard a token that still works.** The
 * advisory refresh at expiry − 120s may fail silently and serve the cached
 * token; only past the mandatory point is the cache cleared. That is
 * `botocore`'s two-tier schedule and Anthropic's SDKs use it for the same
 * reason: a momentary failure at the token endpoint must not take inference
 * down with it.
 *
 * **Who refused is read from a header, never guessed from a body.** Mission
 * Control and Anthropic both answer 401 with similar JSON and send an
 * operator to opposite remedies, which is the lesson the verification broker
 * already paid for.
 */

import {
  ANTHROPIC_TOKEN_URL,
  type AnthropicCredential,
  type AnthropicRoute,
  resolveAnthropicRoute,
} from './anthropicRoute.pure.ts';

export type { AnthropicCredential } from './anthropicRoute.pure.ts';

/** Mission Control's own refusals carry this; what it relays never does. */
const MISSION_CONTROL_REFUSAL_HEADER = 'x-mission-control-refusal';

/** Where a clone asks Mission Control to speak for it. */
export const IDENTITY_PATH = '/api/public/anthropic/identity';

/** Refresh once the token is this close to expiry, serving the cached one if it fails. */
const ADVISORY_REFRESH_MS = 120_000;

/** Past this, a failed exchange is an error rather than a cached answer. */
const MANDATORY_REFRESH_MS = 30_000;

const EXCHANGE_TIMEOUT_MS = 15_000;

export type CredentialResult =
  | { ok: true; credential: AnthropicCredential; via: 'api_key' | 'federated' }
  | { ok: false; why: string; end: 'unconfigured' | 'mission_control' | 'anthropic' };

interface CachedToken {
  value: string;
  workspaceId: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inFlight: Promise<CredentialResult> | null = null;

/** Test seam: forget any cached token. Never called in production. */
export function resetAnthropicCredentialCache(): void {
  cached = null;
  inFlight = null;
}

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    // A function running without env permission is a configuration fault, not
    // a reason to throw out of a credential read.
    return undefined;
  }
}

/** How this deployment is configured to reach Anthropic. */
export function anthropicRoute(): AnthropicRoute {
  return resolveAnthropicRoute({
    apiKey: env('ANTHROPIC_API_KEY'),
    workspaceId: env('ANTHROPIC_WORKSPACE_ID'),
    missionControlUrl: env('MISSION_CONTROL_URL'),
    cloneApiKey: env('MISSION_CONTROL_CLONE_API_KEY'),
  });
}

/**
 * Whether this deployment can reach Anthropic at all.
 *
 * Configuration, never reachability — a caller that needs to KNOW should make
 * a call. It exists because several surfaces decide whether to offer a
 * model-backed feature, and they were each reading the key directly, which is
 * what made a federated deployment look like an unconfigured one.
 */
export function anthropicConfigured(): boolean {
  return anthropicRoute().via !== 'unconfigured';
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface IdentityGrant {
  assertion: string;
  organization_id: string;
  service_account_id: string;
  federation_rule_id: string;
  workspace_id: string;
}

async function requestIdentity(
  route: Extract<AnthropicRoute, { via: 'federated' }>,
): Promise<{ ok: true; grant: IdentityGrant } | { ok: false; why: string }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${route.missionControlUrl}${IDENTITY_PATH}`,
      {
        method: 'POST',
        headers: {
          'x-clone-api-key': route.cloneApiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ workspace_id: route.workspaceId }),
      },
      EXCHANGE_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      ok: false,
      why: `Mission Control could not be reached to obtain an Anthropic identity: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!response.ok) {
    const refusal = response.headers.get(MISSION_CONTROL_REFUSAL_HEADER);
    const body = await response.text().catch(() => '');
    return {
      ok: false,
      why: refusal
        ? `Mission Control refused to issue an Anthropic identity for this deployment: ${refusal}`
        : `Mission Control answered ${response.status} when asked for an Anthropic identity${
          body ? `: ${body.slice(0, 400)}` : ''
        }`,
    };
  }

  let grant: IdentityGrant;
  try {
    grant = (await response.json()) as IdentityGrant;
  } catch {
    return { ok: false, why: 'Mission Control returned an unreadable Anthropic identity' };
  }

  if (
    !grant?.assertion || !grant.organization_id || !grant.service_account_id ||
    !grant.federation_rule_id || !grant.workspace_id
  ) {
    return {
      ok: false,
      why: 'Mission Control returned an incomplete Anthropic identity, so no token could be exchanged',
    };
  }

  return { ok: true, grant };
}

async function exchange(
  route: Extract<AnthropicRoute, { via: 'federated' }>,
): Promise<CredentialResult> {
  const identity = await requestIdentity(route);
  if (!identity.ok) return { ok: false, why: identity.why, end: 'mission_control' };

  const { grant } = identity;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      ANTHROPIC_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: grant.assertion,
          federation_rule_id: grant.federation_rule_id,
          organization_id: grant.organization_id,
          service_account_id: grant.service_account_id,
          workspace_id: grant.workspace_id,
        }),
      },
      EXCHANGE_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      ok: false,
      end: 'anthropic',
      why: `Anthropic's token endpoint could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return {
      ok: false,
      end: 'anthropic',
      why: `Anthropic refused the federated token exchange (${response.status})${
        body ? `: ${body.slice(0, 400)}` : ''
      }`,
    };
  }

  let payload: { access_token?: string; expires_in?: number };
  try {
    payload = await response.json();
  } catch {
    return { ok: false, end: 'anthropic', why: 'Anthropic returned an unreadable token response' };
  }

  const token = (payload.access_token ?? '').trim();
  if (!token) {
    return { ok: false, end: 'anthropic', why: 'Anthropic returned no access token' };
  }

  /*
   * Trust the answer's own lifetime rather than the rule's configured one:
   * Anthropic bounds the minted token at twice the remaining life of the
   * assertion, so it is routinely SHORTER than the rule asks for, and a cache
   * that believed the rule would serve an expired token.
   */
  const lifetimeMs = Math.max(60, Number(payload.expires_in) || 0) * 1000;
  cached = { value: token, workspaceId: grant.workspace_id, expiresAt: Date.now() + lifetimeMs };

  return {
    ok: true,
    via: 'federated',
    credential: { kind: 'access_token', value: token, workspaceId: grant.workspace_id },
  };
}

/**
 * The credential this request should spend, obtaining one if necessary.
 *
 * Never throws. A caller that cannot proceed renders `why`, which names the
 * end that failed rather than asserting the vendor is down.
 */
export async function resolveAnthropicCredential(): Promise<CredentialResult> {
  const route = anthropicRoute();

  if (route.via === 'unconfigured') {
    return { ok: false, why: route.why, end: 'unconfigured' };
  }

  if (route.via === 'api_key') {
    return {
      ok: true,
      via: 'api_key',
      credential: { kind: 'api_key', value: route.apiKey, workspaceId: route.workspaceId },
    };
  }

  const now = Date.now();

  if (cached && cached.workspaceId === route.workspaceId) {
    if (now < cached.expiresAt - ADVISORY_REFRESH_MS) {
      return {
        ok: true,
        via: 'federated',
        credential: { kind: 'access_token', value: cached.value, workspaceId: cached.workspaceId },
      };
    }

    /*
     * Inside the advisory window: try for a fresh one, but a failure here
     * serves the token we already hold. It is still valid for ~90 seconds,
     * and taking inference down for a momentary token-endpoint failure is the
     * worse outcome by a wide margin.
     */
    if (now < cached.expiresAt - MANDATORY_REFRESH_MS) {
      const servable = cached;
      const refreshed = await runExchange(route);
      if (refreshed.ok) return refreshed;
      return {
        ok: true,
        via: 'federated',
        credential: {
          kind: 'access_token',
          value: servable.value,
          workspaceId: servable.workspaceId,
        },
      };
    }

    // Too close to expiry to serve. Fall through and require a fresh one.
    cached = null;
  }

  return await runExchange(route);
}

/**
 * One exchange at a time.
 *
 * A fan-out (seventeen report sections, four enrichment chapters) would
 * otherwise run one exchange each, and an assertion carrying a `jti` is
 * single-use — so every exchange after the first would be refused
 * `jti_reused` and the whole batch would fail on what is really a success.
 */
function runExchange(route: Extract<AnthropicRoute, { via: 'federated' }>): Promise<CredentialResult> {
  if (inFlight) return inFlight;
  inFlight = exchange(route).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
