import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Briefcase, LayoutDashboard, LogOut, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';

const NAV = [
  { to: '/solicitor', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/solicitor/matters', label: 'Matters', icon: Briefcase, exact: false },
];

/**
 * Shared chrome for every authenticated Solicitor Portal surface. Keeps the
 * portal visually distinct from the Command Centre while reusing the same
 * semantic dark-gold tokens.
 */
export function SolicitorPortalShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, signOut } = useSolicitorPortalAuth();
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <Scale className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Solicitor Portal</p>
              <p className="truncate text-sm text-muted-foreground">
                {user?.firm_name || 'Legal practice'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <nav aria-label="Solicitor portal" className="flex items-center gap-1">
              {NAV.map(({ to, label, icon: Icon, exact }) => {
                const active = exact ? pathname === to : pathname.startsWith(to);
                return (
                  <Button
                    key={to}
                    asChild
                    size="sm"
                    variant={active ? 'default' : 'ghost'}
                    className={cn('gap-2', active && 'shadow-sm')}
                  >
                    <Link to={to} aria-current={active ? 'page' : undefined}>
                      <Icon className="h-4 w-4" aria-hidden />
                      {label}
                    </Link>
                  </Button>
                );
              })}
            </nav>
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" aria-hidden />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </main>
    </div>
  );
}
