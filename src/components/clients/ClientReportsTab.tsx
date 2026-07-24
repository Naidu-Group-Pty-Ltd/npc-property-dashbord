import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { secureStorageDownload, secureStorageUpload } from '@/hooks/useSecureStorage';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
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
import {
  FileText,
  Download,
  Mail,
  Plus,
  Building2,
  PieChart,
  FileSpreadsheet,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Eye,
  Trash2,
  MoreVertical,
  Loader2,
  SortAsc,
  Landmark,
  Send,
} from 'lucide-react';
import { format } from 'date-fns';
import { PropertyReportGenerator } from './PropertyReportGenerator';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchAndGenerateBorrowingCapacityPDF, generateBorrowingCapacityPDF } from '@/components/borrowing-capacity/BorrowingCapacityPDFReport';
import { fetchLatestBorrowingCapacity } from '@/lib/fetchLatestBorrowingCapacity';
import { useAuth } from '@/hooks/useAuth';

interface ClientReportsTabProps {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  fullClient: any;
  properties: any[];
  employment: any[];
  income: any[];
  assets: any[];
  liabilities: any[];
  expenses?: any[];
  onEmailClick: (blob: Blob, fileName: string) => void;
  onOpenEmailCompose: () => void;
}

type ReportType = 'all' | 'portfolio' | 'vownet' | 'investment' | 'property' | 'borrowing' | 'published';
type SortMode = 'newest' | 'oldest' | 'name';

interface UnifiedReport {
  id: string;
  type: 'vownet' | 'portfolio' | 'property' | 'investment' | 'borrowing' | 'published';
  name: string;
  generatedAt: string;
  status: 'completed' | 'pending' | 'failed';
  fileUrl?: string | null;
  propertyAddress?: string;
  source: 'file' | 'investment_report' | 'portfolio_report' | 'borrowing_assessment' | 'portal_report';
  // Portfolio-specific fields
  healthScore?: number | null;
  overallHealth?: string | null;
  portfolioValue?: number | null;
}

export function ClientReportsTab({
  clientId,
  clientName,
  clientEmail,
  fullClient,
  properties,
  employment,
  income,
  assets,
  liabilities,
  expenses = [],
  onEmailClick,
  onOpenEmailCompose,
}: ClientReportsTabProps) {
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ReportType>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [reportToDelete, setReportToDelete] = useState<UnifiedReport | null>(null);
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const canFetchReports = !authLoading && !!user;

  // Fetch client files that are reports
  const { data: reportFiles = [] } = useQuery({
    queryKey: ['client-report-files', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { files: true },
      });

      if (error || !data?.success) {
        console.warn('[ClientReportsTab] Failed to fetch client files:', error?.message || 'unknown error');
        return [];
      }

      return (data.files || []).filter((f: any) => f.is_vownet_form || f.report_type);
    },
  });

  // Fetch investment reports linked to client properties via secure function
  const propertyIds = properties.map((p) => p.id);
  const { data: investmentReports = [] } = useQuery({
    queryKey: ['client-investment-reports', clientId, propertyIds],
    enabled: canFetchReports && propertyIds.length > 0,
    retry: false,
    queryFn: async () => {
      if (propertyIds.length === 0) return [];

      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        listOptions: {
          isClientReport: true,
          clientPropertyIds: propertyIds,
          select: 'id,property_address,status,created_at,client_property_id',
          orderBy: 'created_at',
          orderAsc: false,
        }
      });

      if (error) {
        console.warn('[ClientReportsTab] Failed to fetch investment reports:', error.message);
        return [];
      }

      return data?.reports || [];
    },
  });

  // Fetch borrowing capacity assessments for this client
  const { data: bcAssessments = [] } = useQuery({
    queryKey: ['client-bc-assessments', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'borrowing_capacity_assessments',
          select: 'id,created_at,borrowing_capacity,serviceability_band,updated_at',
          orderBy: 'created_at',
          order_asc: false,
          filters: { client_id: clientId }
        }
      });

      if (error) {
        console.warn('[ClientReportsTab] Failed to fetch BC assessments:', error.message);
        return [] as any[];
      }

      return (data?.records || []) as any[];
    },
  });

  // Fetch portfolio analysis reports
  const { data: portfolioReports = [], isLoading: portfolioLoading } = useQuery({
    queryKey: ['portfolio-analysis-reports', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'portfolio_analysis_reports',
          select: '*',
          orderBy: 'created_at',
          order_asc: false,
          filters: { client_id: clientId }
        }
      });

      if (error) {
        console.warn('[ClientReportsTab] Failed to fetch portfolio reports:', error.message);
        return [] as any[];
      }

      return (data?.records || []) as any[];
    },
  });

  // Fetch published portal reports for this client
  const { data: portalReports = [] } = useQuery({
    queryKey: ['client-portal-reports-unified', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_portal_reports',
          select: '*',
          filters: { client_id: clientId },
          orderBy: 'published_at',
          order_asc: false,
        },
      });
      if (error) {
        console.warn('[ClientReportsTab] Failed to fetch portal reports:', error.message);
        return [] as any[];
      }
      return (data?.records || []) as any[];
    },
  });

  const deletePortfolioMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'portfolio_analysis_reports',
        reportId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_: any, reportId: string) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-analysis-reports', clientId] });
      logActivityDirect({
        actionType: 'report_deleted',
        entityType: 'portfolio_report',
        entityId: reportId,
        metadata: { client_id: clientId }
      });
      toast.success('Report deleted');
      setReportToDelete(null);
    },
    onError: () => {
      toast.error('Portfolio report could not be deleted. No data was removed. Please try again.');
    },
  });

  // Unified report list — merges all sources, deduplicates portfolio reports
  const allReports: UnifiedReport[] = useMemo(() => {
    const reports: UnifiedReport[] = [];

    // Vownet forms from files
    reportFiles
      .filter((f: any) => f.is_vownet_form)
      .forEach((f: any) => {
        reports.push({
          id: f.id,
          type: 'vownet',
          name: f.file_name || 'Client Detail Form',
          generatedAt: f.uploaded_at,
          status: 'completed',
          fileUrl: f.file_path,
          source: 'file',
        });
      });

    // Other report files (property reports etc) — exclude portfolio type (handled below)
    reportFiles
      .filter((f: any) => f.report_type && !f.is_vownet_form && f.report_type !== 'portfolio')
      .forEach((f: any) => {
        reports.push({
          id: f.id,
          type: f.report_type as 'property' | 'investment',
          name: f.file_name || `${f.report_type} Report`,
          generatedAt: f.uploaded_at,
          status: 'completed',
          fileUrl: f.file_path,
          propertyAddress: f.description,
          source: 'file',
        });
      });

    // Investment reports from investment_reports table
    investmentReports.forEach((r: any) => {
      reports.push({
        id: r.id,
        type: 'investment',
        name: `Investment Report - ${r.property_address}`,
        generatedAt: r.created_at,
        status: (r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : 'pending') as any,
        fileUrl: r.pdf_url || null,
        propertyAddress: r.property_address,
        source: 'investment_report',
      });
    });

    // Portfolio analysis reports from portfolio_analysis_reports table
    portfolioReports.forEach((r: any) => {
      reports.push({
        id: r.id,
        type: 'portfolio',
        name: `Portfolio Analysis - ${format(new Date(r.created_at), 'dd MMM yyyy')}`,
        generatedAt: r.created_at,
        status: 'completed',
        fileUrl: r.pdf_file_path,
        source: 'portfolio_report',
        healthScore: r.health_score,
        overallHealth: r.overall_health,
        portfolioValue: r.portfolio_value,
      });
    });

    // Borrowing capacity assessments
    bcAssessments.forEach((r: any) => {
      const formattedCap = r.borrowing_capacity
        ? `$${Number(r.borrowing_capacity).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
        : '';
      reports.push({
        id: r.id,
        type: 'borrowing',
        name: `Borrowing Capacity${formattedCap ? ` – ${formattedCap}` : ''} (${r.serviceability_band || 'N/A'})`,
        generatedAt: r.created_at,
        status: 'completed',
        source: 'borrowing_assessment',
      });
    });

    // Published portal reports
    portalReports.forEach((r: any) => {
      reports.push({
        id: `portal-${r.id}`,
        type: 'published',
        name: r.report_title || 'Published Report',
        generatedAt: r.published_at || r.created_at,
        status: 'completed',
        fileUrl: r.storage_path,
        source: 'portal_report',
      });
    });

    return reports;
  }, [reportFiles, investmentReports, portfolioReports, bcAssessments, portalReports]);

  // Filter + sort
  const filteredReports = useMemo(() => {
    let filtered = activeFilter === 'all' ? allReports : allReports.filter(r => r.type === activeFilter);

    filtered.sort((a, b) => {
      if (sortMode === 'newest') return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
      if (sortMode === 'oldest') return new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime();
      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, [allReports, activeFilter, sortMode]);

  // Type counts for filter chips
  const typeCounts = useMemo(() => ({
    all: allReports.length,
    portfolio: allReports.filter(r => r.type === 'portfolio').length,
    vownet: allReports.filter(r => r.type === 'vownet').length,
    investment: allReports.filter(r => r.type === 'investment').length,
    property: allReports.filter(r => r.type === 'property').length,
    borrowing: allReports.filter(r => r.type === 'borrowing').length,
    published: allReports.filter(r => r.type === 'published').length,
  }), [allReports]);

  const getReportIcon = (type: string) => {
    switch (type) {
      case 'vownet': return <FileSpreadsheet className="h-4 w-4" />;
      case 'portfolio': return <PieChart className="h-4 w-4" />;
      case 'borrowing': return <Landmark className="h-4 w-4" />;
      case 'property':
      case 'investment': return <Building2 className="h-4 w-4" />;
      case 'published': return <Send className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'vownet': return 'bg-primary/10 text-primary border-primary/20';
      case 'portfolio': return 'bg-accent/50 text-accent-foreground border-accent';
      case 'investment': return 'bg-secondary/50 text-secondary-foreground border-secondary';
      case 'borrowing': return 'bg-primary/15 text-primary border-primary/25';
      case 'property': return 'bg-muted text-muted-foreground border-border';
      case 'published': return 'bg-accent/50 text-accent-foreground border-accent';
      default: return '';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="h-3.5 w-3.5 text-success-foreground0" />;
      case 'pending': return <Clock className="h-3.5 w-3.5 text-brand-500" />;
      case 'failed': return <AlertCircle className="h-3.5 w-3.5 text-destructive-foreground0" />;
      default: return null;
    }
  };

  // Legacy rows accidentally stored the entire `secureStorageUpload` response
  // object (JSON-stringified) as `file_path`. Normalize before passing to storage.
  const normalizeStoragePath = (raw: string): string => {
    if (!raw) return raw;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return trimmed;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.path === 'string' && parsed.path) return parsed.path;
        if (typeof parsed.fullPath === 'string' && parsed.fullPath) {
          return parsed.fullPath.replace(/^client-files\//, '');
        }
      }
    } catch {}
    return trimmed;
  };

  const handleDownloadFile = async (fileUrl: string, fileName: string) => {
    const normalized = normalizeStoragePath(fileUrl);
    try {
      const result = await secureStorageDownload('client-files', normalized);
      if (!result.success || !result.blob) throw new Error(result.error || 'Download failed');

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch (error: any) {
      console.error('Download error:', error);
      // Fallback to investment-reports bucket for older files
      try {
        const fallbackResult = await secureStorageDownload('investment-reports', normalized);
        if (!fallbackResult.success || !fallbackResult.blob) throw new Error('Fallback download failed');
        const url = URL.createObjectURL(fallbackResult.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('Report downloaded');
      } catch {
        toast.error('Failed to download report');
      }
    }
  };

  const handleViewFile = async (fileUrl: string) => {
    const normalized = normalizeStoragePath(fileUrl);
    // Open the tab synchronously inside the click handler so popup blockers
    // (Chrome/Safari) don't kill it after the async storage download.
    const viewer = window.open('', '_blank');
    if (viewer) {
      viewer.document.write(
        '<title>Loading PDF…</title><style>body{margin:0;background:#0d0d0d;color:#d4a843;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh}</style><body>Loading PDF…</body>'
      );
    }

    const openBlob = (blob: Blob) => {
      // Force application/pdf so the browser renders inline instead of downloading.
      const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      if (viewer) {
        viewer.location.href = url;
      } else {
        // Popup blocked — fall back to same-tab download link.
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
      }
      // Revoke after the viewer has had time to load the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    try {
      const result = await secureStorageDownload('client-files', normalized);
      if (result.success && result.blob) {
        openBlob(result.blob);
        return;
      }
      throw new Error(result.error || 'Failed');
    } catch (err) {
      // Fallback: try the investment-reports bucket via the same secure path.
      try {
        const fallback = await secureStorageDownload('investment-reports', normalized);
        if (fallback.success && fallback.blob) {
          openBlob(fallback.blob);
          return;
        }
      } catch {}
      if (viewer) viewer.close();
      console.error('[handleViewFile] failed', err, 'raw=', fileUrl, 'normalized=', normalized);
      toast.error('Failed to open PDF');
    }
  };

  const handleEmailReport = async (report: UnifiedReport) => {
    if (!report.fileUrl) {
      toast.error('No file available to attach');
      return;
    }
    const normalized = normalizeStoragePath(report.fileUrl);
    try {
      const result = await secureStorageDownload('client-files', normalized);
      if (!result.success || !result.blob) throw new Error('Download failed');
      onEmailClick(result.blob, report.name);
    } catch {
      toast.error('Failed to prepare report for email');
    }
  };

  const handleSendToPortal = async (report: UnifiedReport) => {
    const reportTypeMap: Record<string, string> = {
      investment: 'investment',
      portfolio: 'portfolio',
      borrowing: 'borrowing_capacity',
      vownet: 'cash_flow',
      property: 'investment',
    };

    let storagePath = report.fileUrl || null;

    // For borrowing capacity reports, generate the PDF on-the-fly, upload to storage, then publish
    if (report.source === 'borrowing_assessment' && !storagePath) {
      toast.loading('Generating & uploading Borrowing Capacity PDF...', { id: 'portal-bc' });
      try {
        const { latestAssessment, incomeSources, liabilities, expenses, properties, client } =
          await fetchLatestBorrowingCapacity(clientId);

        if (!latestAssessment) {
          toast.error('No borrowing capacity assessment found. Calculate capacity first.', { id: 'portal-bc' });
          return;
        }

        const result = await generateBorrowingCapacityPDF({
          clientId,
          clientName,
          assessment: latestAssessment,
          incomeSources,
          liabilities,
          expenses,
          properties,
          client,
          returnBlob: true,
        });

        if (!result?.blob) {
          toast.error('PDF generation failed', { id: 'portal-bc' });
          return;
        }

        // Upload to storage
        const safeName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
        const dateStr = format(new Date(), 'yyyy-MM-dd_HHmmss');
        const uploadPath = `portal-reports/${clientId}/Borrowing_Capacity_${safeName}_${dateStr}.pdf`;

        const uploadResult = await secureStorageUpload('client-files', uploadPath, result.blob, {
          contentType: 'application/pdf',
          upsert: true,
        });

        if (!uploadResult.success) {
          toast.error('Failed to upload PDF: ' + uploadResult.error, { id: 'portal-bc' });
          return;
        }

        storagePath = uploadResult.path || uploadPath;
        toast.dismiss('portal-bc');
      } catch (err: any) {
        toast.error('Failed to generate PDF: ' + err.message, { id: 'portal-bc' });
        return;
      }
    }

    if (!storagePath) {
      toast.error('No PDF available to send. Generate the report PDF first.');
      return;
    }

    try {
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_portal_reports',
        clientId,
        data: {
          report_title: report.name,
          report_type: reportTypeMap[report.type] || 'investment',
          storage_path: storagePath,
          notes: report.propertyAddress ? `Property: ${report.propertyAddress}` : null,
          published_at: new Date().toISOString(),
        },
      });
      if (error) throw error;
      toast.success('Report published to client portal');
    } catch (err: any) {
      toast.error('Failed to publish: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDelete = (report: UnifiedReport) => {
    setReportToDelete(report);
  };

  const confirmDelete = () => {
    if (!reportToDelete) return;
    if (reportToDelete.source === 'portfolio_report') {
      deletePortfolioMutation.mutate(reportToDelete.id);
    } else {
      // For now, only portfolio reports support deletion from this view
      toast.info('This report type cannot be deleted from here');
      setReportToDelete(null);
    }
  };

  const filterChips: { key: ReportType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'borrowing', label: 'Borrowing' },
    { key: 'vownet', label: 'Client Forms' },
    { key: 'investment', label: 'Investment' },
    { key: 'property', label: 'Property' },
    { key: 'published', label: 'Published' },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden overflow-y-auto">
      {/* Reports remain focused on existing report records and property-specific generation. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1">Generate property report:</span>

        {/* Property Report Dropdown */}
        {properties.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Building2 className="h-4 w-4 mr-1.5" />
                Property
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Select Property</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {properties.map((property) => (
                <DropdownMenuItem
                  key={property.id}
                  onClick={() => setSelectedProperty(property.id)}
                  className="flex items-start gap-2 py-2"
                >
                  <Building2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium truncate max-w-[200px]">
                      {property.address}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {property.property_type === 'investment' ? 'Investment' : property.property_type === 'owner_occupied' ? 'Owner Occupied' : property.property_type === 'smsf' ? 'SMSF' : property.property_type === 'rental' ? 'Rental' : property.property_type}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Selected Property Inline Generator */}
      {selectedProperty && (() => {
        const selectedProp = properties.find(p => p.id === selectedProperty);
        if (!selectedProp) return null;
        return (
          <div className="p-3 bg-muted/50 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate">{selectedProp.address}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <PropertyReportGenerator property={selectedProp} clientName={clientName} />
              <Button variant="ghost" size="sm" onClick={() => setSelectedProperty(null)}>Cancel</Button>
            </div>
          </div>
        );
      })()}

      <Separator />

      {/* ─── Filter Chips + Sort ─── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterChips.map(chip => {
            const count = typeCounts[chip.key];
            if (chip.key !== 'all' && count === 0) return null;
            return (
              <button
                key={chip.key}
                onClick={() => setActiveFilter(chip.key)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border",
                  activeFilter === chip.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {chip.label}
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] rounded-full px-1.5 min-w-[18px] text-center",
                    activeFilter === chip.key ? "bg-primary-foreground/20" : "bg-muted-foreground/20"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
              <SortAsc className="h-3.5 w-3.5 mr-1" />
              {sortMode === 'newest' ? 'Newest' : sortMode === 'oldest' ? 'Oldest' : 'Name'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSortMode('newest')}>Most Recent</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortMode('oldest')}>Oldest First</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortMode('name')}>Name A-Z</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ─── Unified Report Library ─── */}
      {!canFetchReports ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">Please sign in to view client reports</p>
        </div>
      ) : authLoading || portfolioLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {activeFilter === 'all' ? 'No reports generated yet' : `No ${activeFilter} reports found`}
          </p>
          <p className="text-xs mt-1">Use the buttons above to generate your first report</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredReports.map((report) => (
            <div
              key={`${report.source}-${report.id}`}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              {/* Left: Icon + Info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  {getReportIcon(report.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{report.name}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", getTypeBadgeClass(report.type))}>
                      {report.type.charAt(0).toUpperCase() + report.type.slice(1)}
                    </Badge>
                    {getStatusIcon(report.status)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    <Clock className="h-3 w-3 flex-shrink-0" />
                    <span>{format(new Date(report.generatedAt), 'dd MMM yyyy, HH:mm')}</span>
                    {report.propertyAddress && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="truncate">{report.propertyAddress}</span>
                      </>
                    )}
                    {report.overallHealth && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span>Health: {report.overallHealth}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1 sm:gap-1 flex-shrink-0 ml-auto">
                {/* View (for investment reports without file or any report with file) */}
                {report.type === 'investment' && report.source === 'investment_report' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 sm:h-8 sm:w-8"
                    onClick={() => window.open(`/investment-report/${report.id}`, '_blank')}
                    title="View Report"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}

                {/* Download PDF for borrowing capacity assessments */}
                {report.type === 'borrowing' && report.source === 'borrowing_assessment' && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => fetchAndGenerateBorrowingCapacityPDF(clientId, clientName)}
                      title="Download PDF"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </>
                )}

                {report.fileUrl && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => handleViewFile(report.fileUrl!)}
                      title="View PDF"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => handleDownloadFile(report.fileUrl!, report.name)}
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => handleEmailReport(report)}
                      title="Email this report"
                    >
                      <Mail className="h-4 w-4" />
                    </Button>
                  </>
                )}

                {/* Send to Client Portal (hide for already-published portal reports) */}
                {report.source !== 'portal_report' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-8 sm:w-8 text-primary"
                  onClick={() => handleSendToPortal(report)}
                  title="Send to Client Portal"
                >
                  <Send className="h-4 w-4" />
                </Button>
                )}

                {/* More actions (delete for portfolio reports) */}
                {report.source === 'portfolio_report' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleDelete(report)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!reportToDelete} onOpenChange={() => setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{reportToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
