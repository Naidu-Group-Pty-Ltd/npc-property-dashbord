/**
 * The Portfolio Performance Review family catalogue — the third report format
 * drawn in the ten Investment Compass designs.
 *
 * The assertions that earn their place here are the ones about *data*, not
 * about parsing:
 *
 *  1. every namespace the masters bind is one the projection publishes;
 *  2. the sample portfolio's totals are summed from its own holdings;
 *  3. the two shipping **voice** templates that share `report_type: 'portfolio'`
 *     resolve too — the adapter flipped them to production-ready, and a
 *     production-ready template bound to a vocabulary nothing publishes is the
 *     defect `docs/reports/COVERAGE.md` records against the Compass masters;
 *  4. the inventory says on the page when it cannot show every holding, which
 *     is `PORTFOLIO.md`'s finding **F4** — the shipping generator drops rows
 *     "with nothing on the page saying so".
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { PORTFOLIO_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/portfolio';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { SEED_TEMPLATES } from '../../../../scripts/template-library/templates';
import { deriveEntryFacts } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { projectPortfolio } from '../../../../supabase/functions/_shared/portfolioProjection.pure';
import { colourwaysForFamily, colourwayTokenOverride } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const portfolio = SAMPLE.portfolio as Record<string, any>;
const properties = SAMPLE.properties as Array<Record<string, number>>;

const sum = (key: string) => properties.reduce((t, p) => t + Number(p[key] ?? 0), 0);

/** Namespaces every template may bind regardless of format. */
const AMBIENT = ['client', 'org', 'report', 'author'];

function boundNamespaces(templates: Array<{ schema: unknown }>): Set<string> {
  const out = new Set<string>();
  for (const t of templates) {
    for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\./g)) out.add(m[1]);
  }
  return out;
}

describe('the catalogue', () => {
  it('ships fifty masters across the same ten families', () => {
    expect(PORTFOLIO_TEMPLATES).toHaveLength(50);
    expect(new Set(PORTFOLIO_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('is production-ready, because the format has a real adapter', () => {
    for (const t of PORTFOLIO_TEMPLATES) {
      expect(t.reportType, t.name).toBe('portfolio');
      expect(deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready, t.name)
        .toBe(true);
    }
  });

  it('does not collide with either of the other two family catalogues', () => {
    // All three use the same variant codes — `pb-01` exists in each — so the
    // slug carries the format. It is the primary key of a library row.
    const mine = PORTFOLIO_TEMPLATES.map((t) => t.slug);
    const others = [...INVESTMENT_COMPASS_TEMPLATES, ...BORROWING_CAPACITY_TEMPLATES].map((t) => t.slug);
    expect(new Set(mine).size).toBe(50);
    expect(mine.filter((s) => others.includes(s))).toEqual([]);
    for (const t of PORTFOLIO_TEMPLATES) {
      expect(t.designMeta.reportFormat).toBe('portfolio-review');
    }
  });

  it('parses against the live schema contract', () => {
    for (const t of PORTFOLIO_TEMPLATES) {
      expect(() => parseTemplate(t.schema), t.name).not.toThrow();
    }
  });
});

describe('every bound figure has a source', () => {
  /** What the projection publishes for a fully-populated stored report. */
  const projected = projectPortfolio({
    client_name: 'Example Client',
    health_score: 68, overall_health: 'Moderate',
    portfolio_value: 3410000, total_equity: 1322000, total_properties: 4,
    average_lvr: 55.96, average_yield: 4.31, net_monthly_cashflow: -1183.33,
    updated_at: '2026-08-12T00:00:00.000Z',
    report_data: {
      portfolioMetrics: {
        totalValue: 3410000, totalDebt: 2088000, totalEquity: 1322000, totalProperties: 4,
        investmentCount: 3, ownerOccupiedCount: 1, averageLVR: 55.96, averageYield: 4.31,
        netMonthlyCashflow: -1183.33, totalMonthlyRentalIncome: 11691.58,
        totalMonthlyExpenses: 12874.91,
        bestPerformer: { address: 'a', value: 1, net_monthly_cashflow: 1, property_type: 'House' },
        worstPerformer: { address: 'b', value: 1, net_monthly_cashflow: -1, property_type: 'House' },
      },
      propertyAnalyses: [
        { address: 'a', value: 1, loan: 1, equity: 0, lvr: 1, grossYield: 1, netMonthlyCashflow: 1, annualCashflow: 12 },
      ],
      analysis: {
        executiveSummary: {
          healthScore: 68, overallHealth: 'Moderate', primaryRecommendation: 'x',
          // The observed minimums: 3 strengths, 2 concerns. The masters draw
          // exactly that many, so a shorter fixture here would pass while the
          // page printed a marker with nothing beside it.
          keyStrengths: ['s1', 's2', 's3'], keyConcerns: ['c1', 'c2'],
        },
        financialHealth: {
          analysis: 'x', cashflowStatus: 'x', debtServiceability: 'x',
          equityPosition: 'x', lvrRisk: 'x',
        },
        // The five list-shaped fields are arrays on all 21 stored reports, at
        // the observed minimum lengths: 2 market risks, 4 mitigations, 3
        // priority actions, 1 per horizon.
        riskAssessment: {
          overallRiskLevel: 'Moderate', concentrationRisk: 'x', vacancyRisk: 'x',
          interestRateSensitivity: 'x',
          marketRisks: ['m1', 'm2'],
          mitigationStrategies: ['s1', 's2', 's3', 's4'],
        },
        strategicRecommendations: {
          priorityActions: ['a', 'b', 'c'],
          shortTerm: ['st'], mediumTerm: ['mt'], longTerm: ['lt'],
        },
      },
    },
  });

  it('binds only namespaces the projection publishes', () => {
    const published = new Set([...Object.keys(projected), ...AMBIENT]);
    const unpublished = [...boundNamespaces(PORTFOLIO_TEMPLATES)].filter((ns) => !published.has(ns));
    expect(unpublished).toEqual([]);
  });

  it('publishes every leaf the masters bind, not just the namespace', () => {
    // A namespace that resolves and a leaf that resolves are different claims,
    // and only the second one puts a figure on the page.
    const flat = new Map<string, unknown>();
    const walk = (value: unknown, path: string) => {
      flat.set(path, value);
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    for (const [k, v] of Object.entries(projected)) walk(v, k);

    const missing = new Set<string>();
    for (const t of PORTFOLIO_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)/g)) {
        const path = m[1];
        if (AMBIENT.includes(path.split('.')[0])) continue;
        // Indexed leaves resolve through the array the projection publishes.
        if (!flat.has(path) && !flat.has(path.replace(/\.\d+\./g, '.0.'))) missing.add(path);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('keeps the portfolio-risk assessment clear of the client risk profile', () => {
    // `risk.vacancy` already means "reaction to three months vacancy" to the
    // voice catalogue — a client tolerance, not a portfolio exposure. Shortening
    // `vacancyRisk` to `vacancy` would have replaced it wherever both
    // vocabularies share a data object.
    expect(projected.risk).toHaveProperty('vacancyRisk');
    expect(projected.risk).not.toHaveProperty('vacancy');
    expect((SAMPLE.risk as Record<string, unknown>).vacancy).toBe('Can absorb 8 weeks');
  });

  it('resolves the shipping voice template that shares this report type', () => {
    // `portfolio-review` predates all of this and binds `portfolio.count`,
    // `portfolio.holdings.0.net` and so on. The adapter made it production-ready,
    // so those have to resolve or a client's portfolio prints as blanks.
    const voice = SEED_TEMPLATES.find((t) => t.slug === 'portfolio-review');
    expect(voice, 'the voice portfolio template still exists').toBeTruthy();

    const p = projected.portfolio as Record<string, unknown>;
    for (const leaf of ['count', 'lvr', 'grossYield', 'netCashFlow', 'holdings', 'strength', 'watch', 'narrative']) {
      expect(p[leaf], leaf).toBeDefined();
    }
    const holding = (p.holdings as Array<Record<string, unknown>>)[0];
    expect(Object.keys(holding).sort()).toEqual(['address', 'debt', 'equity', 'net', 'value', 'yield']);

    // Ratios of two stored totals, not the mean-of-property averages beside
    // them. Publishing `averageLvr` under the name `lvr` would answer a
    // different question in the same words.
    expect(p.lvr).toBeCloseTo((2088000 / 3410000) * 100, 6);
    expect(p.lvr).not.toBe(p.averageLvr);
    expect(p.grossYield).toBeCloseTo(((11691.58 * 12) / 3410000) * 100, 6);
  });

  it('leaves the four unmappable voice leaves absent rather than guessing', () => {
    // The stored analysis has no portfolio growth series, no rated category
    // notes, no headline/body split on its one recommendation, and no owner or
    // due date on its priority actions. A plausible-looking guess on a client's
    // page is worse than a gap.
    const p = projected.portfolio as Record<string, unknown>;
    expect(p.growth12m).toBeUndefined();
    expect(p.scores).toBeUndefined();
    expect(p.recommendation).toBeUndefined();
    expect((p.actions as Array<Record<string, unknown>>)[0]).toEqual({ action: 'a' });
  });
});

describe('the sample data is arithmetically honest', () => {
  it('totals the holdings table it prints', () => {
    expect(portfolio.value).toBe(sum('value'));
    expect(portfolio.debt).toBe(sum('loan'));
    expect(portfolio.equity).toBe(sum('equity'));
    expect(portfolio.equity).toBe(portfolio.value - portfolio.debt);
    expect(portfolio.monthlyCashflow).toBeCloseTo(sum('netMonthlyCashflow'), 9);
  });

  it('reconciles rent less expenses against the net position', () => {
    // All three are printed on one table, directly under each other.
    expect(portfolio.monthlyRentalIncome - portfolio.monthlyExpenses)
      .toBeCloseTo(portfolio.monthlyCashflow, 9);
  });

  it('annualises consistently, and agrees with the voice figures it shares a namespace with', () => {
    expect(portfolio.annualCashflow).toBeCloseTo(portfolio.monthlyCashflow * 12, 6);
    // The voice templates print the same portfolio annually. A preview in which
    // two pages of the same catalogue disagree about one number is the thing
    // this file exists to prevent.
    expect(Math.round(portfolio.annualCashflow)).toBe(portfolio.netCashFlow);
    expect(portfolio.propertyCount).toBe(portfolio.count);
    expect(portfolio.investmentCount + portfolio.ownerOccupiedCount).toBe(portfolio.propertyCount);
  });

  it('keeps the weighted ratios and the mean-of-property averages apart', () => {
    // Both are correct and they are not equal: 61.2% weighted against 55.96%
    // mean. `portfolio_analysis_reports` stores the mean, which is why the
    // masters label it "Average LVR" rather than "Portfolio LVR".
    expect(portfolio.averageLvr).toBeCloseTo(55.9611, 3);
    expect(portfolio.lvr).toBe(61.2);
    expect(portfolio.averageYield).toBeCloseTo(4.31, 9);
  });
});

describe('rendering', () => {
  it('renders every master with real figures and nothing unresolved', () => {
    for (const t of PORTFOLIO_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain('$3,410,000');
      expect(html, t.name).toContain('-$1,183');
      expect(html, t.name).not.toContain('{{');
    }
  });

  /**
   * 550 renders: fifty masters against their base palette and each of their ten
   * colourways. Exhaustive on purpose — a colourway that moved a block would
   * move it on exactly one family — and slow enough to need saying so, because
   * the 5s default passes when this file runs alone and times out when it runs
   * beside the other catalogues.
   */
  it('changes the colour and never the layout', () => {
    const geometry = (html: string) => (html.match(/left:[\d.]+pt;top:[\d.]+pt/g) ?? []).join('|');
    for (const t of PORTFOLIO_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html);
      for (const cw of colourwaysForFamily(t.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(t.schema as any, {
          data: SAMPLE, tokenOverrides: colourwayTokenOverride(cw),
        }).html);
        expect(other, `${t.name} / ${cw.name}`).toBe(base);
      }
    }
  }, 60_000);

  it('says on the page when the inventory cannot show every holding', () => {
    // PORTFOLIO.md's F4: the shipping generator drops rows past the second page
    // "with nothing on the page saying so". This page model also cannot
    // paginate — so it must say so.
    const notice = 'does not show the whole portfolio';
    for (const t of PORTFOLIO_TEMPLATES) {
      const four = renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html;
      expect(four, t.name).not.toContain(notice);

      const six = renderTemplateToHtml(t.schema as any, {
        data: { ...SAMPLE, portfolio: { ...portfolio, propertyCount: 6 } },
      }).html;
      expect(six, t.name).toContain(notice);
      expect(six, t.name).toContain('The portfolio holds 6 properties');
    }
  });

  it('never lets an object reach a page where a paragraph belongs', () => {
    // The names lie about the shapes: `analysis.executiveSummary` is an object,
    // not a paragraph, and `strategicRecommendations` is four horizon buckets
    // rather than a list. The projection publishes a leaf only when it is
    // genuinely a string, which is what stops `[object Object]` reaching a
    // client's page. Assert it through the projection, because that is where
    // the guarantee lives — the renderer will happily print whatever it is
    // handed.
    const stringy = projectPortfolio({
      report_data: {
        analysis: {
          executiveSummary: { primaryRecommendation: { headline: 'nested' }, overallHealth: 'Fine' },
          financialHealth: { analysis: ['an', 'array'], cashflowStatus: 'Positive' },
          strategicRecommendations: { shortTerm: { nested: true }, longTerm: ['Hold'] },
        },
      },
    });
    expect(stringy.summary.primaryRecommendation).toBeUndefined();
    expect(stringy.summary.overallHealth).toBe('Fine');
    expect(stringy.health.analysis).toBeUndefined();
    expect(stringy.health.cashflowStatus).toBe('Positive');
    expect(stringy.actions.shortTerm).toBeUndefined();
    expect(stringy.actions.longTerm).toEqual(['Hold']);

    const { html } = renderTemplateToHtml(PORTFOLIO_TEMPLATES[0].schema as any, {
      data: { ...SAMPLE, ...stringy },
    });
    expect(html).not.toContain('[object Object]');
  });
});
