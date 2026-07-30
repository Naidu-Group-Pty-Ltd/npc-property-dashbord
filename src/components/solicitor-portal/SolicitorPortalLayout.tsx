import { Link, Outlet, useLocation } from 'react-router-dom';
import { Briefcase, KanbanSquare, LayoutDashboard, LogOut, MessageSquare, Scale, Settings, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { SolicitorNotificationBell } from './SolicitorNotificationBell';
import { SolicitorRealtimeBridge } from './SolicitorRealtimeBridge';

const NAV = [
  { to: '/solicitor', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/solicitor/matters', label: 'Matters', icon: Briefcase },
  { to: '/solicitor/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { to: '/solicitor/messages', label: 'Messages', icon: MessageSquare },
  { to: '/solicitor/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/solicitor/settings', label: 'Settings', icon: Settings },
];

/** One authenticated layout owns portal chrome, session transport and realtime. */
export function SolicitorPortalLayout() {
  const { user, signOut } = useSolicitorPortalAuth();
  const { pathname } = useLocation();
  return <div className="min-h-screen bg-background">
    <SolicitorRealtimeBridge />
    <header className="sticky top-0 z-30 border-b border-border/60 bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link to="/solicitor" className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10"><Scale className="h-5 w-5 text-primary" aria-hidden /></span>
          <span><span className="block text-xs font-semibold uppercase tracking-[0.2em] text-primary">Solicitor Portal</span><span className="block max-w-48 truncate text-sm text-muted-foreground">{user?.firm_name || 'Legal practice'}</span></span>
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <nav aria-label="Solicitor portal" className="flex max-w-[calc(100vw-7rem)] gap-1 overflow-x-auto pb-1 sm:max-w-none sm:pb-0">
            {NAV.map(({to,label,icon:Icon,exact})=>{const active=exact?pathname===to:pathname.startsWith(to);return <Button key={to} asChild size="sm" variant={active?'default':'ghost'}><Link to={to} aria-current={active?'page':undefined}><Icon className="mr-2 h-4 w-4" aria-hidden/><span>{label}</span></Link></Button>})}
          </nav>
          <SolicitorNotificationBell />
          <Button variant="outline" size="sm" onClick={()=>void signOut()}><LogOut className="mr-2 h-4 w-4" aria-hidden/><span className="hidden sm:inline">Sign out</span></Button>
        </div>
      </div>
    </header>
    <main id="main-content" className="mx-auto max-w-7xl px-4 py-6 sm:px-6"><Outlet /></main>
  </div>;
}
