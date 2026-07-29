import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchTokenBalance } from "@/lib/missionControl";
import {
  isKnownPlan,
  planEnablesSubModule,
  planIncludesModule,
} from "@/lib/pricing/planEntitlements";

/**
 * What this workspace's PLAN entitles it to.
 *
 * Distinct from `usePermissions`, which answers what the signed-in USER is
 * allowed to do. A feature needs both: the workspace has to have bought it,
 * and the user has to be permitted to use it.
 *
 * The plan slug comes from Mission Control's balance response, which the app
 * already fetches. While it is loading — or if it never arrives — everything
 * is enabled. Gating must never be the reason a paying customer loses access
 * to a feature over a lookup that was slow or failed.
 */
export function usePlanEntitlements() {
  const [planSlug, setPlanSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchTokenBalance()
      .then((b) => {
        if (!cancelled) setPlanSlug(b?.planSlug ?? null);
      })
      .catch(() => {
        // Unknown plan gates open; nothing to recover here.
        if (!cancelled) setPlanSlug(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isSubModuleEnabled = useCallback(
    (key: string) => planEnablesSubModule(planSlug, key),
    [planSlug],
  );

  const isModuleIncluded = useCallback(
    (moduleSlug: string) => planIncludesModule(planSlug, moduleSlug),
    [planSlug],
  );

  return useMemo(
    () => ({
      planSlug,
      /** True once we know the plan is one the entitlement matrix describes. */
      planKnown: isKnownPlan(planSlug),
      isSubModuleEnabled,
      isModuleIncluded,
      loading,
    }),
    [planSlug, isSubModuleEnabled, isModuleIncluded, loading],
  );
}
