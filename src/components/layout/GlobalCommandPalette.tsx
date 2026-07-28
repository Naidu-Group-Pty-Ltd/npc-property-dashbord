import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  Home,
  Building2,
  Calendar,
  Mail,
  Settings,
  FileText,
  BarChart3,
  BookOpen,
  Activity,
  Upload,
  ShieldCheck,
  Zap,
  Sparkles,
  Phone,
  MessageSquareText,
  MessageSquare,
  FileStack,
  Palette,
  Users,
  History,
  Plug,
  UserCircle,
  Target,
  Cloud,
  Gauge,
  TrendingUp,
  Bell,
  ClipboardList,
  FileSignature,
  Globe,
  Newspaper,
  Send,
  Map as MapIcon,
  Cpu,
  Coins,
  Inbox,
  Database,
  AlertTriangle,
  Command as CommandIcon,
  ExternalLink,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useAmlAccess } from '@/hooks/useAmlAccess';

/**
 * GlobalCommandPalette — Phase 1.
 *
 * ⌘K / Ctrl-K opens a fuzzy nav palette across every route the user can
 * see. Also surfaces "Recent" navigations from localStorage. Inline
 * actions (create client, run report) will be layered in Phase 3.
 *
 * Permission gating mirrors DashboardSidebar so we never advertise a route
 * the user cannot reach.
 */

type NavEntry = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  moduleKey: string;
  group: string;
  keywords?: string[];
};

const ENTRIES: NavEntry[] = [
  // Main
  { title: 'Overview', url: '/', icon: Home, moduleKey: 'overview', group: 'Main', keywords: ['home', 'dashboard'] },
  { title: 'Market Updates', url: '/market-updates', icon: Newspaper, moduleKey: '__always__', group: 'Main', keywords: ['news', 'market'] },
  { title: 'Opportunity Marketplace', url: '/listings', icon: Building2, moduleKey: 'listings', group: 'Main', keywords: ['property', 'listings', 'off-market', 'builder'] },
  { title: 'Commercial / Industrial', url: '/commercial', icon: Building2, moduleKey: '__always__', group: 'Main' },
  { title: 'Calendar', url: '/calendar', icon: Calendar, moduleKey: 'calendar' , group: 'Main' },

  // Reports & Analysis
  { title: 'Reports', url: '/reports', icon: BarChart3, moduleKey: 'reports', group: 'Reports' },
  { title: 'Quantitative Reports', url: '/quantitative-reports', icon: BarChart3, moduleKey: 'generated_reports', group: 'Reports' },
  { title: 'Generated Reports', url: '/generated-reports', icon: FileText, moduleKey: 'generated_reports', group: 'Reports' },
  { title: 'Cash Flow Analysis', url: '/cash-flow-analysis', icon: Activity, moduleKey: 'cash_flow', group: 'Reports' },
  { title: 'Aurixa Intelligence Hub', url: '/report-qa', icon: MessageSquareText, moduleKey: 'report_qa', group: 'Reports', keywords: ['ai', 'ask', 'report q&a', 'aurixa'] },
  { title: 'Portfolio Reports', url: '/portfolio-reports', icon: FileText, moduleKey: 'portfolio_reports', group: 'Reports' },
  { title: 'Report Requests', url: '/report-requests', icon: Send, moduleKey: 'report_requests', group: 'Reports' },
  { title: 'Charts', url: '/charts', icon: BarChart3, moduleKey: 'charts', group: 'Reports' },

  // Clients & CRM
  { title: 'Clients', url: '/clients', icon: UserCircle, moduleKey: 'clients', group: 'Clients & CRM' },
  { title: 'Client Tracker', url: '/client-tracker', icon: Target, moduleKey: 'client_tracker', group: 'Clients & CRM' },
  { title: 'CRM Conversations', url: '/conversations', icon: MessageSquare, moduleKey: 'conversations', group: 'Clients & CRM' },
  { title: 'Portal Messages', url: '/messages', icon: Inbox, moduleKey: '__always__', group: 'Clients & CRM' },
  { title: 'Email Copilot', url: '/email-copilot', icon: Sparkles, moduleKey: 'email_copilot', group: 'Clients & CRM' },
  { title: 'Call Logs', url: '/call-logs', icon: Phone, moduleKey: 'call_logs', group: 'Clients & CRM' },

  // Operations
  { title: 'Deal Pipeline', url: '/deal-pipeline', icon: TrendingUp, moduleKey: 'deal_pipeline', group: 'Operations' },
  { title: 'Reminders', url: '/reminders', icon: Bell, moduleKey: 'reminders', group: 'Operations' },
  { title: 'Checklists', url: '/checklists', icon: ClipboardList, moduleKey: 'checklists', group: 'Operations' },
  { title: 'Agreements', url: '/agreements', icon: FileSignature, moduleKey: 'agreements', group: 'Operations' },
  { title: 'Game Plan', url: '/game-plan', icon: MapIcon, moduleKey: 'game_plans', group: 'Operations' },
  { title: 'Marketing', url: '/marketing-analytics', icon: TrendingUp, moduleKey: 'marketing_analytics', group: 'Operations' },

  // Help / Usage
  { title: 'User Guide', url: '/user-guide', icon: BookOpen, moduleKey: 'user_guide', group: 'Help' },
  { title: 'Billing & Usage', url: '/billing', icon: Coins, moduleKey: '__always__', group: 'Help' },
];

const ADMIN_ENTRIES: NavEntry[] = [
  { title: 'Auto Report Generation', url: '/automation', icon: Zap, moduleKey: 'automation', group: 'Admin', keywords: ['automation'] },
  { title: 'Templates', url: '/templates', icon: FileStack, moduleKey: 'templates', group: 'Admin' },
  { title: 'Branding', url: '/white-label', icon: Palette, moduleKey: 'white_label', group: 'Admin' },
  { title: 'Integrations', url: '/integrations', icon: Plug, moduleKey: 'integrations', group: 'Admin' },
  { title: 'Cloudflare', url: '/cloudflare', icon: Cloud, moduleKey: 'cloudflare', group: 'Admin' },
  { title: 'API Usage', url: '/api-usage', icon: Gauge, moduleKey: 'api_usage', group: 'Admin' },
  { title: 'Model Hub', url: '/model-hub', icon: Cpu, moduleKey: 'integrations', group: 'Admin' },
  { title: 'Monitoring', url: '/monitoring', icon: Activity, moduleKey: 'monitoring', group: 'Admin' },
  { title: 'Quality Assurance', url: '/quality-assurance', icon: ShieldCheck, moduleKey: 'quality_assurance', group: 'Admin' },
  { title: 'Data Import', url: '/data-import', icon: Upload, moduleKey: 'data_import', group: 'Admin' },
  { title: 'Depreciation Comps', url: '/admin/depreciation-comps', icon: Database, moduleKey: 'depreciation_comps', group: 'Admin' },
  { title: 'Error Logs', url: '/error-logs', icon: AlertTriangle, moduleKey: 'error_logs', group: 'Admin' },
  { title: 'Activity Logs', url: '/admin/activity-logs', icon: History, moduleKey: 'activity_logs', group: 'Admin' },
  { title: 'Settings', url: '/settings', icon: Settings, moduleKey: 'settings', group: 'Admin' },
  { title: 'User Management', url: '/admin/users', icon: Users, moduleKey: 'user_management', group: 'Admin' },
  { title: 'Finance Portal (Admin)', url: '/admin/finance-portal', icon: ShieldCheck, moduleKey: 'finance_portal_admin', group: 'Admin' },
  { title: 'Portal Config', url: '/portal-config', icon: Globe, moduleKey: 'portal_config', group: 'Admin' },
  { title: 'Sources', url: '/sources', icon: Mail, moduleKey: 'sources', group: 'Admin' },
];

const RECENT_KEY = 'aurixa.commandPalette.recent';
const MAX_RECENT = 6;

function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRecent(url: string) {
  if (typeof window === 'undefined') return;
  try {
    const current = readRecent().filter((v) => v !== url);
    const next = [url, ...current].slice(0, MAX_RECENT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function GlobalCommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [recent, setRecent] = React.useState<string[]>(() => readRecent());
  const navigate = useNavigate();
  const { hasModuleAccess, isSuperadmin, loading: permissionsLoading } = usePermissions();
  const aml = useAmlAccess();

  // Keyboard: ⌘K / Ctrl-K to toggle. `/` opens when nothing else has focus.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (event.key === '/' && !isMod) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  React.useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  const filter = React.useCallback(
    (entry: NavEntry) => {
      if (entry.moduleKey === '__always__') return true;
      if (entry.moduleKey === '__superadmin_only__') return isSuperadmin;
      return isSuperadmin || hasModuleAccess(entry.moduleKey);
    },
    [hasModuleAccess, isSuperadmin]
  );

  const visibleEntries = React.useMemo(() => {
    if (permissionsLoading) return ENTRIES;
    return ENTRIES.filter(filter);
  }, [filter, permissionsLoading]);

  const visibleAdmin = React.useMemo(() => {
    if (permissionsLoading) return [];
    return ADMIN_ENTRIES.filter(filter);
  }, [filter, permissionsLoading]);

  const amlEntry: NavEntry | null =
    !aml.loading && aml.flagEnabled && aml.hasAnyRole
      ? { title: 'AML / CTF Compliance', url: '/admin/aml', icon: ShieldCheck, moduleKey: '__aml__', group: 'Compliance' }
      : null;

  const allEntries = React.useMemo(() => {
    const list = [...visibleEntries];
    if (amlEntry) list.push(amlEntry);
    return [...list, ...visibleAdmin];
  }, [amlEntry, visibleAdmin, visibleEntries]);

  const entriesByUrl = React.useMemo(() => new Map(allEntries.map((e) => [e.url, e])), [allEntries]);

  const recentResolved = React.useMemo(
    () => recent.map((url) => entriesByUrl.get(url)).filter((e): e is NavEntry => Boolean(e)),
    [entriesByUrl, recent]
  );

  const grouped = React.useMemo(() => {
    const map = new Map<string, NavEntry[]>();
    for (const entry of allEntries) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return map;
  }, [allEntries]);

  const handleSelect = React.useCallback(
    (url: string) => {
      writeRecent(url);
      setOpen(false);
      // Defer navigation so the dialog closes cleanly.
      setTimeout(() => navigate(url), 10);
    },
    [navigate]
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search commands, pages, and shortcuts…" />
      <CommandList>
        <CommandEmpty>No matches. Try a page name, module, or keyword.</CommandEmpty>

        {recentResolved.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recentResolved.map((entry) => (
                <CommandItem
                  key={`recent-${entry.url}`}
                  value={`recent ${entry.title} ${entry.url}`}
                  onSelect={() => handleSelect(entry.url)}
                >
                  <entry.icon className="mr-2 h-4 w-4 text-primary" />
                  <span>{entry.title}</span>
                  <CommandShortcut>{entry.group}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {Array.from(grouped.entries()).map(([group, list]) => (
          <CommandGroup key={group} heading={group}>
            {list.map((entry) => (
              <CommandItem
                key={entry.url}
                value={[entry.title, entry.url, entry.group, ...(entry.keywords ?? [])].join(' ')}
                onSelect={() => handleSelect(entry.url)}
              >
                <entry.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{entry.title}</span>
                <CommandShortcut>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}

        <CommandSeparator />
        <CommandGroup heading="Tips">
          <CommandItem value="tip-shortcut" disabled>
            <CommandIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Press ⌘K or / to open this palette from anywhere.</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default GlobalCommandPalette;
