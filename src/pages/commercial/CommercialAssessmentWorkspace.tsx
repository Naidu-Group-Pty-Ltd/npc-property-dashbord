/**
 * Commercial & Industrial assessment workspace.
 *
 * A full-page, autosaving, step-by-step workspace — the replacement for the
 * narrow scrolling modal the feature used to create properties through. Steps
 * are directly navigable rather than strictly sequential, because a user
 * revisiting an assessment usually knows which section they came back for.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle, ArrowLeft, ArrowRight, Building2, Check, CloudOff,
  Factory, Loader2, Save, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { usePermissions } from '@/hooks/usePermissions';
import { ciAssessmentApi, useCiAssessment } from '@/hooks/useCiAssessments';
import { runAssessment, type AssessmentResult } from '@/lib/ciAssessment/engine';
import { validateAssessment } from '@/lib/ciAssessment/validation';
import { ASSESSMENT_STATUS_LABELS, assessmentTypeDefinition, type AssessmentPayload } from '@/lib/ciAssessment/types';
import { StepAssessmentType } from '@/components/commercial/assessment/StepAssessmentType';
import { IntakePackPanel } from '@/components/commercial/assessment/IntakePackPanel';
import type { ParsedPack } from '@/lib/ciAssessment/intakePack';
import { StepPropertyTransaction } from '@/components/commercial/assessment/StepPropertyTransaction';
import { StepOwnership } from '@/components/commercial/assessment/StepOwnership';
import { StepIncome } from '@/components/commercial/assessment/StepIncome';
import { StepPortfolio } from '@/components/commercial/assessment/StepPortfolio';
import { StepLeaseIncome } from '@/components/commercial/assessment/StepLeaseIncome';
import { StepLoanStructure } from '@/components/commercial/assessment/StepLoanStructure';
import { StepResults } from '@/components/commercial/assessment/StepResults';
import { StepClientLink } from '@/components/commercial/assessment/StepClientLink';
import { ResultsRail } from '@/components/commercial/assessment/ResultsRail';

const STEPS = [
  { key: 'type', label: 'Type', section: 'assessmentType' },
  // The intake pack sits early on purpose: the usual flow is create the
  // assessment, download the pack, meet the client, come back and upload it.
  { key: 'pack', label: 'Intake pack', section: 'intakePack' },
  { key: 'property', label: 'Property & transaction', section: 'property' },
  { key: 'ownership', label: 'Ownership', section: 'ownership' },
  { key: 'income', label: 'Income', section: 'income' },
  { key: 'portfolio', label: 'Portfolio', section: 'portfolio' },
  { key: 'lease', label: 'Lease income', section: 'lease' },
  { key: 'loan', label: 'Loan structure', section: 'loan' },
  { key: 'results', label: 'Results', section: 'results' },
  { key: 'link', label: 'Save & link', section: 'link' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

function SaveIndicator({ state, savedAt }: { state: string; savedAt: string | null }) {
  if (state === 'saving') {
    return (
      <span className="ci-save-indicator" role="status">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Saving…
      </span>
    );
  }
  if (state === 'error' || state === 'conflict') {
    return (
      <span className="ci-save-indicator ci-save-indicator-error" role="status">
        <CloudOff className="h-3 w-3" aria-hidden="true" />
        {state === 'conflict' ? 'Changed elsewhere — reload' : 'Save failed'}
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="ci-save-indicator" role="status">
        <Save className="h-3 w-3" aria-hidden="true" /> Unsaved changes
      </span>
    );
  }
  if (state === 'saved' || savedAt) {
    return (
      <span className="ci-save-indicator ci-save-indicator-saved" role="status">
        <Check className="h-3 w-3" aria-hidden="true" /> Saved
      </span>
    );
  }
  return null;
}

export default function CommercialAssessmentWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isSuperadmin } = usePermissions();
  const { canEdit } = useModulePermissions('clients');

  const {
    record, payload, loading, error, saveState, lastSavedAt,
    update, saveNow, saveTitle, reload,
  } = useCiAssessment(id ?? null);


  const [calculating, setCalculating] = useState(false);
  const [savedResult, setSavedResult] = useState<AssessmentResult | null>(null);

  const stepParam = searchParams.get('step') as StepKey | null;
  const activeStep: StepKey = STEPS.some((step) => step.key === stepParam) ? stepParam! : 'type';
  const activeIndex = STEPS.findIndex((step) => step.key === activeStep);

  const goToStep = useCallback((key: StepKey) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('step', key);
      return next;
    }, { replace: true });
    // Focus lands at the top of the new step rather than wherever the click was.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  /**
   * Permissions. Overriding policy assumptions is deliberately narrower than
   * editing an assessment — modelling a deal and moving a DSCR hurdle are not
   * the same authority. Server-side checks in the edge function are the real
   * enforcement; these flags only shape what is offered.
   */
  const canOverridePolicy = isSuperadmin || canEdit;
  const canLinkClient = isSuperadmin || canEdit;
  const canUpdateClient = isSuperadmin || canEdit;

  // Live result, recomputed from the working payload on every change. Cheap
  // enough to run inline — the engine is pure arithmetic with no I/O.
  const liveResult = useMemo(
    () => (payload ? runAssessment(payload) : null),
    [payload],
  );

  const validation = useMemo(
    () => (payload ? validateAssessment(payload) : null),
    [payload],
  );

  const issues = useMemo(
    () => (validation ? [...validation.errors, ...validation.warnings] : []),
    [validation],
  );

  useEffect(() => {
    if (error && saveState !== 'conflict') {
      toast({ title: 'Assessment error', description: error, variant: 'destructive' });
    }
  }, [error, saveState]);

  const readOnly = record ? !['draft', 'data_entry', 'ready_to_calculate', 'calculated', 'requires_review'].includes(record.status) : false;

  const setPayload = useCallback((next: AssessmentPayload) => {
    update(next, STEPS[activeIndex]?.section);
  }, [update, activeIndex]);

  const setTitle = useCallback(async (title: string) => {
    // No refetch here: reloading the assessment dropped the workspace into its
    // loading state and destroyed the input mid-typing.
    await saveTitle(title);
  }, [saveTitle]);


  /**
   * Merge a returned intake pack into the working assessment.
   *
   * Scalar sections merge field-by-field so a value the pack did not carry
   * cannot blank out something already entered here. Collections replace
   * wholesale — a half-merged list of entities or liabilities, matched on
   * nothing more reliable than array position, would be worse than either
   * keeping or replacing the set outright.
   */
  const applyIntakePack = useCallback((parsed: ParsedPack) => {
    if (!payload) return;
    const incoming = parsed.payload;

    // A blank, zero or absent value in the pack means "not answered", not
    // "set this to nothing" — so those are skipped rather than written over.
    const mergeScalars = <T,>(current: T, next: T): T => {
      const merged = { ...(current as Record<string, unknown>) };
      Object.entries(next as Record<string, unknown>).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (typeof value === 'string' && value.trim() === '') return;
        if (typeof value === 'number' && value === 0) return;
        if (Array.isArray(value)) return;
        merged[key] = value;
      });
      return merged as T;
    };

    const next: AssessmentPayload = {
      ...payload,
      assessmentType: incoming.assessmentType ?? payload.assessmentType,
      property: mergeScalars(payload.property, incoming.property),
      loan: mergeScalars(payload.loan, incoming.loan),
      lease: {
        ...mergeScalars(payload.lease, incoming.lease),
        tenancies: incoming.lease.tenancies.length ? incoming.lease.tenancies : payload.lease.tenancies,
      },
      ownership: {
        ...mergeScalars(payload.ownership, incoming.ownership),
        entities: incoming.ownership.entities.length ? incoming.ownership.entities : payload.ownership.entities,
      },
      income: {
        ...payload.income,
        periods: incoming.income.periods.length ? incoming.income.periods : payload.income.periods,
        addbacks: incoming.income.periods.length ? incoming.income.addbacks : payload.income.addbacks,
      },
      portfolio: {
        ...payload.portfolio,
        assets: incoming.portfolio.assets.length ? incoming.portfolio.assets : payload.portfolio.assets,
        liabilities: incoming.portfolio.liabilities.length
          ? incoming.portfolio.liabilities : payload.portfolio.liabilities,
      },
      // Keep prior provenance and append the pack's, so a field imported from a
      // URL earlier still shows where it came from.
      provenance: [...payload.provenance, ...parsed.provenance],
    };

    update(next, 'intakePack');
  }, [payload, update]);

  const calculate = useCallback(async () => {
    if (!id || !payload || !liveResult) return;
    setCalculating(true);
    // Persist the working payload first: a calculation run must snapshot the
    // inputs that are actually saved, not a draft the server has never seen.
    await saveNow('calculation');
    const result = await ciAssessmentApi.runCalculation({ assessmentId: id, payload, result: liveResult });
    setCalculating(false);

    if (result.error) {
      toast({ title: 'Calculation not saved', description: result.error, variant: 'destructive' });
      return;
    }
    setSavedResult(liveResult);
    await reload();
    toast({
      title: 'Calculation saved',
      description: `${liveResult.outcomeLabel}. Engine ${liveResult.engineVersion}, policy ${liveResult.policyVersion}.`,
    });
    goToStep('results');
  }, [id, payload, liveResult, saveNow, reload, goToStep]);

  const complete = useCallback(async () => {
    if (!id) return;
    const result = await ciAssessmentApi.complete(id);
    if (result.error) {
      toast({ title: 'Could not complete', description: result.error, variant: 'destructive' });
      return;
    }
    await reload();
    toast({ title: 'Assessment completed', description: 'You can now link it to a client, or keep it standalone.' });
    goToStep('link');
  }, [id, reload, goToStep]);

  const generateReport = useCallback(() => {
    if (!liveResult) return;
    // Report generation reuses the platform's print path: the results view is
    // print-styled, so the browser's own renderer produces the PDF without a
    // second layout that could drift from the screen.
    window.print();
  }, [liveResult]);

  if (loading) {
    return (
      <div className="ci-shell">
        <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading assessment…
        </div>
      </div>
    );
  }

  if (!record || !payload || !liveResult) {
    return (
      <div className="ci-shell space-y-4">
        <div className="ci-warning-row ci-warning-critical">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{error ?? 'This assessment could not be found, or you do not have access to it.'}</span>
        </div>
        <Button variant="outline" onClick={() => navigate('/commercial')}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Back to Commercial &amp; Industrial
        </Button>
      </div>
    );
  }

  const definition = assessmentTypeDefinition(payload.assessmentType);
  const SegmentIcon = definition.segment === 'industrial' ? Factory : Building2;

  return (
    <div className="ci-foundation ci-workspace">
      <header className="ci-workspace-header">
        <div className="ci-workspace-header-inner">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              size="icon" variant="ghost" className="h-8 w-8 shrink-0"
              onClick={() => navigate('/commercial')}
              aria-label="Back to Commercial and Industrial"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <SegmentIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
                {record.title}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {record.reference} · {definition.label} · v{record.version}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="ci-status-badge ci-status-neutral">
              {ASSESSMENT_STATUS_LABELS[record.status]}
            </Badge>
            <SaveIndicator state={saveState} savedAt={lastSavedAt} />
            {saveState === 'conflict' ? (
              <Button size="sm" variant="outline" onClick={reload}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Reload
              </Button>
            ) : null}
            <Button size="sm" onClick={calculate} disabled={calculating || readOnly}>
              {calculating
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {calculating ? 'Calculating…' : 'Run calculation'}
            </Button>
          </div>
        </div>

        <nav className="mx-auto w-full max-w-[1600px] px-4 pb-3 sm:px-6 lg:px-8" aria-label="Assessment steps">
          <ol className="ci-steps">
            {STEPS.map((step, index) => {
              const isActive = step.key === activeStep;
              const stepIssues = issues.filter((issue) => issue.step === index + 1 && issue.severity === 'error');
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    onClick={() => goToStep(step.key)}
                    aria-current={isActive ? 'step' : undefined}
                    className={cn('ci-step-chip', isActive && 'ci-step-chip-active')}
                  >
                    <span className="ci-step-index" aria-hidden="true">{index + 1}</span>
                    <span>{step.label}</span>
                    {stepIssues.length ? (
                      <>
                        <AlertCircle className="h-3 w-3 text-destructive" aria-hidden="true" />
                        <span className="sr-only">{stepIssues.length} error(s)</span>
                      </>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <div className="ci-workspace-body">
        <main className="ci-workspace-main">
          {validation && validation.errors.length && activeStep !== 'results' ? (
            <div className="ci-warning-row ci-warning-critical" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">
                  {validation.errors.length} field{validation.errors.length === 1 ? '' : 's'} need attention
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {validation.errors.slice(0, 5).map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => goToStep(STEPS[Math.min(issue.step - 1, STEPS.length - 1)].key)}
                      >
                        Step {issue.step}: {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {activeStep === 'type' ? (
            <StepAssessmentType
              payload={payload} title={record.title} onTitleChange={setTitle}
              onChange={setPayload} disabled={readOnly}
            />
          ) : null}
          {activeStep === 'pack' ? (
            <IntakePackPanel
              payload={payload}
              assessmentReference={record.reference}
              assessmentTitle={record.title}
              segment={definition.segment === 'industrial' ? 'industrial' : 'commercial'}
              onApply={applyIntakePack}
              onCreateClient={() => window.open('/clients', '_blank', 'noopener,noreferrer')}
              disabled={readOnly}
            />
          ) : null}
          {activeStep === 'property' ? (
            <StepPropertyTransaction payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'ownership' ? (
            <StepOwnership payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'income' ? (
            <StepIncome payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'portfolio' ? (
            <StepPortfolio payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'lease' ? (
            <StepLeaseIncome payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'loan' ? (
            <StepLoanStructure
              payload={payload} onChange={setPayload} issues={issues}
              canOverridePolicy={canOverridePolicy} disabled={readOnly}
            />
          ) : null}
          {activeStep === 'results' ? (
            <>
              {!record.current_calculation_id ? (
                <div className="ci-warning-row ci-warning-info">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    These figures are live from your working data and have not been saved as a calculation
                    run yet. Run the calculation to snapshot the inputs, policy and outputs together.
                  </span>
                </div>
              ) : null}
              <StepResults
                payload={payload}
                result={savedResult ?? liveResult}
                onRecalculate={calculate}
                onGenerateReport={generateReport}
                calculating={calculating}
                canGenerateReport={Boolean(record.current_calculation_id)}
              />
              {record.status !== 'completed' && record.status !== 'linked' ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
                  <Button onClick={complete} disabled={!record.current_calculation_id}>
                    Complete assessment
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {record.current_calculation_id
                      ? 'Locks the working data and opens the client-linking step.'
                      : 'Run a calculation before completing.'}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
          {activeStep === 'link' ? (
            record.status === 'completed' || record.status === 'linked' ? (
              <StepClientLink
                assessmentId={record.id}
                payload={payload}
                linkedClientId={record.client_id}
                onLinked={reload}
                canLink={canLinkClient}
                canUpdateClient={canUpdateClient}
              />
            ) : (
              <div className="ci-step-panel">
                <h2 className="ci-step-heading">Save and link</h2>
                <p className="ci-step-description">
                  Client linking opens once the assessment is complete. Run the calculation, review the
                  result, then complete the assessment.
                </p>
                <Button variant="outline" onClick={() => goToStep('results')}>
                  Go to results
                </Button>
              </div>
            )
          ) : null}

          {/* Step navigation */}
          <nav className="flex items-center justify-between gap-3 border-t border-border pt-4" aria-label="Step navigation">
            <Button
              variant="outline" size="sm" disabled={activeIndex === 0}
              onClick={() => goToStep(STEPS[Math.max(0, activeIndex - 1)].key)}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Step {activeIndex + 1} of {STEPS.length}
            </span>
            <Button
              size="sm" disabled={activeIndex === STEPS.length - 1}
              onClick={async () => {
                await saveNow(STEPS[activeIndex]?.section);
                goToStep(STEPS[Math.min(STEPS.length - 1, activeIndex + 1)].key);
              }}
            >
              Next <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </nav>
        </main>

        <ResultsRail result={liveResult} onJumpToResults={() => goToStep('results')} />
      </div>
    </div>
  );
}
