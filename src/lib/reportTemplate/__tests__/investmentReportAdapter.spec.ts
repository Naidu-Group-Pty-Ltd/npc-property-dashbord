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
   * This test used to assert `reportType: 'address'` under the name
   * "preserves report scope routing for non-Compass rows" — which is a
   * description of the defect, not of a contract.
   *
   * `investment_reports` has `report_tier`, `report_variant` and
   * `report_scope`, and has never had a `report_type`. So the old expression
   * fell through to `report_scope`, which is a GEOGRAPHY, not a format. Read
   * from production on 2026-08-16:
   *
   *   | tier      | rows | scopes present  |
   *   | compass   | 1124 | address, suburb |
   *   | snapshot  |   24 | address         |
   *   | briefing  |   21 | address         |
   *   | financial |    9 | address         |
   *   | strategic |    9 | address         |
   *
   * All 63 non-compass rows resolved to `address`, which matches no adapter,
   * no entry in `REPORT_TYPE_ALIASES` and no row in `report_templates` — so
   * `routeReportThroughTemplate` refused with `no_active_template` and fell
   * back to the legacy generator on every one of them.
   *
   * All five tiers are one format. The assertion now pins that, so a scope
   * cannot be mistaken for a format again.
   */
  it('routes every non-Compass tier to the investment format, never to a scope', async () => {
    for (const tier of ['snapshot', 'briefing', 'financial', 'strategic']) {
      invokeSecureFunction.mockResolvedValue({
        data: {
          report: {
            id: 'report-2',
            report_scope: 'address',
            report_tier: tier,
            report_variant: tier,
          },
        },
        error: null,
      });

      const ctx = await investmentReportAdapter.resolveRoutingContext({ reportId: 'report-2' });
      expect(ctx, tier).toEqual(expect.objectContaining({ reportType: 'investment' }));
      // A geography must never reach the router as a format.
      expect(ctx?.reportType, tier).not.toBe('address');
      expect(ctx?.reportType, tier).not.toBe('suburb');
      // The tier itself is still carried — it selects the variant, not the format.
      expect(ctx?.tier, tier).toBe(tier);
    }
  });

  it('does not let a suburb-scoped Compass row become a suburb format', async () => {
    // `suburb` is a scope AND a category, which is the whole reason the
    // confusion was possible. 1,124 compass rows span both scopes.
    invokeSecureFunction.mockResolvedValue({
      data: {
        report: {
          id: 'report-3',
          report_scope: 'suburb',
          report_tier: 'compass',
          report_variant: 'compass',
        },
      },
      error: null,
    });

    await expect(investmentReportAdapter.resolveRoutingContext({ reportId: 'report-3' }))
      .resolves.toEqual(expect.objectContaining({ reportType: 'investment_compass' }));
  });
});
