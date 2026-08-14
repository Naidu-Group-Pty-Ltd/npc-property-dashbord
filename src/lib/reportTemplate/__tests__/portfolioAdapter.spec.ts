/**
 * The Portfolio adapter's review join.
 *
 * The adapter shipped without it: `applyPortfolioProjection` takes the
 * client's newest completed `portfolio_reviews` row as its third argument —
 * the join `render-portfolio-review-pdf` performs before building the same
 * document — and the adapter called it with two. The review, scenario and
 * per-property-score pages therefore rendered in the production-fit harness,
 * which does the join, and never through the product path: silently the same
 * output as `includeReview: false` on every render. This file pins the join,
 * clause for clause, against the route's own shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface QueryLog {
  table: string;
  eq: Array<[string, unknown]>;
  order: Array<[string, Record<string, unknown>]>;
  limit: number | null;
}

const harness: {
  rows: Record<string, unknown | null>;
  errors: Record<string, { message: string } | null>;
  queries: QueryLog[];
} = { rows: {}, errors: {}, queries: [] };

function builderFor(table: string) {
  const log: QueryLog = { table, eq: [], order: [], limit: null };
  harness.queries.push(log);
  const result = () => ({
    data: harness.rows[table] ?? null,
    error: harness.errors[table] ?? null,
  });
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => { log.eq.push([col, val]); return chain; },
    order: (col: string, opts: Record<string, unknown>) => { log.order.push([col, opts]); return chain; },
    limit: (n: number) => { log.limit = n; return chain; },
    in: () => chain,
    maybeSingle: async () => result(),
  };
  return chain;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => builderFor(table) },
}));

import { portfolioAdapter } from '../adapters/portfolioAdapter';
import { resetOrganisationCache } from '../adapters/organisation';

const ANALYSIS_ROW = {
  id: 'a4d5a570-0000-4000-8000-000000000001',
  client_id: 'c4d5a570-0000-4000-8000-000000000002',
  client_name: 'Jordan & Sarah Nguyen',
  health_score: 68,
  portfolio_value: 3_410_000,
  updated_at: '2026-08-12T00:00:00.000Z',
  // One holding, because `buildPortfolioReview` refuses a row with none — and
  // the review namespaces publish only through that build, which is exactly
  // why the adapter's missing join was invisible: the projection's own half
  // still rendered.
  report_data: {
    propertyAnalyses: [{ address: '9/44 Regent Street, Newtown', currentValue: 1_125_000 }],
  },
};

const REVIEW_ROW = {
  status: 'completed',
  review_date: '2026-08-02T14:16:14.279Z',
  risk_level: 'medium',
  overall_score: 55,
  executive_summary: 'Portfolio review completed with an overall score of 55/100.',
};

beforeEach(() => {
  harness.rows = {
    portfolio_analysis_reports: ANALYSIS_ROW,
    portfolio_reviews: REVIEW_ROW,
    whitelabel_settings: null,
  };
  harness.errors = {};
  harness.queries = [];
  resetOrganisationCache();
});

describe('the review join', () => {
  it('performs the route\'s own join, clause for clause', async () => {
    await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });

    const review = harness.queries.find((q) => q.table === 'portfolio_reviews');
    expect(review, 'no portfolio_reviews query was made').toBeTruthy();
    // `render-portfolio-review-pdf`'s exact clauses: the client, completed
    // only, newest review_date first with nulls last, one row.
    expect(review!.eq).toEqual([
      ['client_id', ANALYSIS_ROW.client_id],
      ['status', 'completed'],
    ]);
    expect(review!.order).toEqual([
      ['review_date', { ascending: false, nullsFirst: false }],
    ]);
    expect(review!.limit).toBe(1);
  });

  it('hands the review to the projection, so the review pages can render', async () => {
    const ctx = await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    const portfolio = ctx?.data.portfolio as Record<string, any>;
    expect(portfolio?.review?.summary)
      .toBe('Portfolio review completed with an overall score of 55/100.');
    // The normaliser words the level for the page: 'medium' → 'Medium'.
    expect(portfolio?.review?.riskLevel).toBe('Medium');
  });

  it('builds a thinner document, not a failed one, when the read errors', async () => {
    // The route's own posture: a review that cannot be read is a warning, and
    // the projection treats null exactly as `includeReview: false`.
    harness.errors.portfolio_reviews = { message: 'permission denied' };
    harness.rows.portfolio_reviews = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    expect(ctx).toBeTruthy();
    expect((ctx?.data.portfolio as Record<string, any> | undefined)?.review).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read the review'));
    warn.mockRestore();
  });

  it('asks for no review when the analysis names no client', async () => {
    harness.rows.portfolio_analysis_reports = { ...ANALYSIS_ROW, client_id: null };
    await portfolioAdapter.buildBindingContext({ reportId: ANALYSIS_ROW.id });
    expect(harness.queries.some((q) => q.table === 'portfolio_reviews')).toBe(false);
  });
});
