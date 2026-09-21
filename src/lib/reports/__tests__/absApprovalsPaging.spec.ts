/**
 * Paging the supply register.
 *
 * The numbers these rules exist for are production measurements taken by
 * `abs-approvals-liveness` on 21 Sep 2026, not fixtures: at SA2 grain with
 * the query narrowed, 33 months is 111.6 MB, 12 months is 26.0 MB and 6
 * months is 12.2 MB against a 24 MB ceiling.
 */
import { describe, it, expect } from 'vitest';
import {
  APPROVALS_PAGE_MONTHS,
  approvalsPage,
  monthSpan,
  pagesToCover,
  shiftMonth,
} from '../../../../supabase/functions/_shared/reports/market/openData/absApprovalsPaging.pure.ts';

describe('period arithmetic has no Date in it', () => {
  it('shifts across year boundaries in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-09', -12)).toBe('2025-09');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });

  it('refuses anything that is not YYYY-MM rather than coercing it', () => {
    expect(() => shiftMonth('2026-9', -1)).toThrow(/must be YYYY-MM/);
    expect(() => shiftMonth('September 2026', -1)).toThrow(/must be YYYY-MM/);
    expect(() => monthSpan('2026-09', 'later')).toThrow(/must be YYYY-MM/);
  });

  it('counts a span inclusively, and signs a backwards one', () => {
    expect(monthSpan('2026-04', '2026-09')).toBe(6);
    expect(monthSpan('2026-09', '2026-09')).toBe(1);
    expect(monthSpan('2026-09', '2026-04')).toBeLessThan(0);
  });
});

describe('the frontier is measured, never assumed', () => {
  it('asks page 0 forward from today and imposes NO floor', () => {
    /*
     * The ABS publishes with a lag: a six-month window asked on 21 Sep 2026
     * returned four months, to 2026-07. Judging that as truncated would
     * refuse every healthy load, and hard-coding "expect two months" is a
     * constant nobody here can verify and the Bureau can change silently.
     */
    const page = approvalsPage(0, '2026-09', null);
    expect(page).toEqual({ index: 0, startPeriod: '2026-04', endPeriod: '2026-09', minPeriods: null });
  });

  it('treats a first run with no frontier as the frontier whatever the index', () => {
    expect(approvalsPage(3, '2026-09', null).minPeriods).toBeNull();
    expect(approvalsPage(3, '2026-09', null).endPeriod).toBe('2026-09');
  });
});

describe('every page after the frontier lies wholly in the past', () => {
  // The frontier the Bureau actually gave on 21 Sep 2026.
  const FRONTIER = '2026-07';

  it('steps back a whole window and demands a full one', () => {
    expect(approvalsPage(1, '2026-09', FRONTIER))
      .toEqual({ index: 1, startPeriod: '2026-01', endPeriod: '2026-06', minPeriods: 6 });
    expect(approvalsPage(2, '2026-09', FRONTIER))
      .toEqual({ index: 2, startPeriod: '2025-07', endPeriod: '2025-12', minPeriods: 6 });
  });

  it('never overlaps the frontier page, so no month is fetched twice', () => {
    const first = approvalsPage(0, '2026-09', null);
    const second = approvalsPage(1, '2026-09', FRONTIER);
    // The frontier page covered up to 2026-07 (what the publisher had); the
    // next page must end the month before it.
    expect(second.endPeriod).toBe(shiftMonth(FRONTIER, -1));
    expect(monthSpan(second.startPeriod, second.endPeriod)).toBe(APPROVALS_PAGE_MONTHS);
    expect(first.endPeriod > second.endPeriod).toBe(true);
  });

  it('leaves no gap between consecutive pages', () => {
    for (let i = 1; i < 6; i++) {
      const here = approvalsPage(i, '2026-09', FRONTIER);
      const next = approvalsPage(i + 1, '2026-09', FRONTIER);
      expect(shiftMonth(next.endPeriod, 1)).toBe(here.startPeriod);
    }
  });

  it('refuses a page index that is not a whole number of pages back', () => {
    expect(() => approvalsPage(-1, '2026-09', FRONTIER)).toThrow(/non-negative integer/);
    expect(() => approvalsPage(1.5, '2026-09', FRONTIER)).toThrow(/non-negative integer/);
    expect(() => approvalsPage(1, '2026-09', FRONTIER, 0)).toThrow(/at least one month/);
  });
});

describe('a run can say what remains', () => {
  it('counts the pages between a frontier and a floor', () => {
    // 2023-01 to 2026-07 is 43 months: eight six-month pages.
    expect(pagesToCover('2026-07', '2023-01')).toBe(8);
    expect(pagesToCover('2026-07', '2026-02')).toBe(1);
  });

  it('never answers zero, because the frontier page always runs', () => {
    expect(pagesToCover('2026-07', '2026-07')).toBe(1);
    expect(pagesToCover('2026-07', '2027-01')).toBe(1);
  });

  it('is the page size the measurement supports', () => {
    // 12 months measured 26.0 MB against a 24 MB ceiling; 6 measured 12.2.
    expect(APPROVALS_PAGE_MONTHS).toBe(6);
  });
});
