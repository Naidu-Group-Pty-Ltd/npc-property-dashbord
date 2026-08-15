import { AlertTriangle, BarChart3, Building2, CalendarDays, Calculator, Filter, Home, MapPin, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BuildType, BuildTypeFilter, InvestmentReport } from './types';
import { getBuildTypeLabel } from './utils';

interface CashFlowPageHeroProps {
  reports: InvestmentReport[];
  filteredReports: InvestmentReport[];
  dateRangeLabel: string;
  buildTypeFilter: BuildTypeFilter;
  getBuildType: (report: InvestmentReport) => BuildType;
}

export function CashFlowPageHero({ reports, filteredReports, dateRangeLabel, buildTypeFilter, getBuildType }: CashFlowPageHeroProps) {
  const buildTypeCounts = reports.reduce<Record<BuildType, number>>((counts, report) => {
    const buildType = getBuildType(report);
    counts[buildType] += 1;
    return counts;
  }, {
    new_build: 0,
    existing_property: 0,
    land_only: 0,
  });

  const representedBuildTypes = (Object.entries(buildTypeCounts) as Array<[BuildType, number]>).filter(([, count]) => count > 0);
  const weakRentCount = reports.filter((report) => {
    const fc = report.financial_calculations || {};
    const mo = report.manual_overrides || {};
    const weeklyRent = mo.weeklyRent || fc.weeklyRent || 0;
    return !weeklyRent || weeklyRent <= 0;
  }).length;

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-background text-foreground dark:text-white shadow-xl">
      <CardContent className="relative p-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.24),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_42%)]" />
        <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-brand-300 via-primary to-transparent" />

        <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:p-8">
          <div className="flex flex-col justify-between gap-6">
            <div className="space-y-4">
              <Badge className="w-fit border-brand-300/30 bg-brand-300/10 text-brand-100 hover:bg-brand-300/10">
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
                Cash Flow Intelligence Workspace
              </Badge>

              <div className="space-y-3">
                <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight md:text-4xl">
                  <span className="rounded-2xl border border-border dark:border-white/15 bg-card/10 dark:bg-white/10 p-2 shadow-inner">
                    <Calculator className="h-7 w-7 text-brand-200 md:h-8 md:w-8" />
                  </span>
                  10-Year Cash Flow Analysis
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-foreground dark:text-foreground md:text-base">
                  Model long-term property performance, yearly assumptions, rental growth, expenses, land tax, debt, equity, and after-tax cash flow from generated investment reports.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground dark:text-foreground">
              {representedBuildTypes.length > 0 ? representedBuildTypes.map(([buildType, count]) => (
                <span key={buildType} className="inline-flex items-center gap-1 rounded-full border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 px-3 py-1">
                  {getBuildTypeIcon(buildType)}
                  {getBuildTypeLabel(buildType)}: {count}
                </span>
              )) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 px-3 py-1">
                  <Building2 className="h-3.5 w-3.5" />
                  No build types represented yet
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroMetric icon={BarChart3} label="Cash-flow-ready reports" value={reports.length.toLocaleString()} />
            <HeroMetric icon={Filter} label="Visible reports" value={filteredReports.length.toLocaleString()} />
            <HeroMetric icon={CalendarDays} label="Date range" value={dateRangeLabel} />
            <HeroMetric icon={Building2} label="Build types represented" value={representedBuildTypes.length.toLocaleString()} detail={getFilterDetail(buildTypeFilter)} />
            {weakRentCount > 0 && (
              <HeroMetric
                icon={AlertTriangle}
                label="Missing/zero rent"
                value={weakRentCount.toLocaleString()}
                detail="Loaded reports needing rent review"
                warning
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HeroMetric({ icon: Icon, label, value, detail, warning = false }: { icon: typeof Calculator; label: string; value: string; detail?: string; warning?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 backdrop-blur ${warning ? 'border-warning/30 bg-warning/10' : 'border-border dark:border-white/10 bg-card/8 dark:bg-white/8'}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground dark:text-foreground">{label}</span>
        <span className={`rounded-lg p-2 ${warning ? 'bg-warning/15 text-warning' : 'bg-card/10 dark:bg-white/10 text-brand-100'}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`text-2xl font-bold capitalize tabular-nums ${warning ? 'text-warning' : 'text-foreground dark:text-white'}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground dark:text-foreground">{detail}</p>}
    </div>
  );
}

function getBuildTypeIcon(buildType: BuildType) {
  if (buildType === 'new_build') return <Building2 className="h-3.5 w-3.5" />;
  if (buildType === 'land_only') return <MapPin className="h-3.5 w-3.5" />;
  return <Home className="h-3.5 w-3.5" />;
}

function getFilterDetail(buildTypeFilter: BuildTypeFilter) {
  if (buildTypeFilter === 'all') return 'All build types selected';
  return `${getBuildTypeLabel(buildTypeFilter)} filter active`;
}
