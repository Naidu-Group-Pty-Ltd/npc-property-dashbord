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

  it('preserves report scope routing for non-Compass rows', async () => {
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
      .resolves.toEqual(expect.objectContaining({ reportType: 'address' }));
  });
});
