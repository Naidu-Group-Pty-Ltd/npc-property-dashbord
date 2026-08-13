/**
 * What a Commercial & Industrial Capacity template may bind.
 *
 * ## This restates the snapshot, it does not recompute anything
 *
 * `_shared/reports/commercialCapacity/` already builds a
 * `CommercialCapacitySnapshot` for `render-commercial-capacity-pdf`, from the
 * stored calculation run. This restates that, exactly as the Comparison, Client
 * Details and Report Q&A projections restate their normalisers.
 *
 * The format's first rule is that **every figure comes from the stored run and
 * never from a recomputation**, and a projection is the easiest place in this
 * programme to break it — a derived total here would be a second engine, and a
 * document whose arithmetic disagrees with the calculator a broker was looking
 * at is worse than one with a gap in it. Nothing below computes; it unwraps,
 * labels and caps.
 *
 * ## Measures are unwrapped to their values
 *
 * The snapshot wraps every number in a `Measure` so the renderer can format it.
 * A template binds `{{capacity.headline.maximumCapacity | currency}}` instead,
 * so this publishes `.value` and lets the filter do the formatting — the same
 * choice `clientDetailsProjection.pure.ts` made, and for the same reason: a
 * template cannot reach into an object it has no syntax for.
 *
 * ## The analysis carries its provenance or it is not published
 *
 * The contract's fourth rule is that the page says what it is. The provenance
 * note is published **beside** the analysis rather than left to each of fifty
 * masters to remember, so a master that draws the model's prose cannot draw it
 * without the sentence that says a model wrote it. `analysis` and
 * `analysisProvenance` are published together or not at all.
 *
 * ## What production actually holds
 *
 * Sixteen assessments; **thirteen have no calculation run** (seven `draft`, four
 * `archived`, two `data_entry`) and so have no figures for a document to carry.
 * Of the three that do, **all three are `outside_current_assumptions`, all bound
 * by the debt service coverage ratio**. A decline is not the edge case here — it
 * is the whole corpus — so `outcome`, `outcomeReason` and `bindingConstraint`
 * are the fields the masters are built around rather than a footnote.
 */
import type {
  CommercialCapacitySnapshot,
  ConstraintRow,
  CostLine,
} from './reports/commercialCapacity/payload.pure.ts';
import type { CapacityAnalysis } from './reports/commercialCapacity/analysis.pure.ts';
import { ANALYSIS_PROVENANCE_NOTE } from './reports/commercialCapacity/render.pure.ts';
import type { Measure } from './reportDesign/measure.pure.ts';

/**
 * Collections a page may draw.
 *
 * The page model cannot paginate, so an unbounded collection runs off the end of
 * a fixed sequence. Where a cap bites, the record's own count is printed beside
 * it — a table silently showing eight of nineteen costs is a misleading
 * document, and the count is what makes it an honest one.
 */
export const CAPS = {
  constraints: 8,
  transactionLines: 10,
  incomeLines: 10,
  tenancies: 6,
  findings: 6,
  scenarios: 3,
  questions: 6,
  warnings: 5,
  outstanding: 6,
  nextActions: 5,
  method: 8,
} as const;

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/** A `Measure` to the bare number a filter can format. Null stays absent. */
function num(m: Measure | null | undefined): number | undefined {
  if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value)) return undefined;
  return m.value;
}

function costLine(line: CostLine): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'label', str(line.label));
  put(out, 'amount', num(line.amount as Measure));
  put(out, 'note', str((line as unknown as Record<string, unknown>).note));
  return out;
}

function constraint(row: ConstraintRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const r = row as unknown as Record<string, unknown>;
  put(out, 'label', str(r.label));
  put(out, 'actual', num(r.actual as Measure));
  put(out, 'limit', num(r.limit as Measure));
  put(out, 'headroom', num(r.headroom as Measure));
  put(out, 'status', str(r.status));
  // Which test decided the answer. The whole document turns on this one row and
  // all three assessments in production are bound by the same test, so it is
  // published as a flag a master can draw a marker from.
  if (r.binding === true) out.binding = true;
  return out;
}

export interface ProjectedCommercialCapacity {
  capacity: Record<string, unknown>;
}

export function projectCommercialCapacity(
  snapshot: CommercialCapacitySnapshot,
): ProjectedCommercialCapacity {
  const capacity: Record<string, unknown> = {};
  const s = snapshot as unknown as Record<string, any>;

  // ── who and what ─────────────────────────────────────────────────────────
  const meta: Record<string, unknown> = {};
  put(meta, 'subject', str(s.meta?.subject));
  put(meta, 'reference', str(s.meta?.reference));
  put(meta, 'title', str(s.meta?.title));
  put(meta, 'assessedOn', str(s.meta?.assessedOn));
  put(meta, 'segment', str(s.meta?.segment));
  /*
   * Derived only when there is something to derive from.
   *
   * A ternary here always yields a string, which made `meta` truthy — and so
   * `capacity` truthy — for a snapshot with nothing in it. A page conditional on
   * `capacity` would then have drawn blank. Absent has to mean absent all the
   * way up, not merely per-key; the Report Q&A projection had the same defect in
   * `subject` and a test found it there too.
   */
  const segment = str(s.meta?.segment);
  if (segment) put(meta, 'segmentLabel', segment === 'industrial' ? 'Industrial' : 'Commercial');
  put(meta, 'assessmentType', str(s.meta?.assessmentTypeLabel));
  put(meta, 'lenderProfile', str(s.meta?.lenderProfile));
  // Both versions, because a figure is only reproducible against the pair that
  // produced it, and a re-issued report must be checkable against the first.
  put(meta, 'engineVersion', str(s.meta?.engineVersion));
  put(meta, 'policyVersion', str(s.meta?.policyVersion));
  if (Object.keys(meta).length) capacity.meta = meta;

  const property: Record<string, unknown> = {};
  put(property, 'address', str(s.property?.address));
  put(property, 'assetClass', str(s.property?.assetClass));
  put(property, 'gstTreatment', str(s.property?.gstTreatment));
  put(property, 'lettableArea', num(s.property?.lettableArea));
  put(property, 'purchasePrice', num(s.property?.purchasePrice));
  put(property, 'valuation', num(s.property?.valuation));
  put(property, 'valuationBasis', str(s.property?.valuationBasis));
  if (Object.keys(property).length) capacity.property = property;

  // ── the answer ───────────────────────────────────────────────────────────
  const h = s.headline ?? {};
  const headline: Record<string, unknown> = {};
  put(headline, 'outcome', str(h.outcome));
  put(headline, 'outcomeLabel', str(h.outcomeLabel));
  put(headline, 'outcomeReason', str(h.outcomeReason));
  put(headline, 'bindingConstraint', str(h.bindingConstraint));
  put(headline, 'maximumCapacity', num(h.maximumCapacity));
  put(headline, 'requestedLoan', num(h.requestedLoan));
  put(headline, 'difference', num(h.difference));
  put(headline, 'requiredContribution', num(h.requiredContribution));
  put(headline, 'assessmentRate', num(h.assessmentRate));
  put(headline, 'loanTerm', num(h.loanTerm));
  put(headline, 'amortisation', num(h.amortisation));
  put(headline, 'monthlyDebtService', num(h.monthlyDebtService));
  put(headline, 'surplus', num(h.surplus));
  put(headline, 'sensitisedSurplus', num(h.sensitisedSurplus));

  /*
   * Headroom or shortfall, as a word.
   *
   * `difference` is signed and a template cannot branch on a sign. Every
   * assessment in production is a shortfall, so a master that only reads
   * `difference` prints a negative number under a heading that says "headroom".
   */
  const difference = num(h.difference);
  if (difference !== undefined) {
    put(headline, 'differenceLabel', difference < 0 ? 'Shortfall' : 'Headroom');
    put(headline, 'differenceAbsolute', Math.abs(difference));
    put(headline, 'isShortfall', difference < 0 ? true : undefined);
  }
  if (Object.keys(headline).length) capacity.headline = headline;

  put(capacity, 'narrative', str(s.narrative));

  // ── the tests ────────────────────────────────────────────────────────────
  const r = s.ratios ?? {};
  const ratios: Record<string, unknown> = {};
  for (const key of [
    'lvr', 'lvrCeiling', 'dscr', 'dscrFloor', 'icr', 'icrFloor',
    'debtYield', 'debtYieldFloor', 'ltc', 'ltcCeiling', 'debtToEbitda',
  ]) put(ratios, key, num(r[key]));
  if (Object.keys(ratios).length) capacity.ratios = ratios;

  const constraints = Array.isArray(s.constraints) ? s.constraints : [];
  if (constraints.length) {
    capacity.constraints = constraints.slice(0, CAPS.constraints).map(constraint);
    put(capacity, 'constraintCount', constraints.length);
    if (constraints.length > CAPS.constraints) {
      put(capacity, 'constraintsOmitted',
        `${constraints.length - CAPS.constraints} further tests are not shown.`);
    }
  }

  // ── the money ────────────────────────────────────────────────────────────
  const t = s.transaction ?? {};
  const transaction: Record<string, unknown> = {};
  const tLines = Array.isArray(t.lines) ? t.lines : [];
  if (tLines.length) {
    transaction.lines = tLines.slice(0, CAPS.transactionLines).map(costLine);
    put(transaction, 'lineCount', tLines.length);
  }
  put(transaction, 'totalProjectCost', num(t.totalProjectCost));
  put(transaction, 'borrowerContribution', num(t.borrowerContribution));
  put(transaction, 'fundingGap', num(t.fundingGap));
  put(transaction, 'cashOut', num(t.cashOut));
  if (Object.keys(transaction).length) capacity.transaction = transaction;

  const pi = s.propertyIncome ?? {};
  const propertyIncome: Record<string, unknown> = {};
  const piLines = Array.isArray(pi.lines) ? pi.lines : [];
  if (piLines.length) {
    propertyIncome.lines = piLines.slice(0, CAPS.incomeLines).map(costLine);
    put(propertyIncome, 'lineCount', piLines.length);
  }
  put(propertyIncome, 'netOperatingIncome', num(pi.netOperatingIncome));
  put(propertyIncome, 'capitalisationRate', num(pi.capitalisationRate));
  put(propertyIncome, 'breakEvenOccupancy', num(pi.breakEvenOccupancy));
  put(propertyIncome, 'wale', num(pi.wale));
  put(propertyIncome, 'tenantCount', num(pi.tenantCount));
  put(propertyIncome, 'tenantConcentration', num(pi.tenantConcentration));
  if (Object.keys(propertyIncome).length) capacity.propertyIncome = propertyIncome;

  const bi = s.businessIncome ?? {};
  const businessIncome: Record<string, unknown> = {};
  put(businessIncome, 'adjustedEbitda', num(bi.adjustedEbitda));
  put(businessIncome, 'assessableIncome', num(bi.assessableIncome));
  put(businessIncome, 'trend', num(bi.trend));
  if (Object.keys(businessIncome).length) capacity.businessIncome = businessIncome;

  // ── what is missing, and what to do ──────────────────────────────────────
  const outstanding = Array.isArray(s.outstanding) ? s.outstanding : [];
  if (outstanding.length) {
    capacity.outstanding = outstanding.slice(0, CAPS.outstanding).map((o: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(o?.label));
      // Blocking items are the reason an assessment cannot progress. Published
      // as a word rather than a boolean so a table cell can print it.
      put(row, 'blocking', o?.blocking ? 'Blocking' : 'Outstanding');
      return row;
    });
    put(capacity, 'outstandingCount', outstanding.length);
    put(capacity, 'blockingCount',
      outstanding.filter((o: any) => o?.blocking).length || undefined);
  }

  const nextActions = (Array.isArray(s.nextActions) ? s.nextActions : [])
    .map(str).filter(Boolean) as string[];
  if (nextActions.length) {
    capacity.nextActions = nextActions.slice(0, CAPS.nextActions).map((label) => ({ label }));
  }

  const warnings = Array.isArray(s.warnings) ? s.warnings : [];
  if (warnings.length) {
    capacity.warnings = warnings.slice(0, CAPS.warnings).map((w: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(w?.label ?? w?.message ?? w?.title));
      put(row, 'detail', str(w?.detail ?? w?.description));
      return row;
    });
    put(capacity, 'warningCount', warnings.length);
  }

  const method = Array.isArray(s.method) ? s.method : [];
  if (method.length) {
    capacity.method = method.slice(0, CAPS.method).map((m: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(m?.label ?? m?.step));
      put(row, 'detail', str(m?.detail ?? m?.note));
      return row;
    });
  }

  put(capacity, 'disclaimer', str(s.disclaimer));

  // ── the model's reading ──────────────────────────────────────────────────
  applyAnalysis(capacity, s.analysis ?? null);

  return { capacity };
}

/**
 * The analysis, published with the sentence that says a model wrote it.
 *
 * Together or not at all. The contract's rule is that the page says what it is,
 * and leaving fifty masters each to remember a provenance note is a rule that
 * holds until one of them forgets. A master binding `capacity.analysis.*`
 * without `capacity.analysisProvenance` has nothing to print, which is a
 * visible failure rather than a silent one.
 */
function applyAnalysis(
  capacity: Record<string, unknown>,
  analysis: CapacityAnalysis | null,
): void {
  if (!analysis) return;
  const a = analysis as unknown as Record<string, any>;

  const out: Record<string, unknown> = {};
  put(out, 'interpretation', str(a.interpretation));

  const findings = Array.isArray(a.findings) ? a.findings : [];
  if (findings.length) {
    out.findings = findings.slice(0, CAPS.findings).map((f: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'title', str(f?.title));
      put(row, 'detail', str(f?.detail));
      // A judgement, not a colour — the interface says so and a template that
      // mapped it to red/green would be inventing one.
      put(row, 'significance', str(f?.significance));
      return row;
    });
  }

  const scenarios = Array.isArray(a.scenarios) ? a.scenarios : [];
  if (scenarios.length) {
    out.scenarios = scenarios.slice(0, CAPS.scenarios).map((sc: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'name', str(sc?.name));
      put(row, 'reasoning', str(sc?.reasoning));
      put(row, 'estimatedImpact', str(sc?.estimatedImpact));
      put(row, 'executionRisk', str(sc?.executionRisk));
      const evidence = (Array.isArray(sc?.evidenceRequired) ? sc.evidenceRequired : [])
        .map(str).filter(Boolean) as string[];
      if (evidence.length) put(row, 'evidence', evidence.join('; '));
      return row;
    });
  }

  const questions = (Array.isArray(a.questionsForCredit) ? a.questionsForCredit : [])
    .map(str).filter(Boolean) as string[];
  if (questions.length) {
    out.questions = questions.slice(0, CAPS.questions).map((label) => ({ label }));
  }

  if (!Object.keys(out).length) return;

  put(out, 'model', str(a.model));
  put(out, 'generatedAt', str(a.generatedAt));
  capacity.analysis = out;
  capacity.analysisProvenance = ANALYSIS_PROVENANCE_NOTE;
}

export function applyCommercialCapacityProjection(
  target: Record<string, unknown>,
  snapshot: CommercialCapacitySnapshot,
): void {
  const { capacity } = projectCommercialCapacity(snapshot);
  if (Object.keys(capacity).length) target.capacity = capacity;
}
