// The capability resolver: one function that turns "what the workspace
// holds" plus "who is asking" into a CapabilityDecision with its reasoning.
//
// Independence of sources is the core rule. A Scale workspace that also
// bought a duplicate Market News Feed add-on is entitled TWICE — through the
// tier and through the add-on — and cancelling the duplicate must not touch
// the tier's grant. The resolver therefore collects every applicable source
// and only then decides.
//
// Failure posture (the deliberate change from the old fail-open matrix):
//
//   snapshot ready/stale  → decide from the snapshot (stale = last-known-good
//                           served during a Mission Control outage; a paying
//                           customer keeps what they bought through a blip).
//   loading               → status "loading", enabled false. Callers show a
//                           skeleton, not a denial and not the feature.
//   unavailable (no       → CORE capabilities (in every tier) stay usable so
//   snapshot ever)          the platform is not bricked; PREMIUM capabilities
//                           are withheld with status "unknown" — shown as
//                           temporarily unavailable, never as an upsell.

import type {
  CapabilityDecision,
  CapabilityKey,
  EntitlementSource,
  PlanSlug,
  SnapshotState,
  WorkspaceEntitlementSnapshot,
} from "./types";
import { cheapestIncludingPlan, getCapabilityDefinition } from "./registry";
import { isKnownPlanSlug } from "./aliases";

export interface ResolveContext {
  snapshot: WorkspaceEntitlementSnapshot | null;
  snapshotState: SnapshotState;
  /**
   * Whether the current USER holds the capability's permission key.
   * `undefined` means "not evaluated here" (pure workspace-level question).
   * Superadministrators bypass USER permissions, never workspace entitlement
   * — pass `hasPermission: true` for them, and let the plan decide.
   */
  hasPermission?: boolean;
  /** True while user permissions are still loading. */
  permissionLoading?: boolean;
}

const CORE_PLAN_COUNT = 3; // capability in all three tiers = core platform

function isCoreCapability(key: CapabilityKey): boolean {
  const def = getCapabilityDefinition(key);
  return !!def && def.includedInPlans.length === CORE_PLAN_COUNT;
}

/** Sources that would grant `key` under this snapshot, in precedence order. */
function collectSources(
  key: CapabilityKey,
  snapshot: WorkspaceEntitlementSnapshot,
): EntitlementSource[] {
  const def = getCapabilityDefinition(key);
  if (!def) return [];
  const sources: EntitlementSource[] = [];

  if (
    isKnownPlanSlug(snapshot.planSlug) &&
    def.includedInPlans.includes(snapshot.planSlug as PlanSlug)
  ) {
    sources.push("base_tier");
  }
  if (def.addonSlugs?.some((slug) => snapshot.addonSlugs.includes(slug))) {
    sources.push("addon");
  }
  if (def.addonSlugs?.some((slug) => snapshot.trialSlugs.includes(slug))) {
    sources.push("trial");
  }
  if (
    snapshot.billingExempt ||
    snapshot.overrideSlugs.includes("*") ||
    def.addonSlugs?.some((slug) => snapshot.overrideSlugs.includes(slug)) ||
    snapshot.overrideSlugs.includes(key)
  ) {
    sources.push("workspace_override");
  }
  return sources;
}

/** Resolve one capability. Pure — no hooks, usable client- and test-side. */
export function resolveCapability(key: CapabilityKey, ctx: ResolveContext): CapabilityDecision {
  const def = getCapabilityDefinition(key);
  const base: Pick<CapabilityDecision, "capability" | "planSlug" | "workspaceId" | "permissionKey"> = {
    capability: key,
    planSlug: ctx.snapshot?.planSlug,
    workspaceId: ctx.snapshot?.workspaceId,
    permissionKey: def?.permissionKey,
  };

  // A key the registry does not describe is not commercially gated.
  if (!def) {
    return { ...base, enabled: true, status: "enabled", entitlementSources: [] };
  }

  // Operational availability trumps purchase state — never tell someone to
  // upgrade into a capability that cannot currently run.
  if (def.productStatus === "coming_soon" || def.productStatus === "unavailable") {
    return { ...base, enabled: false, status: "product_unavailable", entitlementSources: [] };
  }

  if (ctx.snapshotState === "loading") {
    return { ...base, enabled: false, status: "loading", entitlementSources: [] };
  }

  if (ctx.snapshotState === "unavailable" || !ctx.snapshot) {
    if (isCoreCapability(key)) {
      // The safest agreed core experience stays up while entitlement is
      // unconfirmed; permission still applies below via the enabled path.
      return decideWithPermission(base, def.key, ["base_tier"], ctx);
    }
    return { ...base, enabled: false, status: "unknown", entitlementSources: [] };
  }

  const sources = collectSources(key, ctx.snapshot);

  // Parent capability must be resolvable too (client.* needs module.clients).
  if (sources.length > 0 && def.parentCapability) {
    const parent = resolveCapability(def.parentCapability, { ...ctx, hasPermission: undefined });
    if (!parent.enabled) {
      return {
        ...base,
        enabled: false,
        status: parent.status === "plan_excluded" ? "plan_excluded" : "dependency_missing",
        entitlementSources: sources,
        missingDependencies: [def.parentCapability],
        requiredPlan: cheapestIncludingPlan(def),
        availableAddons: [...(def.addonSlugs ?? [])],
      };
    }
  }

  // Declared hard dependencies.
  if (sources.length > 0 && def.dependencies?.length) {
    const missing = def.dependencies.filter(
      (dep) => !resolveCapability(dep, { ...ctx, hasPermission: undefined }).enabled,
    );
    if (missing.length > 0) {
      return {
        ...base,
        enabled: false,
        status: "dependency_missing",
        entitlementSources: sources,
        missingDependencies: missing,
      };
    }
  }

  if (sources.length === 0) {
    return {
      ...base,
      enabled: false,
      status: "plan_excluded",
      entitlementSources: [],
      requiredPlan: cheapestIncludingPlan(def),
      availableAddons: [...(def.addonSlugs ?? [])],
    };
  }

  return decideWithPermission(base, def.key, sources, ctx);
}

function decideWithPermission(
  base: Pick<CapabilityDecision, "capability" | "planSlug" | "workspaceId" | "permissionKey">,
  key: CapabilityKey,
  sources: EntitlementSource[],
  ctx: ResolveContext,
): CapabilityDecision {
  if (ctx.hasPermission === false) {
    if (ctx.permissionLoading) {
      return { ...base, enabled: false, status: "loading", entitlementSources: sources };
    }
    return {
      ...base,
      enabled: false,
      status: "permission_denied",
      entitlementSources: sources,
      effectiveSource: sources[0],
    };
  }
  return {
    ...base,
    enabled: true,
    status: "enabled",
    entitlementSources: sources,
    effectiveSource: sources[0],
  };
}

/** Convenience wrapper for pure workspace-level checks. */
export function workspaceHasCapability(
  key: CapabilityKey,
  snapshot: WorkspaceEntitlementSnapshot | null,
  snapshotState: SnapshotState,
): boolean {
  return resolveCapability(key, { snapshot, snapshotState }).enabled;
}
