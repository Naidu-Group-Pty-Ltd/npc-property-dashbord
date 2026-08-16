import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeSecureFunction } = vi.hoisted(() => ({
  invokeSecureFunction: vi.fn(),
}));

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction,
}));

import { investmentReportAdapter } from '../adapters/investmentReportAdapter';

describe('investmentReportAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes Compass rows through the canonical Compass report type', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: {
        report: {
          id: 'report-1',
          report_scope: 'address',
          report_tier: 'compass',
          report_variant: 'compass',
        },
      },
      error: null,
    });

    await expect(investmentReportAdapter.resolveRoutingContext({ reportId: 'report-1' }))
      .resolves.toEqual(expect.objectContaining({ reportType: 'investment_compass' }));
  });

  /*
   * A scope is not a format.
   *
   * This asserted `reportType: 'address'`, which is what the adapter used to
   * return — `getReportType` read `row.report_type`, a column
   * `investment_reports` has never had, and fell through to `report_scope`.
   * `address` matches no adapter, no entry in `REPORT_TYPE_ALIASES` and no row
   * in `report_templates`, so the four non-Compass tiers — snapshot, briefing,
   * strategic, financial, 63 reports — refused with `no_active_template` and
   * fell back to the legacy generator every time. The render ledger held five
   * `investment_compass` jobs and none of any other tier.
   *
   * All five tiers are one format. The spec encoded the defect, so it is
   * inverted here rather than deleted: the case it was written to cover — a
   * non-Compass row routing somewhere sensible — is the case that was broken.
   */
  it('routes a non-Compass tier to the investment format, not its scope', async () => {
    invokeSecureFunction.mockResolvedValue({
      data: {
        report: {
          id: 'report-2',
          report_scope: 'address',
          report_tier: 'financial',
          report_variant: 'financial',
        },
      },
      error: null,
    });

    await expect(investmentReportAdapter.resolveRoutingContext({ reportId: 'report-2' }))
      .resolves.toEqual(expect.objectContaining({
        reportType: 'investment',
        tier: 'financial',
        variant: 'financial',
      }));
  });
});
