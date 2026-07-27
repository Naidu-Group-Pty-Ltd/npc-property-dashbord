import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Home, 
  Building2, 
  Calendar, 
  Mail, 
  AlertTriangle, 
  Settings,
  Database,
  BarChart3,
  FileText,
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
  ChevronDown,
  Search,
  X as XIcon,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAmlAccess } from '@/hooks/useAmlAccess';
import { hasAmlCapability, type AmlCapability } from '@/lib/aml/permissions';
import { BrandLockup, BrandLogo } from '@/components/branding/BrandAssets';
import { cn } from '@/lib/utils';

const navigationItems = [
  { title: 'Overview', url: '/', icon: Home, moduleKey: 'overview' },
  { title: 'Market Updates', url: '/market-updates', icon: Newspaper, moduleKey: '__always__' },
  { title: 'Listings', url: '/listings', icon: Building2, moduleKey: 'listings' },
  { title: 'Commercial / Industrial', url: '/commercial', icon: Building2, moduleKey: '__always__' },
  { title: 'Calendar', url: '/calendar', icon: Calendar, moduleKey: 'calendar' },
  { title: 'Reports', url: '/reports', icon: BarChart3, moduleKey: 'reports' },
  { title: 'Quantitative Reports', url: '/quantitative-reports', icon: BarChart3, moduleKey: 'generated_reports' },
  { title: 'Generated Reports', url: '/generated-reports', icon: FileText, moduleKey: 'generated_reports' },
  { title: 'Cash Flow Analysis', url: '/cash-flow-analysis', icon: Activity, moduleKey: 'cash_flow' },
  { title: 'Report Q&A', url: '/report-qa', icon: MessageSquareText, moduleKey: 'report_qa' },
  { title: 'Email Copilot', url: '/email-copilot', icon: Sparkles, moduleKey: 'email_copilot' },
  { title: 'Call Logs', url: '/call-logs', icon: Phone, moduleKey: 'call_logs' },
  { title: 'Portal Messages', url: '/messages', icon: Inbox, moduleKey: '__always__' },
  { title: 'CRM Conversations', url: '/conversations', icon: MessageSquare, moduleKey: 'conversations' },
  { title: 'Clients', url: '/clients', icon: UserCircle, moduleKey: 'clients' },
  { title: 'Client Tracker', url: '/client-tracker', icon: Target, moduleKey: 'client_tracker' },
  { title: 'Portfolio Reports', url: '/portfolio-reports', icon: FileText, moduleKey: 'portfolio_reports' },
  { title: 'Report Requests', url: '/report-requests', icon: Send, moduleKey: 'report_requests' },
  { title: 'Deal Pipeline', url: '/deal-pipeline', icon: TrendingUp, moduleKey: 'deal_pipeline' },
  { title: 'Reminders', url: '/reminders', icon: Bell, moduleKey: 'reminders' },
  { title: 'Checklists', url: '/checklists', icon: ClipboardList, moduleKey: 'checklists' },
  { title: 'Agreements', url: '/agreements', icon: FileSignature, moduleKey: 'agreements' },
  { title: 'Game Plan', url: '/game-plan', icon: MapIcon, moduleKey: 'game_plans' },
  { title: 'Marketing', url: '/marketing-analytics', icon: TrendingUp, moduleKey: 'marketing_analytics' },
  { title: 'Charts', url: '/charts', icon: BarChart3, moduleKey: 'charts' },
  { title: 'User Guide', url: '/user-guide', icon: BookOpen, moduleKey: 'user_guide' },
  { title: 'Billing & Usage', url: '/billing', icon: Coins, moduleKey: '__always__' },
];


const navigationGroups = [
  {
    title: 'Main Dashboard',
    itemTitles: ['Overview', 'Market Updates', 'Listings', 'Commercial / Industrial', 'Calendar'],
  },
  {
    title: 'Reports & Analysis',
    itemTitles: ['Reports', 'Quantitative Reports', 'Generated Reports', 'Cash Flow Analysis', 'Report Q&A', 'Portfolio Reports', 'Report Requests', 'Charts'],
  },
  {
    title: 'Client & CRM',
    itemTitles: ['Clients', 'Client Tracker', 'CRM Conversations', 'Portal Messages', 'Email Copilot', 'Call Logs'],
  },
  {
    title: 'Operations',
    itemTitles: ['Deal Pipeline', 'Reminders', 'Checklists', 'Agreements', 'Game Plan', 'Marketing'],
  },
  {
    title: 'Help & Usage',
    itemTitles: ['User Guide', 'Billing & Usage'],
  },
];

const adminGroup = {
  title: 'Administration',
  itemTitles: [
    'Automation',
    'Templates',
    'Branding',
    'Integrations',
    'Cloudflare',
    'API Usage',
    'Model Hub',
    'Monitoring',
    'Quality Assurance',
    'Data Import',
    'Depreciation Comps',
    'Error Logs',
    'Activity Logs',
    'Settings',
    'User Management',
    'Finance Portal',
    'Portal Config',
    'Token Audit Log',
    'PDF Import Engine',
    'PDF Import Diagnostics',
    'BC Segment Engine',
    'Reclassify Property',
    'Sources',
  ],
};

const adminItems = [
  { title: 'Automation', url: '/automation', icon: Zap, moduleKey: 'automation' },
  { title: 'Templates', url: '/templates', icon: FileStack, moduleKey: 'templates' },
  { title: 'Branding', url: '/white-label', icon: Palette, moduleKey: 'white_label' },
  { title: 'Integrations', url: '/integrations', icon: Plug, moduleKey: 'integrations' },
  { title: 'Cloudflare', url: '/cloudflare', icon: Cloud, moduleKey: 'cloudflare' },
  { title: 'API Usage', url: '/api-usage', icon: Gauge, moduleKey: 'api_usage' },
  { title: 'Model Hub', url: '/model-hub', icon: Cpu, moduleKey: 'integrations' },
  { title: 'Monitoring', url: '/monitoring', icon: Activity, moduleKey: 'monitoring' },
  { title: 'Quality Assurance', url: '/quality-assurance', icon: ShieldCheck, moduleKey: 'quality_assurance' },
  { title: 'Data Import', url: '/data-import', icon: Upload, moduleKey: 'data_import' },
  { title: 'Depreciation Comps', url: '/admin/depreciation-comps', icon: Database, moduleKey: 'depreciation_comps' },
  { title: 'Error Logs', url: '/error-logs', icon: AlertTriangle, moduleKey: 'error_logs' },
  { title: 'Activity Logs', url: '/admin/activity-logs', icon: History, moduleKey: 'activity_logs' },
  { title: 'Settings', url: '/settings', icon: Settings, moduleKey: 'settings' },
  { title: 'User Management', url: '/admin/users', icon: Users, moduleKey: 'user_management' },
  { title: 'Finance Portal', url: '/admin/finance-portal', icon: ShieldCheck, moduleKey: 'finance_portal_admin' },
  { title: 'Portal Config', url: '/portal-config', icon: Globe, moduleKey: 'portal_config' },
  { title: 'Token Audit Log', url: '/admin/token-audit', icon: Coins, moduleKey: '__superadmin_only__' },
  { title: 'PDF Import Engine', url: '/admin/pdf-import-engine', icon: Cpu, moduleKey: '__superadmin_only__' },
  { title: 'PDF Import Diagnostics', url: '/admin/pdf-import-diagnostics', icon: Activity, moduleKey: '__superadmin_only__' },
  { title: 'BC Segment Engine', url: '/admin/bc-segment-engine', icon: Gauge, moduleKey: '__superadmin_only__' },
  { title: 'Reclassify Property', url: '/admin/reclassify-property', icon: Database, moduleKey: '__superadmin_only__' },
  { title: 'Sources', url: '/sources', icon: Mail, moduleKey: 'sources' },
];

// Phase 2 — AML/CTF Compliance sidebar group. Every entry is gated by the
// aml_ctf feature flag AND the user's assigned AML role via useAmlAccess.
const amlNavItems: Array<{
  title: string;
  url: string;
  icon: any;
  capability: AmlCapability;
}> = [
  { title: 'AML Overview', url: '/admin/aml', icon: ShieldCheck, capability: 'aml.view' },
  { title: 'Intake Queue', url: '/admin/aml/intake', icon: Inbox, capability: 'aml.view' },
  { title: 'Customer Cases', url: '/admin/aml/cases', icon: FileStack, capability: 'aml.view' },
  { title: 'Verification', url: '/admin/aml/verification', icon: ShieldCheck, capability: 'aml.view' },
  { title: 'Screening', url: '/admin/aml/screening', icon: AlertTriangle, capability: 'aml.view' },
  { title: 'Risk', url: '/admin/aml/risk', icon: Gauge, capability: 'aml.view' },
  { title: 'Counterparty', url: '/admin/aml/counterparty', icon: Users, capability: 'aml.view' },
  { title: 'Finance Comparison', url: '/admin/aml/finance', icon: TrendingUp, capability: 'aml.investigate' },
  { title: 'Transactions', url: '/admin/aml/transactions', icon: Coins, capability: 'aml.investigate' },
  { title: 'Monitoring', url: '/admin/aml/monitoring', icon: Activity, capability: 'aml.view' },
  { title: 'Investigations', url: '/admin/aml/investigations', icon: FileSignature, capability: 'aml.investigate' },
  { title: 'AUSTRAC Reporting', url: '/admin/aml/austrac', icon: FileText, capability: 'aml.report' },
  { title: 'Records & Privacy', url: '/admin/aml/records', icon: Database, capability: 'aml.view' },
  { title: 'Governance', url: '/admin/aml/governance', icon: ClipboardList, capability: 'aml.view' },
  { title: 'Launch Ops', url: '/admin/aml/launch-ops', icon: Zap, capability: 'aml.view' },
  { title: 'Configuration', url: '/admin/aml/configuration', icon: Settings, capability: 'aml.configure' },
];


export function DashboardSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const { settings } = useWhiteLabel();
  const { hasModuleAccess, isSuperadmin, loading: permissionsLoading } = usePermissions();
  const aml = useAmlAccess();
  const isCollapsed = state === 'collapsed';
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [navFilter, setNavFilter] = useState('');

  // Clear the sidebar search whenever the sidebar collapses to icon mode.
  useEffect(() => {
    if (isCollapsed) setNavFilter('');
  }, [isCollapsed]);

  const isActive = (path: string) => {
    if (path === '/commercial') {
      return currentPath === '/commercial' || currentPath.startsWith('/commercial/') || currentPath === '/industrial' || currentPath.startsWith('/industrial/');
    }
    // AML/CTF Compliance is a single sidebar entry — keep it active for every
    // nested /admin/aml/* surface since they all render inside the same page.
    if (path === '/admin/aml') {
      return currentPath === '/admin/aml' || currentPath.startsWith('/admin/aml/');
    }
    return currentPath === path;
  };

  // While permissions are loading, show all items to prevent flash
  // Once loaded, filter based on actual permissions
  const visibleNavItems = permissionsLoading 
    ? navigationItems 
    : navigationItems.filter(item =>
        item.moduleKey === '__always__' ? true : (isSuperadmin || hasModuleAccess(item.moduleKey))
      );
  
  const visibleAdminItems = permissionsLoading
    ? [] // Hide admin items while loading for security
    : adminItems.filter(item =>
        item.moduleKey === '__superadmin_only__' ? isSuperadmin : (isSuperadmin || hasModuleAccess(item.moduleKey))
      );

  const visibleNavItemsByTitle = useMemo(
    () => new Map(visibleNavItems.map((item) => [item.title, item])),
    [visibleNavItems]
  );

  const visibleAdminItemsByTitle = useMemo(
    () => new Map(visibleAdminItems.map((item) => [item.title, item])),
    [visibleAdminItems]
  );

  const normalisedFilter = navFilter.trim().toLowerCase();
  const matchesFilter = (title: string) =>
    normalisedFilter.length === 0 || title.toLowerCase().includes(normalisedFilter);

  const groupedNavItems = navigationGroups
    .map((group) => ({
      ...group,
      items: group.itemTitles.flatMap((title) => {
        const item = visibleNavItemsByTitle.get(title);
        if (!item) return [];
        if (!matchesFilter(item.title)) return [];
        return [item];
      }),
    }))
    .filter((group) => group.items.length > 0);

  const groupedAdminItems = {
    ...adminGroup,
    items: adminGroup.itemTitles.flatMap((title) => {
      const item = visibleAdminItemsByTitle.get(title);
      if (!item) return [];
      if (!matchesFilter(item.title)) return [];
      return [item];
    }),
  };

  // AML/CTF Compliance — consolidated into a single sidebar entry. All
  // sub-surfaces (Intake, Cases, Screening, AUSTRAC, Configuration, …) live
  // as in-page tabs inside `/admin/aml` via `AmlLayout`.
  const amlGroupedItems = (() => {
    if (aml.loading || !aml.flagEnabled || !aml.hasAnyRole) return null;
    const anyAllowed = amlNavItems.some((item) => hasAmlCapability(aml.roles, item.capability));
    if (!anyAllowed) return null;
    return {
      title: 'AML/CTF Compliance',
      items: [
        {
          title: 'AML/CTF Compliance',
          url: '/admin/aml',
          icon: ShieldCheck,
          moduleKey: '__aml__',
        },
      ],
    };
  })();


  const renderNavigationItem = (item: (typeof navigationItems)[number], isAdministration = false) => {
    const active = isActive(item.url);

    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.title}
          className={cn(
            'dashboard-sidebar-menu-button',
            isAdministration && 'dashboard-sidebar-menu-button-admin',
            active && 'dashboard-sidebar-menu-button-active'
          )}
        >
          <NavLink 
            to={item.url} 
            className="flex min-w-0 items-center gap-2 text-sm font-medium"
            title={item.title}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="min-w-0 truncate">{item.title}</span>}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const renderGroup = (
    group: { title: string; items: typeof visibleNavItems },
    options: { administration?: boolean } = {}
  ) => {
    const hasActiveItem = group.items.some((item) => isActive(item.url));
    const isGroupCollapsed = !hasActiveItem && Boolean(collapsedGroups[group.title]);

    if (isCollapsed) {
      return (
        <SidebarGroup
          key={group.title}
          className={cn(
            'dashboard-sidebar-group-collapsed',
            options.administration && 'dashboard-sidebar-admin-group-collapsed'
          )}
        >
          <SidebarGroupContent>
            <SidebarMenu>{group.items.map((item) => renderNavigationItem(item, options.administration))}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      );
    }

    return (
      <SidebarGroup
        key={group.title}
        className={cn('dashboard-sidebar-group', options.administration && 'dashboard-sidebar-admin-group')}
      >
        <button
          type="button"
          className={cn(
            'dashboard-sidebar-group-trigger',
            hasActiveItem && 'dashboard-sidebar-group-trigger-active',
            options.administration && 'dashboard-sidebar-admin-trigger'
          )}
          aria-expanded={!isGroupCollapsed}
          onClick={() => setCollapsedGroups((current) => ({ ...current, [group.title]: !current[group.title] }))}
        >
          <span>{group.title}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isGroupCollapsed && '-rotate-90')} />
        </button>
        {!isGroupCollapsed && (
          <SidebarGroupContent className="mt-1">
            <SidebarMenu>{group.items.map((item) => renderNavigationItem(item, options.administration))}</SidebarMenu>
          </SidebarGroupContent>
        )}
      </SidebarGroup>
    );
  };

  // Determine which logo to show based on sidebar state
  const currentLogo = isCollapsed 
    ? (settings.sidebarIcon || settings.sidebarLogo) 
    : settings.sidebarLogo;

  return (
    <Sidebar collapsible="icon" className="dashboard-sidebar-surface border-r-0">
      <SidebarContent className="dashboard-sidebar-content">
        {/* Brand */}
        <div className={`dashboard-sidebar-header ${isCollapsed ? 'p-3' : 'p-6'}`}>
          {isCollapsed ? (
            <div className="flex items-center justify-center">
              {currentLogo ? (
                <img src={currentLogo} alt={settings.companyName} className="h-8 w-8 object-contain" />
              ) : (
                <BrandLogo slot="sidebar-icon" fallbackClassName="h-8 w-8" />
              )}
            </div>
          ) : (
            <BrandLockup
              slot="sidebar"
              meta="Intake Dashboard"
              className="dashboard-brand-lockup"
              logoClassName="brand-logo brand-logo-sidebar"
              fallbackClassName="h-10 w-10"
            />
          )}
        </div>

        {!isCollapsed && (
          <div className="px-4 pb-2">
            <label className="relative block">
              <span className="sr-only">Filter navigation</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={navFilter}
                onChange={(event) => setNavFilter(event.target.value)}
                placeholder="Filter navigation…"
                aria-label="Filter navigation"
                className="h-8 w-full rounded-md border border-[color:var(--sidebar-border)] bg-[color:hsl(var(--sidebar-background))] pl-8 pr-7 text-xs text-sidebar-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {navFilter.length > 0 && (
                <button
                  type="button"
                  onClick={() => setNavFilter('')}
                  aria-label="Clear navigation filter"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
              Tip: press <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">⌘K</kbd> for the command palette.
            </p>
          </div>
        )}

        <nav className="dashboard-sidebar-nav" aria-label="Dashboard navigation">
          {groupedNavItems.length === 0 && !isCollapsed && (
            <div className="mx-4 my-3 rounded-md border border-dashed border-[color:var(--sidebar-border)] p-3 text-center text-xs text-muted-foreground">
              No matches for “{navFilter}”.
            </div>
          )}
          {groupedNavItems.map((group) => renderGroup(group))}

          {amlGroupedItems && renderGroup(amlGroupedItems)}

          {groupedAdminItems.items.length > 0 && (
            <div className="dashboard-sidebar-admin-divider">
              {renderGroup(groupedAdminItems, { administration: true })}
            </div>
          )}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
