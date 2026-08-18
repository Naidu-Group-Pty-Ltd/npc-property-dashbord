/**
 * Server-side environment classification and provider-resolution policy.
 *
 * Production must never run the IDV/screening simulator. The browser hostname
 * is not trusted for this decision — classification uses only configuration
 * the platform itself injects into the function runtime:
 *
 *   1. `AML_ENVIRONMENT` — explicit operator declaration
 *      ("production" | "staging" | "test" | "local"). Always wins.
 *   2. `SUPABASE_URL` — set by Supabase, not by callers. When it names the
 *      known production project ref the environment is production even if
 *      nobody remembered to set AML_ENVIRONMENT.
 *   3. Otherwise "unknown".
 *
 * The decision table is a pure function so it can be tested exhaustively
 * without Deno or the network.
 */

/** The one production project this repository deploys to (also hardcoded in
 * src/integrations/supabase/client.ts and the deploy workflow). */
export const PRODUCTION_PROJECT_REF = "dduzbchuswwbefdunfct";

export type AmlEnvironment = "production" | "staging" | "test" | "local" | "unknown";

export function classifyEnvironment(env: {
  amlEnvironment?: string | null;
  supabaseUrl?: string | null;
}): AmlEnvironment {
  const explicit = (env.amlEnvironment ?? "").trim().toLowerCase();
  if (explicit === "production" || explicit === "staging" || explicit === "test" || explicit === "local") {
    return explicit;
  }
  const url = env.supabaseUrl ?? "";
  if (url.includes(`${PRODUCTION_PROJECT_REF}.supabase.co`)) return "production";
  return "unknown";
}

/** Typed refusal codes — the caller maps these to safe responses and MUST NOT
 * record a customer-visible failed verification for any of them. */
export type ProviderRefusalCode =
  | "provider_not_configured"     // production, and nothing is configured
  | "simulator_blocked_in_production" // a simulator selection reached production
  | "provider_misconfigured";     // live adapter selected but incomplete/unwired

export class ProviderResolutionError extends Error {
  readonly code: ProviderRefusalCode;
  constructor(code: ProviderRefusalCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ProviderResolutionError";
  }
}

export interface ProviderDecisionInput {
  environment: AmlEnvironment;
  /** Mode after tenant-config / env fallback resolution. */
  mode: "simulator" | "live";
  /** Provider key after resolution ("simulator" when nothing chose one). */
  providerKey: string;
  /** Whether a live adapter exists for providerKey. */
  adapterWired: boolean;
  /** Whether the adapter's own required configuration is present. */
  adapterConfigured: boolean;
}

export type ProviderDecision =
  | { kind: "simulator" }
  | { kind: "live" }
  | { kind: "refuse"; code: ProviderRefusalCode; message: string };

/**
 * The policy:
 *  - production never gets the simulator, whether by explicit configuration
 *    or by default-of-nothing;
 *  - a live selection anywhere must be fully wired and configured;
 *  - everywhere that is not production, the simulator stays available so
 *    local/test flows keep working unchanged.
 */
export function decideProvider(input: ProviderDecisionInput): ProviderDecision {
  const wantsSimulator = input.mode === "simulator" || input.providerKey === "simulator";

  if (wantsSimulator) {
    if (input.environment === "production") {
      // Simulator is not a mode production can be in — it is an unfinished
      // configuration. A real provider key left in simulator mode is the more
      // dangerous of the two, because the row reads as configured and active
      // on the dashboard while it can never verify anybody; production sat in
      // exactly that state. Both refuse, and both refuse as "not configured"
      // so the client is routed to document verification by an adviser rather
      // than being told to come back later for something that will not
      // self-heal.
      const nothingConfigured =
        input.mode === "simulator" && input.providerKey === "simulator";
      const realProviderLeftInSimulator =
        input.providerKey !== "simulator" && input.mode === "simulator";
      return {
        kind: "refuse",
        code: nothingConfigured ? "provider_not_configured" : "simulator_blocked_in_production",
        message: realProviderLeftInSimulator
          ? `Provider "${input.providerKey}" is still in simulator mode, which production ` +
            "cannot execute. Finish configuring it as live in AML › Configuration › " +
            "Providers. No verification attempt was recorded."
          : "Identity verification is not configured for production. " +
            "Configure a live provider in AML › Configuration › Providers. " +
            "No verification attempt was recorded.",
      };
    }
    return { kind: "simulator" };
  }

  if (!input.adapterWired) {
    return {
      kind: "refuse", code: "provider_misconfigured",
      message: `Provider "${input.providerKey}" is set to live mode but no adapter is wired. ` +
        "No verification attempt was recorded.",
    };
  }
  if (!input.adapterConfigured) {
    return {
      kind: "refuse", code: "provider_misconfigured",
      message: `Provider "${input.providerKey}" is missing required configuration ` +
        "(service URL / credentials). No verification attempt was recorded.",
    };
  }
  return { kind: "live" };
}

/**
 * Map a typed refusal onto the technical error category recorded against a
 * check or a screening subject.
 *
 * ## Why this is a function and not a ternary at each call site
 *
 * There are three refusal codes and the two consumers each collapsed them
 * with the same expression:
 *
 *     err.code === 'provider_misconfigured' ? 'provider_misconfigured'
 *                                           : 'provider_not_configured'
 *
 * which sends `simulator_blocked_in_production` to "not configured". That is
 * the wrong half of the fork, and it was live: production's screening
 * provider row is `local_lists`, active, in `simulator` mode — a provider
 * that IS configured and cannot execute. The operator was told "No screening
 * provider is configured for this tenant. An administrator must configure
 * one", so the remedy on offer was to create a provider that already exists,
 * while the actual remedy — finish configuring the existing one as live, and
 * load a list for it — was never named.
 *
 * `provider_misconfigured` carries exactly that message ("configured but
 * cannot execute — in production that usually means it is still in simulator
 * mode"), so the mapping is onto the existing vocabulary rather than a new
 * code the policy and the UI would have to learn.
 *
 * The distinction that matters to whoever reads it: **not configured** means
 * nothing is there to fix, **misconfigured** means something is there and is
 * unfinished. Only the absence of a provider is the former.
 */
export function technicalCategoryForRefusal(
  code: ProviderRefusalCode,
): "provider_not_configured" | "provider_misconfigured" {
  return code === "provider_not_configured"
    ? "provider_not_configured"
    : "provider_misconfigured";
}
