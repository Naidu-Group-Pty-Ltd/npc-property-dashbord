import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { usePlanEntitlements } from './usePlanEntitlements';
import { toCapabilityKey } from '@/lib/entitlements';
import { useCapabilityResolver } from './useCapability';
import type { CapabilityDecision } from '@/lib/entitlements';

/**
 * Convenience hook that returns permission flags for a specific module.
 * Use in pages/components to conditionally show/hide edit/delete UI.
 *
 * Two independent questions have to both say yes:
 *   • does this workspace's PLAN or an active ADD-ON include the module
 *     (the capability resolver), and
 *   • is this USER permitted to use it (usePermissions)?
 *
 * A superadmin bypasses the role check — they always have, and that is what
 * makes support possible — but NOT the plan check. Being an admin of a
 * workspace does not conjure a module the workspace has not bought, and a
 * superadmin seeing features nobody else can see is how support tickets get
 * answered with advice that cannot be followed. Commercial bypass exists
 * only as the audited billing-exempt / workspace-override path in Mission
 * Control, which the resolver reports as `workspace_override`.
 *
 * @example
 * const { canView, canEdit, canDelete } = useModulePermissions('clients');
 * // Then conditionally render buttons based on these flags
 */
export function useModulePermissions(moduleKey: string) {
  const { hasModuleAccess, canEdit, canDelete, isSuperadmin, loading } = usePermissions();
  const { isModuleIncluded, loading: planLoading } = usePlanEntitlements();
  const { resolve } = useCapabilityResolver();

  return useMemo(() => {
    const inPlan = isModuleIncluded(moduleKey);
    /** Full decision for the mapped capability — denial screens read this to
     * distinguish "not purchased" from "not permitted". Null when the key is
     * not commercially gated. */
    const decision: CapabilityDecision | null = toCapabilityKey(moduleKey)
      ? resolve(moduleKey)
      : null;
    // The USER-permission axis is evaluated against the capability's own
    // permission key when it declares one (Model Hub rides the
    // `integrations` permission; Report Requests rides `reports`), and the
    // raw module key otherwise — the legacy behaviour.
    const permKey = decision?.permissionKey ?? moduleKey;
    return {
      canView: inPlan && (isSuperadmin || hasModuleAccess(permKey)),
      canEdit: inPlan && (isSuperadmin || canEdit(permKey)),
      canDelete: inPlan && (isSuperadmin || canDelete(permKey)),
      /** False when the plan excludes it — lets callers offer an upgrade. */
      includedInPlan: inPlan,
      decision,
      loading: loading || planLoading,
    };
  }, [moduleKey, isSuperadmin, hasModuleAccess, canEdit, canDelete, loading, isModuleIncluded, planLoading, resolve]);
}
