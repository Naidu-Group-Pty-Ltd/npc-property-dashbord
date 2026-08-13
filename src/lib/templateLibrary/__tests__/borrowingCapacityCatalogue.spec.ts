/**
 * The Borrowing Capacity family catalogue — the second report format drawn in
 * the ten Investment Compass designs.
 *
 * The interesting assertions here are not "it parses". They are:
 *
 *  1. the masters are genuinely production-ready, not preview-only;
 *  2. every figure they bind is one the projection actually publishes;
 *  3. the sample data's totals reconcile against their own components.
 *
 * (3) earns its place. The income page prints the component lines and the total
 * on one table, so a sample whose total does not equal its parts renders a
 * visibly wrong financial document in every preview, screenshot and PDF. The
 * first draft did exactly that — four lines summing to $280,000 under a
 * $245,000 total — and the render showed it immediately.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { deriveEntryFacts } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { projectBorrowingCapacity } from '../../../../supabase/functions/_shared/borrowingCapacityProjection.pure';
import { colourwaysForFamily, colourwayTokenOverride } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const sum = (rows: any[], key: string) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

function resolves(data: Record<string, any>, path: string): boolean {
  let cur: any = data;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

describe('the catalogue', () => {
  it('ships fifty masters across the same ten families', () => {
    expect(BORROWING_CAPACITY_TEMPLATES).toHaveLength(50);
    expect(new Set(BORROWING_CAPACITY_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('is production-ready, because the format has a real adapter', () => {
    // The whole point of building `borrowingCapacityAdapter` before this
    // catalogue. Preview-only masters would look finished and never render a
    // client's assessment.
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      expect(t.reportType, t.name).toBe('borrowing_capacity');
      expect(deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready, t.name)
        .toBe(true);
    }
  });

  it('does not collide with the Investment Compass masters', () => {
    // Both catalogues use the same variant codes — `pb-01` exists in each — so
    // the slug has to carry the format. It is the primary key of a library row.
    const bc = BORROWING_CAPACITY_TEMPLATES.map((t) => t.slug);
    const ic = INVESTMENT_COMPASS_TEMPLATES.map((t) => t.slug);
    expect(new Set(bc).size).toBe(50);
    expect(bc.filter((s) => ic.includes(s))).toEqual([]);
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      expect(t.designMeta.reportFormat).toBe('borrowing-capacity');
    }
  });

  it('parses against the live schema contract', () => {
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      expect(() => parseTemplate(t.schema), t.name).not.toThrow();
    }
  });

  it('omits the two pages whose data does not exist', () => {
    // `explanation` is null on all 143 stored assessments, and the audit trail
    // has an unbounded row count this fixed-position page model cannot paginate.
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      const names = t.schema.pages.map((p) => p.name);
      expect(names, t.name).not.toContain('How this was calculated');
      expect(names, t.name).not.toContain('Audit trail');
    }
  });
});

describe('every bound figure has a source', () => {
  /** What the projection publishes for a fully-populated assessment. */
  const projected = projectBorrowingCapacity({
    gross_annual_income: 280000, shaded_annual_income: 263320,
    income_breakdown: [{ component: 'x', grossAmount: 1, shadedAmount: 1, shadingRate: 0 }],
    living_expenses_monthly: 6420, expense_method: 'hem',
    expense_breakdown: { declaredExpenses: 5900, hemBenchmark: 6420 },
    existing_commitments_monthly: 1840,
    liability_breakdown: [{ type: 'x', balance: 1, limit: 1, monthlyServicing: 1 }],
    interest_rate_used: 6.14, buffer_rate: 3, assessment_rate: 9.14, loan_term_years: 30,
    proposed_loan_amount: 1032000, proposed_lvr: 80, borrowing_capacity: 1180000,
    monthly_surplus: 1290, serviceability_band: 'amber', stress_tested_capacity: 1042000,
    dti_ratio: 5.95, recommendations: ['a', 'b', 'c'], warnings: ['w'],
    assumptions: { selectedLenderName: 'Example Bank' },
    lmi_mode: 'display_deduction', lmi_amount: 21400, lmi_lvr_trigger: 80,
    updated_at: '2026-08-12T00:00:00.000Z',
  });

  it('binds only namespaces the projection publishes', () => {
    const published = new Set([
      ...Object.keys(projected), 'client', 'org', 'report',
    ]);
    const bound = new Set<string>();
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\./g)) bound.add(m[1]);
    }
    // A namespace bound but never published renders empty on every real
    // assessment — the exact defect the Investment Compass masters shipped with.
    expect([...bound].filter((ns) => !published.has(ns))).toEqual([]);
  });
});

describe('the sample data is arithmetically honest', () => {
  const income = SAMPLE.income as any;
  const liabilities = SAMPLE.liabilities as any;
  const expenses = SAMPLE.expenses as any;
  const capacity = SAMPLE.capacity as any;
  const loan = SAMPLE.loan as any;

  it('totals the income table it prints', () => {
    expect(sum(income.items, 'grossAmount')).toBe(income.gross);
    expect(sum(income.items, 'shadedAmount')).toBe(income.shaded);
    expect(income.gross - income.shaded).toBe(income.shadingApplied);
  });

  it('totals the liabilities table it prints', () => {
    expect(sum(liabilities.items, 'monthlyServicing')).toBe(liabilities.monthly);
  });

  it('annualises consistently', () => {
    expect(expenses.monthly * 12).toBe(expenses.annual);
    expect(liabilities.monthly * 12).toBe(liabilities.annual);
    expect(capacity.monthlySurplus * 12).toBe(capacity.annualSurplus);
  });

  it('keeps the lending arithmetic self-consistent', () => {
    expect(loan.interestRate + loan.bufferRate).toBeCloseTo(loan.assessmentRate, 9);
    expect(capacity.propertyValueEstimate - loan.proposed).toBe(capacity.depositAmount);
    // A stress test that exceeded the headline capacity would be nonsense.
    expect(capacity.stressTested).toBeLessThan(capacity.borrowing);
  });
});

describe('rendering', () => {
  it('renders every master with real figures on the page', () => {
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain('$1,180,000');
      expect(html, t.name).not.toContain('{{');
    }
  });

  it('changes the colour and never the layout', () => {
    const geometry = (html: string) => (html.match(/left:[\d.]+pt;top:[\d.]+pt/g) ?? []).join('|');
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html);
      for (const cw of colourwaysForFamily(t.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(t.schema as any, {
          data: SAMPLE, tokenOverrides: colourwayTokenOverride(cw),
        }).html);
        expect(other, `${t.name} / ${cw.name}`).toBe(base);
      }
    }
  });

  it('drops the LMI block when LMI does not apply', () => {
    // 140 of 143 assessments have lmi_mode 'none'. The sample carries `lmi: {}`
    // so this is the path a reviewer sees.
    const t = BORROWING_CAPACITY_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
    expect(html).not.toContain('Lenders mortgage insurance');
    const withLmi = renderTemplateToHtml(t.schema as any, {
      data: { ...SAMPLE, lmi: { amount: 21400, lvrTrigger: 80, mode: 'display_deduction' } },
    }).html;
    expect(withLmi).toContain('Lenders mortgage insurance');
  });
});
