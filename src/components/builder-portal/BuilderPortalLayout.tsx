import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  Boxes, Building2, HardHat, KanbanSquare, LayoutDashboard, ListChecks, LogOut,
  MessageSquare, Receipt, Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { BuilderOrganisationSwitcher } from './BuilderOrganisationSwitcher';

/**
 * One authenticated layout owns the Builder Portal chrome. Mirrors
 * `SolicitorPortalLayout`.
 *
 * Navigation shows the eventual portal shape. Items whose module is not yet
 * built are rendered disabled with an explicit
 * "available in a later phase" tooltip rather than linking to a placeholder —
 * there are no fake business records or stub APIs behind them.
 */

interface BuilderNavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  available: boolean;
}

const NAV: BuilderNavItem[] = [
  { to: '/builder', label: 'Dashboard', icon: LayoutDashboard, exact: true, available: true },
  { to: '/builder/projects', label: 'Projects', icon: Building2, available: true },
  { to: '/builder/inventory', label: 'Inventory', icon: Boxes, available: true },
  { to: '/builder/transactions', label: 'Transactions', icon: Receipt, available: true },
  { to: '/builder/pipeline', label: 'Pipeline', icon: KanbanSquare, available: true },
  { to: '/builder/messages', label: 'Messages', icon: MessageSquare, available: false },
  { to: '/builder/tasks', label: 'Tasks', icon: ListChecks, available: false },
  { to: '/builder/settings', label: 'Settings', icon: Settings, available: true },
];

export function BuilderPortalLayout() {
  const { user, activeOrganisation, signOut } = useBuilderPortalAuth();
  const { pathname } = useLocation();

  const organisationName = activeOrganisation
    ? activeOrganisation.trading_name || activeOrganisation.legal_name
    : 'No organisation selected';

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/builder"
            className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <HardHat className="h-5 w-5 text-primary" aria-hidden />
            </span>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Builder Portal
              </span>
              <span className="block max-w-48 truncate text-sm text-muted-foreground">
                {organisationName}
              </span>
            </span>
          </Link>

          <div className="flex min-w-0 items-center gap-2">
            <TooltipProvider delayDuration={200}>
              <nav
                aria-label="Builder portal"
                className="flex max-w-[calc(100vw-11rem)] gap-1 overflow-x-auto pb-1 sm:max-w-none sm:pb-0"
              >
                {NAV.map(({ to, label, icon: Icon, exact, available }) => {
                  const active = exact ? pathname === to : pathname.startsWith(to);

                  if (!available) {
                    return (
                      <Tooltip key={to}>
                        <TooltipTrigger asChild>
                          <span>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled
                              aria-disabled
                              className="cursor-not-allowed opacity-50"
                            >
                              <Icon className="mr-2 h-4 w-4" aria-hidden />
                              <span>{label}</span>
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{label} becomes available in a later phase</TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <Button
                      key={to}
                      asChild
                      size="sm"
                      variant={active ? 'default' : 'ghost'}
                    >
                      <Link to={to} aria-current={active ? 'page' : undefined}>
                        <Icon className="mr-2 h-4 w-4" aria-hidden />
                        <span>{label}</span>
                      </Link>
                    </Button>
                  );
                })}
              </nav>
            </TooltipProvider>

            <BuilderOrganisationSwitcher />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-40">
                  <span className={cn('truncate')}>{user?.name ?? 'Account'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                  <span className="block truncate text-sm font-medium">{user?.name}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {user?.email}
                  </span>
                  {user?.job_title ? (
                    <Badge variant="outline" className="mt-2">{user.job_title}</Badge>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/builder/settings">
                    <Settings className="mr-2 h-4 w-4" aria-hidden />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="mr-2 h-4 w-4" aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
