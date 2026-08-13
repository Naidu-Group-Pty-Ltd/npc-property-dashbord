import { Building, ChevronsUpDown, GitCompare, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface InvestmentReport {
  id: string;
  property_address: string;
}

interface CashFlowControlPanelProps {
  comparisonMode: boolean;
  /** Whether the workspace holds the Cash-Flow Comparisons capability.
   * When false the comparison toggle is removed entirely. Defaults true so
   * legacy callers keep today's behaviour. */
  comparisonsAvailable?: boolean;
  onComparisonModeChange: (enabled: boolean) => void;
  selectedComparisonReportIds: string[];
  availableReports: InvestmentReport[];
  onToggleComparisonReport: (reportId: string) => void;
  loadingReports: boolean;
  investorProfile: 'growth' | 'income' | 'balanced';
  onInvestorProfileChange: (profile: 'growth' | 'income' | 'balanced') => void;
  excludeLandTaxFromCashFlow: boolean;
  onExcludeLandTaxChange: (checked: boolean) => void;
  hasChanges: boolean;
}

export function CashFlowControlPanel({
  comparisonMode,
  comparisonsAvailable = true,
  onComparisonModeChange,
  selectedComparisonReportIds,
  availableReports,
  onToggleComparisonReport,
  loadingReports,
  investorProfile,
  onInvestorProfileChange,
  excludeLandTaxFromCashFlow,
  onExcludeLandTaxChange,
  hasChanges,
}: CashFlowControlPanelProps) {
  return (
    <Card className="overflow-hidden border-border/80 bg-gradient-to-br from-background via-muted/20 to-background shadow-sm">
      <CardContent className="space-y-4 p-4 md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-xl bg-primary/10 p-2 text-primary">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold md:text-base">Analysis Controls</p>
                <p className="text-xs text-muted-foreground">Compare reports and tune assumptions without changing projection logic.</p>
              </div>
              {hasChanges && (
                <Badge variant="outline" className="rounded-full border-warning/30 bg-warning/10 text-warning dark:bg-warning/30 dark:text-warning">
                  Unsaved assumptions
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
            {comparisonsAvailable && (
              <Button
                variant={comparisonMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => onComparisonModeChange(!comparisonMode)}
                className="min-h-9 gap-2 rounded-xl"
              >
                <GitCompare className="h-4 w-4" />
                {comparisonMode ? 'Exit Comparison' : 'Compare Reports'}
              </Button>
            )}

            <Select value={investorProfile} onValueChange={(value) => onInvestorProfileChange(value as 'growth' | 'income' | 'balanced')}>
              <SelectTrigger className="h-9 w-full rounded-xl sm:w-[190px]">
                <SelectValue placeholder="Investor profile" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">Balanced Investor</SelectItem>
                <SelectItem value="growth">Growth Investor</SelectItem>
                <SelectItem value="income">Income Investor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-stretch">
          <div className="space-y-3 rounded-2xl border bg-background/85 p-3 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add comparison property</p>
                <p className="text-xs text-muted-foreground">Select up to 4 comparison reports.</p>
              </div>
              {comparisonMode && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      size="sm"
                      className="min-h-9 w-full justify-between rounded-xl text-sm font-normal md:w-[320px]"
                      disabled={loadingReports || selectedComparisonReportIds.length >= 4}
                    >
                      {loadingReports ? 'Loading...' : `Add property (${selectedComparisonReportIds.length}/4)`}
                      <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[calc(100vw-2rem)] max-w-[380px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search properties..." />
                      <CommandList>
                        <CommandEmpty>No properties found.</CommandEmpty>
                        <CommandGroup>
                          {availableReports
                            .filter((report) => !selectedComparisonReportIds.includes(report.id))
                            .map((report) => (
                              <CommandItem
                                key={report.id}
                                value={report.property_address}
                                onSelect={() => onToggleComparisonReport(report.id)}
                                className="cursor-pointer"
                              >
                                <Building className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">
                                  {report.property_address.length > 50
                                    ? report.property_address.substring(0, 50) + '...'
                                    : report.property_address}
                                </span>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
            </div>

            {comparisonMode && selectedComparisonReportIds.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {selectedComparisonReportIds.map((id) => {
                  const report = availableReports.find((candidate) => candidate.id === id);
                  return report ? (
                    <Badge key={id} variant="secondary" className="flex items-center gap-1 rounded-full px-3 py-1 text-xs">
                      {report.property_address.split(',')[0].substring(0, 24)}
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-destructive"
                        onClick={() => onToggleComparisonReport(id)}
                      />
                    </Badge>
                  ) : null;
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {comparisonMode ? 'No comparison reports selected yet.' : 'Enable comparison mode to add peer reports.'}
              </p>
            )}
          </div>

          <label className="flex min-h-[112px] items-start gap-3 rounded-2xl border bg-background/85 p-4 shadow-sm">
            <Checkbox
              id="excludeLandTax"
              checked={excludeLandTaxFromCashFlow}
              onCheckedChange={(checked) => onExcludeLandTaxChange(checked === true)}
            />
            <span className="space-y-1">
              <span className="block text-sm font-semibold leading-none">Exclude Land Tax</span>
              <span className="block text-xs leading-5 text-muted-foreground">
                Removes land tax from cash-flow analysis and marks assumptions as changed when toggled.
              </span>
            </span>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
