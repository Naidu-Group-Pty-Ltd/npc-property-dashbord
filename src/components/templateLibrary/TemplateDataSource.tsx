/**
 * Choose what data fills the preview: the sample engagement, or one of your
 * own past reports.
 *
 * ## Why real data is offered at all
 *
 * Sample data proves the *design*. It cannot tell an adviser how the template
 * handles their own numbers — a suburb name that runs two lines, a portfolio
 * with three holdings rather than five, a report where the market section was
 * never filled in. Rendering a real historical report answers that, and it is
 * the difference between "this looks nice" and "this works for my files".
 *
 * ## Why sample data stays the default
 *
 * A real report populates only the namespaces its adapter emits — `property.*`,
 * `financials.*`, `scores.*`, `demographics.*`, `economic.*`, `location.*` and
 * `sections.*`. The catalogue's templates also bind `market.*`, `client.*`,
 * `risks.*` and others that no adapter produces today, so a real-data preview
 * is legitimately patchy. Opening on it would make every template look broken.
 * So: sample by default, real on request, and the gap reported rather than
 * hidden.
 *
 * Nothing here widens access. Reports load through `investmentReportAdapter`,
 * which goes via the `get-investment-reports` edge function and therefore
 * through the same `reports` module permission check as everywhere else. A user
 * without `reports:view` simply sees no reports to choose from.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useSecureInvestmentReports } from '@/hooks/useSecureInvestmentReports';
import { buildTemplateBindingContext } from '@/lib/reportTemplate/buildBindingContext';
import { supportsProduction } from '@/lib/reportTemplate/adapters';
import { SAMPLE_REPORT_DATA } from '@/lib/templateLibrary/sampleReportData';

export const SAMPLE_SOURCE = 'sample';

interface ReportOption { id: string; label: string }

interface Props {
  /** The template's report type, which decides whether an adapter exists. */
  reportType: string | null;
  /** Bindings the template references, used to report real-data coverage. */
  requiredBindings: string[];
  /** Receives the data the preview should render with. */
  onData: (data: Record<string, unknown>, sourceLabel: string) => void;
}

function coverage(data: Record<string, unknown>, bindings: string[]): number {
  if (bindings.length === 0) return 1;
  const read = (path: string) => path.split('.').reduce<unknown>(
    (acc, k) => (acc == null ? acc : (acc as Record<string, unknown>)[k]), data,
  );
  const filled = bindings.filter((b) => {
    const v = read(b);
    return v !== undefined && v !== null && v !== '';
  }).length;
  return filled / bindings.length;
}

export function TemplateDataSource({ reportType, requiredBindings, onData }: Props) {
  const { listReports } = useSecureInvestmentReports();
  const [source, setSource] = useState<string>(SAMPLE_SOURCE);
  const [reports, setReports] = useState<ReportOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [realCoverage, setRealCoverage] = useState<number | null>(null);

  const adapterExists = supportsProduction(reportType);

  // Load the picker's options once, and only for templates that could use them.
  useEffect(() => {
    if (!adapterExists || reports !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listReports({ limit: 20, orderBy: 'created_at', orderAsc: false });
        if (cancelled) return;
        setReports(
          (rows ?? []).map((r) => ({
            id: r.id,
            label: r.property_address || `Report ${r.id.slice(0, 8)}`,
          })),
        );
      } catch {
        if (!cancelled) setReports([]);
      }
    })();
    return () => { cancelled = true; };
  }, [adapterExists, reports, listReports]);

  const choose = useCallback(async (next: string) => {
    setSource(next);
    setProblem(null);
    setRealCoverage(null);

    if (next === SAMPLE_SOURCE) {
      onData(SAMPLE_REPORT_DATA, 'sample data');
      return;
    }

    setLoading(true);
    try {
      const ctx = await buildTemplateBindingContext(next);
      if (!ctx?.data) {
        // Say which of the two it is: no permission, or nothing stored.
        setProblem('That report could not be loaded, or holds no data this template can use.');
        setSource(SAMPLE_SOURCE);
        onData(SAMPLE_REPORT_DATA, 'sample data');
        return;
      }
      const label = reports?.find((r) => r.id === next)?.label ?? 'your report';
      setRealCoverage(coverage(ctx.data as Record<string, unknown>, requiredBindings));
      onData(ctx.data as Record<string, unknown>, label);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That report could not be loaded.');
      setSource(SAMPLE_SOURCE);
      onData(SAMPLE_REPORT_DATA, 'sample data');
    } finally {
      setLoading(false);
    }
  }, [onData, reports, requiredBindings]);

  if (!adapterExists) return null;

  const missingPct = realCoverage === null ? null : Math.round((1 - realCoverage) * 100);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select value={source} onValueChange={choose} disabled={loading}>
        <SelectTrigger className="h-8 w-[13.5rem] text-xs" aria-label="Data used in this preview">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SAMPLE_SOURCE}>Sample data</SelectItem>
          {(reports ?? []).map((r) => (
            <SelectItem key={r.id} value={r.id} className="max-w-[22rem]">
              <span className="truncate">{r.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}

      {problem && (
        <span className="flex items-center gap-1 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          {problem}
        </span>
      )}

      {/* The honest bit: a real report rarely fills a whole template, and the
          reader should know that the gaps are missing data, not a broken
          template. */}
      {missingPct !== null && missingPct > 0 && (
        <span className="text-[11px] text-muted-foreground">
          {missingPct}% of this template&apos;s fields are empty in that report
          <Button
            variant="link"
            size="sm"
            className="h-auto px-1.5 py-0 text-[11px]"
            onClick={() => choose(SAMPLE_SOURCE)}
          >
            Back to sample
          </Button>
        </span>
      )}
    </div>
  );
}
