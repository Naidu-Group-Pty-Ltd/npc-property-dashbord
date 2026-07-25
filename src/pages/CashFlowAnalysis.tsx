import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { CashFlowAnalysisModal } from '@/components/reports/CashFlowAnalysisModal';
import { useToast } from '@/hooks/use-toast';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { CashFlowEmptyState } from '@/components/cash-flow/CashFlowEmptyState';
import { CashFlowLoadingState } from '@/components/cash-flow/CashFlowLoadingState';
import { CashFlowPageHero } from '@/components/cash-flow/CashFlowPageHero';
import { CashFlowPaginationFooter } from '@/components/cash-flow/CashFlowPaginationFooter';
import { CashFlowReportGrid } from '@/components/cash-flow/CashFlowReportGrid';
import { CashFlowToolbar } from '@/components/cash-flow/CashFlowToolbar';
import type { BuildTypeFilter, DateRangeFilter, InvestmentReport } from '@/components/cash-flow/types';

export default function CashFlowAnalysis() {
  useModulePermissions('cash_flow');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reports, setReports] = useState<InvestmentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [backendOffset, setBackendOffset] = useState(0);
  const [openingReportId, setOpeningReportId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [buildTypeFilter, setBuildTypeFilter] = useState<BuildTypeFilter>('all');
  const [selectedReport, setSelectedReport] = useState<InvestmentReport | null>(null);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [hasHandledDeepLink, setHasHandledDeepLink] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeFilter>('30');

  const PAGE_SIZE = 50;
  const { toast } = useToast();

  const dateRangeCutoff = useMemo(() => {
    if (dateRange === 'all') return null;
    const date = new Date();
    date.setDate(date.getDate() - parseInt(dateRange, 10));
    return date;
  }, [dateRange]);

  const dateRangeLabel = useMemo(() => {
    switch (dateRange) {
      case '30': return 'last 30 days';
      case '90': return 'last 90 days';
      case '180': return 'last 6 months';
      case '365': return 'last 12 months';
      case 'all': return 'all time';
    }
  }, [dateRange]);

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  // Handle deep-linking: auto-open analysis from URL params
  useEffect(() => {
    if (loading || hasHandledDeepLink || reports.length === 0) return;
    
    const reportId = searchParams.get('reportId');
    const action = searchParams.get('action'); // 'view' or 'analyze' (default: analyze)
    
    if (reportId) {
      if (action === 'view') {
        navigate(`/generated-reports?reportId=${reportId}`, { replace: true });
        setHasHandledDeepLink(true);
        return;
      }
      const summary = reports.find(r => r.id === reportId);
      // Fetch full payload by ID even if it's not in the loaded list (paginated/older reports)
      openAnalysisForReport(summary || ({ id: reportId, property_address: '' } as InvestmentReport));
      setSearchParams({}, { replace: true });
      setHasHandledDeepLink(true);
    }
  }, [loading, reports, searchParams, hasHandledDeepLink, navigate]);

  const hasRequiredData = (report: InvestmentReport) => {
    const fc = report.financial_calculations || {};
    const mo = report.manual_overrides || {};
    
    // Check for purchase price (required) - rent is optional but helpful
    const hasPrice = mo.purchasePrice || fc.purchasePrice || fc.propertyValue;
    
    // For now, only require price - rent can be estimated or added later
    return !!hasPrice;
  };

  const getBuildType = (report: InvestmentReport): 'new_build' | 'existing_property' | 'land_only' => {
    const buildType = report.manual_overrides?.buildType;
    if (buildType === 'new_build' || buildType === 'land_only') return buildType;
    return 'existing_property';
  };

  const fetchReports = async (append = false, currentOffset = 0) => {
    try {
      if (append) setLoadingMore(true); else setLoading(true);
      // IMPORTANT: do not fetch report_content for the list view (very large payload)
      const listOptions: Record<string, any> = {
        select: 'id, property_address, property_listing_id, created_at, current_version, report_scope, status, manual_overrides, financial_calculations, investment_score, is_archived',
        status: 'completed',
        isArchived: false,
        orderBy: 'created_at',
        orderAsc: false,
        limit: PAGE_SIZE,
        offset: currentOffset,
      };
      if (dateRangeCutoff) {
        listOptions.createdAfter = dateRangeCutoff.toISOString();
      }
      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        listOptions,
      });

      if (error) throw new Error(error.message);

      const fetched: InvestmentReport[] = data?.reports || [];
      const reportsWithCashFlowData = fetched.filter(hasRequiredData);
      setReports(prev => append ? [...prev, ...reportsWithCashFlowData] : reportsWithCashFlowData);
      setBackendOffset(currentOffset + fetched.length);
      setHasMore(fetched.length === PAGE_SIZE);
    } catch (error: any) {
      console.error('Error fetching reports:', error);
      toast({
        title: "Error",
        description: "Failed to load investment reports",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    fetchReports(true, backendOffset);
  };

  const filteredReports = reports.filter(report => {
    const matchesSearch = report.property_address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBuildType = buildTypeFilter === 'all' || getBuildType(report) === buildTypeFilter;
    return matchesSearch && matchesBuildType;
  });

  const getInvestmentGrade = (report: InvestmentReport) => {
    const score = report.investment_score?.overall_score;
    if (!score) return null;
    
    if (score >= 85) return { grade: 'A+', color: 'bg-success' };
    if (score >= 75) return { grade: 'A', color: 'bg-success' };
    if (score >= 65) return { grade: 'B+', color: 'bg-success' };
    if (score >= 55) return { grade: 'B', color: 'bg-brand-500' };
    if (score >= 50) return { grade: 'C+', color: 'bg-brand-500' };
    if (score >= 45) return { grade: 'C', color: 'bg-warning' };
    if (score >= 35) return { grade: 'D', color: 'bg-destructive/60' };
    return { grade: 'F', color: 'bg-destructive' };
  };

  const FULL_REPORT_SELECT = 'id, property_address, property_listing_id, report_content, created_at, current_version, report_scope, status, manual_overrides, financial_calculations, demographics_data, economic_data, investment_score, location_intelligence';

  const openAnalysisForReport = async (reportSummary: InvestmentReport) => {
    setOpeningReportId(reportSummary.id);
    try {
      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        reportId: reportSummary.id,
        listOptions: { select: FULL_REPORT_SELECT },
      });
      if (error) throw new Error(error.message);
      const fullReport = data?.report || reportSummary;
      setSelectedReport(fullReport);
      setAnalysisModalOpen(true);

      logActivityDirect({
        actionType: 'cash_flow_created',
        entityType: 'cash_flow_analysis',
        entityId: fullReport.id,
        entityName: fullReport.property_address,
        metadata: { action: 'view_analysis' }
      });
    } catch (err: any) {
      console.error('Error loading full report:', err);
      toast({
        title: "Error",
        description: "Failed to load full report data",
        variant: "destructive",
      });
    } finally {
      setOpeningReportId(null);
    }
  };

  const handleViewAnalysis = (report: InvestmentReport) => {
    openAnalysisForReport(report);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setDateRange('30');
    setBuildTypeFilter('all');
  };

  return (
    <div className="space-y-6 overflow-x-hidden p-4 md:p-6">
      <CashFlowPageHero
        reports={reports}
        filteredReports={filteredReports}
        dateRangeLabel={dateRangeLabel}
        buildTypeFilter={buildTypeFilter}
        getBuildType={getBuildType}
      />

      <CashFlowToolbar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        buildTypeFilter={buildTypeFilter}
        onBuildTypeFilterChange={setBuildTypeFilter}
        filteredCount={filteredReports.length}
        loadedCount={reports.length}
      />

      {loading ? (
        <CashFlowLoadingState />
      ) : filteredReports.length === 0 ? (
        <CashFlowEmptyState
          variant={reports.length === 0 ? 'noReports' : 'noResults'}
          onConfigureReports={() => navigate('/generated-reports')}
          onClearFilters={handleClearFilters}
        />
      ) : (
        <CashFlowReportGrid
          reports={filteredReports}
          openingReportId={openingReportId}
          getBuildType={getBuildType}
          getInvestmentGrade={getInvestmentGrade}
          onViewReport={(report) => navigate(`/investment-report/${report.id}`)}
          onOpenCashFlow={handleViewAnalysis}
        />
      )}

      {!loading && (reports.length > 0 || hasMore) && (
        <CashFlowPaginationFooter
          filteredCount={filteredReports.length}
          loadedCount={reports.length}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={handleLoadMore}
        />
      )}

      <CashFlowAnalysisModal
        report={selectedReport}
        isOpen={analysisModalOpen}
        onClose={() => {
          setAnalysisModalOpen(false);
          setSelectedReport(null);
        }}
        onReportUpdated={() => {
          fetchReports();
          // Also update the selected report if it was modified
          if (selectedReport) {
            invokeSecureFunction('get-investment-reports', {
              reportId: selectedReport.id,
              listOptions: {
                select: 'id, property_address, property_listing_id, report_content, created_at, current_version, report_scope, status, manual_overrides, financial_calculations, demographics_data, economic_data, investment_score, location_intelligence'
              }
            }).then(({ data }) => {
              if (data?.report) setSelectedReport(data.report);
            });
          }
        }}
      />
    </div>
  );
}
