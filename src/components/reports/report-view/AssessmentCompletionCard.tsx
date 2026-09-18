/**
 * The five-dimension completion reading, drawn from the run's own record.
 *
 * `investment_score.completion` is written by the scoring run
 * (`assessmentCompletion.pure.ts` via `scoreForProduction`), so this card
 * DRAWS a decision rather than re-deriving one — the surface can never
 * disagree with the stamp. Three rules from the S5/S6 instruction:
 *
 *   * **"Assessment incomplete" is not "insufficient evidence."** The state
 *     chip and the statement are the run's own; an incomplete assessment
 *     names the dimensions still owed and who closes each, and never reads
 *     as a broken product.
 *   * **A dimension shows its score or its reason, never a substitute.**
 *     Scored rows print the valid 0–100 value; unscored rows print the
 *     recorded reason and the recovery act with its actor.
 *   * **Historical rows are preserved.** A report whose run wrote no
 *     completion block (everything before the gate) renders exactly as it
 *     always did — this card simply does not mount.
 */
import { CheckCircle2, CircleDashed, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface RecoveryAction {
  actor?: string;
  action?: string;
  retryable?: boolean;
}

interface DimensionStatus {
  dimension?: string;
  label?: string;
  scored?: boolean;
  score?: number | null;
  reason?: string | null;
  recovery?: RecoveryAction | null;
}

interface CompletionBlock {
  state?: string;
  mayIssueCompletedGrade?: boolean;
  dimensions?: DimensionStatus[];
  scoredCount?: number;
  totalCount?: number;
  evidenceCoverage?: number | null;
  attemptsRemaining?: number;
  statement?: string;
}

const STATE_LABELS: Record<string, string> = {
  acquisition: 'Acquiring evidence',
  processing: 'Processing',
  evidence_required: 'Evidence required',
  completed: 'Assessment complete',
  historical: 'Historical assessment',
};

const ACTOR_LABELS: Record<string, string> = {
  operator: 'Operator',
  administrator: 'Administrator',
  automatic: 'Automatic',
};

interface Props {
  investmentScore: unknown;
}

export function AssessmentCompletionCard({ investmentScore }: Props) {
  const completion = (investmentScore as { completion?: CompletionBlock } | null | undefined)?.completion;
  // A run that wrote no completion block predates the gate; its record
  // stands as issued and this card says nothing about it.
  if (!completion || !Array.isArray(completion.dimensions) || completion.dimensions.length === 0) {
    return null;
  }

  const scored = completion.scoredCount ?? completion.dimensions.filter((d) => d.scored).length;
  const total = completion.totalCount ?? completion.dimensions.length;
  const stateLabel = STATE_LABELS[completion.state ?? ''] ?? null;

  return (
    <Card className="overflow-hidden border-border/80 bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-border bg-muted/40 p-2 text-muted-foreground shadow-sm">
            <ListChecks className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base text-foreground">Assessment Completion</CardTitle>
              <Badge variant="outline" className="bg-background/70 text-xs">
                {scored} of {total} dimensions
              </Badge>
              {stateLabel && (
                <Badge variant="secondary" className="text-xs">{stateLabel}</Badge>
              )}
            </div>
            {completion.statement && (
              <p className="mt-1 text-sm text-muted-foreground">{completion.statement}</p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 border-t bg-muted/10 p-4 sm:p-5">
        <ul className="space-y-2">
          {completion.dimensions.map((d) => (
            <li key={d.dimension ?? d.label} className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                  {d.scored
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    : <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{d.label ?? d.dimension}</span>
                </span>
                {d.scored && typeof d.score === 'number' && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {Math.round(d.score)}<span className="text-xs font-normal text-muted-foreground">/100</span>
                  </span>
                )}
              </div>
              {!d.scored && d.reason && (
                <p className="mt-1 text-xs text-muted-foreground">{d.reason}</p>
              )}
              {!d.scored && d.recovery?.action && (
                <p className="mt-1 text-xs text-foreground">
                  <span className="font-medium">
                    {ACTOR_LABELS[d.recovery.actor ?? ''] ?? 'Next step'}:
                  </span>{' '}
                  {d.recovery.action}
                </p>
              )}
            </li>
          ))}
        </ul>
        {typeof completion.evidenceCoverage === 'number' && (
          <p className="text-xs text-muted-foreground">
            Evidence coverage {Math.round(completion.evidenceCoverage * 100)}% — a different
            measure from dimension completion, retained from the run.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
