import { useCallback, useMemo } from "react";
import {
  getCapabilityDefinition,
  resolveCapability,
  toCapabilityKey,
  type CapabilityDecision,
  type CapabilityKey,
} from "@/lib/entitlements";
import { usePermissions } from "./usePermissions";
import { useWorkspaceEntitlements } from "./useWorkspaceEntitlements";

/**
 * The full capability decision for the current workspace AND user — the
 * preferred gate for new code.
 *
 * Combines the workspace's commercial entitlement (base tier, add-ons,
 * trials, overrides) with the user's module permission. A superadministrator
 * bypasses the USER permission axis only; commercial entitlement is never
 * silently bypassed — a billing-exempt workspace resolves through the
 * audited `workspace_override` source instead.
 */
export function useCapability(key: CapabilityKey | string): CapabilityDecision {
  const { resolve } = useCapabilityResolver();
  return useMemo(() => resolve(key), [resolve, key]);
}

/** Resolver form for components that need to evaluate many capabilities
 * without calling hooks in a loop (registries, tab lists, nav). */
export function useCapabilityResolver() {
  const { snapshot, snapshotState } = useWorkspaceEntitlements();
  const { hasModuleAccess, isSuperadmin, loading: permissionLoading } = usePermissions();

  const resolve = useCallback(
    (rawKey: CapabilityKey | string): CapabilityDecision => {
      const key = toCapabilityKey(rawKey);
      if (!key) {
        // Not commercially gated — only the user-permission axis applies.
        const granted = isSuperadmin || hasModuleAccess(rawKey);
        return {
          capability: rawKey as CapabilityKey,
          enabled: granted,
          status: granted ? "enabled" : permissionLoading ? "loading" : "permission_denied",
          entitlementSources: [],
        };
      }
      const def = getCapabilityDefinition(key);
      const hasPermission = def?.permissionKey
        ? isSuperadmin || hasModuleAccess(def.permissionKey)
        : undefined;
      return resolveCapability(key, {
        snapshot,
        snapshotState,
        hasPermission,
        permissionLoading,
      });
    },
    [snapshot, snapshotState, hasModuleAccess, isSuperadmin, permissionLoading],
  );

  return useMemo(
    () => ({ resolve, snapshotState, permissionLoading }),
    [resolve, snapshotState, permissionLoading],
  );
}
