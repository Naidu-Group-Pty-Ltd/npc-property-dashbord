import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { usePlanEntitlements } from './usePlanEntitlements';

/**
 * Convenience hook that returns permission flags for a specific module.
 * Use in pages/components to conditionally show/hide edit/delete UI.
 * 
 * Two independent questions have to both say yes:
 *   • does this workspace's PLAN include the module (usePlanEntitlements), and
 *   • is this USER permitted to use it (usePermissions)?
 *
 * A superadmin bypasses the role check — they always have, and that is what
 * makes support possible — but NOT the plan check. Being an admin of a
 * workspace does not conjure a module the workspace has not bought, and a
 * superadmin seeing features nobody else can see is how support tickets get
 * answered with advice that cannot be followed.
 *
 * An unknown plan enables everything. See planEntitlements.ts for why.
 *
 * @example
 * const { canView, canEdit, canDelete } = useModulePermissions('clients');
 * // Then conditionally render buttons based on these flags
 */
export function useModulePermissions(moduleKey: string) {
  const { hasModuleAccess, canEdit, canDelete, isSuperadmin, loading } = usePermissions();
  const { isModuleIncluded, loading: planLoading } = usePlanEntitlements();

  return useMemo(() => {
    const inPlan = isModuleIncluded(moduleKey);
    return {
      canView: inPlan && (isSuperadmin || hasModuleAccess(moduleKey)),
      canEdit: inPlan && (isSuperadmin || canEdit(moduleKey)),
      canDelete: inPlan && (isSuperadmin || canDelete(moduleKey)),
      /** False when the plan excludes it — lets callers offer an upgrade. */
      includedInPlan: inPlan,
      loading: loading || planLoading,
    };
  }, [moduleKey, isSuperadmin, hasModuleAccess, canEdit, canDelete, loading, isModuleIncluded, planLoading]);
}
