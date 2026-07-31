import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TemplateUploader } from '@/components/templates/TemplateUploader';
import { TemplateList } from '@/components/templates/TemplateList';
import { BrandingManager } from '@/components/templates/BrandingManager';
import { GlobalReportSettings } from '@/components/templates/GlobalReportSettings';
import { QATemplateUploader } from '@/components/templates/QATemplateUploader';
import { QATemplateList } from '@/components/templates/QATemplateList';
import { CashFlowTemplateUploader } from '@/components/templates/CashFlowTemplateUploader';
import { CashFlowTemplateList } from '@/components/templates/CashFlowTemplateList';
import { ReportFormatGroup } from '@/components/templates/ReportFormatGroup';
import { CoverPageOverlayManager } from '@/components/templates/cover-editor/CoverPageOverlayManager';
import {
  FileText, Palette, Brain, BarChart3, TrendingUp, Building2, Settings, MessageSquare,
  Calculator, MapPin, Hash, Map, Layers, Edit, Trash2, CheckCircle2, Plus, Search,
} from 'lucide-react';
import {
  useReportTemplates,
  useReportTemplateMutations,
} from '@/hooks/useReportTemplates';
import { makeBlankTemplate } from '@/lib/reportTemplate/templateSchema';

type ReportFormat =
  | 'investment_compass' 
  | 'investment_executive' 
  | 'investment_snapshot'
  | 'suburb_compass'
  | 'suburb_executive'
  | 'suburb_snapshot'
  | 'postcode_compass'
  | 'postcode_executive'
  | 'postcode_snapshot'
  | 'statewide_compass'
  | 'statewide_executive'
  | 'statewide_snapshot'
  | 'comparison_specific'
  | 'comparison_cashflow'
  | 'individual_cashflow';

interface ReportFormatConfig {
  id: ReportFormat;
  label: string;
  description: string;
  category: 'investment' | 'suburb' | 'postcode' | 'statewide' | 'comparison' | 'cash_flow';
  tier?: 'compass' | 'executive' | 'snapshot';
  icon: React.ElementType;
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  investment: 'Investment Report',
  cashflow: 'Cash Flow',
  qa: 'Q&A Export',
  borrowing_capacity: 'Borrowing Capacity',
  portfolio: 'Portfolio Analysis',
  suburb: 'Suburb Analysis',
  postcode: 'Postcode Analysis',
  statewide: 'Statewide Analysis',
  comparison: 'Comparison Report',
  vownet: 'Formara / Client Form',
};

const REPORT_FORMATS: ReportFormatConfig[] = [
  { id: 'investment_compass', label: 'Investor Compass', description: 'Comprehensive investment analysis report', category: 'investment', tier: 'compass', icon: Building2 },
  { id: 'investment_executive', label: 'Executive Brief', description: 'Condensed executive summary report', category: 'investment', tier: 'executive', icon: FileText },
  { id: 'investment_snapshot', label: 'Snapshot', description: 'Quick property snapshot overview', category: 'investment', tier: 'snapshot', icon: FileText },
  { id: 'suburb_compass', label: 'Suburb Compass', description: 'Comprehensive suburb-wide investment analysis', category: 'suburb', tier: 'compass', icon: MapPin },
  { id: 'suburb_executive', label: 'Suburb Executive Brief', description: 'Condensed suburb market summary', category: 'suburb', tier: 'executive', icon: FileText },
  { id: 'suburb_snapshot', label: 'Suburb Snapshot', description: 'Quick suburb overview', category: 'suburb', tier: 'snapshot', icon: FileText },
  { id: 'postcode_compass', label: 'Postcode Compass', description: 'Comprehensive postcode zone analysis', category: 'postcode', tier: 'compass', icon: Hash },
  { id: 'postcode_executive', label: 'Postcode Executive Brief', description: 'Condensed postcode market summary', category: 'postcode', tier: 'executive', icon: FileText },
  { id: 'postcode_snapshot', label: 'Postcode Snapshot', description: 'Quick postcode overview', category: 'postcode', tier: 'snapshot', icon: FileText },
  { id: 'statewide_compass', label: 'Statewide Compass', description: 'Comprehensive state-level market analysis', category: 'statewide', tier: 'compass', icon: Map },
  { id: 'statewide_executive', label: 'Statewide Executive Brief', description: 'Condensed state market summary', category: 'statewide', tier: 'executive', icon: FileText },
  { id: 'statewide_snapshot', label: 'Statewide Snapshot', description: 'Quick state overview', category: 'statewide', tier: 'snapshot', icon: FileText },
  { id: 'comparison_specific', label: 'Specific Property Comparison', description: 'Side-by-side property comparison analysis', category: 'comparison', icon: BarChart3 },
  { id: 'comparison_cashflow', label: '10 Year Cash Flow Comparison', description: 'Multi-property cash flow projection comparison', category: 'comparison', icon: TrendingUp },
  { id: 'individual_cashflow', label: 'Individual 10 Year Cash Flow', description: 'Single property detailed cash flow analysis', category: 'cash_flow', icon: TrendingUp },
];

const FORMAT_GROUPS = [
  { key: 'investment', title: 'Investment Reports', description: 'Templates for individual property investment analysis reports', icon: Building2, columns: 3 as const },
  { key: 'suburb', title: 'Suburb Analysis', description: 'Templates for suburb-wide market and investment analysis reports', icon: MapPin, columns: 3 as const },
  { key: 'postcode', title: 'Postcode Analysis', description: 'Templates for postcode-zone market and investment analysis reports', icon: Hash, columns: 3 as const },
  { key: 'statewide', title: 'Statewide Analysis', description: 'Templates for state-level macro market and investment analysis reports', icon: Map, columns: 3 as const },
  { key: 'comparison', title: 'Comparison Analysis', description: 'Templates for comparing multiple properties side-by-side', icon: BarChart3, columns: 2 as const },
  { key: 'cash_flow', title: 'Individual Cash Flow Analysis', description: 'Templates for detailed single property cash flow projections', icon: TrendingUp, columns: 2 as const },
];

export default function Templates() {
  const navigate = useNavigate();
  const { canEdit: canEditTemplates } = useModulePermissions('templates');
  const [activeTab, setActiveTab] = useState('report-formats');
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat | null>(null);
  const [builderSearch, setBuilderSearch] = useState('');
  const [builderSort, setBuilderSort] = useState<'name_asc' | 'name_desc' | 'type' | 'tier' | 'version_desc' | 'updated_desc'>('updated_desc');

  const { data: reportTemplates = [], isLoading: reportTemplatesLoading } = useReportTemplates();
  const { create: createReportTemplate, remove: removeReportTemplate } = useReportTemplateMutations();

  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['report-structure-templates'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'report_structure_templates',
        listOptions: { orderBy: 'priority', orderAsc: false }
      });
      if (error) throw new Error(error.message);
      return data?.records || [];
    },
  });

  const { data: brandingProfiles, isLoading: brandingLoading } = useQuery({
    queryKey: ['client-branding-profiles'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'client_branding_profiles',
        listOptions: { orderBy: 'created_at', orderAsc: false }
      });
      if (error) throw new Error(error.message);
      return data?.records || [];
    },
  });

  const filterTemplatesByType = (type: string) => {
    return templates?.filter(t => t.template_type === type) || [];
  };

  const filterTemplatesByFormat = (format: ReportFormatConfig) => {
    return templates?.filter(t => {
      if (format.tier) {
        return t.report_category === format.category && t.report_tier === format.tier;
      }
      return t.report_category === format.category;
    }) || [];
  };

  const getTemplateCountByFormat = (format: { id: string }) => {
    const config = REPORT_FORMATS.find(f => f.id === format.id);
    if (!config) return 0;
    return filterTemplatesByFormat(config).length;
  };

  const selectedConfig = REPORT_FORMATS.find(f => f.id === selectedFormat);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Template Management</h1>
        <p className="text-muted-foreground">
          Manage report templates, PDF layouts, and client branding profiles
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="inline-flex w-auto min-w-full md:grid md:w-full md:grid-cols-8">
            <TabsTrigger value="report-formats" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Brain className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Formats
            </TabsTrigger>
            <TabsTrigger value="builder" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Layers className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Builder
            </TabsTrigger>
            <TabsTrigger value="cover-editor" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Layers className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Cover Page
            </TabsTrigger>
            <TabsTrigger value="pdf-layout" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <FileText className="h-3.5 w-3.5 md:h-4 md:w-4" />
              PDF
            </TabsTrigger>
            <TabsTrigger value="qa-export" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <MessageSquare className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Q&A
            </TabsTrigger>
            <TabsTrigger value="cashflow-export" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Calculator className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Cash Flow
            </TabsTrigger>
            <TabsTrigger value="branding" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Palette className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="global-settings" className="flex items-center gap-1.5 text-xs md:text-sm whitespace-nowrap">
              <Settings className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="report-formats" className="space-y-6">
          {FORMAT_GROUPS.map((group) => (
            <ReportFormatGroup
              key={group.key}
              title={group.title}
              description={group.description}
              icon={group.icon}
              formats={REPORT_FORMATS.filter(f => f.category === group.key)}
              selectedFormat={selectedFormat}
              onSelectFormat={(id) => setSelectedFormat(id as ReportFormat | null)}
              getCount={getTemplateCountByFormat}
              columns={group.columns}
            />
          ))}

          {/* Selected Format Details — upload & list scoped to this format */}
          {selectedConfig && (
            <Card>
              <CardHeader>
                <CardTitle>{selectedConfig.label} Templates</CardTitle>
                <CardDescription>
                  Upload and manage AI structure templates for this report format
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <TemplateUploader
                  templateType="ai_structure"
                  defaultCategory={selectedConfig.category}
                  defaultTier={selectedConfig.tier}
                />
                <TemplateList
                  templates={filterTemplatesByFormat(selectedConfig)}
                  isLoading={templatesLoading}
                  templateType="ai_structure"
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="builder" className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Visual PDF Template Builder</h2>
              <p className="text-muted-foreground text-sm max-w-2xl">
                Design PDF report layouts visually. Drag, drop, bind to live data, and preview the actual generated PDF in real time.
              </p>
            </div>
            <Button
              onClick={() => {
                createReportTemplate.mutate(
                  { name: 'Untitled template', schema: makeBlankTemplate() },
                  {
                    onSuccess: (record: any) => {
                      if (record?.id) navigate(`/admin/template-builder/${record.id}`);
                    },
                  }
                );
              }}
              disabled={createReportTemplate.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              New template
            </Button>
          </div>

          {/* Search & Sort */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, type, or tier..."
                value={builderSearch}
                onChange={(e) => setBuilderSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={builderSort} onValueChange={(v) => setBuilderSort(v as any)}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_desc">Recently updated</SelectItem>
                <SelectItem value="name_asc">Name (A-Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z-A)</SelectItem>
                <SelectItem value="type">Report type</SelectItem>
                <SelectItem value="tier">Tier</SelectItem>
                <SelectItem value="version_desc">Version (newest)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(() => {
            const query = builderSearch.trim().toLowerCase();
            const filtered = reportTemplates.filter((tpl) => {
              if (!query) return true;
              const nameMatch = tpl.name.toLowerCase().includes(query);
              const typeMatch = tpl.report_type?.toLowerCase().includes(query);
              const tierMatch = tpl.tier?.toLowerCase().includes(query);
              const descMatch = tpl.description?.toLowerCase().includes(query);
              return nameMatch || typeMatch || tierMatch || descMatch;
            });

            const sorted = [...filtered].sort((a, b) => {
              switch (builderSort) {
                case 'name_asc':
                  return a.name.localeCompare(b.name);
                case 'name_desc':
                  return b.name.localeCompare(a.name);
                case 'type': {
                  const ta = a.report_type || '';
                  const tb = b.report_type || '';
                  return ta.localeCompare(tb) || a.name.localeCompare(b.name);
                }
                case 'tier': {
                  const tOrder: Record<string, number> = { compass: 0, executive: 1, snapshot: 2 };
                  const ta = tOrder[a.tier || ''] ?? 99;
                  const tb = tOrder[b.tier || ''] ?? 99;
                  return ta - tb || a.name.localeCompare(b.name);
                }
                case 'version_desc':
                  return (b.version || 0) - (a.version || 0);
                case 'updated_desc':
                default:
                  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
              }
            });

            if (reportTemplatesLoading) {
              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-44" />
                  ))}
                </div>
              );
            }

            if (reportTemplates.length === 0) {
              return (
                <Card>
                  <CardContent className="py-16 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <CardTitle className="text-lg">No builder templates yet</CardTitle>
                    <CardDescription className="mt-2 max-w-md mx-auto">
                      Create your first template to start designing report layouts visually.
                    </CardDescription>
                    <Button
                      className="mt-6"
                      disabled={createReportTemplate.isPending}
                      onClick={() => {
                        createReportTemplate.mutate(
                          { name: 'Untitled template', schema: makeBlankTemplate() },
                          {
                            onSuccess: (record: any) => {
                              if (record?.id) navigate(`/admin/template-builder/${record.id}`);
                            },
                          }
                        );
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Create first template
                    </Button>
                  </CardContent>
                </Card>
              );
            }

            if (sorted.length === 0) {
              return (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No templates match your search.</p>
                  <Button variant="link" size="sm" onClick={() => setBuilderSearch('')}>
                    Clear search
                  </Button>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {sorted.length} template{sorted.length === 1 ? '' : 's'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sorted.map((tpl) => {
                    const pageCount = tpl.schema?.pages?.length ?? 0;
                    return (
                      <Card key={tpl.id} className="hover:border-primary/40 transition-colors">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <CardTitle className="text-base truncate">{tpl.name}</CardTitle>
                              <CardDescription className="mt-1 line-clamp-2 text-xs">
                                {tpl.description || 'No description'}
                              </CardDescription>
                            </div>
                            {tpl.is_active && (
                              <Badge variant="default" className="text-xs">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                              </Badge>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div className="flex flex-wrap gap-1.5 text-xs">
                            {tpl.report_type && (
                              <Badge variant="secondary">
                                {REPORT_TYPE_LABELS[tpl.report_type] || tpl.report_type}
                              </Badge>
                            )}
                            {tpl.tier && <Badge variant="outline">{tpl.tier}</Badge>}
                            <Badge variant="outline">v{tpl.version}</Badge>
                            {tpl.schema && (
                              <Badge variant="outline">
                                {pageCount} page{pageCount === 1 ? '' : 's'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex gap-2 pt-2">
                            <Button
                              size="sm"
                              variant="default"
                              className="flex-1"
                              onClick={() => navigate(`/admin/template-builder/${tpl.id}`)}
                            >
                              <Edit className="h-3.5 w-3.5 mr-1" /> Open in Builder
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 rounded-full text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/40"
                                  title={`Delete template ${tpl.name}`}
                                  aria-label={`Delete template ${tpl.name}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="border-destructive/25 bg-background text-foreground shadow-2xl shadow-destructive/10 sm:max-w-md">
                                <AlertDialogHeader className="space-y-3">
                                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:mx-0">
                                    <Trash2 className="h-5 w-5" />
                                  </div>
                                  <AlertDialogTitle className="text-destructive">Delete template?</AlertDialogTitle>
                                  <AlertDialogDescription className="space-y-2 text-left text-muted-foreground">
                                    <span className="block">
                                      This will permanently delete <span className="font-medium text-foreground">{tpl.name}</span>.
                                    </span>
                                    <span className="block">This cannot be undone.</span>
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="gap-2 sm:gap-0">
                                  <AlertDialogCancel className="border-border bg-background text-foreground hover:bg-muted">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40"
                                    onClick={() => removeReportTemplate.mutate(tpl.id)}
                                  >
                                    Delete template
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="cover-editor" className="space-y-4">
          <CoverPageOverlayManager />
        </TabsContent>

        <TabsContent value="pdf-layout" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>PDF Layout Templates</CardTitle>
              <CardDescription>
                HTML/CSS templates that control the visual layout and styling of generated PDF reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <TemplateUploader templateType="pdf_layout" />
              <TemplateList templates={filterTemplatesByType('pdf_layout')} isLoading={templatesLoading} templateType="pdf_layout" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qa-export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Q&A Export Templates
              </CardTitle>
              <CardDescription>
                Upload PDF templates to customize how Aurixa Intelligence Hub conversations are exported.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <QATemplateUploader />
              <QATemplateList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cashflow-export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-primary" />
                Cash Flow Export Templates
              </CardTitle>
              <CardDescription>
                Upload PDF templates to customize how 10-Year Cash Flow analyses are exported.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <CashFlowTemplateUploader />
              <CashFlowTemplateList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Client Branding Profiles</CardTitle>
              <CardDescription>
                Customize report branding with client-specific logos, colors, and styling.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BrandingManager profiles={brandingProfiles || []} isLoading={brandingLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="global-settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Global Report Settings</CardTitle>
              <CardDescription>
                Configure contact details and professional disclaimer that will be applied across all generated reports.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GlobalReportSettings />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
