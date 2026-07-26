// App configuration - updated Mar 9, 2026
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { SearchProvider } from "@/contexts/SearchContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { ComparisonProvider } from "@/contexts/ComparisonContext";
import { BrandProvider } from "@/branding/BrandProvider";
import { AuthProvider } from "@/hooks/useAuth";
import { PermissionsProvider } from "@/hooks/usePermissions";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ModuleGuard } from "@/components/auth/ModuleGuard";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { BackgroundJobTracker } from "./components/BackgroundJobTracker";
import { ReportGenerationProgress } from "./components/reports/ReportGenerationProgress";
import { CallNotificationListener } from "./components/CallNotificationListener";
import { Phase1NotificationListeners } from "./components/Phase1NotificationListeners";
import { TokenEventsListener } from "@/components/billing/TokenEventsListener";
import { PushNotificationPrompt } from "./components/PushNotificationPrompt";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { HarveyCountdown } from "@/components/HarveyCountdown";
import { Button } from "@/components/ui/button";
import Overview from "./pages/Overview";
import Listings from "./pages/Listings";
import Calendar from "./pages/Calendar";
import MarketUpdates from "./pages/MarketUpdates";
import Sources from "./pages/Sources";
import Reports from "./pages/Reports";
import QuantitativeReports from "./pages/QuantitativeReports";
import Charts from "./pages/Charts";
import GeneratedReports from "./pages/GeneratedReports";
import ReportViewer from "./pages/ReportViewer";
import Settings from "./pages/Settings";
import UserGuide from "./pages/UserGuide";
import DataImport from './pages/DataImport';
import Monitoring from './pages/Monitoring';
import QualityAssurance from './pages/QualityAssurance';
import ErrorLogs from './pages/ErrorLogs';
import Automation from './pages/Automation';
import EmailCopilot from './pages/EmailCopilot';
import CallLogs from './pages/CallLogs';
import Conversations from './pages/Conversations';
import Messages from './pages/Messages';
import Lenders from './pages/Lenders';
import CashFlowAnalysis from './pages/CashFlowAnalysis';
import ReportQA from './pages/ReportQA';
import SharedQAAnswer from './pages/SharedQAAnswer';
import InvestmentReportView from './pages/InvestmentReportView';
import Templates from './pages/Templates';
import WhiteLabel from './pages/WhiteLabel';
import Auth from "./pages/Auth";
import AcceptInvite from "./pages/AcceptInvite";
import UserManagement from "./pages/admin/UserManagement";
import GhlMigration from "./pages/admin/GhlMigration";
import FinancePortalAdmin from "./pages/admin/FinancePortalAdmin";
import FinancePortalAnalytics from "./pages/admin/FinancePortalAnalytics";
import FinancePortalBulkImport from "./pages/admin/FinancePortalBulkImport";
import FinancePortalCompliance from "./pages/admin/FinancePortalCompliance";
import FinancePortalHealth from "./pages/admin/FinancePortalHealth";
import FinancePortalCommissions from "./pages/admin/FinancePortalCommissions";
import ActivityLogs from "./pages/ActivityLogs";
import { DepreciationCompsAdmin } from "./components/admin/DepreciationCompsAdmin";
import TemplateBuilder from "./pages/admin/TemplateBuilder";
import TemplateBuilderEdit from "./pages/admin/TemplateBuilderEdit";
import TemplateSharePreview from "./pages/TemplateSharePreview";
import ReportEngineInspector from "./pages/admin/ReportEngineInspector";
import FigmaTemplates from "./pages/admin/FigmaTemplates";
import PdfImportEngineAdmin from "./pages/admin/PdfImportEngineAdmin";
import BcSegmentEngineAdmin from "./pages/admin/BcSegmentEngineAdmin";
import AmlV3Cutover from "./pages/admin/AmlV3Cutover";
import AmlIntegrationHealth from "./pages/admin/AmlIntegrationHealth";
import PdfImportDiagnostics from "./pages/admin/PdfImportDiagnostics";
import PdfImportMonitoring from "./pages/admin/PdfImportMonitoring";
import PdfImportRetention from "./pages/admin/PdfImportRetention";
import PdfImportClientReports from "./pages/admin/PdfImportClientReports";
import TemplateImportQuality from "./pages/admin/TemplateImportQuality";
import PdfGoldenRegression from "./pages/admin/PdfGoldenRegression";
import MarketQAQuality from "./pages/admin/MarketQAQuality";
import ReclassifyPropertyAdmin from "./pages/admin/ReclassifyPropertyAdmin";
import AgentQuality from "./pages/admin/AgentQuality";
import AmlCases from "./pages/aml/AmlCases";
import AmlOverview from "./pages/aml/AmlOverview";
import {
  AmlIntakeQueue, AmlVerification, AmlScreening, AmlRisk, AmlCounterparty,
  AmlFinance, AmlTransactions,
  AmlMonitoring, AmlInvestigations, AmlAustracReporting, AmlRecords, AmlGovernance, AmlConfiguration,
} from "./pages/aml/AmlShellPages";
import AmlLaunchOps from "./pages/aml/AmlLaunchOps";
import { AmlLayout } from "@/components/aml/AmlLayout";
import { AmlGuard } from "@/components/aml/AmlGuard";
import AgentMemoryManager from "./pages/agent/MemoryManager";
import AgentInsights from "./pages/agent/AgentInsights";
import AgentPlans from "./pages/agent/AgentPlans";
import AgentSkills from "./pages/agent/AgentSkills";
import SharedMarketQAAnswer from "./pages/qa/SharedMarketQAAnswer";
import MarketQASubscriptions from "./pages/qa/MarketQASubscriptions";
import MarketQADigests from "./pages/qa/MarketQADigests";

import Integrations from "./pages/Integrations";
import MarketingAnalytics from "./pages/MarketingAnalytics";
import CloudflareManagement from "./pages/CloudflareManagement";
import ClientManagement from "./pages/ClientManagement";
import ClientTracker from "./pages/ClientTracker";
import PortfolioReports from "./pages/PortfolioReports";
import ReportRequests from "./pages/ReportRequests";
import ApiUsage from "./pages/ApiUsage";
import DealPipeline from "./pages/DealPipeline";
import RemindersHub from "./pages/RemindersHub";
import Checklists from "./pages/Checklists";
import Agreements from "./pages/Agreements";
import GamePlan from "./pages/GamePlan";
import Commissions from "./pages/Commissions";
import ReportsAnalytics from "./pages/ReportsAnalytics";
import ModelHub from "./pages/ModelHub";
import Billing from "./pages/Billing";
import TokenAuditLog from "./pages/TokenAuditLog";
import CommercialProperties from "./pages/commercial/CommercialProperties";
import CommercialPropertyDetail from "./pages/commercial/CommercialPropertyDetail";

import IndustrialPropertyDetail from "./pages/industrial/IndustrialPropertyDetail";
import PropertyCalculators from "./pages/calculators/PropertyCalculators";
import NotFound from "./pages/NotFound";
import { PortalAuthProvider } from "@/hooks/usePortalAuth";
import { PortalProtectedRoute } from "@/components/portal/PortalProtectedRoute";
import { PortalLayout } from "@/components/portal/PortalLayout";
import PortalAuth from "./pages/portal/PortalAuth";
import PortalHandoff from "./pages/portal/PortalHandoff";
import PortalDashboard from "./pages/portal/PortalDashboard";
import PortalProfile from "./pages/portal/PortalProfile";
import PortalProperties from "./pages/portal/PortalProperties";
import PortalEmployment from "./pages/portal/PortalEmployment";
import PortalReports from "./pages/portal/PortalReports";
import PortalDocuments from "./pages/portal/PortalDocuments";
import PortalAcceptInvite from "./pages/portal/PortalAcceptInvite";
import PortalNotifications from "./pages/portal/PortalNotifications";
import PortalDealProgress from "./pages/portal/PortalDealProgress";
import PortalActionItems from "./pages/portal/PortalActionItems";
import PortalFinanceHub from "./pages/portal/PortalFinanceHub";
import PortalLenders from "./pages/portal/PortalLenders";
import PortalMessages from "./pages/portal/PortalMessages";
import PortalPropertyInsights from "./pages/portal/PortalPropertyInsights";
import PortalBooking from "./pages/portal/PortalBooking";
import PortalAppointments from "./pages/portal/PortalAppointments";
import PortalAml from "./pages/portal/PortalAml";
import PortalConfig from "./pages/PortalConfig";
import { PortalConsentWall } from "@/components/portal/PortalConsentWall";
import { FinancePortalAuthProvider } from "@/hooks/useFinancePortalAuth";
import { FinancePortalProtectedRoute } from "@/components/finance-portal/FinancePortalProtectedRoute";
import { FinancePortalLayout } from "@/components/finance-portal/FinancePortalLayout";
import FinancePortalLogin from "./pages/finance-portal/FinancePortalLogin";
import FinancePortalAcceptInvite from "./pages/finance-portal/FinancePortalAcceptInvite";
import FinancePortalChangePassword from "./pages/finance-portal/FinancePortalChangePassword";
import FinancePortalDashboard from "./pages/finance-portal/FinancePortalDashboard";
import FinancePortalClients from "./pages/finance-portal/FinancePortalClients";
import FinancePortalClientProfile from "./pages/finance-portal/FinancePortalClientProfile";
import FinancePortalMessages from "./pages/finance-portal/FinancePortalMessages";
import FinancePortalEarnings from "./pages/finance-portal/FinancePortalEarnings";
import FinancePortalLenderIntelligence from "./pages/finance-portal/FinancePortalLenderIntelligence";
import FinancePortalReports from "./pages/finance-portal/FinancePortalReports";
import FinancePortalSettings from "./pages/finance-portal/FinancePortalSettings";

import FinancePortalPurchaseFiles from "./pages/finance-portal/FinancePortalPurchaseFiles";
import FinancePortalPurchaseFileDetail from "./pages/finance-portal/FinancePortalPurchaseFileDetail";
import FinancePortalClientInbox from "./pages/finance-portal/FinancePortalClientInbox";
import FinancePortalPipeline from "./pages/finance-portal/FinancePortalPipeline";
import FinancePortalInsights from "./pages/finance-portal/FinancePortalInsights";
import AmlCaseSnapshot from "./pages/finance-portal/AmlCaseSnapshot";


const queryClient = new QueryClient();

const CalendarErrorFallback = () => (
  <div className="p-6">
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm">
      <div className="font-medium text-foreground">Calendar failed to load.</div>
      <div className="mt-1 text-muted-foreground">
        A malformed appointment may have caused this section to crash.
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  </div>
);

const PathNormalizer = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const normalizedPath = location.pathname.replace(/\/{2,}/g, '/');
    if (normalizedPath !== location.pathname) {
      navigate(`${normalizedPath}${location.search}${location.hash}`, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, navigate]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrandProvider>
            <PermissionsProvider>
              <BrowserRouter>
                <PathNormalizer />
                <NotificationsProvider>
                  <BackgroundJobTracker />
                  <ReportGenerationProgress />
                  <CallNotificationListener />
                  <Phase1NotificationListeners />
                  <TokenEventsListener />
                  <PushNotificationPrompt />
                  <ComparisonProvider>
                    <SearchProvider>
                      <Toaster />
                      <Sonner />
                      <Routes>
                        {/* Public shareable answer link (no auth) */}
                        <Route path="/qa/shared/:token" element={<SharedQAAnswer />} />
                        {/* Public shareable market Q&A answer (no auth) */}
                        <Route path="/qa/market/:slug" element={<SharedMarketQAAnswer />} />
                        {/* Public template share preview (no auth) */}
                        <Route path="/template-share/:token" element={<TemplateSharePreview />} />
                        {/* Client Portal Routes */}
                        <Route path="/client/login" element={
                          <PortalAuthProvider>
                            <PortalAuth />
                          </PortalAuthProvider>
                        } />
                        <Route path="/client/accept-invite" element={
                          <PortalAcceptInvite />
                        } />
                        <Route path="/portal/accept-invite" element={
                          <PortalAcceptInvite />
                        } />
                        <Route path="/client/handoff" element={<PortalHandoff />} />
                        <Route path="/client/consent" element={
                          <PortalAuthProvider>
                            <PortalConsentWall />
                          </PortalAuthProvider>
                        } />
                        <Route path="/client" element={
                          <PortalAuthProvider>
                            <PortalProtectedRoute>
                              <PortalLayout />
                            </PortalProtectedRoute>
                          </PortalAuthProvider>
                        }>
                          <Route index element={<PortalDashboard />} />
                          <Route path="profile" element={<PortalProfile />} />
                          <Route path="properties" element={<PortalProperties />} />
                          <Route path="employment" element={<PortalEmployment />} />
                          <Route path="emails" element={<PortalReports />} />
                          <Route path="reports" element={<PortalReports />} />
                          <Route path="request-report" element={<PortalReports />} />
                          <Route path="documents" element={<PortalDocuments />} />
                          <Route path="notifications" element={<PortalNotifications />} />
                          <Route path="deal-progress" element={<PortalDealProgress />} />
                          <Route path="action-items" element={<PortalActionItems />} />
                          <Route path="finance" element={<PortalFinanceHub />} />
                          <Route path="lenders" element={<PortalLenders />} />
                          <Route path="messages" element={<PortalMessages />} />
                          <Route path="property-insights" element={<PortalPropertyInsights />} />
                          <Route path="booking" element={<PortalBooking />} />
                          <Route path="appointments" element={<PortalAppointments />} />
                          <Route path="aml" element={<PortalAml />} />
                        </Route>

                        {/* Finance Portal Routes - single provider wrapping all /finance/* */}
                        <Route path="/finance/*" element={
                          <FinancePortalAuthProvider>
                            <Routes>
                              <Route path="login" element={<FinancePortalLogin />} />
                              <Route path="accept-invite" element={<FinancePortalAcceptInvite />} />
                              <Route path="change-password" element={
                                <FinancePortalProtectedRoute>
                                  <FinancePortalChangePassword />
                                </FinancePortalProtectedRoute>
                              } />
                              <Route path="" element={
                                <FinancePortalProtectedRoute>
                                  <FinancePortalLayout />
                                </FinancePortalProtectedRoute>
                              }>
                                <Route index element={<FinancePortalDashboard />} />
                                <Route path="purchase-files" element={<FinancePortalPurchaseFiles />} />
                                <Route path="purchase-files/:fileId" element={<FinancePortalPurchaseFileDetail />} />
                                <Route path="clients" element={<FinancePortalClients />} />
                                <Route path="clients/:clientId" element={<FinancePortalClientProfile />} />
                                <Route path="messages" element={<FinancePortalMessages />} />
                                <Route path="client-inbox" element={<FinancePortalClientInbox />} />
                                <Route path="earnings" element={<FinancePortalEarnings />} />
                                <Route path="lender-intelligence" element={<FinancePortalLenderIntelligence />} />
                                <Route path="pipeline" element={<FinancePortalPipeline />} />
                                <Route path="insights" element={<FinancePortalInsights />} />
                                <Route path="reports" element={<FinancePortalReports />} />
                                <Route path="settings" element={<FinancePortalSettings />} />
                                <Route path="aml-snapshot/:token" element={<AmlCaseSnapshot />} />
                                



                              </Route>
                            </Routes>
                          </FinancePortalAuthProvider>
                        } />

                        {/* Internal Dashboard Routes */}
                        <Route path="/auth" element={<Auth />} />
                        <Route path="/accept-invite" element={<AcceptInvite />} />
                        <Route path="/" element={
                          <ProtectedRoute>
                            <HarveyCountdown />
                            <DashboardLayout />
                          </ProtectedRoute>
                        }>
                <Route index element={<Overview />} />
                <Route path="dashboard" element={<Overview />} />
                <Route path="listings" element={<ModuleGuard moduleKey="listings"><Listings /></ModuleGuard>} />
                <Route path="market-updates" element={<MarketUpdates />} />
                <Route
                  path="calendar"
                  element={
                    <ModuleGuard moduleKey="calendar">
                      <ErrorBoundary fallback={<CalendarErrorFallback />}>
                        <Calendar />
                      </ErrorBoundary>
                    </ModuleGuard>
                  }
                />
                <Route path="sources" element={<ModuleGuard moduleKey="sources"><Sources /></ModuleGuard>} />
                <Route path="reports" element={<ModuleGuard moduleKey="reports"><Reports /></ModuleGuard>} />
                <Route path="quantitative-reports" element={<ModuleGuard moduleKey="generated_reports"><QuantitativeReports /></ModuleGuard>} />
                <Route path="quantitative-reports/:reportId" element={<ModuleGuard moduleKey="generated_reports"><ReportViewer /></ModuleGuard>} />
                <Route path="charts" element={<ModuleGuard moduleKey="charts"><Charts /></ModuleGuard>} />
                <Route path="generated-reports" element={<ModuleGuard moduleKey="generated_reports"><GeneratedReports /></ModuleGuard>} />
                <Route path="generated-reports/:reportId" element={<ModuleGuard moduleKey="generated_reports"><ReportViewer /></ModuleGuard>} />
                <Route path="user-guide" element={<UserGuide />} />
                <Route path="monitoring" element={<ModuleGuard moduleKey="monitoring"><Monitoring /></ModuleGuard>} />
                <Route path="quality-assurance" element={<ModuleGuard moduleKey="quality_assurance"><QualityAssurance /></ModuleGuard>} />
                <Route path="data-import" element={<ModuleGuard moduleKey="data_import"><DataImport /></ModuleGuard>} />
                <Route path="automation" element={<ModuleGuard moduleKey="automation"><Automation /></ModuleGuard>} />
                <Route path="email-copilot" element={<ModuleGuard moduleKey="email_copilot"><EmailCopilot /></ModuleGuard>} />
                <Route path="call-logs" element={<ModuleGuard moduleKey="call_logs"><CallLogs /></ModuleGuard>} />
                <Route path="cash-flow-analysis" element={<ModuleGuard moduleKey="cash_flow"><CashFlowAnalysis /></ModuleGuard>} />
                <Route path="report-qa" element={<ModuleGuard moduleKey="report_qa"><ReportQA /></ModuleGuard>} />
                <Route path="investment-report/:id" element={<ModuleGuard moduleKey="reports"><InvestmentReportView /></ModuleGuard>} />
                <Route path="templates" element={<ModuleGuard moduleKey="templates"><Templates /></ModuleGuard>} />
                <Route path="white-label" element={<ModuleGuard moduleKey="white_label"><WhiteLabel /></ModuleGuard>} />
                <Route path="error-logs" element={<ModuleGuard moduleKey="error_logs"><ErrorLogs /></ModuleGuard>} />
                <Route path="settings" element={<ModuleGuard moduleKey="settings"><Settings /></ModuleGuard>} />
                <Route path="admin/users" element={<ModuleGuard moduleKey="user_management"><UserManagement /></ModuleGuard>} />
                <Route path="admin/finance-portal" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalAdmin /></ModuleGuard>} />
                <Route path="admin/finance-portal/analytics" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalAnalytics /></ModuleGuard>} />
                <Route path="admin/finance-portal/bulk-import" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalBulkImport /></ModuleGuard>} />
                <Route path="admin/finance-portal/compliance" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalCompliance /></ModuleGuard>} />
                <Route path="admin/finance-portal/health" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalHealth /></ModuleGuard>} />
                <Route path="admin/finance-portal/commissions" element={<ModuleGuard moduleKey="finance_portal_admin"><FinancePortalCommissions /></ModuleGuard>} />
                <Route path="admin/activity-logs" element={<ModuleGuard moduleKey="activity_logs"><ActivityLogs /></ModuleGuard>} />
                <Route path="admin/depreciation-comps" element={<ModuleGuard moduleKey="depreciation_comps"><DepreciationCompsAdmin /></ModuleGuard>} />
                <Route path="admin/template-builder" element={<ModuleGuard moduleKey="templates"><TemplateBuilder /></ModuleGuard>} />
                <Route path="admin/template-builder/:id" element={<ModuleGuard moduleKey="templates" requireEdit><TemplateBuilderEdit /></ModuleGuard>} />
                <Route path="admin/report-engine-inspector" element={<ReportEngineInspector />} />
                <Route path="admin/figma-templates" element={<ModuleGuard moduleKey="templates"><FigmaTemplates /></ModuleGuard>} />
                <Route path="admin/pdf-import-engine" element={<ModuleGuard moduleKey="templates"><PdfImportEngineAdmin /></ModuleGuard>} />
                <Route path="admin/pdf-import-diagnostics" element={<ModuleGuard moduleKey="templates"><PdfImportDiagnostics /></ModuleGuard>} />
                <Route path="admin/pdf-import-monitoring" element={<ModuleGuard moduleKey="templates"><PdfImportMonitoring /></ModuleGuard>} />
                <Route path="admin/pdf-import-retention" element={<ModuleGuard moduleKey="templates"><PdfImportRetention /></ModuleGuard>} />
                <Route path="admin/pdf-import-client-reports" element={<ModuleGuard moduleKey="templates"><PdfImportClientReports /></ModuleGuard>} />
                <Route path="admin/template-import-quality" element={<ModuleGuard moduleKey="templates"><TemplateImportQuality /></ModuleGuard>} />
                <Route path="admin/pdf-golden-regression" element={<ModuleGuard moduleKey="templates"><PdfGoldenRegression /></ModuleGuard>} />
                <Route path="admin/market-qa-quality" element={<ModuleGuard moduleKey="activity_logs"><MarketQAQuality /></ModuleGuard>} />
                <Route path="admin/bc-segment-engine" element={<BcSegmentEngineAdmin />} />
                <Route path="admin/reclassify-property" element={<ReclassifyPropertyAdmin />} />
                <Route path="admin/agent-quality" element={<ModuleGuard moduleKey="activity_logs"><AgentQuality /></ModuleGuard>} />
                <Route path="admin/aml" element={<AmlLayout />}>
                  <Route index element={<AmlGuard capability="aml.view"><AmlOverview /></AmlGuard>} />
                  <Route path="intake" element={<AmlGuard capability="aml.view"><AmlIntakeQueue /></AmlGuard>} />
                  <Route path="cases" element={<AmlGuard capability="aml.view"><AmlCases /></AmlGuard>} />
                  <Route path="verification" element={<AmlGuard capability="aml.view"><AmlVerification /></AmlGuard>} />
                  <Route path="screening" element={<AmlGuard capability="aml.view"><AmlScreening /></AmlGuard>} />
                  <Route path="risk" element={<AmlGuard capability="aml.view"><AmlRisk /></AmlGuard>} />
                  <Route path="counterparty" element={<AmlGuard capability="aml.view"><AmlCounterparty /></AmlGuard>} />
                  <Route path="finance" element={<AmlGuard capability="aml.investigate"><AmlFinance /></AmlGuard>} />
                  <Route path="transactions" element={<AmlGuard capability="aml.investigate"><AmlTransactions /></AmlGuard>} />
                  <Route path="monitoring" element={<AmlGuard capability="aml.view"><AmlMonitoring /></AmlGuard>} />
                  <Route path="investigations" element={<AmlGuard capability="aml.investigate"><AmlInvestigations /></AmlGuard>} />
                  <Route path="austrac" element={<AmlGuard capability="aml.report"><AmlAustracReporting /></AmlGuard>} />
                  <Route path="records" element={<AmlGuard capability="aml.view"><AmlRecords /></AmlGuard>} />
                  <Route path="governance" element={<AmlGuard capability="aml.view"><AmlGovernance /></AmlGuard>} />
                  <Route path="launch-ops" element={<AmlGuard capability="aml.view"><AmlLaunchOps /></AmlGuard>} />
                  <Route path="configuration" element={<AmlGuard capability="aml.configure"><AmlConfiguration /></AmlGuard>} />
                </Route>
                <Route path="admin/aml-v3-cutover" element={<AmlV3Cutover />} />
                <Route path="admin/aml-integration-health" element={<AmlIntegrationHealth />} />
                <Route path="agent/memories" element={<ModuleGuard moduleKey="agent"><AgentMemoryManager /></ModuleGuard>} />
                <Route path="agent-insights" element={<ModuleGuard moduleKey="agent"><AgentInsights /></ModuleGuard>} />
                <Route path="agent/plans" element={<AgentPlans />} />
                <Route path="agent/skills" element={<AgentSkills />} />
                <Route path="qa/subscriptions" element={<MarketQASubscriptions />} />
                <Route path="qa/digests" element={<MarketQADigests />} />

                <Route path="integrations" element={<ModuleGuard moduleKey="integrations"><Integrations /></ModuleGuard>} />
                <Route path="integrations/ghl-migration" element={<GhlMigration />} />
                <Route path="cloudflare" element={<ModuleGuard moduleKey="cloudflare"><CloudflareManagement /></ModuleGuard>} />
                <Route path="api-usage" element={<ModuleGuard moduleKey="api_usage"><ApiUsage /></ModuleGuard>} />
                <Route path="clients" element={<ModuleGuard moduleKey="clients"><ClientManagement /></ModuleGuard>} />
                <Route path="client-tracker" element={<ModuleGuard moduleKey="client_tracker"><ClientTracker /></ModuleGuard>} />
                <Route path="portfolio-reports" element={<ModuleGuard moduleKey="portfolio_reports"><PortfolioReports /></ModuleGuard>} />
                <Route path="report-requests" element={<ModuleGuard moduleKey="reports"><ReportRequests /></ModuleGuard>} />
                <Route path="deal-pipeline" element={<ModuleGuard moduleKey="deal_pipeline"><DealPipeline /></ModuleGuard>} />
                <Route path="reminders" element={<ModuleGuard moduleKey="reminders"><RemindersHub /></ModuleGuard>} />
                <Route path="checklists" element={<ModuleGuard moduleKey="checklists"><Checklists /></ModuleGuard>} />
                <Route path="agreements" element={<ModuleGuard moduleKey="agreements"><Agreements /></ModuleGuard>} />
                <Route path="game-plan" element={<ModuleGuard moduleKey="game_plans"><GamePlan /></ModuleGuard>} />
                <Route path="portal-config" element={<ModuleGuard moduleKey="portal_config"><PortalConfig /></ModuleGuard>} />
                <Route path="marketing-analytics" element={<ModuleGuard moduleKey="marketing_analytics"><MarketingAnalytics /></ModuleGuard>} />
                <Route path="conversations" element={<ModuleGuard moduleKey="conversations"><Conversations /></ModuleGuard>} />
                <Route path="messages" element={<ModuleGuard moduleKey="conversations"><Messages /></ModuleGuard>} />
                <Route path="lenders" element={<ModuleGuard moduleKey="lenders"><Lenders /></ModuleGuard>} />
                <Route path="commissions" element={<Commissions />} />
                <Route path="reports/analytics" element={<ReportsAnalytics />} />
                <Route path="model-hub" element={<ModuleGuard moduleKey="integrations" requireEdit><ModelHub /></ModuleGuard>} />
                <Route path="billing" element={<Billing />} />
                {/* Legacy deep links land on the consolidated page's Usage tab. */}
                <Route path="billing/usage" element={<Navigate to="/billing?tab=usage" replace />} />
                <Route path="admin/token-audit" element={<TokenAuditLog />} />
                <Route path="commercial" element={<CommercialProperties />} />
                <Route path="commercial/calculators" element={<PropertyCalculators />} />
                <Route path="commercial/:id" element={<CommercialPropertyDetail />} />
                <Route path="industrial" element={<CommercialProperties />} />
                <Route path="industrial/calculators" element={<PropertyCalculators />} />
                <Route path="calculators" element={<PropertyCalculators />} />
                <Route path="industrial/:id" element={<IndustrialPropertyDetail />} />
                        </Route>
                        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </SearchProvider>
                  </ComparisonProvider>
                </NotificationsProvider>
              </BrowserRouter>
            </PermissionsProvider>
          </BrandProvider>
        </AuthProvider>
      </TooltipProvider>
  </QueryClientProvider>
);

export default App;
