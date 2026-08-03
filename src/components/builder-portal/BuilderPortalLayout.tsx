import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bell, Boxes, Building2, FileText, Hammer, HardHat, History, KanbanSquare,
  LayoutDashboard, ListChecks, LogOut, Menu, MessageSquare, Receipt, Settings, ShieldCheck, X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { accessRoleLabel } from '@/lib/builderAccessTerms';
import { useBuilderPortalAuth } from '@/hooks/useBuilderPortalAuth';
import { BuilderPortalNavGroup } from './ui/BuilderPortalNavGroup';
import { BuilderOrganisationSwitcher } from './BuilderOrganisationSwitcher';
import { BuilderOnboardingTour } from './BuilderOnboardingTour';

/**
 * One authenticated layout owns the Builder Portal chrome: a grouped sidebar on
 * desktop, a compact top bar, and a drawer on mobile.
 *
 * It replaced a single horizontal bar carrying all twelve destinations, which
 * overflowed its own row on every viewport narrower than a desktop and left the
 * workspace looking unfinished. Nothing about where those destinations go has
 * changed — `NAV` below is the same list, in the same order, with the same
 * paths; only how it is laid out is different.
 *
 * Items whose module is not yet built are rendered disabled with an explicit
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
  { to: '/builder/construction', label: 'Construction', icon: Hammer, available: true },
  { to: '/builder/documents', label: 'Documents', icon: FileText, available: true },
  { to: '/builder/messages', label: 'Messages', icon: MessageSquare, available: true },
  { to: '/builder/tasks', label: 'Tasks', icon: ListChecks, available: true },
  { to: '/builder/notifications', label: 'Notifications', icon: Bell, available: true },
  { to: '/builder/activity', label: 'Activity', icon: History, available: true },
  { to: '/builder/settings', label: 'Settings', icon: Settings, available: true },
];

/**
 * Anchor the guided onboarding tour points at, derived from the route so it can
 * never drift from the destination it labels. `/builder` is the dashboard;
 * every other destination uses its path segment.
 *
 * Deliberately derived rather than stored on BuilderNavItem: NAV entries are
 * asserted verbatim by the per-domain contract tests, and an extra field would
 * make those assertions about the tour rather than about the navigation.
 */
function tourAnchor(to: string): string {
  return to === '/builder' ? 'dashboard' : to.slice('/builder/'.length);
}

/**
 * How the twelve destinations are read, by the stage of delivery they belong
 * to. Grouping is presentation: it changes no path, no guard and no module.
 */
const NAV_GROUPS: ReadonlyArray<{ title: string; paths: ReadonlyArray<string> }> = [
  { title: 'Overview', paths: ['/builder'] },
  {
    title: 'Project delivery',
    paths: [
      '/builder/projects', '/builder/inventory', '/builder/transactions',
      '/builder/pipeline', '/builder/construction',
    ],
  },
  { title: 'Workspace', paths: ['/builder/documents', '/builder/messages', '/builder/tasks'] },
  {
    title: 'Account & control',
    paths: ['/builder/notifications', '/builder/activity', '/builder/settings'],
  },
];

/**
 * NAV placed into its groups. Anything NAV holds that no group names is
 * appended to the last group rather than dropped, so a destination added to NAV
 * can never quietly disappear from the navigation by being forgotten here.
 */
const GROUPED_NAV: ReadonlyArray<{ title: string; items: BuilderNavItem[] }> = (() => {
  const byPath = new Map(NAV.map((item) => [item.to, item]));
  const placed = new Set<string>();

  const groups = NAV_GROUPS.map(({ title, paths }) => {
    const items = paths
      .map((path) => byPath.get(path))
      .filter((item): item is BuilderNavItem => Boolean(item));
    items.forEach((item) => placed.add(item.to));
    return { title, items };
  });

  const unplaced = NAV.filter((item) => !placed.has(item.to));
  if (unplaced.length) groups[groups.length - 1].items.push(...unplaced);
  return groups;
})();

/** Initials from data already on the session — nothing is fetched for this. */
function initialsFor(name?: string | null, email?: string | null): string {
  const source = (name || email || 'B').trim();
  return source
    .split(/[\s@.]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <TooltipProvider delayDuration={200}>
      <nav aria-label="Builder portal" className="py-1">
        {GROUPED_NAV.map(({ title, items }) => (
          <BuilderPortalNavGroup key={title} title={title}>
            {items.map(({ to, label, icon: Icon, exact, available }) => {
              if (!available) {
                return (
                  <li key={to}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled
                            aria-disabled
                            className="w-full cursor-not-allowed justify-start opacity-50"
                          >
                            <Icon className="mr-3 h-[18px] w-[18px] shrink-0" aria-hidden />
                            <span>{label}</span>
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{label} becomes available in a later phase</TooltipContent>
                    </Tooltip>
                  </li>
                );
              }

              // `NavLink`'s own matching is used for styling, but the tour
              // anchor and `aria-current` are derived from the same rule the
              // old bar used, so neither can drift from the path.
              const active = exact ? pathname === to : pathname.startsWith(to);

              return (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={exact}
                    onClick={onNavigate}
                    data-tour={tourAnchor(to)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                  </NavLink>
                </li>
              );
            })}
          </BuilderPortalNavGroup>
        ))}
      </nav>
    </TooltipProvider>
  );
}

export function BuilderPortalLayout() {
  const { user, activeOrganisation, signOut } = useBuilderPortalAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const organisationName = activeOrganisation
    ? activeOrganisation.trading_name || activeOrganisation.legal_name
    : 'No organisation selected';
  const initials = initialsFor(user?.name, user?.email);
  const currentPage = NAV.find((item) => (item.exact ? pathname === item.to : pathname.startsWith(item.to)));

  // Navigating closes the drawer, so a route change never leaves it open.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  /**
   * The organisation the session is acting for, with the access role it grants.
   * The switcher renders itself only when there is more than one organisation
   * to choose between, and the selection is re-verified server-side — none of
   * that logic lives here.
   */
  const organisationCard = (
    <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/5 to-card p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        <Building2 className="h-3 w-3 shrink-0" aria-hidden />
        Acting as
      </p>
      <p className="mt-1.5 break-words text-sm font-semibold leading-snug text-foreground">
        {organisationName}
      </p>
      {activeOrganisation ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="font-normal">
            {accessRoleLabel(activeOrganisation.membership_role)}
          </Badge>
          {activeOrganisation.is_primary ? (
            <Badge variant="outline" className="font-normal">Primary organisation</Badge>
          ) : null}
        </div>
      ) : null}
      <div className="mt-3 [&_button]:w-full [&_button]:max-w-none">
        <BuilderOrganisationSwitcher />
      </div>
    </div>
  );

  const sidebarBody = (onNavigate?: () => void) => (
    <>
      <div className="px-4 py-3">{organisationCard}</div>
      <ScrollArea className="flex-1">
        <SidebarNav pathname={pathname} onNavigate={onNavigate} />
      </ScrollArea>
      <Separator />
      <div className="p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start rounded-xl text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
          onClick={() => void signOut()}
        >
          <LogOut className="mr-3 h-4 w-4" aria-hidden />
          Sign out
        </Button>
        <p className="mt-2 flex items-center gap-1.5 px-3 text-[10px] text-muted-foreground/60">
          <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden />
          <span>Secured portal · access resolved per request</span>
        </p>
      </div>
    </>
  );

  const brandLockup = (compact = false) => (
    <Link
      to="/builder"
      className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10',
          compact ? 'h-8 w-8' : 'h-10 w-10',
        )}
        aria-hidden
      >
        <HardHat className={compact ? 'h-4 w-4 text-primary' : 'h-5 w-5 text-primary'} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Builder Portal
        </span>
        <span className="block truncate text-xs text-muted-foreground">{organisationName}</span>
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a
        href="#main-content"
        className="sr-only rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70]"
      >
        Skip to main content
      </a>

      <div className="flex min-w-0 flex-1">
        {/* ── Desktop sidebar ── */}
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r border-border/60 bg-card/60 lg:flex">
          <div className="px-4 py-3.5">{brandLockup()}</div>
          <Separator />
          {sidebarBody()}
        </aside>

        {/* ── Main column ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-border/60 bg-card/95 backdrop-blur">
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={mobileOpen}
              >
                <Menu className="h-5 w-5" aria-hidden />
              </Button>

              <div className="min-w-0 lg:hidden">{brandLockup(true)}</div>

              {pathname !== '/builder' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden h-9 shrink-0 gap-1.5 rounded-full text-muted-foreground hover:text-foreground lg:inline-flex"
                  onClick={() => navigate('/builder')}
                  aria-label="Back to Builder Portal dashboard"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  <span className="text-xs font-medium">Back to dashboard</span>
                </Button>
              ) : null}

              <p className="hidden min-w-0 truncate text-sm font-semibold text-foreground lg:block">
                {currentPage?.label ?? 'Builder Portal'}
              </p>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                >
                  {/* No count is rendered: this layout loads none, and a
                      fabricated badge would be worse than no badge. */}
                  <Link to="/builder/notifications" aria-label="Notifications">
                    <Bell className="h-[18px] w-[18px]" aria-hidden />
                  </Link>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-9 gap-2 px-2">
                      <Avatar className="h-7 w-7 border border-primary/20">
                        <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
                        {user?.name ?? 'Account'}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel>
                      <span className="block truncate text-sm font-medium">{user?.name}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {user?.email}
                      </span>
                      {user?.job_title ? (
                        <Badge variant="outline" className="mt-2 font-normal">{user.job_title}</Badge>
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

          <main id="main-content" className="min-w-0 flex-1">
            <div className="mx-auto min-w-0 max-w-7xl px-4 py-6 sm:px-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={pathname}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.2 }}
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Builder portal navigation"
              className="fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col border-r border-border/60 bg-card lg:hidden"
              initial={reduceMotion ? false : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 300 }}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
                {brandLockup(true)}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation menu"
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              {sidebarBody(() => setMobileOpen(false))}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <BuilderOnboardingTour />
    </div>
  );
}
