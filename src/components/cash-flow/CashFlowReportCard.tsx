import { format } from 'date-fns';
import { ArrowRight, Building, Calculator, CheckCircle2, FileText, Home, MapPin, ReceiptText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { BuildType, InvestmentGrade, InvestmentReport } from './types';

interface CashFlowReportCardProps {
  report: InvestmentReport;
  buildType: BuildType;
  gradeInfo: InvestmentGrade | null;
  isOpening: boolean;
  onViewReport: (report: InvestmentReport) => void;
  onOpenCashFlow: (report: InvestmentReport) => void;
}

export function CashFlowReportCard({ report, buildType, gradeInfo, isOpening, onViewReport, onOpenCashFlow }: CashFlowReportCardProps) {
  const fc = report.financial_calculations || {};
  const mo = report.manual_overrides || {};
  const purchasePrice = mo.purchasePrice || fc.purchasePrice || fc.propertyValue || 0;
  const weeklyRent = mo.weeklyRent || fc.weeklyRent || 0;
  const isNewBuild = buildType === 'new_build';
  const isLandOnly = buildType === 'land_only';

  return (
    <Card className="group flex h-full flex-col overflow-hidden border-border/80 bg-gradient-to-b from-background to-muted/20 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
      <CardHeader className="space-y-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant={isNewBuild ? "default" : isLandOnly ? "outline" : "secondary"}
              className="text-xs"
            >
              {isNewBuild ? (
                <><Building className="h-3 w-3 mr-1" />New Build</>
              ) : isLandOnly ? (
                <><MapPin className="h-3 w-3 mr-1" />Land Only</>
              ) : (
                <><Home className="h-3 w-3 mr-1" />Existing</>
              )}
            </Badge>
            {gradeInfo && (
              <Badge className={`${gradeInfo.color} text-foreground dark:text-white`}>
                {gradeInfo.grade}
              </Badge>
            )}
          </div>
          <div className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {format(new Date(report.created_at), 'dd MMM yyyy')}
          </div>
        </div>

        <div className="space-y-3">
          <CardTitle className="line-clamp-2 text-lg leading-snug">
            {report.property_address}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-success/30 bg-success/10 text-success hover:bg-success/10">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Ready for cash-flow analysis
            </Badge>
            {weeklyRent <= 0 && (
              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning hover:bg-warning/10">
                Rent review needed
              </Badge>
            )}

          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <MetricTile label="Purchase Price" value={`$${purchasePrice.toLocaleString()}`} />
          <MetricTile label="Weekly Rent" value={`$${weeklyRent.toLocaleString()}`} warning={weeklyRent <= 0} />
        </div>

        <div className="rounded-xl border bg-background/80 p-3 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <ReceiptText className="h-3.5 w-3.5 text-primary" />
            Analysis inputs
          </div>
          Uses configured manual overrides first, then report financial calculations where available.
        </div>
      </CardContent>

      <CardFooter className="flex flex-col-reverse gap-2 border-t bg-muted/20 p-4 sm:flex-row">
        <Button
          variant="outline"
          size="sm"
          className="w-full sm:flex-1"
          onClick={() => onViewReport(report)}
        >
          <FileText className="h-4 w-4 mr-1" />
          View Report
        </Button>
        <Button
          size="sm"
          className="w-full sm:flex-1"
          onClick={() => onOpenCashFlow(report)}
          disabled={isOpening}
        >
          <Calculator className="h-4 w-4 mr-1" />
          {isOpening ? 'Loading...' : 'Open Cash Flow'}
          {!isOpening && <ArrowRight className="h-3 w-3 ml-1" />}
        </Button>
      </CardFooter>
    </Card>
  );
}

function MetricTile({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warning ? 'border-brand-200 bg-brand-50/70' : 'bg-background'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-semibold ${warning ? 'text-brand-700' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}
