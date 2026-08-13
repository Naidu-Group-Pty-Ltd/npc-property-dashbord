import { useMemo } from 'react';
import {
  ADMIN_NAVIGATION_ITEMS,
  NAVIGATION_ITEMS,
  type NavItemDef,
} from '@/lib/navigation/registry';
import { useCapabilityResolver } from './useCapability';

/**
 * The one visibility rule for navigation, shared by the desktop sidebar,
 * mobile sidebar, bottom bar and command palette.
 *
 * An item is visible when its capability decision is enabled. While the
 * decision is still loading, MAIN navigation stays visible (no flash of an
 * emptied sidebar at startup) and ADMIN navigation stays hidden (fail closed
 * — matching the pre-registry behaviour). Excluded premium modules are
 * REMOVED, not rendered disabled.
 */
export function useNavigationVisibility() {
  const { resolve } = useCapabilityResolver();

  return useMemo(() => {
    const isNavItemVisible = (item: NavItemDef): boolean => {
      const decision = resolve(item.moduleKey);
      return decision.enabled || decision.status === 'loading';
    };
    const isAdminItemVisible = (item: NavItemDef): boolean =>
      resolve(item.moduleKey).enabled;

    return {
      isNavItemVisible,
      isAdminItemVisible,
      visibleNavItems: NAVIGATION_ITEMS.filter((i) => !i.paletteOnly && isNavItemVisible(i)),
      visibleAdminItems: ADMIN_NAVIGATION_ITEMS.filter(
        (i) => !i.paletteOnly && isAdminItemVisible(i),
      ),
      paletteNavItems: NAVIGATION_ITEMS.filter(isNavItemVisible),
      paletteAdminItems: ADMIN_NAVIGATION_ITEMS.filter(isAdminItemVisible),
    };
  }, [resolve]);
}
