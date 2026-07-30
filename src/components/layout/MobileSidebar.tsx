import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { usePermissions } from '@/hooks/usePermissions';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BrandLockup } from '@/components/branding/BrandAssets';

interface MobileSidebarProps {
  onNavigate?: () => void;
}

// Mirror of DashboardSidebar navigation — keep in sync.
const navigationItems = [
  { title: 'Overview', url: '/', icon: Home, moduleKey: 'overview' },
  { title: 'Market Updates', url: '/market-updates', icon: Newspaper, moduleKey: '__always__' },
  { title: 'Opportunity Marketplace', url: '/listings', icon: Building2, moduleKey: 'listings' },
  { title: 'Commercial / Industrial', url: '/commercial', icon: Building2, moduleKey: '__always__' },
  { title: 'Calendar', url: '/calendar', icon: Calendar, moduleKey: 'calendar' },
  { title: 'Reports', url: '/reports', icon: BarChart3, moduleKey: 'reports' },
  { title: 'Quantitative Reports', url: '/quantitative-reports', icon: BarChart3, moduleKey: 'generated_reports' },
  { title: 'Generated Reports', url: '/generated-reports', icon: FileText, moduleKey: 'generated_reports' },
  { title: 'Cash Flow Analysis', url: '/cash-flow-analysis', icon: Activity, moduleKey: 'cash_flow' },
  { title: 'Aurixa Intelligence Hub', url: '/report-qa', icon: MessageSquareText, moduleKey: 'report_qa' },
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
    itemTitles: ['Overview', 'Market Updates', 'Opportunity Marketplace', 'Commercial / Industrial', 'Calendar'],
  },
  {
    title: 'Reports & Analysis',
    itemTitles: ['Reports', 'Quantitative Reports', 'Generated Reports', 'Cash Flow Analysis', 'Aurixa Intelligence Hub', 'Portfolio Reports', 'Report Requests', 'Charts'],
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
    'Auto Report Generation',
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
    'Solicitor Portal',
    'Client Portal',
    'Token Audit Log',
    'PDF Import Engine',
    'PDF Import Diagnostics',
    'BC Segment Engine',
    'Reclassify Property',
    'Sources',
  ],
};

const adminItems = [
  { title: 'Auto Report Generation', url: '/automation', icon: Zap, moduleKey: 'automation' },
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
  { title: 'Solicitor Portal', url: '/admin/solicitor-portal', icon: Scale, moduleKey: 'solicitor_portal_admin' },
  { title: 'Client Portal', url: '/portal-config', icon: Globe, moduleKey: 'portal_config' },
  { title: 'Token Audit Log', url: '/admin/token-audit', icon: Coins, moduleKey: '__superadmin_only__' },
  { title: 'PDF Import Engine', url: '/admin/pdf-import-engine', icon: Cpu, moduleKey: '__superadmin_only__' },
  { title: 'PDF Import Diagnostics', url: '/admin/pdf-import-diagnostics', icon: Activity, moduleKey: '__superadmin_only__' },
  { title: 'BC Segment Engine', url: '/admin/bc-segment-engine', icon: Gauge, moduleKey: '__superadmin_only__' },
  { title: 'Reclassify Property', url: '/admin/reclassify-property', icon: Database, moduleKey: '__superadmin_only__' },
  { title: 'Sources', url: '/sources', icon: Mail, moduleKey: 'sources' },
];

export function MobileSidebar({ onNavigate }: MobileSidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const { settings } = useWhiteLabel();
  const { hasModuleAccess, isSuperadmin, loading: permissionsLoading } = usePermissions();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const isActive = (path: string) => {
    if (path === '/commercial') {
      return currentPath === '/commercial' || currentPath.startsWith('/commercial/') || currentPath === '/industrial' || currentPath.startsWith('/industrial/');
    }
    return currentPath === path;
  };

  const visibleNavItems = permissionsLoading
    ? navigationItems
    : navigationItems.filter((item) =>
        item.moduleKey === '__always__' ? true : (isSuperadmin || hasModuleAccess(item.moduleKey))
      );

  const visibleAdminItems = permissionsLoading
    ? []
    : adminItems.filter((item) =>
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

  const groupedNavItems = navigationGroups
    .map((group) => ({
      ...group,
      items: group.itemTitles.flatMap((title) => {
        const item = visibleNavItemsByTitle.get(title);
        return item ? [item] : [];
      }),
    }))
    .filter((group) => group.items.length > 0);

  const groupedAdminItems = {
    ...adminGroup,
    items: adminGroup.itemTitles.flatMap((title) => {
      const item = visibleAdminItemsByTitle.get(title);
      return item ? [item] : [];
    }),
  };

  const handleClick = () => onNavigate?.();

  const renderNavigationItem = (
    item: (typeof navigationItems)[number],
    isAdministration = false
  ) => {
    const active = isActive(item.url);
    return (
      <li key={item.title} className="list-none">
        <NavLink
          to={item.url}
          onClick={handleClick}
          title={item.title}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'dashboard-sidebar-menu-button flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium',
            isAdministration && 'dashboard-sidebar-menu-button-admin',
            active && 'dashboard-sidebar-menu-button-active'
          )}
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{item.title}</span>
        </NavLink>
      </li>
    );
  };

  const renderGroup = (
    group: { title: string; items: typeof visibleNavItems },
    options: { administration?: boolean } = {}
  ) => {
    const hasActiveItem = group.items.some((item) => isActive(item.url));
    const isGroupCollapsed = !hasActiveItem && Boolean(collapsedGroups[group.title]);

    return (
      <div
        key={group.title}
        className={cn(
          'dashboard-sidebar-group',
          options.administration && 'dashboard-sidebar-admin-group'
        )}
      >
        <button
          type="button"
          className={cn(
            'dashboard-sidebar-group-trigger',
            hasActiveItem && 'dashboard-sidebar-group-trigger-active',
            options.administration && 'dashboard-sidebar-admin-trigger'
          )}
          aria-expanded={!isGroupCollapsed}
          onClick={() =>
            setCollapsedGroups((current) => ({ ...current, [group.title]: !current[group.title] }))
          }
        >
          <span>{group.title}</span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isGroupCollapsed && '-rotate-90')} />
        </button>
        {!isGroupCollapsed && (
          <ul className="mt-1 space-y-0.5">
            {group.items.map((item) => renderNavigationItem(item, options.administration))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="dashboard-sidebar-surface flex h-full flex-col overflow-hidden">
      {/* Brand — matches desktop expanded header */}
      <div className="dashboard-sidebar-header p-6">
        <BrandLockup
          slot="sidebar"
          meta="Intake Dashboard"
          className="dashboard-brand-lockup"
          logoClassName="brand-logo brand-logo-sidebar"
          fallbackClassName="h-10 w-10"
        />
      </div>

      <ScrollArea className="flex-1">
        <nav className="dashboard-sidebar-nav" aria-label="Dashboard navigation">
          {groupedNavItems.map((group) => renderGroup(group))}

          {groupedAdminItems.items.length > 0 && (
            <div className="dashboard-sidebar-admin-divider">
              {renderGroup(groupedAdminItems, { administration: true })}
            </div>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
