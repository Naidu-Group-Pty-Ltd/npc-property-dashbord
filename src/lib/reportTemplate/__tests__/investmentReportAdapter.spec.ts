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

  /**
   * The four non-Compass tiers are investment reports, not a geography.
   *
   * This test asserted `reportType: 'address'` and was pinning the defect
   * rather than the contract. `investment_reports` has no `report_type` column,
   * so `getReportType` fell through to `report_scope` — `address` or `suburb`,
   * which is where the property is and not what the document is. `address`
   * matches no adapter, no alias and no `report_templates` row, so all 63
   * snapshot / briefing / strategic / financial reports refused with
   * `no_active_template` and fell back to the legacy generator. All five tiers
   * now resolve to the investment format; only Compass keeps its own spelling.
   */
  it('routes the non-Compass tiers to the investment format, not to their scope', async () => {
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
      .resolves.toEqual(expect.objectContaining({ reportType: 'investment', tier: 'financial' }));
  });
});
