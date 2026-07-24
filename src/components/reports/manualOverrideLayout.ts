import type { CSSProperties } from 'react';
import { APP_SHELL_DIMENSIONS } from '@/components/layout/shellDimensions';

export type ManualOverrideSidebarState = 'expanded' | 'collapsed';

/**
 * Supplies the portal-safe shell variables for Manual Data Override. Dialog
 * portals live outside the sidebar provider's DOM subtree, so the active shell
 * measurements are intentionally passed to the portal as CSS custom values.
 */
export function getManualOverrideShellVariables(
  sidebarState: ManualOverrideSidebarState,
  hasDesktopSidebar: boolean,
): CSSProperties {
  return {
    '--manual-override-sidebar-width': hasDesktopSidebar
      ? sidebarState === 'collapsed'
        ? APP_SHELL_DIMENSIONS.collapsedSidebar
        : APP_SHELL_DIMENSIONS.expandedSidebar
      : '0px',
    '--manual-override-header-height': hasDesktopSidebar
      ? APP_SHELL_DIMENSIONS.desktopHeader
      : APP_SHELL_DIMENSIONS.mobileHeader,
  } as CSSProperties;
}
