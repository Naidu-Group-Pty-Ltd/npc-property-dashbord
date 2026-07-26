import { ChevronRight, MapPin, TrendingUp, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface ReportLibraryTabsProps {
  isMobile: boolean;
  investmentCount: number | null;
  comparisonCount: number;
}

const workspaceTabs: Array<{
  value: 'investment' | 'comparisons';
  label: string;
  mobileLabel: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: 'investment',
    label: 'Investment',
    mobileLabel: 'Invest',
    description: 'Property, suburb, postcode, and state intelligence',
    icon: TrendingUp,
  },
  {
    value: 'comparisons',
    label: 'Comparisons',
    mobileLabel: 'Compare',
    description: 'Multi-property decision analysis',
    icon: MapPin,
  },
];

export function ReportLibraryTabs({ isMobile, investmentCount, comparisonCount }: ReportLibraryTabsProps) {
  const counts = {
    investment: investmentCount,
    comparisons: comparisonCount,
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 pt-1 md:mx-0 md:overflow-visible md:px-0">
      <DashboardThemeFrame
        variant="toolbar"
        className="min-w-max rounded-[1.6rem] border-white/10 bg-[radial-gradient(circle_at_18%_0%,rgba(168,85,247,0.16),transparent_34%),linear-gradient(135deg,rgba(0,0,0,0.52),rgba(15,23,42,0.74))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_18px_52px_rgba(0,0,0,0.28)] md:min-w-0 md:p-4"
      >
        <TabsList className={isMobile ? 'inline-flex h-auto w-auto min-w-full gap-3 bg-transparent p-0' : 'grid h-auto w-full grid-cols-2 gap-4 bg-transparent p-0 lg:gap-5'}>
          {workspaceTabs.map(({ value, label, mobileLabel, description, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="group relative h-auto min-h-[96px] min-w-[18rem] overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.025] px-5 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_10px_30px_rgba(0,0,0,0.18)] transition-all duration-200 hover:-translate-y-0.5 hover:border-purple-400/30 hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-purple-300/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:border-purple-400/60 data-[state=active]:bg-[radial-gradient(circle_at_78%_12%,rgba(190,0,255,0.24),transparent_36%),linear-gradient(135deg,rgba(88,28,135,0.28),rgba(15,23,42,0.72))] data-[state=active]:text-foreground data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_30px_rgba(168,85,247,0.24),0_18px_40px_rgba(0,0,0,0.28)] data-[state=active]:ring-1 data-[state=active]:ring-purple-300/25 md:min-w-0 lg:min-h-[104px]"
            >
              <span className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 transition-opacity duration-200 group-data-[state=active]:opacity-100" />
              <span className="flex w-full items-start justify-between gap-4">
                <span className="flex min-w-0 items-start gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.035] text-muted-foreground shadow-inner transition-all duration-200 group-hover:border-purple-300/25 group-hover:bg-purple-500/10 group-hover:text-purple-200 group-data-[state=active]:border-purple-300/45 group-data-[state=active]:bg-purple-500/18 group-data-[state=active]:text-purple-100 group-data-[state=active]:shadow-[0_0_18px_rgba(168,85,247,0.22)]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 space-y-2 pt-0.5">
                    <span className="block text-[15px] font-bold leading-none tracking-tight text-foreground md:text-base">
                      <span className="hidden sm:inline">{label}</span>
                      <span className="sm:hidden">{mobileLabel}</span>
                    </span>
                    <span className="block max-w-[14rem] text-[12.5px] font-normal leading-5 text-muted-foreground transition-colors group-data-[state=active]:text-foreground/75 sm:max-w-none">
                      {description}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-3">
                  <Badge variant="secondary" className="flex h-7 min-w-7 items-center justify-center rounded-full border border-white/10 bg-black/25 px-2 text-xs font-bold text-foreground shadow-inner transition-colors group-data-[state=active]:border-purple-300/40 group-data-[state=active]:bg-purple-300/15 group-data-[state=active]:text-purple-50">
                    {counts[value] ?? '—'}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/55 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-purple-200/80 group-data-[state=active]:text-purple-100" aria-hidden="true" />
                </span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </DashboardThemeFrame>
    </div>
  );
}
