import { useState, useEffect } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Users, 
  Upload, 
  Search, 
  Building2, 
  DollarSign, 
  TrendingUp,
  RefreshCw,
  Loader2,
  Download,
  Trash2,
  Clock,
  Zap,
  Star,
  ExternalLink,
  Target,
  UserPlus,
  MoreHorizontal
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ExcelDropzone } from '@/components/clients/ExcelDropzone';
import { ClientCard } from '@/components/clients/ClientCard';
import { ClientDetailsModal } from '@/components/clients/ClientDetailsModal';
import { ClientFilters, ClientFiltersState, defaultFilters } from '@/components/clients/ClientFilters';
import { ClientBulkActions } from '@/components/clients/ClientBulkActions';
import { ClientAnalyticsDashboard } from '@/components/clients/ClientAnalyticsDashboard';
import { ClientComparison } from '@/components/clients/ClientComparison';
import { PortfolioAnalysisReportsList } from '@/components/clients/PortfolioAnalysisReportsList';
import { AddClientModal } from '@/components/clients/AddClientModal';
import { GHLExportDialog } from '@/components/shared/GHLExportDialog';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Client {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  primary_mobile: string | null;
  secondary_first_name: string | null;
  secondary_surname: string | null;
  ghl_contact_id: string | null;
  ghl_sync_status: string | null;
  total_portfolio_value: number;
  total_debt: number;
  net_monthly_cash_flow: number;
  created_at: string;
  /** Real active status (clients.is_active) — set via AML/CTF activation. */
  is_active?: boolean | null;
  /** Starred/favourite flag — a separate concept from active status. */
  is_favorite?: boolean;
  client_properties?: { id: string }[];
  pipeline_status?: string | null;
  follow_up_date?: string | null;
  next_review_due?: string | null;
  review_frequency?: string | null;
  last_review_date?: string | null;
}

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Smart capitalization for names from GHL (often lowercase)
function smartCapitalize(name: string | null | undefined): string {
  if (!name) return '';
  
  // Handle already properly capitalized names
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) {
    return name;
  }
  
  return name
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part, index, arr) => {
      // Keep separators as-is
      if (/^(\s+|-|')$/.test(part)) return part;
      
      // Handle special prefixes like Mc, Mac, O'
      if (part.startsWith('mc') && part.length > 2) {
        return 'Mc' + part.charAt(2).toUpperCase() + part.slice(3);
      }
      if (part.startsWith('mac') && part.length > 3) {
        return 'Mac' + part.charAt(3).toUpperCase() + part.slice(4);
      }
      
      // Standard capitalization
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

export default function ClientManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [deepLinkTab, setDeepLinkTab] = useState<string | undefined>(undefined);
  const [deepLinkDealId, setDeepLinkDealId] = useState<string | undefined>(undefined);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [filters, setFilters] = useState<ClientFiltersState>(defaultFilters);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isImportingFromGHL, setIsImportingFromGHL] = useState(false);
  const [importProgress, setImportProgress] = useState<{ imported: number; hasMore: boolean; totalFromApi?: number } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const queryClient = useQueryClient();
  const { canEdit: canEditClients, canDelete: canDeleteClients } = useModulePermissions('clients');

  // Fetch clients with property count via secure Edge Function (HttpOnly cookies)
  const { data: clients = [], isLoading, refetch } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction<{ success: boolean; clients: Client[] }>('get-client-data', {
        listMode: true,
        listOptions: {
          select: '*',
          orderBy: 'created_at',
          orderAsc: false,
          includePropertyCount: true,
        },
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error('Failed to fetch clients');
      return data.clients as Client[];
    }
  });

  // Deep-link: auto-open client modal or apply filter from query params
  useEffect(() => {
    const clientId = searchParams.get('clientId');
    const tab = searchParams.get('tab');
    const dealId = searchParams.get('dealId');
    const filterParam = searchParams.get('filter');

    // Handle reviews_due filter deep-link from Overview widget
    if (filterParam === 'reviews_due' && !isLoading) {
      // Show all clients with any review due (overdue + upcoming within 30 days)
      setFilters(prev => ({ ...prev, reviewStatus: 'upcoming' as const }));
      setTimeout(() => setSearchParams({}, { replace: true }), 100);
      return;
    }

    if (!clientId || isLoading || clients.length === 0) return;

    const target = clients.find(c => c.id === clientId);
    if (target) {
      setSelectedClient(target);
      setDeepLinkTab(tab || undefined);
      setDeepLinkDealId(dealId || undefined);
      setShowDetailsModal(true);
    }
    // Clean URL
    setSearchParams({}, { replace: true });
  }, [clients, isLoading, searchParams]);

  // Fetch GHL Location ID via edge function
  const { data: ghlLocationId } = useQuery({
    queryKey: ['ghl-location-id'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('check-integration-secrets', {
        integrationId: 'gohighlevel'
      });
      
      if (error || !data?.configured) {
        console.error('GHL not configured:', error);
        return null;
      }
      // The location ID is stored as GOHIGHLEVEL_LOCATION_ID env var
      // We need to get it from a different source - check if it was returned
      return data?.locationId || null;
    },
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  // Auto-sync from GHL on first load if no clients exist
  useEffect(() => {
    if (!isLoading && clients.length === 0 && !hasAutoSynced && !isImportingFromGHL) {
      setHasAutoSynced(true);
      handleImportFromGHL();
    }
  }, [isLoading, clients.length, hasAutoSynced, isImportingFromGHL]);

  // Periodic auto-sync from GHL
  useEffect(() => {
    if (!autoSyncEnabled) return;

    const performAutoSync = async () => {
      if (isImportingFromGHL || isAutoSyncing) return;
      
      setIsAutoSyncing(true);
      try {
        const { data, error } = await invokeSecureFunction('import-clients-from-ghl', {
          clearExisting: false,
          maxPages: 5, // Lighter sync for background updates
        });

        if (!error && data?.success) {
          setLastSyncTime(new Date());
          refetch();
          if (data.stats?.imported > 0) {
            toast.success(`Auto-sync: ${data.stats.imported} clients updated`, { duration: 3000 });
          }
        }
      } catch (err) {
        console.error('Auto-sync error:', err);
      } finally {
        setIsAutoSyncing(false);
      }
    };

    // Initial sync on mount
    performAutoSync();

    // Set up interval
    const intervalId = setInterval(performAutoSync, AUTO_SYNC_INTERVAL);

    return () => clearInterval(intervalId);
  }, [autoSyncEnabled, isImportingFromGHL]);

  // Import clients from GHL with auto-resume for large datasets
  const handleImportFromGHL = async (
    clearExisting = false,
    resumeFromId: string | null = null,
    resumeFrom: number | null = null,
  ) => {
    setIsImportingFromGHL(true);

    if (!resumeFromId && resumeFrom === null) {
      setImportProgress({ imported: 0, hasMore: true });
    }

    try {
      let totalImported = importProgress?.imported || 0;
      let nextResumeId: string | null = resumeFromId;
      let nextResume: number | null = resumeFrom;
      let isFirstBatch = !resumeFromId && resumeFrom === null;

      // Loop to fetch all batches automatically
      do {
        const { data, error } = await invokeSecureFunction('import-clients-from-ghl', {
          clearExisting: isFirstBatch ? clearExisting : false,
          resumeFromId: nextResumeId,
          resumeFrom: nextResume,
          maxPages: 10, // Process 10 pages (1000 contacts) per batch to avoid timeouts
        });

        if (error) throw error;

        if (data?.success) {
          const importedThisBatch = data.stats?.imported || 0;
          totalImported += importedThisBatch;

          setImportProgress((prev) => ({
            imported: totalImported,
            hasMore: !!data.hasMore,
            totalFromApi: prev?.totalFromApi ?? data.stats?.totalFromApi,
          }));

          if (data.hasMore) {
            nextResumeId = data.nextResumeId ?? null;
            nextResume = typeof data.nextResume === 'number' ? data.nextResume : null;
            isFirstBatch = false;

            // If the API isn't providing a cursor, stop (prevents UI from looping forever)
            if (!nextResumeId && nextResume === null) {
              console.warn('Import indicated hasMore=true but no resume cursor was provided; stopping.');
              break;
            }
          } else {
            nextResumeId = null;
            nextResume = null;
            toast.success(`Import complete! ${totalImported} clients imported from GHL.`);
          }

          // Refresh the client list after each batch
          refetch();
        } else {
          throw new Error(data?.error || 'Import failed');
        }
      } while (nextResumeId || nextResume !== null);
    } catch (err: any) {
      console.error('GHL import error:', err);
      toast.error('Failed to import from GHL: ' + (err.message || 'Unknown error'));
    } finally {
      setIsImportingFromGHL(false);
      setImportProgress(null);
      setShowClearConfirm(false);
    }
  };

  // Clear all clients and reimport
  const handleClearAndReimport = () => {
    setShowClearConfirm(true);
  };

  const confirmClearAndReimport = () => {
    handleImportFromGHL(true);
  };

  // Delete client mutation via secure Edge Function (HttpOnly cookies)
  const deleteClientMutation = useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'clients',
        clientId,
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete client');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Client deleted successfully');
      setClientToDelete(null);
    },
    onError: (error) => {
      toast.error('Failed to delete client: ' + error.message);
    }
  });

  // Apply filters
  const filteredClients = clients.filter(client => {
    // Starred filter — is_favorite is the star flag only; it is NOT the
    // client's active status (that is clients.is_active, set via AML/CTF
    // activation and shown on the client record).
    if (showStarredOnly && !client.is_favorite) return false;

    // Search filter
    const searchLower = searchQuery.toLowerCase();
    const fullName = `${client.primary_first_name} ${client.primary_surname}`.toLowerCase();
    const email = client.primary_email?.toLowerCase() || '';
    const matchesSearch = fullName.includes(searchLower) || email.includes(searchLower);
    if (!matchesSearch) return false;

    // Portfolio value filter
    const portfolioValue = Number(client.total_portfolio_value) || 0;
    if (filters.portfolioMin !== null && portfolioValue < filters.portfolioMin) return false;
    if (filters.portfolioMax !== null && portfolioValue > filters.portfolioMax) return false;

    // Cash flow status filter
    const cashFlow = Number(client.net_monthly_cash_flow) || 0;
    if (filters.cashFlowStatus === 'positive' && cashFlow < 0) return false;
    if (filters.cashFlowStatus === 'negative' && cashFlow >= 0) return false;

    // Sync status filter
    const syncStatus = client.ghl_sync_status || 'not_synced';
    if (filters.syncStatus !== 'all' && syncStatus !== filters.syncStatus) return false;

    // Follow-up status filter
    if (filters.followUpStatus !== 'all') {
      const now = new Date();
      const followUp = client.follow_up_date ? new Date(client.follow_up_date) : null;
      if (filters.followUpStatus === 'flagged' && !followUp) return false;
      if (filters.followUpStatus === 'overdue' && (!followUp || followUp >= now)) return false;
      if (filters.followUpStatus === 'upcoming') {
        if (!followUp) return false;
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (followUp < now || followUp > weekFromNow) return false;
      }
      if (filters.followUpStatus === 'none' && followUp) return false;
    }

    // Review status filter
    if (filters.reviewStatus !== 'all') {
      const now = new Date();
      const nextReview = client.next_review_due ? new Date(client.next_review_due) : null;
      if (filters.reviewStatus === 'overdue' && (!nextReview || nextReview >= now)) return false;
      if (filters.reviewStatus === 'due_soon') {
        if (!nextReview) return false;
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (nextReview < now || nextReview > weekFromNow) return false;
      }
      if (filters.reviewStatus === 'upcoming') {
        if (!nextReview) return false;
        const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        // Include overdue AND upcoming within 30 days — this is the "all reviews due" view
        if (nextReview > monthFromNow) return false;
      }
      if (filters.reviewStatus === 'no_review' && nextReview) return false;
    }

    // Review frequency filter
    if (filters.reviewFrequency !== 'all') {
      const freq = client.review_frequency || '';
      if (filters.reviewFrequency === 'quarterly' && freq !== 'quarterly') return false;
      if (filters.reviewFrequency === 'bi_annual' && freq !== 'bi_annual') return false;
      if (filters.reviewFrequency === 'annual' && freq !== 'annual') return false;
    }

    return true;
  });

  // Apply smart capitalization to client names for display
  const displayClients = filteredClients.map(client => ({
    ...client,
    primary_first_name: smartCapitalize(client.primary_first_name),
    primary_surname: smartCapitalize(client.primary_surname),
    secondary_first_name: smartCapitalize(client.secondary_first_name),
    secondary_surname: smartCapitalize(client.secondary_surname),
  }));

  // Count starred clients for the button badge (is_favorite — not is_active)
  const starredClientCount = clients.filter(c => c.is_favorite).length;

  // Calculate summary stats
  const totalClients = clients.length;
  const totalProperties = clients.reduce((acc, c) => acc + (c.client_properties?.length || 0), 0);
  const totalPortfolioValue = clients.reduce((acc, c) => acc + (Number(c.total_portfolio_value) || 0), 0);
  const pendingSyncCount = clients.filter(c => c.ghl_sync_status === 'pending').length;

  const handleViewClient = (client: Client) => {
    setSelectedClient(client);
    setShowDetailsModal(true);
  };

  const handleDeleteClient = (client: Client) => {
    setClientToDelete(client);
  };

  const handleSelectClient = (clientId: string, selected: boolean) => {
    if (selected) {
      setSelectedClients(prev => [...prev, clientId]);
    } else {
      setSelectedClients(prev => prev.filter(id => id !== clientId));
    }
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedClients(filteredClients.map(c => c.id));
    } else {
      setSelectedClients([]);
    }
  };

  const handleSyncAllPending = async () => {
    const pendingClients = clients.filter(c => c.ghl_sync_status === 'pending' || !c.ghl_sync_status);
    if (pendingClients.length === 0) {
      toast.info('No clients to sync');
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;
    let errorCount = 0;

    for (const client of pendingClients) {
      try {
        const { data, error } = await invokeSecureFunction('sync-client-to-ghl', {
          clientId: client.id
        });
        if (error || !data?.success) {
          errorCount++;
        } else {
          successCount++;
        }
      } catch {
        errorCount++;
      }
    }

    setIsSyncingAll(false);
    toast.success(`Synced ${successCount} clients${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
    refetch();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatLastSync = (date: Date | null) => {
    if (!date) return 'Never';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ago`;
  };

  const allSelected = filteredClients.length > 0 && selectedClients.length === filteredClients.length;
  const someSelected = selectedClients.length > 0 && selectedClients.length < filteredClients.length;
  const ghlExportFields = [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'tags', label: 'Tags' },
    { key: 'source', label: 'Source' },
    { key: 'secondary_first_name', label: 'Secondary First Name' },
    { key: 'secondary_last_name', label: 'Secondary Last Name' },
    { key: 'portfolio_value', label: 'Portfolio Value' },
    { key: 'total_debt', label: 'Total Debt' },
    { key: 'net_cash_flow', label: 'Net Cash Flow' },
    { key: 'properties', label: 'Properties' },
    { key: 'pipeline_status', label: 'Pipeline Status' },
    { key: 'follow_up_date', label: 'Follow Up Date' },
    { key: 'next_review_due', label: 'Next Review Due' },
    { key: 'review_frequency', label: 'Review Frequency' },
    { key: 'ghl_contact_id', label: 'GHL Contact ID' },
    { key: 'ghl_status', label: 'GHL Status' },
  ];
  const ghlExportRecords = displayClients.map((client) => ({
    first_name: client.primary_first_name || '',
    last_name: client.primary_surname || '',
    email: client.primary_email || '',
    phone: client.primary_mobile || '',
    tags: 'Dashboard Export',
    source: 'Client Management Export',
    secondary_first_name: client.secondary_first_name || '',
    secondary_last_name: client.secondary_surname || '',
    portfolio_value: client.total_portfolio_value?.toString() || '0',
    total_debt: client.total_debt?.toString() || '0',
    net_cash_flow: client.net_monthly_cash_flow?.toString() || '0',
    properties: (client.client_properties?.length || 0).toString(),
    pipeline_status: client.pipeline_status || '',
    follow_up_date: client.follow_up_date || '',
    next_review_due: client.next_review_due || '',
    review_frequency: client.review_frequency || '',
    ghl_contact_id: client.ghl_contact_id || '',
    ghl_status: client.ghl_sync_status || 'not_synced',
  }));

  const kpiCards = [
    {
      label: 'Total Clients',
      value: totalClients,
      icon: Users,
      accent: 'text-brand-200',
      iconSurface: 'border-brand-300/25 bg-brand-400/10',
      glow: 'from-brand-500/20',
      valueClassName: 'text-foreground',
      barClassName: 'from-brand-300 via-brand-400 to-transparent',
    },
    {
      label: 'Total Properties',
      value: totalProperties,
      icon: Building2,
      accent: 'text-brand-100',
      iconSurface: 'border-brand-300/20 bg-brand-300/10',
      glow: 'from-brand-500/15',
      valueClassName: 'text-foreground',
      barClassName: 'from-brand-300 via-brand-400 to-transparent',
    },
    {
      label: 'Portfolio Value',
      value: formatCurrency(totalPortfolioValue),
      icon: DollarSign,
      accent: 'text-brand-50',
      iconSurface: 'border-brand-200/35 bg-brand-300/15 shadow-brand-500/10',
      glow: 'from-brand-400/25',
      valueClassName: 'bg-gradient-to-r from-brand-100 via-brand-300 to-brand-500 bg-clip-text text-transparent',
      barClassName: 'from-brand-200 via-brand-400 to-transparent',
    },
    {
      label: 'Pending GHL Sync',
      value: pendingSyncCount,
      icon: TrendingUp,
      accent: 'text-brand-200',
      iconSurface: 'border-brand-300/30 bg-brand-500/15',
      glow: 'from-brand-600/25',
      valueClassName: pendingSyncCount > 0 ? 'text-brand-200' : 'text-foreground',
      barClassName: 'from-brand-300 via-warning to-transparent',
    },
  ];

  return (
    <div className="client-management-page relative -mx-3 space-y-5 overflow-hidden px-3 pb-20 md:mx-0 md:px-0 md:pb-0">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 rounded-[2rem] bg-[radial-gradient(circle_at_top_left,rgba(234,179,8,0.16),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.94),rgba(3,7,18,0.98))]" />
      <GHLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export clients for GHL"
        description="Map the current filtered client view into GHL-compatible headers before exporting as CSV or XLSX."
        fields={ghlExportFields}
        records={ghlExportRecords}
        fileBaseName={`client-management-export-${new Date().toISOString().split('T')[0]}`}
        sheetName="Client Management"
        onExported={(exportFormat, count) => toast.success(`Exported ${count} clients to ${exportFormat.toUpperCase()}`)}
      />

      {/* Header */}
      <section className="relative overflow-visible rounded-3xl border border-brand-500/20 bg-white dark:bg-[linear-gradient(135deg,rgba(20,20,20,0.94),rgba(3,7,18,0.9))] p-4 shadow-xl shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:shadow-black/30 backdrop-blur md:p-5">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
        <div className="pointer-events-none absolute -right-14 -top-20 h-44 w-44 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="inline-flex items-center rounded-full border border-brand-500/25 bg-brand-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">Premium client workspace</div>
            <h1 className="bg-gradient-to-r from-card dark:from-background via-brand-700 to-brand-500 bg-clip-text pb-1 text-[clamp(2rem,3vw,2.875rem)] font-semibold leading-[1.12] tracking-[-0.035em] text-transparent dark:from-white dark:via-brand-100 dark:to-brand-300">Client Management</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-[15px]">
              Manage clients, properties, and sync with GoHighLevel
            </p>
            <p className="text-xs text-muted-foreground">Last auto-sync: {formatLastSync(lastSyncTime)}</p>
          </div>
          <div className="flex w-full flex-col items-stretch gap-2 rounded-2xl border border-border/60 bg-background/70 p-1 shadow-inner shadow-[0_12px_32px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-black/30 dark:shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:shadow-black/30 backdrop-blur sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
          {/* Auto-sync toggle - compact on mobile */}
          <div className={`flex min-h-10 items-center justify-between gap-2 rounded-2xl border px-3 py-1.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-400/45 hover:bg-brand-500/10 focus-within:ring-2 focus-within:ring-brand-300/30 sm:justify-start ${autoSyncEnabled ? 'border-brand-300/35 bg-brand-400/10 shadow-brand-950/20' : 'border-border/60 bg-background/60 dark:border-white/10 dark:bg-white/[0.04]'}`}>
            {isAutoSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <Zap className={`h-3.5 w-3.5 ${autoSyncEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
            )}
            <span className={`text-xs font-semibold ${autoSyncEnabled ? 'text-brand-800 dark:text-brand-100' : 'text-muted-foreground'}`}>Auto-sync</span>
            <Switch
              checked={autoSyncEnabled}
              onCheckedChange={setAutoSyncEnabled}
              className="scale-90 data-[state=checked]:bg-brand-400"
            />
          </div>

          <Button 
            onClick={() => handleImportFromGHL(false)} 
            variant="default" 
            size="sm"
            disabled={isImportingFromGHL}
            className="h-10 flex-1 rounded-xl border border-brand-300/35 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(120,53,15,0.12))] px-4 text-xs font-bold text-brand-100 shadow-lg shadow-brand-950/25 transition-all hover:-translate-y-0.5 hover:border-brand-200/55 hover:bg-brand-500/25 hover:text-brand-50 hover:shadow-[0_14px_38px_rgba(245,158,11,0.18)] focus-visible:ring-2 focus-visible:ring-brand-300/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:text-sm"
          >
            {isImportingFromGHL ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            <span className="hidden sm:inline">
              {isImportingFromGHL && importProgress
                ? `Importing... (${importProgress.imported.toLocaleString()})`
                : 'Import from GHL'}
            </span>
            <span className="sm:hidden">Import</span>
          </Button>
          <Button
            onClick={() => setShowExportDialog(true)}
            variant="outline"
            size="sm"
            className="h-10 flex-1 rounded-xl border-border/60 bg-background/70 px-4 text-xs font-semibold text-foreground dark:border-white/15 dark:bg-white/[0.04] dark:text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-400/45 hover:bg-brand-500/10 hover:text-brand-100 hover:shadow-[0_12px_30px_rgba(245,158,11,0.12)] focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none sm:text-sm"
            disabled={displayClients.length === 0}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            <span className="hidden sm:inline">Export</span>
            <span className="sm:hidden">Export</span>
          </Button>
          {canEditClients && (
            <Button 
              onClick={() => setShowAddClientModal(true)} 
              variant="default" 
              size="sm"
              className="h-11 flex-1 rounded-xl border border-brand-200/50 bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 px-4 text-xs font-bold text-black shadow-xl shadow-brand-500/30 transition-all hover:-translate-y-0.5 hover:from-brand-200 hover:via-brand-300 hover:to-brand-400 hover:shadow-[0_18px_46px_rgba(251,191,36,0.32)] focus-visible:ring-2 focus-visible:ring-brand-200/75 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-none sm:text-sm"
            >
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              <span className="hidden sm:inline">Add Client</span>
              <span className="sm:hidden">Add</span>
            </Button>
          )}
          
          {/* More actions in dropdown on mobile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 flex-1 rounded-xl border-border/60 bg-background/70 px-3 text-foreground dark:border-white/15 dark:bg-white/[0.04] dark:text-foreground transition-all hover:-translate-y-0.5 hover:border-brand-400/45 hover:bg-brand-500/10 hover:text-brand-100 hover:shadow-[0_12px_30px_rgba(245,158,11,0.12)] focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-brand-300/50 data-[state=open]:bg-brand-500/15 data-[state=open]:text-brand-100 sm:flex-none" aria-label="More actions">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56 rounded-2xl border-brand-500/20 bg-popover dark:bg-[linear-gradient(145deg,rgba(24,24,27,0.98),rgba(3,7,18,0.96))] p-2 shadow-2xl shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:shadow-black/30">
              <DropdownMenuItem onClick={handleClearAndReimport} disabled={isImportingFromGHL} className="rounded-xl text-destructive transition-colors focus:bg-destructive/10 focus:text-destructive dark:text-destructive dark:focus:text-destructive-foreground disabled:opacity-50">
                <Trash2 className="h-4 w-4 mr-2 text-destructive dark:text-destructive" />
                Clear & Reimport
              </DropdownMenuItem>
              {pendingSyncCount > 0 && (
                <DropdownMenuItem onClick={handleSyncAllPending} disabled={isSyncingAll} className="rounded-xl transition-colors focus:bg-brand-500/10 focus:text-brand-100 disabled:opacity-50">
                  <RefreshCw className="h-4 w-4 mr-2 text-brand-300" />
                  Sync All ({pendingSyncCount})
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => refetch()} className="rounded-xl transition-colors focus:bg-brand-500/10 focus:text-brand-100">
                <RefreshCw className="h-4 w-4 mr-2 text-muted-foreground dark:text-foreground" />
                Refresh
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.location.href = '/client-tracker'} className="rounded-xl transition-colors focus:bg-brand-500/10 focus:text-brand-100">
                <Target className="h-4 w-4 mr-2 text-muted-foreground dark:text-foreground" />
                Client Tracker
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </div>
      </section>

      {/* Summary Stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map(({ label, value, icon: Icon, accent, iconSurface, glow, valueClassName, barClassName }) => (
          <Card
            key={label}
            className="group relative overflow-hidden rounded-2xl border border-border/70 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.22)_100%)] dark:bg-[linear-gradient(145deg,rgba(24,24,27,0.92),rgba(3,7,18,0.88))] shadow-lg shadow-[0_12px_30px_rgba(15,23,42,0.08)] dark:shadow-black/25 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/45 hover:shadow-xl hover:shadow-brand-950/35"
          >
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${glow} via-transparent to-transparent opacity-75 transition-opacity duration-300 group-hover:opacity-100`} />
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/65 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground/90">{label}</CardTitle>
              <div className={`rounded-xl border p-2 shadow-inner transition-transform duration-300 group-hover:scale-105 ${iconSurface}`}>
                <Icon className={`h-[17px] w-[17px] ${accent}`} />
              </div>
            </CardHeader>
            <CardContent className="relative space-y-3 pt-0">
              <div className={`text-[34px] font-semibold leading-none tracking-tight md:text-[38px] ${valueClassName}`}>{value}</div>
              <div className="h-px w-full bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
              <div className={`h-1 w-20 rounded-full bg-gradient-to-r ${barClassName} opacity-90 shadow-[0_0_22px_rgba(245,158,11,0.22)] transition-all duration-300 group-hover:w-28 group-hover:opacity-100`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <Tabs defaultValue="clients" className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-2.5 shadow-xl shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20 backdrop-blur md:p-3">
        <div className="-mx-3 overflow-x-auto px-3 pb-1 md:mx-0 md:px-0">
          <TabsList aria-label="Client management sections" className="inline-flex h-auto min-h-11 w-auto min-w-max gap-1 rounded-2xl border border-brand-500/20 bg-muted p-1 shadow-inner shadow-foreground/70 backdrop-blur dark:bg-[linear-gradient(135deg,rgba(24,24,27,0.86),rgba(3,7,18,0.78))] dark:shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:shadow-black/30">
            <TabsTrigger value="clients" className="min-h-10 rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-brand-500/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-300 data-[state=active]:to-brand-500 data-[state=active]:text-black data-[state=active]:shadow-lg data-[state=active]:shadow-brand-500/25">Clients</TabsTrigger>
            <TabsTrigger value="portfolio-reports" className="min-h-10 rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-brand-500/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-300 data-[state=active]:to-brand-500 data-[state=active]:text-black data-[state=active]:shadow-lg data-[state=active]:shadow-brand-500/25">Portfolio</TabsTrigger>
            <TabsTrigger value="analytics" className="min-h-10 rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-brand-500/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-300 data-[state=active]:to-brand-500 data-[state=active]:text-black data-[state=active]:shadow-lg data-[state=active]:shadow-brand-500/25">Analytics</TabsTrigger>
            <TabsTrigger value="compare" className="min-h-10 rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-brand-500/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-300 data-[state=active]:to-brand-500 data-[state=active]:text-black data-[state=active]:shadow-lg data-[state=active]:shadow-brand-500/25">Compare</TabsTrigger>
            <TabsTrigger value="import" className="min-h-10 rounded-xl px-4 py-2 text-[13px] font-semibold text-muted-foreground transition-all duration-200 hover:bg-brand-500/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-gradient-to-r data-[state=active]:from-brand-300 data-[state=active]:to-brand-500 data-[state=active]:text-black data-[state=active]:shadow-lg data-[state=active]:shadow-brand-500/25">Import</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="clients" className="space-y-5 rounded-xl border border-border/60 bg-background/35 p-3 md:p-4">
          {/* Bulk Actions Bar */}
          <ClientBulkActions
            selectedClients={selectedClients}
            clients={filteredClients}
            onClearSelection={() => setSelectedClients([])}
            onActionComplete={() => refetch()}
          />

          {/* Search & Filters */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-brand-500/15 bg-muted dark:bg-[linear-gradient(135deg,rgba(24,24,27,0.76),rgba(3,7,18,0.62))] p-3 shadow-inner shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:shadow-black/25 backdrop-blur">
            <div className="relative min-w-full flex-1 sm:min-w-[240px] md:max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-200/70" />
              <Input
                placeholder="Search clients..."
                aria-label="Search clients"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 rounded-xl border-brand-500/20 bg-background/75 pl-10 pr-4 text-sm shadow-sm shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20 placeholder:text-muted-foreground/75 transition-all hover:border-brand-400/35 focus-visible:border-brand-300/70 focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
            <Button
              variant={showStarredOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setShowStarredOnly(!showStarredOnly)}
              aria-pressed={showStarredOnly}
              className={`h-11 gap-2 rounded-xl px-4 font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-400/50 focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                showStarredOnly
                  ? 'border-brand-300/40 bg-brand-400 text-black shadow-brand-500/20 hover:bg-brand-300 hover:text-black'
                  : 'border-brand-500/25 bg-background/70 text-muted-foreground hover:bg-brand-500/10 hover:text-brand-100'
              }`}
            >
              <Star className={`h-4 w-4 ${showStarredOnly ? 'fill-current' : ''}`} />
              Starred
              {starredClientCount > 0 && (
                <Badge variant={showStarredOnly ? "secondary" : "default"} className={`ml-1 rounded-full px-2 font-bold ${showStarredOnly ? 'bg-background dark:bg-black/15 text-black' : 'bg-brand-500/15 text-brand-100 border border-brand-500/25'}`}>
                  {starredClientCount}
                </Badge>
              )}
            </Button>
            <ClientFilters filters={filters} onFiltersChange={setFilters} />
            {filteredClients.length > 0 && (
              <div className="flex min-h-10 items-center gap-2 rounded-xl border border-border/60 bg-background/55 px-3 text-sm shadow-sm transition-all hover:border-brand-500/35 hover:bg-brand-500/5 focus-within:border-brand-300/50 focus-within:ring-2 focus-within:ring-brand-300/25">
                <Checkbox
                  checked={allSelected}
                  ref={(ref) => {
                    if (ref) {
                      (ref as any).indeterminate = someSelected;
                    }
                  }}
                  onCheckedChange={handleSelectAll}
                  className="border-brand-500/40 data-[state=checked]:bg-brand-500 data-[state=checked]:text-black"
                />
                <span className="text-sm font-medium text-muted-foreground">
                  Select all ({filteredClients.length})
                </span>
              </div>
            )}
          </div>

          {/* Client List */}
          {isLoading ? (
            <div className="grid items-stretch gap-5 lg:grid-cols-2 2xl:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="relative min-h-[22rem] overflow-hidden rounded-3xl border-brand-300/15 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.22)_100%)] dark:bg-[linear-gradient(145deg,rgba(24,24,27,0.86),rgba(3,7,18,0.72))] shadow-xl shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/50 to-transparent" />
                  <CardContent className="space-y-5 p-5">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-12 animate-pulse rounded-2xl bg-brand-300/15" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-2/3 animate-pulse rounded-full bg-card/10 dark:bg-white/10" />
                        <div className="h-3 w-1/2 animate-pulse rounded-full bg-card/5 dark:bg-white/5" />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <div className="h-16 animate-pulse rounded-2xl bg-muted/55 dark:bg-white/[0.045]" />
                      <div className="h-16 animate-pulse rounded-2xl bg-muted/45 dark:bg-white/[0.035]" />
                      <div className="h-16 animate-pulse rounded-2xl bg-muted/40 dark:bg-white/[0.03]" />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-brand-100/70">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading client records...
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : displayClients.length === 0 ? (
            <Card className="relative overflow-hidden rounded-3xl border-dashed border-brand-300/20 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.10),transparent_35%),linear-gradient(145deg,hsl(var(--card)),hsl(var(--muted)/0.22))] dark:bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.1),transparent_35%),linear-gradient(145deg,rgba(24,24,27,0.78),rgba(3,7,18,0.62))] shadow-xl shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20">
              <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/55 to-transparent" />
              <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl border border-brand-300/20 bg-brand-300/10 text-brand-100 shadow-lg shadow-brand-950/20">
                  {searchQuery || filters !== defaultFilters || showStarredOnly ? (
                    <Search className="h-7 w-7" />
                  ) : (
                    <Users className="h-7 w-7" />
                  )}
                </div>
                <h3 className="text-xl font-bold tracking-tight text-foreground dark:text-white">
                  {showStarredOnly
                    ? 'No starred clients found'
                    : searchQuery || filters !== defaultFilters
                      ? 'No clients match your filters'
                      : 'No clients found'
                  }
                </h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                  {searchQuery || filters !== defaultFilters || showStarredOnly
                    ? 'Try adjusting your filters'
                    : 'Import clients using the Import tab'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid items-stretch gap-5 lg:grid-cols-2 2xl:grid-cols-3">
              {displayClients.map((client) => (
              <ClientCard
                    key={client.id}
                    client={client}
                    ghlLocationId={ghlLocationId}
                    onView={() => handleViewClient(client)}
                    onDelete={canDeleteClients ? () => handleDeleteClient(client) : undefined}
                    onSyncComplete={() => refetch()}
                    isSelected={selectedClients.includes(client.id)}
                    onSelect={(checked) => handleSelectClient(client.id, !!checked)}
                  />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4 rounded-xl border border-border/60 bg-background/35 p-3 md:p-4">
          <ClientAnalyticsDashboard clients={clients} />
        </TabsContent>

        <TabsContent value="compare" className="space-y-4 rounded-xl border border-border/60 bg-background/35 p-3 md:p-4">
          <ClientComparison clients={clients} />
        </TabsContent>

        <TabsContent value="portfolio-reports" className="space-y-5 rounded-2xl border border-brand-400/15 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.09),transparent_34%),linear-gradient(180deg,rgba(15,15,18,0.78),rgba(0,0,0,0.48))] p-2.5 shadow-xl shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20 md:p-5">
          <div className="relative overflow-hidden rounded-3xl border border-brand-300/20 bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)/0.22))] dark:bg-[linear-gradient(135deg,rgba(24,24,27,0.94),rgba(3,7,18,0.86))] p-5 shadow-lg shadow-[0_12px_30px_rgba(15,23,42,0.08)] dark:shadow-black/25">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-brand-300/20 bg-brand-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-brand-100">
                  Portfolio Intelligence
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground dark:text-white">Portfolio Performance Reports</h2>
                <p className="text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                Quick view of recent portfolio analysis reports — open the full page for search, stats, and bulk actions
                </p>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={() => window.location.href = '/portfolio-reports'}
                className="h-11 rounded-2xl bg-gradient-to-r from-brand-300 to-brand-500 px-5 font-semibold text-black shadow-lg shadow-brand-950/25 transition-all duration-200 hover:-translate-y-0.5 hover:from-brand-200 hover:to-brand-400 hover:shadow-brand-500/20 focus-visible:ring-2 focus-visible:ring-brand-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Full Reports Page
              </Button>
            </div>
          </div>
          <PortfolioAnalysisReportsList showHeader={false} />
        </TabsContent>

        <TabsContent value="import" className="space-y-4 rounded-xl border border-border/60 bg-background/35 p-3 md:p-4">
          <Card className="relative overflow-hidden rounded-3xl border-brand-500/20 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.12),transparent_34%),linear-gradient(145deg,hsl(var(--card)),hsl(var(--muted)/0.22))] dark:bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_34%),linear-gradient(145deg,rgba(24,24,27,0.94),rgba(3,7,18,0.86))] shadow-2xl shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:shadow-black/25 transition-colors hover:border-brand-400/40">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
            <CardHeader className="border-b border-border/60 dark:border-white/10 pb-4">
              <CardTitle className="flex items-center gap-3 text-xl font-bold tracking-tight text-foreground dark:text-white sm:text-2xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-300/15 text-brand-100 shadow-lg shadow-brand-950/20">
                  <Upload className="h-5 w-5" />
                </span>
                Import Clients from Excel
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                Drag and drop your client intake form Excel file to import clients and their properties into the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <ExcelDropzone onImportComplete={() => refetch()} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Client Details Modal */}
      {selectedClient && (
        <ClientDetailsModal
          client={selectedClient}
          open={showDetailsModal}
          onOpenChange={(open) => {
            setShowDetailsModal(open);
            if (!open) {
              setDeepLinkTab(undefined);
              setDeepLinkDealId(undefined);
            }
          }}
          initialTab={deepLinkTab}
          initialDealId={deepLinkDealId}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!clientToDelete} onOpenChange={() => setClientToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Client</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {clientToDelete?.primary_first_name} {clientToDelete?.primary_surname}? 
              This will also delete all their properties, income, assets, and liabilities. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clientToDelete && deleteClientMutation.mutate(clientToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Clear & Reimport Confirmation Dialog */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Clients & Reimport</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete ALL existing client data and reimport fresh from GoHighLevel. 
              This action cannot be undone. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClearAndReimport}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isImportingFromGHL ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                'Clear & Reimport'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Client Modal */}
      <AddClientModal
        open={showAddClientModal}
        onOpenChange={setShowAddClientModal}
      />
    </div>
  );
}
